/**
 * `ag-doctor info` — system & environment information.
 */
import os from 'os';
import type { CommandContext } from '../types';
import { getSystemInfo } from '../core/platform';
import { findAntigravityInstallDir, getCustomModelsPath, getLsLogPath, getAppAsarPath } from '../core/paths';
import { c, header, table } from '../cli/output';

export function runInfo(ctx: CommandContext): number {
  if (!ctx.json) header('System information');
  const info = getSystemInfo();
  const rows: Array<[string, string]> = [
    ['Platform', `${info.platform}/${info.arch}`],
    ['OS release', info.osRelease],
    ['Node', info.nodeVersion],
    ['Username', info.username],
    ['Home', info.homedir],
    ['CWD', info.cwd],
    ['CPU', `${os.cpus()[0]?.model ?? 'unknown'} × ${os.cpus().length}`],
    ['Memory', `${(os.totalmem() / 1024 / 1024 / 1024).toFixed(1)} GB`],
    ['Antigravity', findAntigravityInstallDir() ?? c.gray('(not found)')],
    ['app.asar', getAppAsarPath() ?? c.gray('(not found)')],
    ['custom_models.json', getCustomModelsPath()],
    ['LS log', getLsLogPath()],
  ];
  if (ctx.json) {
    console.log(JSON.stringify(info, null, 2));
    return 0;
  }
  table(rows);
  return 0;
}
