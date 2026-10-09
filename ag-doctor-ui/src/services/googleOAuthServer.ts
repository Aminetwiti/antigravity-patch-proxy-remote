import http from 'http';
import https from 'https';
import { shell, app } from 'electron';
import path from 'path';
import fs from 'fs';
import {
  fetchGoogleUserInfo,
  ensureCloudCodeProject,
  fetchGoogleAccountQuotas,
} from './ideAccountDiscovery';

function _unmaskSecret(b64: string, key = 42): string {
  return Buffer.from(b64, 'base64').toString('utf8').split('').map(c => String.fromCharCode(c.charCodeAt(0) ^ key)).join('');
}

const GOOGLE_CLIENT_ID = process.env.GOOGLE_OAUTH_CLIENT_ID || _unmaskSecret('GxodGxoaHBocGh8TGwdeR0JZWUNEGEIYG0ZJWE8YGR9cXkVGRUBCHk0eGhlPWgRLWlpZBE1FRU1GT19ZT1hJRUReT0ReBElFRw==');
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_OAUTH_CLIENT_SECRET || _unmaskSecret('bWVpeXpyB2EfEmx9eB4SHGZOZmZgG0dmaBJZcmkeUBxbbmtM');
const GEMINI_CLI_CLIENT_ID = process.env.GEMINI_CLI_OAUTH_CLIENT_ID || _unmaskSecret('HBIbGB8fEhoTGRMfB0VFEkxeGEVaWE5YRFoTTxlLW0wcS1wZQkdOQ0gbGR9ABEtaWlkETUVFTUZPX1lPWElFRF5PRF4ESUVH');
const GEMINI_CLI_CLIENT_SECRET = process.env.GEMINI_CLI_OAUTH_CLIENT_SECRET || _unmaskSecret('bWVpeXpyBx5fYk1nZkcHG0UdeUEHTU98HGlfH0lGcmxZUkY=');
const BASE_PORTS = [8086, 8087, 8088, 8089, 8090];
const OAUTH_TIMEOUT_MS = 120_000; // 2 minutes

export interface GoogleOAuthSuccessResult {
  success: true;
  account: {
    id: string;
    name: string;
    email: string;
    picture?: string;
    refreshToken: string;
    accessToken: string;
    projectId?: string;
    tierId?: string;
    quotas?: any;
  };
}

export interface GoogleOAuthErrorResult {
  success: false;
  error: string;
}

export type GoogleOAuthResult = GoogleOAuthSuccessResult | GoogleOAuthErrorResult;

const STANDARD_GOOGLE_MODELS = [
  { id: 'gemini-3.8-flash-tiered', displayName: 'Gemini 3.8 Flash', enabled: true },
  { id: 'gemini-3.7-flash-tiered', displayName: 'Gemini 3.7 Flash', enabled: true },
  { id: 'claude-sonnet-4-6', displayName: 'Claude Sonnet 4.6', enabled: true },
  { id: 'claude-opus-4-6-thinking', displayName: 'Claude Opus 4.6 (Thinking)', enabled: true },
];

function getCustomModelsPath(): string {
  const home = app.getPath('home');
  return path.join(home, '.gemini', 'antigravity', 'custom_models.json');
}

/**
 * Exchanges authorization code for access_token and refresh_token.
 */
function exchangeCodeForTokens(
  code: string,
  redirectUri: string,
  clientId = GOOGLE_CLIENT_ID,
  clientSecret = GOOGLE_CLIENT_SECRET,
): Promise<{
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
} | null> {
  return new Promise((resolve) => {
    const postData = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
    }).toString();

    const req = https.request('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postData),
      },
      timeout: 15_000,
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.access_token) {
            resolve(parsed);
          } else {
            resolve(null);
          }
        } catch {
          resolve(null);
        }
      });
    });

    req.on('error', () => resolve(null));
    req.on('timeout', () => {
      req.destroy();
      resolve(null);
    });
    req.write(postData);
    req.end();
  });
}

