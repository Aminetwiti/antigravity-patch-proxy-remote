import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { SleepBlocker } from '../../shared/utils';
import { DEFAULT_PROXY_PORT } from '../../constants';

export enum SettingKey {
  RUN_IN_BACKGROUND = 'runInBackground',
  KEEP_COMPUTER_AWAKE = 'keepComputerAwake',
}

export const DEFAULTS = new Map<SettingKey, boolean>([
  [SettingKey.RUN_IN_BACKGROUND, process.platform !== 'win32'],
  [SettingKey.KEEP_COMPUTER_AWAKE, false],
]);

interface StorageManager {
  onDidChange(listener: (changes: Record<string, string | null>) => void): { dispose(): void };
  getItems(): Promise<Record<string, string | null>>;
}

export class SettingsService {
  private storageManager: StorageManager;

  constructor(storageManager: StorageManager) {
    this.storageManager = storageManager;
    this.storageManager.onDidChange((changes) => {
      this.applySideEffects(changes);
    });
    void this.initialize();
  }

  async initialize(): Promise<void> {
    const items = await this.storageManager.getItems();
    this.applySideEffects(items);
  }

  applySideEffects(settings: Record<string, string | null>): void {
    const val = settings[SettingKey.KEEP_COMPUTER_AWAKE];
    if (val !== undefined) {
      const preventSleep = val === null ? DEFAULTS.get(SettingKey.KEEP_COMPUTER_AWAKE) : val === 'true';
      SleepBlocker.getInstance().shouldKeepComputerAwake(preventSleep);
    }
  }

  async getSetting(key: SettingKey): Promise<boolean> {
    const items = await this.storageManager.getItems();
    return items[key] === 'true';
  }
}

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
