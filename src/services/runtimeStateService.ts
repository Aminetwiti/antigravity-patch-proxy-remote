import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { DEFAULT_PROXY_PORT } from '../constants';

export interface RuntimeState {
  proxyPort: number;
  daemonPort?: number;
  pid: number;
  timestamp: string;
  version?: string;
}

export class RuntimeStateService {
  private static getStateFilePath(): string {
    const home = process.env.USERPROFILE || process.env.HOME || os.homedir();
    return path.join(home, '.gemini', 'antigravity', 'runtime.json');
  }

  public static async saveState(state: Partial<RuntimeState>): Promise<void> {
    try {
      const filePath = this.getStateFilePath();
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      const current = await this.readState();
      const merged: RuntimeState = {
        proxyPort: state.proxyPort ?? current?.proxyPort ?? DEFAULT_PROXY_PORT,
        daemonPort: state.daemonPort ?? current?.daemonPort,
        pid: state.pid ?? process.pid,
        timestamp: new Date().toISOString(),
        version: state.version ?? current?.version ?? '3.2.0',
      };
      await fs.writeFile(filePath, JSON.stringify(merged, null, 2), 'utf8');
    } catch {
      // Non-blocking best-effort file write
    }
  }

  public static async readState(): Promise<RuntimeState | null> {
    try {
      const filePath = this.getStateFilePath();
      const raw = await fs.readFile(filePath, 'utf8');
      return JSON.parse(raw) as RuntimeState;
    } catch {
      return null;
    }
  }
}