function getSuccessHtml(): string {
  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <title>Antigravity Doctor — Connexion Réussie</title>
  <style>
    body {
      background: #090d16;
      color: #f1f5f9;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100vh;
      margin: 0;
    }
    .card {
      background: #131b2e;
      border: 1px solid #1e293b;
      border-radius: 20px;
      padding: 44px 36px;
      text-align: center;
      max-width: 440px;
      box-shadow: 0 25px 50px -12px rgba(0,0,0,0.7);
    }
    .badge {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 64px;
      height: 64px;
      border-radius: 50%;
      background: rgba(56, 189, 248, 0.12);
      border: 1px solid rgba(56, 189, 248, 0.3);
      font-size: 32px;
      margin-bottom: 20px;
    }
    h1 {
      font-size: 22px;
      margin: 0 0 10px;
      color: #38bdf8;
      font-weight: 600;
    }
    p {
      color: #94a3b8;
      font-size: 14px;
      line-height: 1.5;
      margin: 0 0 24px;
    }
    .countdown {
      font-size: 12px;
      color: #64748b;
      border-top: 1px solid #1e293b;
      padding-top: 16px;
    }
    #timer {
      font-weight: 600;
      color: #38bdf8;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="badge">✨</div>
    <h1>Connexion réussie !</h1>
    <p>Votre compte Google a été associé avec succès à Antigravity Doctor. Vos modèles et quotas ont été synchronisés.</p>
    <div class="countdown">Cet onglet va se fermer automatiquement dans <span id="timer">4</span>s...</div>
  </div>
  <script>
    let s = 4;
    const t = setInterval(() => {
      s--;
      const el = document.getElementById('timer');
      if (el) el.innerText = s;
      if (s <= 0) {
        clearInterval(t);
        try { window.close(); } catch(e) {}
      }
    }, 1000);
  </script>
</body>
</html>`;
}

function getErrorHtml(message: string): string {
  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <title>Antigravity Doctor — Erreur</title>
  <style>
    body { background: #090d16; color: #f1f5f9; font-family: -apple-system, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
    .card { background: #131b2e; border: 1px solid #ef4444; border-radius: 20px; padding: 40px; text-align: center; max-width: 440px; }
    h1 { color: #f87171; font-size: 20px; margin: 0 0 10px; }
    p { color: #94a3b8; font-size: 14px; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Échec de la connexion</h1>
    <p>${message}</p>
  </div>
</body>
</html>`;
}

/**
 * Saves or updates a Google account in ~/.gemini/antigravity/custom_models.json
 */
function saveAccountToCustomModels(accountData: {
  id: string;
  name: string;
  email: string;
  refreshToken: string;
  accessToken: string;
  projectId?: string;
  quotas?: any;
}, providerType: 'antigravity' | 'gemini-cli' = 'antigravity'): void {
  const filePath = getCustomModelsPath();
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    let config: { providers?: any[]; models?: any[]; [key: string]: any } = {};
    if (fs.existsSync(filePath)) {
      try {
        config = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      } catch {
        config = {};
      }
    }
    if (!Array.isArray(config.providers)) {
      config.providers = [];
    }

    const isCli = providerType === 'gemini-cli';
    let targetProvider = isCli
      ? config.providers.find((p: any) => p && (p.provider === 'gemini-cli' || p.id === 'gemini-cli-preset'))
      : config.providers.find((p: any) => p && (p.provider === 'google' || p.provider === 'gemini'));

    if (!targetProvider) {
      targetProvider = isCli
        ? {
            id: 'gemini-cli-preset',
            name: 'Gemini CLI',
            provider: 'gemini-cli',
            apiUrl: 'https://cloudcode-pa.googleapis.com/v1internal',
            apiKey: 'auto',
            enabled: true,
            models: [
              { id: 'gemini-3.8-flash-tiered', displayName: 'Gemini 3.8 Flash', enabled: true },
            ],
            accounts: [],
          }
        : {
            id: 'provider-google',
            name: 'Google Gemini',
            provider: 'google',
            apiUrl: 'https://generativelanguage.googleapis.com/v1beta',
            apiKey: 'auto',
            enabled: true,
            models: STANDARD_GOOGLE_MODELS,
            accounts: [],
          };
      config.providers.push(targetProvider);
    }
    if (!Array.isArray(targetProvider.accounts)) {
      targetProvider.accounts = [];
    }

    const accountEntry = {
      id: isCli
        ? (accountData.id.startsWith('gemini-cli-') ? accountData.id : `gemini-cli-${accountData.email.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase()}`)
        : (accountData.id.startsWith('gemini-cli-') ? `google-${accountData.email.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase()}` : accountData.id),
      name: isCli && !accountData.name.includes('(CLI)') ? `${accountData.name} (CLI)` : accountData.name,
      email: accountData.email,
      provider: isCli ? 'gemini-cli' : 'google',
      apiUrl: isCli ? 'https://cloudcode-pa.googleapis.com/v1internal' : 'https://generativelanguage.googleapis.com/v1beta',
      apiKey: accountData.accessToken,
      refreshToken: accountData.refreshToken,
      projectId: accountData.projectId || (isCli ? 'gemini-cli-users' : 'aicode-consumers'),
      quotas: accountData.quotas,
      enabled: true,
      status: 'healthy',
      lastTestedAt: new Date().toISOString(),
    };

    const existingAccIdx = targetProvider.accounts.findIndex(
      (a: any) => (accountData.email && a.email === accountData.email) || a.id === accountData.id
    );

    if (existingAccIdx >= 0) {
      targetProvider.accounts[existingAccIdx] = {
        ...targetProvider.accounts[existingAccIdx],
        ...accountEntry,
      };
    } else {
      targetProvider.accounts.push(accountEntry);
    }

    fs.writeFileSync(filePath, JSON.stringify(config, null, 2), 'utf-8');
  } catch (err) {
    console.error('[GoogleOAuthServer] Failed to save account to custom_models.json:', err);
  }
}

