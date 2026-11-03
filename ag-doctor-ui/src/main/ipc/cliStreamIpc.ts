import { ipcMain } from 'electron';
import fs from 'fs';
import { spawn } from 'child_process';
import { DOCTOR_IPC_CHANNELS } from '../../ipc/channels';
import type { MainContext } from '../types';

export function registerCliStreamIpc(ctx: MainContext): void {
  ipcMain.handle(DOCTOR_IPC_CHANNELS.RUN, async (_evt, args: string[]) => {
    return ctx.getCliPool().run(args);
  });

  ipcMain.handle(DOCTOR_IPC_CHANNELS.STREAM_START, (evt, args: string[], streamId: string) => {
    const cli = ctx.getCliPath();
    if (!fs.existsSync(cli)) {
      evt.sender.send(`ag:stream:${streamId}:error`, `CLI not found: ${cli}`);
      return false;
    }
    const proc = spawn(process.execPath, [cli, ...args], {
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
    return true;
  });

  ipcMain.handle(DOCTOR_IPC_CHANNELS.STREAM_CANCEL, (_evt, streamId: string) => {
    const proc = ctx.activeStreams.get(streamId);
    if (proc) {
      proc.kill();
      ctx.activeStreams.delete(streamId);
      return true;
    }
    return false;
  });
}
