/**
 * `ag-doctor update` — pull latest, rebuild, redeploy.
 * This is a thin wrapper that runs the parent repo's deploy script.
 *
 * Flags:
 *   --check   Compare local version with the latest GitHub release (no deploy)
 */
import https from 'https';
import path from 'path';
import { spawnInherit } from '../core/process';
import type { CommandContext } from '../types';
import { info, error, ok, warn } from '../cli/output';

const REPO = 'Aminetwiti/antigravity-add-model-main';

interface GitHubRelease {
  tag_name: string;
  name: string;
  html_url: string;
  published_at: string;
  body?: string;
}

function getLocalVersion(): string {
  const pkg = require('../../package.json') as { version: string };
  return pkg.version;
}

function fetchLatestRelease(): Promise<GitHubRelease> {
  return new Promise((resolve, reject) => {
    const req = https.get(
      {
        hostname: 'api.github.com',
        path: `/repos/${REPO}/releases/latest`,
        headers: {
          'User-Agent': 'ag-doctor',
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
        timeout: 10000,
      },
      (res) => {
        if (res.statusCode && res.statusCode >= 400) {
          reject(new Error(`GitHub API returned ${res.statusCode}`));
          return;
        }
        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => {
          try {
            resolve(JSON.parse(body) as GitHubRelease);
          } catch (e) {
            reject(new Error(`Failed to parse GitHub response: ${(e as Error).message}`));
          }
        });
      },
    );
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timed out'));
    });
  });
}

function stripV(v: string): string {
  return v.startsWith('v') ? v.slice(1) : v;
}

async function runUpdateCheck(ctx: CommandContext): Promise<number> {
  const local = getLocalVersion();
  if (!ctx.json) info(`Local version: ${local}`);
  try {
    const latest = await fetchLatestRelease();
    const latestVersion = stripV(latest.tag_name);
    const upToDate = local === latestVersion;
    if (ctx.json) {
      console.log(
        JSON.stringify(
          {
            local,
            latest: latestVersion,
            releaseName: latest.name,
            releaseUrl: latest.html_url,
            publishedAt: latest.published_at,
            upToDate,
          },
          null,
          2,
        ),
      );
      return 0;
    }
    if (upToDate) {
      ok(`You are up to date (v${local}).`);
    } else {
      warn(`Update available: v${local} → v${latestVersion}`);
      info(`Release: ${latest.name}`);
      info(`URL: ${latest.html_url}`);
      if (latest.body) {
        info('Release notes:');
        console.log(latest.body.split('\n').slice(0, 20).join('\n'));
      }
    }
    return upToDate ? 0 : 1;
  } catch (e) {
    error(`Update check failed: ${(e as Error).message}`);
    return 2;
  }
}

export async function runUpdate(ctx: CommandContext): Promise<number> {
  const opts = ctx.options ?? {};
  if (opts.check) {
    return runUpdateCheck(ctx);
  }

  const parent = path.resolve(__dirname, '..', '..', '..');
  info(`Running deploy from ${parent}...`);
  const platform = process.platform;
  try {
    let code = 0;
    if (platform === 'win32') {
      code = await spawnInherit('powershell', ['-ExecutionPolicy', 'Bypass', '-File', path.join(parent, 'deploy.ps1')]);
    } else if (platform === 'darwin') {
      code = await spawnInherit('bash', [path.join(parent, 'deploy.sh')]);
    } else {
      code = await spawnInherit('bash', [path.join(parent, 'deploy_linux.sh')]);
    }
    return code === 0 ? 0 : 2;
  } catch (e) {
    error(`Update failed: ${(e as Error).message}`);
    return 2;
  }
}
