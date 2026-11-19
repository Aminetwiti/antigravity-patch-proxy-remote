import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { pathToFileURL } from 'url';
import { unlockCodeAssistPayload } from '../../proxy/http/routes/endpoints/codeAssistHandler';
import { resolveFileData } from '../../proxy/engine/transforms/historyTrimmer';
import type { GeminiRequestBody } from '../../proxy/core/types';

describe('Audit Adversarial Remediation Suite', () => {
  describe('AUDIT-002: unlockCodeAssistPayload', () => {
    it('injects g1-pro-tier and updates currentTier when upstream returns free-tier', () => {
      const upstreamJson = JSON.stringify({
        cloudaicompanionProject: 'projects/test-project',
        allowedTiers: [{ id: 'free-tier', isDefault: true }],
        currentTier: { id: 'free-tier', name: 'Free' },
      });

      const unlocked = unlockCodeAssistPayload(upstreamJson);
      const parsed = JSON.parse(unlocked);

      expect(parsed.allowedTiers).toEqual(
        expect.arrayContaining([{ id: 'g1-pro-tier', isDefault: true }]),
      );
      expect(parsed.currentTier.id).toBe('g1-pro-tier');
      expect(parsed.paidTier.id).toBe('g1-pro-tier');
      expect(parsed.cloudaicompanionProject).toBe('projects/test-project');
    });

    it('does not duplicate g1-pro-tier if already present', () => {
      const upstreamJson = JSON.stringify({
        allowedTiers: [
          { id: 'free-tier', isDefault: false },
          { id: 'g1-pro-tier', isDefault: true },
        ],
        currentTier: { id: 'g1-pro-tier', name: 'Google AI Pro' },
        paidTier: { id: 'g1-pro-tier', name: 'Google AI Pro' },
      });

      const unlocked = unlockCodeAssistPayload(upstreamJson);
      const parsed = JSON.parse(unlocked);

      const proTiers = parsed.allowedTiers.filter((t: any) => t.id === 'g1-pro-tier');
      expect(proTiers.length).toBe(1);
    });

    it('returns raw string as-is when input is not valid JSON', () => {
      const invalid = '<html>502 Bad Gateway</html>';
      expect(unlockCodeAssistPayload(invalid)).toBe(invalid);
    });
  });

  describe('AUDIT-003: resolveFileData with fileURLToPath', () => {
    it('successfully resolves a local file using a valid file:// URI', async () => {
      const tmpFile = path.join(os.tmpdir(), `test-file-${Date.now()}.txt`);
      fs.writeFileSync(tmpFile, 'Hello from audit test!', 'utf-8');

      try {
        const fileUri = pathToFileURL(tmpFile).href;
        const body: GeminiRequestBody = {
          contents: [
            {
              role: 'user',
              parts: [
                {
                  fileData: {
                    fileUri,
                    mimeType: 'text/plain',
                  },
                },
              ],
            },
          ],
        };

        await resolveFileData(body, {});
        expect((body.contents![0].parts![0] as any).text).toContain('Hello from audit test!');
      } finally {
        if (fs.existsSync(tmpFile)) {
          fs.unlinkSync(tmpFile);
        }
      }
    });

    it('ignores missing files gracefully without throwing', async () => {
      const nonExistentUri = pathToFileURL(path.join(os.tmpdir(), 'non-existent-file-404.txt')).href;
      const body: GeminiRequestBody = {
        contents: [
          {
            role: 'user',
            parts: [
              {
                fileData: {
                  fileUri: nonExistentUri,
                  mimeType: 'text/plain',
                },
              },
            ],
          },
        ],
      };

      await expect(resolveFileData(body, {})).resolves.not.toThrow();
      expect((body.contents![0].parts![0] as any).text).toBeUndefined();
    });
  });
});
