import { describe, it, expect } from 'vitest';
import { isGoogleCloudCodeModel } from '../services/googleAuth';
import { getModelQuotaScore } from '../proxy/googlePool';

describe('Google API Hardening (Forum Findings Parity)', () => {
  describe('AQ-prefixed Google AI Studio Authorization Keys', () => {
    it('correctly classifies legacy AIzaSy keys as AI Studio (not Cloud Code)', () => {
      const model = {
        provider: 'google',
        apiKey: 'AIzaSyA1B2C3D4E5F6G7H8I9J0K1L2M3N4O5P6Q',
      };
      expect(isGoogleCloudCodeModel(model)).toBe(false);
    });

    it('correctly classifies dot-formatted AQ keys as AI Studio (not Cloud Code)', () => {
      const model = {
        provider: 'google',
        apiKey: 'AQ.A1B2C3D4E5F6G7H8I9J0K1L2M3N4O5P6Q',
      };
      expect(isGoogleCloudCodeModel(model)).toBe(false);
    });

    it('correctly classifies raw 53-char AQ keys (without dot) as AI Studio (not Cloud Code)', () => {
      const model = {
        provider: 'google',
        apiKey: 'AQa1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0u1v2w3x4y5z6',
      };
      expect(isGoogleCloudCodeModel(model)).toBe(false);
    });

    it('retains Cloud Code classification for ya29 tokens and refresh tokens', () => {
      const oauthModel = {
        provider: 'google',
        apiKey: 'ya29.a0ARrdaM...',
        refreshToken: '1//04testRefresh...',
      };
      expect(isGoogleCloudCodeModel(oauthModel)).toBe(true);
    });

    it('assigns reservation score (25) to both AIzaSy and AQ-prefixed keys in getModelQuotaScore', () => {
      const legacyModel = {
        name: 'gemini-3.8-flash',
        provider: 'google',
        apiKey: 'AIzaSyTestKey12345',
      };
      const newAqModel = {
        name: 'gemini-3.8-flash',
        provider: 'google',
        apiKey: 'AQabcdef1234567890TestKey53CharactersLongHere1234567',
      };
      const genericModel = {
        name: 'gemini-3.8-flash',
        provider: 'google',
        apiKey: 'some-custom-token-xyz',
      };

      expect(getModelQuotaScore(legacyModel as any)).toBe(25);
      expect(getModelQuotaScore(newAqModel as any)).toBe(25);
      expect(getModelQuotaScore(genericModel as any)).toBe(50);
    });
  });

  describe('HTTP 403 Account Restriction & Suspension Pattern Matching', () => {
    const isLicenseError = (lastErrorText: string) =>
      /license|licens|permission|unauthorized|forbidden|not have a valid|verify your account|validation_required|denied access|restricted|unavailable tier|suspended/i.test(lastErrorText);

    it('matches Google AI Studio 403 denied access pattern', () => {
      expect(isLicenseError('403 PERMISSION_DENIED: Your project has been denied access. Please contact support.')).toBe(true);
    });

    it('matches account restricted and unavailable tier patterns', () => {
      expect(isLicenseError('Account Restricted: Unavailable Tier. Project marked restricted by compliance.')).toBe(true);
    });

    it('matches application suspended for abuse warning', () => {
      expect(isLicenseError('HTTP 403: App suspended for abuse violation.')).toBe(true);
    });
  });

  describe('HTTP 400 FAILED_PRECONDITION vs Syntax Error Pattern Matching', () => {
    const isPrecondition400 = (lastErrorText: string) =>
      /failed_precondition|location is not supported|user location|unsupported region|underage|minor/i.test(lastErrorText);

    it('matches geographic location not supported error', () => {
      expect(isPrecondition400('HTTP 400 FAILED_PRECONDITION: User location is not supported for the API use')).toBe(true);
    });

    it('matches unsupported region and eligibility constraints', () => {
      expect(isPrecondition400('FAILED_PRECONDITION: request originated from an unsupported region')).toBe(true);
      expect(isPrecondition400('FAILED_PRECONDITION: account restricted - minor / underage user')).toBe(true);
    });

    it('does NOT match standard payload syntax errors or malformed json', () => {
      expect(isPrecondition400('HTTP 400 Bad Request: missing field "contents" in JSON payload')).toBe(false);
      expect(isPrecondition400('400 Invalid argument: unexpected token in generationConfig')).toBe(false);
    });
  });
});
