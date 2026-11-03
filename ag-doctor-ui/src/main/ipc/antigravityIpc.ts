import { ipcMain } from 'electron';
import path from 'path';
import fs from 'fs';
import { spawn } from 'child_process';
import { DOCTOR_IPC_CHANNELS } from '../../ipc/channels';
import { detectAntigravityInstallations } from '../../services/installationDetector';
import {
  getCpuOptimizationStatus,
  applyCpuOptimizations,
  revertCpuOptimizations,
} from '../../services/cpuOptimizer';
import type { MainContext } from '../types';

export function registerAntigravityIpc(ctx: MainContext): void {
  ipcMain.handle(DOCTOR_IPC_CHANNELS.ANTIGRAVITY_STATUS, async () => {
    try {
      const r = await ctx.getCliPool().run(['antigravity', 'status', '--json']);
      if (r.code !== 0 && r.code !== 1) {
        return { ok: false, error: r.stderr || r.stdout || `exit ${r.code}` };
      }
      try {
        return { ok: true, data: JSON.parse(r.stdout) };
      } catch (e) {
        return { ok: false, error: `parse failed: ${(e as Error).message}` };
      }
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  });

  ipcMain.handle(DOCTOR_IPC_CHANNELS.ANTIGRAVITY_VERSION, async () => {
    const r = await ctx.getCliPool().run(['antigravity', 'version', '--json']);
    try {
      return { ok: true, data: JSON.parse(r.stdout) };
    } catch {
      return { ok: true, data: { version: r.stdout.trim() } };
    }
  });

  ipcMain.handle(DOCTOR_IPC_CHANNELS.ANTIGRAVITY_LAUNCH, async () => {
    const r = await ctx.getCliPool().run(['antigravity', 'launch', '--json']);
    try {
      return { ok: true, data: JSON.parse(r.stdout) };
    } catch {
      return { ok: true, data: { ok: r.code === 0, message: r.stdout.trim() } };
    }
  });

  ipcMain.handle(DOCTOR_IPC_CHANNELS.ANTIGRAVITY_KILL, async () => {
    const r = await ctx.getCliPool().run(['antigravity', 'kill', '--json']);
    try {
      return { ok: true, data: JSON.parse(r.stdout) };
    } catch {
      return { ok: true, data: { killed: 0, message: r.stdout.trim() } };
    }
  });

  ipcMain.handle(DOCTOR_IPC_CHANNELS.ANTIGRAVITY_RESTART, async () => {
    const r = await ctx.getCliPool().run(['antigravity', 'restart', '--json']);
    try {
      return { ok: true, data: JSON.parse(r.stdout) };
    } catch {
      return { ok: true, data: { ok: r.code === 0, message: r.stdout.trim() } };
    }
  });

  ipcMain.handle(DOCTOR_IPC_CHANNELS.ANTIGRAVITY_CPU_OPT_STATUS, async () => {
    try {
      const status = getCpuOptimizationStatus();
      return { ok: true, data: status };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  });

  ipcMain.handle(DOCTOR_IPC_CHANNELS.ANTIGRAVITY_CPU_OPT_APPLY, async () => {
    try {
      const result = applyCpuOptimizations();
      return {
        ok: result.success,
        data: result,
        error: result.errors.length > 0 ? result.errors.join('; ') : undefined,
      };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  });

  ipcMain.handle(DOCTOR_IPC_CHANNELS.ANTIGRAVITY_CPU_OPT_REVERT, async () => {
    try {
      const result = revertCpuOptimizations();
      return {
        ok: result.success,
        data: result,
        error: result.errors.length > 0 ? result.errors.join('; ') : undefined,
      };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  });

  ipcMain.handle(DOCTOR_IPC_CHANNELS.ANTIGRAVITY_LAUNCH_LOGS, async (evt) => {
    const streamId = `launch-logs-${Date.now()}`;
    const cli = ctx.getCliPath();
    if (!fs.existsSync(cli)) {
      evt.sender.send(`ag:stream:${streamId}:error`, `CLI not found: ${cli}`);
      return streamId;
    }
    const proc = spawn(process.execPath, [cli, 'antigravity', 'launch-logs'], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      windowsHide: true,
    });
    ctx.activeStreams.set(streamId, proc);

    let pending: { stdout: string; stderr: string } | null = null;
    let flushTimer: NodeJS.Timeout | null = null;
    const flush = () => {
      if (pending && (pending.stdout || pending.stderr)) {
        if (!evt.sender.isDestroyed()) {
          evt.sender.send(`ag:stream:${streamId}:data`, pending.stdout + pending.stderr);
        }
      }
      pending = null;
      flushTimer = null;
    };
    const schedule = () => {
      if (!flushTimer) flushTimer = setTimeout(flush, 50);
    };

    proc.stdout?.on('data', (d: Buffer) => {
      const str = d.toString();
      ctx.checkAndNotifyOAuthIntercept(str);
      if (!pending) pending = { stdout: '', stderr: '' };
      pending.stdout += str;
      schedule();
    });
    proc.stderr?.on('data', (d: Buffer) => {
      const str = d.toString();
      ctx.checkAndNotifyOAuthIntercept(str);
      if (!pending) pending = { stdout: '', stderr: '' };
      pending.stderr += str;
      schedule();
    });
    proc.on('close', (code) => {
      flush();
      if (!evt.sender.isDestroyed()) {
        evt.sender.send(`ag:stream:${streamId}:close`, code ?? 0);
      }
      ctx.activeStreams.delete(streamId);
    });
    proc.on('error', (err) => {
      if (!evt.sender.isDestroyed()) {
        evt.sender.send(`ag:stream:${streamId}:error`, err.message);
      }
      ctx.activeStreams.delete(streamId);
    });
    return streamId;
  });

  ipcMain.handle(DOCTOR_IPC_CHANNELS.DETECT_INSTALLATION, async () => {
    try {
      const result = detectAntigravityInstallations();
      return { ok: true, data: result };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  });
}
