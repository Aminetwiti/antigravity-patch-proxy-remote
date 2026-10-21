import { describe, it, expect } from 'vitest';
import { enrichExperimentsPayload, isTelemetryRpcUrl } from '../proxy';

describe('Performance Levers & Shadow Eval Neutralisation', () => {
  describe('isTelemetryRpcUrl', () => {
    it('identifies internal ConnectRPC telemetry and analytics endpoints', () => {
      expect(isTelemetryRpcUrl('/exa.language_server_pb.LanguageServerService/RecordAsyncTelemetry')).toBe(true);
      expect(isTelemetryRpcUrl('/exa.language_server_pb.LanguageServerService/RecordGitTelemetryBatch')).toBe(true);
      expect(isTelemetryRpcUrl('/exa.language_server_pb.LanguageServerService/RecordCortexFeedback')).toBe(true);
      expect(isTelemetryRpcUrl('/exa.language_server_pb.LanguageServerService/RecordPrompts')).toBe(true);
      expect(isTelemetryRpcUrl('/exa.language_server_pb.LanguageServerService/RecordCascadeUsage')).toBe(true);
      expect(isTelemetryRpcUrl('/exa.language_server_pb.LanguageServerService/RecordAnalyticsEvent')).toBe(true);
      expect(isTelemetryRpcUrl('/exa.language_server_pb.LanguageServerService/DetectBattleModeAutoTrigger')).toBe(true);
      expect(isTelemetryRpcUrl('/v1internal:recordTrajectoryAnalytics')).toBe(true);
      expect(isTelemetryRpcUrl('/v1internal:record')).toBe(true);
      expect(isTelemetryRpcUrl('https://daily-cloudcode-pa.googleapis.com/v1internal:recordTrajectoryAnalytics')).toBe(true);
    });

    it('returns false for generative and functional endpoints', () => {
      expect(isTelemetryRpcUrl('/v1internal:streamGenerateContent')).toBe(false);
      expect(isTelemetryRpcUrl('/v1internal:generateContent')).toBe(false);
      expect(isTelemetryRpcUrl('/GetAvailableModels?ls=http://127.0.0.1:55256')).toBe(false);
      expect(isTelemetryRpcUrl('/GetUserStatus?ls=http://127.0.0.1:55256')).toBe(false);
      expect(isTelemetryRpcUrl('/v1internal:listExperiments')).toBe(false);
      expect(isTelemetryRpcUrl('/health')).toBe(false);
      expect(isTelemetryRpcUrl(undefined)).toBe(false);
      expect(isTelemetryRpcUrl('')).toBe(false);
    });
  });

  describe('enrichExperimentsPayload', () => {
    it('forces shadow eval and battle mode auto trigger to false even if upstream sets them true', () => {
      const upstream = JSON.stringify({
        experimentIds: ['exp-deepmind-active'],
        flags: [
          { name: 'shadow-call-aicode-mendel', boolValue: true },
          { name: 'mendel_aicode_shadow_diff', boolValue: true },
          { name: 'enable-battle-mode-auto-trigger', boolValue: true },
        ],
      });

      const enriched = JSON.parse(enrichExperimentsPayload(upstream));
      const shadowCall = enriched.flags.find((f: any) => f.name === 'shadow-call-aicode-mendel');
      const shadowDiff = enriched.flags.find((f: any) => f.name === 'mendel_aicode_shadow_diff');
      const battleTrigger = enriched.flags.find((f: any) => f.name === 'enable-battle-mode-auto-trigger');

      expect(shadowCall?.boolValue).toBe(false);
      expect(shadowDiff?.boolValue).toBe(false);
      expect(battleTrigger?.boolValue).toBe(false);
    });

    it('injects performance boosters into experiment flags', () => {
      const upstream = JSON.stringify({
        experimentIds: [],
        flags: [],
      });

      const enriched = JSON.parse(enrichExperimentsPayload(upstream));
      const fastDebounce = enriched.flags.find((f: any) => f.name === 'supercomplete-fast-debounce');
      const cacheConfig = enriched.flags.find((f: any) => f.name === 'command-prompt-cache-config');
      const forceLocal = enriched.flags.find((f: any) => f.name === 'context-force-local-context');
      const specialBlock = enriched.flags.find((f: any) => f.name === 'use-special-edit-code-block');

      expect(fastDebounce?.boolValue).toBe(true);
      expect(cacheConfig?.stringValue).toBe('{"enabled": true}');
      expect(forceLocal?.boolValue).toBe(true);
      expect(specialBlock?.boolValue).toBe(true);
    });

    it('gracefully returns rawBody on non-JSON input', () => {
      const invalid = '<html>Gateway Timeout</html>';
      expect(enrichExperimentsPayload(invalid)).toBe(invalid);
    });
  });
});