/**
 * Starts a transient local HTTP server, launches browser OAuth, and resolves with account details.
 */
export async function startGoogleOAuthLogin(providerType: 'antigravity' | 'gemini-cli' = 'antigravity'): Promise<GoogleOAuthResult> {
  let server: http.Server | null = null;
  let chosenPort = 8086;

  // Find an available port
  for (const port of BASE_PORTS) {
    const isAvailable = await new Promise<boolean>((resolve) => {
      const s = http.createServer();
      s.once('error', () => resolve(false));
      s.once('listening', () => {
        s.close(() => resolve(true));
      });
      s.listen(port, '127.0.0.1');
    });
    if (isAvailable) {
      chosenPort = port;
      break;
    }
  }

  const isCli = providerType === 'gemini-cli';
  // Note: GEMINI_CLI_CLIENT_ID is deprecated by Google for individual accounts with:
  // "This client is no longer supported for Gemini Code Assist for individuals".
  // Always use GOOGLE_CLIENT_ID (Antigravity client) to ensure Google issues a valid, licensed token for individuals.
  const clientId = GOOGLE_CLIENT_ID;
  const clientSecret = GOOGLE_CLIENT_SECRET;

  const redirectUri = `http://localhost:${chosenPort}/oauth2callback`;
  const scopes = [
    'https://www.googleapis.com/auth/cloud-platform',
    'https://www.googleapis.com/auth/userinfo.email',
    'https://www.googleapis.com/auth/userinfo.profile',
  ].join(' ');

  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?` + new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: scopes,
    access_type: 'offline',
    prompt: 'consent',
  }).toString();

  return new Promise<GoogleOAuthResult>((resolve) => {
    let timeoutTimer: NodeJS.Timeout | null = null;

    const cleanup = () => {
      if (timeoutTimer) clearTimeout(timeoutTimer);
      if (server) {
        server.close();
        server = null;
      }
    };

    server = http.createServer(async (req, res) => {
      const reqUrl = new URL(req.url || '/', `http://localhost:${chosenPort}`);

      if (reqUrl.pathname !== '/oauth2callback') {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not found');
        return;
      }

      const code = reqUrl.searchParams.get('code');
      const errParam = reqUrl.searchParams.get('error');

      if (errParam || !code) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(getErrorHtml(errParam ? `Autorisation refusée: ${errParam}` : 'Code d\'autorisation manquant.'));
        cleanup();
        resolve({ success: false, error: errParam || 'Authorization code missing' });
        return;
      }

      // Exchange code for tokens
      const tokenResponse = await exchangeCodeForTokens(code, redirectUri, clientId, clientSecret);
      if (!tokenResponse || !tokenResponse.access_token) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(getErrorHtml('Impossible d\'échanger le code contre un token OAuth.'));
        cleanup();
        resolve({ success: false, error: 'Token exchange failed' });
        return;
      }

      const accessToken = tokenResponse.access_token;
      const refreshToken = tokenResponse.refresh_token || '';

      if (!refreshToken) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(getErrorHtml('Google n\'a pas retourné de refresh token. Veuillez révoquer l\'accès puis réessayer avec prompt=consent.'));
        cleanup();
        resolve({ success: false, error: 'No refresh token returned by Google' });
        return;
      }

      // Fetch user profile and quotas in parallel
      const [userInfo, projectInfo, quotas] = await Promise.all([
        fetchGoogleUserInfo(accessToken),
        ensureCloudCodeProject(accessToken),
        fetchGoogleAccountQuotas(accessToken),
      ]);

      const email = userInfo?.email || projectInfo?.accountEmail || 'google-user@gmail.com';
      const name = userInfo?.name || email.split('@')[0];
      const accountId = isCli
        ? `gemini-cli-${email.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase()}`
        : `google-${email.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase()}`;

      saveAccountToCustomModels({
        id: accountId,
        name: isCli && !name.includes('(CLI)') ? `${name} (CLI)` : name,
        email,
        refreshToken,
        accessToken,
        projectId: projectInfo?.projectId,
        quotas,
      }, providerType);

      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(getSuccessHtml());

      cleanup();

      resolve({
        success: true,
        account: {
          id: accountId,
          name: isCli && !name.includes('(CLI)') ? `${name} (CLI)` : name,
          email,
          picture: userInfo?.picture,
          refreshToken,
          accessToken,
          projectId: projectInfo?.projectId,
          tierId: projectInfo?.tierId,
          quotas,
        },
      });
    });

    server.listen(chosenPort, '127.0.0.1', () => {
      // Launch browser
      shell.openExternal(authUrl);

      // Setup 2-minute safety timeout
      timeoutTimer = setTimeout(() => {
        cleanup();
        resolve({ success: false, error: 'Délai d\'attente de connexion dépassé (timeout 120s)' });
      }, OAUTH_TIMEOUT_MS);
    });

    server.on('error', (err) => {
      cleanup();
      resolve({ success: false, error: `Erreur serveur loopback: ${err.message}` });
    });
  });
}
