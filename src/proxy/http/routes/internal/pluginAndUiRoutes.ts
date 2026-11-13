import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import log from 'electron-log';

export function handlePluginAndUiRoutes(
  req: http.IncomingMessage,
  res: http.ServerResponse,
): boolean {
  const url = req.url || '';

  // Marketplace Plugin Installation Bridge
  if (url === '/api/plugins/install' && req.method === 'POST') {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf-8'));
        const files: Array<{ path: string; content: string }> = body.files || [];
        const baseDir = path.join(os.homedir(), '.gemini', 'config', 'plugins');
        for (const file of files) {
          const targetPath = path.isAbsolute(file.path) ? file.path : path.join(baseDir, file.path);
          fs.mkdirSync(path.dirname(targetPath), { recursive: true });
          fs.writeFileSync(targetPath, file.content, 'utf-8');
        }
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ ok: true, count: files.length }));
      } catch (err: any) {
        res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ ok: false, error: err?.message }));
      }
    });
    return true;
  }

  if (url === '/api/plugins/uninstall' && req.method === 'POST') {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf-8'));
        const rawId = body.pluginId || body.id || body.slug || '';
        const slug = rawId.split('/').pop() || rawId;
        const targetDir = path.join(os.homedir(), '.gemini', 'config', 'plugins', slug);
        if (fs.existsSync(targetDir)) {
          fs.rmSync(targetDir, { recursive: true, force: true });
        }
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ ok: true }));
      } catch (err: any) {
        res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ ok: false, error: err?.message }));
      }
    });
    return true;
  }

  // UI & Chat Enhancements Configuration Bridge (GET/POST /api/ui/config)
  if (url === '/api/ui/config' || url.startsWith('/api/ui/config?')) {
    const DEFAULT_SUGGESTIONS = [
      { label: '/plan', text: '/plan ' },
      { label: 'Continue', text: 'Continue' },
      { label: 'Analyser et auditer', text: 'Analyser et auditer le code et les erreurs' },
      { label: 'Keep going', text: 'Keep going' },
      { label: 'Exécuter all steps', text: 'Exécuter toutes les étapes prévues' },
      { label: 'Next phase', text: 'Passer à la phase suivante (Next phase)' },
    ];
    const getConfigPath = () => {
      const home = process.env.USERPROFILE || process.env.HOME || os.homedir();
      return path.join(home, '.gemini', 'antigravity', 'config.json');
    };
    const readUiConfig = () => {
      try {
        const p = getConfigPath();
        if (fs.existsSync(p)) {
          const parsed = JSON.parse(fs.readFileSync(p, 'utf8'));
          const ui = parsed.ui || {};
          return {
            retryButton: ui.retryButton !== false,
            suggestionPills: ui.suggestionPills !== false,
            suggestions: Array.isArray(ui.suggestions) && ui.suggestions.length > 0 ? ui.suggestions : DEFAULT_SUGGESTIONS,
          };
        }
      } catch (_) {}
      return { retryButton: true, suggestionPills: true, suggestions: DEFAULT_SUGGESTIONS };
    };

    if (req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify(readUiConfig()));
      return true;
    }
    if (req.method === 'POST') {
      const chunks: Buffer[] = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        try {
          const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          const p = getConfigPath();
          let parsed: any = {};
          if (fs.existsSync(p)) {
            try { parsed = JSON.parse(fs.readFileSync(p, 'utf8')); } catch (_) {}
          }
          parsed.ui = { ...(parsed.ui || {}), ...body };
          fs.mkdirSync(path.dirname(p), { recursive: true });
          fs.writeFileSync(p, JSON.stringify(parsed, null, 2), 'utf8');
          log.info(`[Proxy] Updated UI configuration: retryButton=${parsed.ui.retryButton}, suggestionPills=${parsed.ui.suggestionPills}`);
          res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
          res.end(JSON.stringify({ ok: true, ...readUiConfig() }));
        } catch (e: any) {
          res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
          res.end(JSON.stringify({ error: e?.message || 'Invalid JSON' }));
        }
      });
      return true;
    }
    return true;
  }

  return false;
}
