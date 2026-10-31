import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  compareVersions,
  shouldCheckForUpdates,
  matchAssetForPlatform,
  loadUpdateSettings,
  saveUpdateSettings,
  getSettingsPath,
  type UpdateAsset,
  type UpdateSettings,
} from './updateService';

describe('UpdateService - SemVer Comparison & Core Logic', () => {
  describe('compareVersions', () => {
    it('compares standard major/minor/patch releases', () => {
      expect(compareVersions('3.8.0', '3.7.5')).toBe(true);
      expect(compareVersions('3.7.6', '3.7.5')).toBe(true);
      expect(compareVersions('4.0.0', '3.9.9')).toBe(true);

      expect(compareVersions('3.7.5', '3.7.5')).toBe(false);
      expect(compareVersions('3.7.4', '3.7.5')).toBe(false);
      expect(compareVersions('2.9.9', '3.0.0')).toBe(false);
    });

    it('handles leading "v" prefix correctly', () => {
      expect(compareVersions('v3.7.6', '3.7.5')).toBe(true);
      expect(compareVersions('3.7.6', 'v3.7.5')).toBe(true);
      expect(compareVersions('v3.7.6', 'v3.7.5')).toBe(true);
      expect(compareVersions('v3.7.5', 'v3.7.5')).toBe(false);
    });

    it('handles pre-release tags properly according to SemVer 2.0', () => {
      // Release version is greater than pre-release of the same version
      expect(compareVersions('3.7.6', '3.7.6-beta.1')).toBe(true);
      expect(compareVersions('3.7.6-beta.1', '3.7.6')).toBe(false);

      // Pre-release versions comparison
      expect(compareVersions('3.7.6-beta.2', '3.7.6-beta.1')).toBe(true);
      expect(compareVersions('3.7.6-beta.1', '3.7.6-beta.2')).toBe(false);
      expect(compareVersions('3.7.6-rc.1', '3.7.6-beta.9')).toBe(true);

      // Newer base version with pre-release is greater than older release
      expect(compareVersions('3.7.6-beta.1', '3.7.5')).toBe(true);
      expect(compareVersions('3.7.4', '3.7.5-beta.1')).toBe(false);
    });
  });

  describe('shouldCheckForUpdates', () => {
    it('returns false if autoCheck is disabled', () => {
      const settings: UpdateSettings = {
        autoCheck: false,
        lastCheckTime: 0,
        checkIntervalHours: 24,
        channel: 'stable',
        repo: 'test/repo',
      };
      expect(shouldCheckForUpdates(settings)).toBe(false);
    });

    it('returns true if lastCheckTime is 0', () => {
      const settings: UpdateSettings = {
        autoCheck: true,
        lastCheckTime: 0,
        checkIntervalHours: 24,
        channel: 'stable',
        repo: 'test/repo',
      };
      expect(shouldCheckForUpdates(settings)).toBe(true);
    });

    it('respects checkIntervalHours', () => {
      const now = Date.now();
      const settings: UpdateSettings = {
        autoCheck: true,
        lastCheckTime: now - 25 * 3600 * 1000, // 25 hours ago
        checkIntervalHours: 24,
        channel: 'stable',
        repo: 'test/repo',
      };
      expect(shouldCheckForUpdates(settings)).toBe(true);

      settings.lastCheckTime = now - 5 * 3600 * 1000; // 5 hours ago
      expect(shouldCheckForUpdates(settings)).toBe(false);
    });
  });

  describe('matchAssetForPlatform', () => {
    const assets: UpdateAsset[] = [
      {
        name: 'ag-doctor-3.7.6-Setup.exe',
        browser_download_url: 'https://example.com/ag-doctor-3.7.6-Setup.exe',
        size: 85000000,
      },
      {
        name: 'ag-doctor-3.7.6-portable.exe',
        browser_download_url: 'https://example.com/ag-doctor-3.7.6-portable.exe',
        size: 80000000,
      },
      {
        name: 'ag-doctor-3.7.6-arm64.dmg',
        browser_download_url: 'https://example.com/ag-doctor-3.7.6-arm64.dmg',
        size: 90000000,
      },
      {
        name: 'ag-doctor-3.7.6-x64.dmg',
        browser_download_url: 'https://example.com/ag-doctor-3.7.6-x64.dmg',
        size: 92000000,
      },
      {
        name: 'ag-doctor-3.7.6-amd64.AppImage',
        browser_download_url: 'https://example.com/ag-doctor-3.7.6-amd64.AppImage',
        size: 88000000,
      },
    ];

    it('matches Windows NSIS setup asset on win32 when not in portable mode', () => {
      const match = matchAssetForPlatform(assets, 'win32', 'x64', false);
      expect(match).not.toBeNull();
      expect(match?.name).toBe('ag-doctor-3.7.6-Setup.exe');
    });

    it('matches Windows portable asset on win32 when in portable mode', () => {
      const match = matchAssetForPlatform(assets, 'win32', 'x64', true);
      expect(match).not.toBeNull();
      expect(match?.name).toBe('ag-doctor-3.7.6-portable.exe');
    });

    it('matches macOS DMG with correct architecture', () => {
      const matchArm = matchAssetForPlatform(assets, 'darwin', 'arm64');
      expect(matchArm).not.toBeNull();
      expect(matchArm?.name).toBe('ag-doctor-3.7.6-arm64.dmg');

      const matchX64 = matchAssetForPlatform(assets, 'darwin', 'x64');
      expect(matchX64).not.toBeNull();
      expect(matchX64?.name).toBe('ag-doctor-3.7.6-x64.dmg');
    });

    it('matches Linux AppImage on linux', () => {
      const match = matchAssetForPlatform(assets, 'linux', 'x64');
      expect(match).not.toBeNull();
      expect(match?.name).toBe('ag-doctor-3.7.6-amd64.AppImage');
    });

    it('returns null if asset list is empty', () => {
      expect(matchAssetForPlatform([], 'win32', 'x64')).toBeNull();
    });
  });

  describe('Settings persistence', () => {
    it('persists and reloads update settings', () => {
      const initial = loadUpdateSettings();
      expect(initial).toHaveProperty('autoCheck');
      expect(initial).toHaveProperty('channel');

      const updated = saveUpdateSettings({
        autoCheck: false,
        channel: 'beta',
        checkIntervalHours: 12,
      });

      expect(updated.autoCheck).toBe(false);
      expect(updated.channel).toBe('beta');
      expect(updated.checkIntervalHours).toBe(12);

      const reloaded = loadUpdateSettings();
      expect(reloaded.autoCheck).toBe(false);
      expect(reloaded.channel).toBe('beta');
      expect(reloaded.checkIntervalHours).toBe(12);

      // Restore defaults
      saveUpdateSettings({
        autoCheck: true,
        channel: 'stable',
        checkIntervalHours: 24,
      });
    });
  });
});
