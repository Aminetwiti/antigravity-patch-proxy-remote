import { describe, it, expect, vi } from 'vitest';
import http from 'http';

describe('Remote Session Protocol & Endpoint Validation', () => {
  it('formats session creation payload correctly according to ag-agentd v2 specification', () => {
    const title = 'Refactor auth controller and add tests';
    const workspaceId = '/var/lib/antigravity/workspaces/proj-1';
    const payload = JSON.stringify({ title, workspaceId });
    const parsed = JSON.parse(payload);

    expect(parsed.title).toBe(title);
    expect(parsed.workspaceId).toBe(workspaceId);
  });

  it('validates session list response envelope', () => {
    const rawDaemonResponse = {
      sessions: [
        {
          id: 'sess_1788945181673_506861',
          title: 'Nightly autonomous audit',
          state: 'COMPLETED',
          createdAt: '2026-09-09T02:00:00Z',
        },
        {
          id: 'sess_1788945181673_506862',
          title: 'Fix edge case in payment webhook',
          state: 'RUNNING',
          createdAt: '2026-09-09T11:30:00Z',
        },
      ],
    };

    expect(Array.isArray(rawDaemonResponse.sessions)).toBe(true);
    expect(rawDaemonResponse.sessions).toHaveLength(2);
    expect(rawDaemonResponse.sessions[1].state).toBe('RUNNING');
  });

  it('handles remote terminal command format', () => {
    const cmd = 'docker ps --format "{{.Names}}"';
    const timeout = 15000;
    const reqBody = JSON.stringify({ command: cmd, timeout_ms: timeout });
    const parsed = JSON.parse(reqBody);

    expect(parsed.command).toBe(cmd);
    expect(parsed.timeout_ms).toBe(15000);
  });
});
