// Antigravity 2.0 Remote Agent Runtime Hook
// Injects Remote (VPS) into Antigravity 2.0 UI, handles remote command execution, and provides status UI.
(() => {
  if (window.__ag_remote_hook_installed) {
    if (window.__ag_dom_observer) {
      window.__ag_dom_observer.disconnect();
    }
  }
  window.__ag_remote_hook_installed = true;

  // Intercept benign Antigravity IDE UI errors (e.g. DraftCommentEditor on image/binary assets)
  window.addEventListener('error', (event) => {
    if (event && event.message && (
      event.message.includes('DraftCommentEditor: A line number or selection context is required') ||
      event.message.includes('run state not found')
    )) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }, true);

  window.addEventListener('unhandledrejection', (event) => {
    const reason = event && (event.reason?.message || String(event.reason || ''));
    if (reason.includes('run state not found') || reason.includes('HandleCascadeUserInteraction')) {
      event.preventDefault();
    }
  });

    // Polyfill window.URL to allow data: URIs in Antigravity's I0b image loader
  try {
    const OrigURL = window.URL;
    function PatchedURL(url, base) {
      if (typeof url === 'string' && url.startsWith('data:')) {
        return {
          protocol: 'https:',
          href: url,
          origin: '',
          pathname: '',
          search: '',
          hash: ''
        };
      }
      return new OrigURL(url, base);
    }
    PatchedURL.prototype = OrigURL.prototype;
    Object.assign(PatchedURL, OrigURL);
    window.URL = PatchedURL;
  } catch (_) {}

  // Clean up legacy overrides to preserve native Projects UI & authentic Marketplace
  try {
    window.localStorage.removeItem('jetski.developer.featureEnvironmentOverride');
    const existingFlags = JSON.parse(window.localStorage.getItem('jetski.developer.customFlagOverrides') || '{}');
    delete existingFlags['enable-conversation-navigator'];
    delete existingFlags['enable-conversation-groups'];
    delete existingFlags['enable-plugin-bundles'];
    if (existingFlags['project-4k'] || existingFlags['enable-project-4k']) {
      existingFlags['project-4k'] = false;
      existingFlags['enable-project-4k'] = false;
    }
    window.localStorage.setItem('jetski.developer.customFlagOverrides', JSON.stringify(existingFlags));
  } catch (_) {}

  // Intercept GetAllWorkflows & GetSlashCommands to display all 86 skills in the visual / dropdown
  (() => {
    if (window.__ag_fetch_skills_hooked) return;
    window.__ag_fetch_skills_hooked = true;
    const origFetch = window.fetch;

    function makeGrpcWeb(payload) {
      const jsonStr = JSON.stringify(payload);
      const jsonBytes = new TextEncoder().encode(jsonStr);
      const trailerStr = 'grpc-status: 0\r\ngrpc-message: OK\r\n';
      const trailerBytes = new TextEncoder().encode(trailerStr);

      const total = 5 + jsonBytes.length + 5 + trailerBytes.length;
      const res = new Uint8Array(total);
      const v = new DataView(res.buffer);

      // Data frame (flag 0)
      v.setUint8(0, 0);
      v.setUint32(1, jsonBytes.length, false);
      res.set(jsonBytes, 5);

      // Trailer frame (flag 0x80 = 128)
      const offset2 = 5 + jsonBytes.length;
      v.setUint8(offset2, 128);
      v.setUint32(offset2 + 1, trailerBytes.length, false);
      res.set(trailerBytes, offset2 + 5);

      return res;
    }

    function formatResponse(payload, reqHeaders) {
      let isGw = false;
      if (reqHeaders) {
        if (typeof reqHeaders.get === 'function') {
          isGw = (reqHeaders.get('content-type') || '').includes('grpc-web') || reqHeaders.get('x-grpc-web') === '1';
        } else {
          for (const k of Object.keys(reqHeaders)) {
            const lk = k.toLowerCase();
            if (lk === 'x-grpc-web' && reqHeaders[k] == '1') isGw = true;
            if (lk === 'content-type' && String(reqHeaders[k]).includes('grpc-web')) isGw = true;
          }
        }
      }
      if (isGw) {
        return new Response(makeGrpcWeb(payload), {
          status: 200,
          headers: {
            'content-type': 'application/grpc-web+json',
            'x-grpc-web': '1'
          }
        });
      }
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: {
          'content-type': 'application/json',
          'connect-protocol-version': '1'
        }
      });
    }

    let cachedSkillsWorkflows = null;
    let lastSkillsFetchTime = 0;
    let cachedMarketplaceItems = null;
    let lastMarketplaceFetchTime = 0;
    const recentCascadeInteractions = new Map();
    function cleanRecentInteractions() {
      const now = Date.now();
      for (const [k, ts] of recentCascadeInteractions.entries()) {
        if (now - ts > 5000) recentCascadeInteractions.delete(k);
      }
    }

    const CONTEXT7_ITEM = {
      id: 'antigravity-plugins-partners/plugin/context7',
      slug: 'context7',
      marketplace: 'antigravity-plugins-partners',
      displayName: 'Context7',
      description: 'Up-to-date documentation lookup. Pull version-specific documentation and code examples directly from source repositories into your LLM context.',
      logo: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><rect width="48" height="48" rx="12" fill="%230b132b"/><rect x="4" y="4" width="40" height="40" rx="10" fill="none" stroke="%2300b4d8" stroke-width="2.5"/><path d="M15 16l-5 8 5 8M33 16l5 8-5 8" fill="none" stroke="%2338bdf8" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/><path d="M19 18h10l-6 13" fill="none" stroke="%2310b981" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
      version: '1.0.0',
      tags: ['featured', 'docs', 'context', 'documentation'],
      readme: '# Context7\n\nUp-to-date documentation lookup. Pull version-specific documentation and code examples directly from source repositories into your LLM context.\n\n### Capabilities\n- Seamless library and API documentation search\n- Direct code snippets ingestion into active LLM session\n- Auto-version detection and deprecation notices',
      skills: [
        { name: 'context7-query', description: 'Look up live documentation and API references for libraries and frameworks.' }
      ],
      agents: [],
      mcpServers: [
        { serverName: 'context7', command: 'npx', args: ['-y', '@context7/mcp-server'] }
      ],
      rules: [],
      sidecars: [],
      suggestedPrompts: [
        'Look up recent documentation for this project',
        'Find code examples for the latest version'
      ]
    };

    const OFFICIAL_PLUGINS = [
      // Floating banner companions
      {
        id: 'antigravity-plugins-official/plugin/firebase',
        slug: 'firebase',
        marketplace: 'antigravity-plugins-official',
        displayName: 'Firebase',
        description: 'Prototype, build & run modern apps that users love with Firebase infrastructure.',
        logo: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><path fill="%23FFA000" d="M8 38L18 6l6 12-5.5 10.5z"/><path fill="%23FFCA28" d="M40 38l-7-25-15 25z"/><path fill="%23F57C00" d="M23.5 28.5L18 6l-10 32h32z"/></svg>',
        version: '1.0.0',
        tags: ['google', 'firebase', 'cloud', 'database'],
        readme: '# Firebase\n\nPrototype, build & run modern apps that users love with Firebase backend, AI, and operational infrastructure.\n\n### Features\n- Firestore and Realtime Database management\n- Firebase Cloud Functions monitoring\n- Firebase Hosting and Auth operations',
        skills: [{ name: 'firebase-cli', description: 'Interact with Firebase project configuration and deployment.' }],
        agents: [],
        mcpServers: [{ serverName: 'firebase', command: 'npx', args: ['-y', 'firebase-tools@latest'] }],
        rules: [],
        sidecars: [],
        suggestedPrompts: ['Check Firebase deployment status', 'Inspect Firestore collections']
      },
      {
        id: 'antigravity-plugins-partners/plugin/linear',
        slug: 'linear',
        marketplace: 'antigravity-plugins-partners',
        displayName: 'Linear',
        description: 'The product development system for teams and agents.',
        logo: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><rect width="48" height="48" rx="10" fill="%2312151A"/><path d="M14 34L34 14M14 24L24 14M24 34L34 24" stroke="%235E6AD2" stroke-width="4" stroke-linecap="round"/></svg>',
        version: '1.0.0',
        tags: ['productivity', 'issues', 'linear'],
        readme: '# Linear\n\nThe issue tracking and product development system built for modern engineering teams and autonomous agents.\n\n### Capabilities\n- Create and update Linear issues directly from chat\n- Sync git branch naming and issue status\n- Review sprint progress and issue milestones',
        skills: [{ name: 'linear-issues', description: 'Query and update Linear project issues and cycles.' }],
        agents: [],
        mcpServers: [{ serverName: 'linear', command: 'npx', args: ['-y', '@linear/mcp-server'] }],
        rules: [],
        sidecars: [],
        suggestedPrompts: ['List high priority Linear issues assigned to me', 'Create a bug ticket for the active investigation']
      },
      {
        id: 'antigravity-plugins-partners/plugin/notion',
        slug: 'notion',
        marketplace: 'antigravity-plugins-partners',
        displayName: 'Notion',
        description: 'Connected workspace for wiki, docs, and project knowledge bases.',
        logo: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><rect width="48" height="48" rx="10" fill="%23FFFFFF"/><path fill="%23000000" d="M10 12l20-4 8 2v26l-22 4-6-2V12zm4 3v20l18-3V14l-18 3zm4 4h4l6 10V19h4v12h-4l-6-10v10h-4V19z"/></svg>',
        version: '1.0.0',
        tags: ['productivity', 'wiki', 'docs', 'notion'],
        readme: '# Notion\n\nConnect your team knowledge base, engineering roadmaps, and PRDs directly to Antigravity.\n\n### Capabilities\n- Search team wikis and specifications\n- Append task notes and architecture logs\n- Query structured database tables',
        skills: [{ name: 'notion-search', description: 'Search and read pages across connected Notion workspaces.' }],
        agents: [],
        mcpServers: [{ serverName: 'notion', command: 'npx', args: ['-y', '@notionhq/mcp-server'] }],
        rules: [],
        sidecars: [],
        suggestedPrompts: ['Search Notion for project design specifications', 'Read current architecture guidelines']
      },
      {
        id: 'antigravity-plugins-partners/plugin/cursor',
        slug: 'cursor',
        marketplace: 'antigravity-plugins-partners',
        displayName: 'Cursor Tools',
        description: 'Fast codebase index and semantic indexing companion tools.',
        logo: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><rect width="48" height="48" rx="10" fill="%231E1E1E"/><polygon points="12,10 36,24 24,26 20,38" fill="%23007ACC"/></svg>',
        version: '1.0.0',
        tags: ['devtools', 'cursor', 'search'],
        readme: '# Cursor Tools\n\nDeep semantic code indexing and symbol navigation utilities.',
        skills: [{ name: 'cursor-symbol-search', description: 'Semantic code search across multi-repository workspaces.' }],
        agents: [],
        mcpServers: [],
        rules: [],
        sidecars: [],
        suggestedPrompts: ['Index workspace symbols', 'Find references across repositories']
      },
      {
        id: 'antigravity-plugins-partners/plugin/supabase',
        slug: 'supabase',
        marketplace: 'antigravity-plugins-partners',
        displayName: 'Supabase',
        description: 'The open source Firebase alternative with Postgres, Auth, and Edge Functions.',
        logo: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><rect width="48" height="48" rx="10" fill="%231C1C1C"/><path fill="%233ECF8E" d="M26 8L10 27h14l-2 13 16-19H24z"/></svg>',
        version: '1.0.0',
        tags: ['cloud', 'database', 'supabase'],
        readme: '# Supabase\n\nPostgres database, authentication, instant APIs, edge functions, and real-time subscriptions.\n\n### Capabilities\n- Inspect database schema and run SQL migrations\n- Manage Edge Functions deployment\n- Monitor active connections and slow queries',
        skills: [{ name: 'supabase-db', description: 'Execute database schema queries and migrations.' }],
        agents: [],
        mcpServers: [{ serverName: 'supabase', command: 'npx', args: ['-y', '@supabase/mcp-server'] }],
        rules: [],
        sidecars: [],
        suggestedPrompts: ['Inspect database tables and foreign keys', 'Draft migration for new schema']
      },

      // Google Workspace
      {
        id: 'antigravity-plugins-official/plugin/gdocs',
        slug: 'gdocs',
        marketplace: 'antigravity-plugins-official',
        displayName: 'Google Docs',
        description: 'Read, draft, and edit docs.',
        logo: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><path fill="%234285F4" d="M30 6H14a4 4 0 0 0-4 4v28a4 4 0 0 0 4 4h20a4 4 0 0 0 4-4V14l-8-8z"/><path fill="%23A1C2FA" d="M30 6v8h8z"/><path fill="%23fff" d="M16 22h16v2.5H16zm0 6h16v2.5H16zm0 6h10v2.5H16z"/></svg>',
        version: '1.0.0',
        tags: ['workspace', 'docs', 'google'],
        readme: '# Google Docs\n\nRead, draft, review, and collaborate on Google Docs directly from your Antigravity paired coding assistant.\n\n### Capabilities\n- Read shared Google Docs specification files\n- Export project documentation directly to Google Docs\n- Comment and review documentation collaboratively',
        skills: [{ name: 'gdocs-read', description: 'Read and extract content from Google Docs URLs.' }],
        agents: [],
        mcpServers: [{ serverName: 'google-docs', command: 'npx', args: ['-y', '@antigravity/gdocs-mcp'] }],
        rules: [],
        sidecars: [],
        suggestedPrompts: ['Summarize the attached Google Doc', 'Create project documentation in Docs']
      },
      {
        id: 'antigravity-plugins-official/plugin/gsheets',
        slug: 'gsheets',
        marketplace: 'antigravity-plugins-official',
        displayName: 'Google Sheets',
        description: 'Read, write, and format spreadsheets.',
        logo: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><path fill="%230F9D58" d="M30 6H14a4 4 0 0 0-4 4v28a4 4 0 0 0 4 4h20a4 4 0 0 0 4-4V14l-8-8z"/><path fill="%2387CEAC" d="M30 6v8h8z"/><path fill="%23fff" d="M16 22h16v14H16zm2 2v2.5h5V24zm7 0v2.5h5V24zm-7 4.5v2.5h5v-2.5zm7 0v2.5h5v-2.5zm-7 4.5v2.5h5V33zm7 0v2.5h5V33z"/></svg>',
        version: '1.0.0',
        tags: ['workspace', 'sheets', 'google'],
        readme: '# Google Sheets\n\nRead, write, query, and format tabular data in Google Sheets spreadsheets.\n\n### Capabilities\n- Read data ranges and financial models\n- Append structured logs and metric reports\n- Perform automated spreadsheet formulas validation',
        skills: [{ name: 'gsheets-query', description: 'Query and update cells in Google Sheets.' }],
        agents: [],
        mcpServers: [{ serverName: 'google-sheets', command: 'npx', args: ['-y', '@antigravity/gsheets-mcp'] }],
        rules: [],
        sidecars: [],
        suggestedPrompts: ['Export test coverage metrics to Sheets', 'Query data from active spreadsheet']
      },
      {
        id: 'antigravity-plugins-official/plugin/gslides',
        slug: 'gslides',
        marketplace: 'antigravity-plugins-official',
        displayName: 'Google Slides',
        description: 'Read, edit, and export presentations.',
        logo: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><path fill="%23F4B400" d="M30 6H14a4 4 0 0 0-4 4v28a4 4 0 0 0 4 4h20a4 4 0 0 0 4-4V14l-8-8z"/><path fill="%23FBE38E" d="M30 6v8h8z"/><path fill="%23fff" d="M16 22h16v12H16zm2 2v8h12v-8z"/></svg>',
        version: '1.0.0',
        tags: ['workspace', 'slides', 'google'],
        readme: '# Google Slides\n\nCreate, edit, and review slide decks and technical presentations.\n\n### Capabilities\n- Generate presentation slide decks from project specs\n- Format slide layouts and code snippets\n- Export decks to PDF and web formats',
        skills: [{ name: 'gslides-generate', description: 'Generate presentation decks from Markdown outlines.' }],
        agents: [],
        mcpServers: [{ serverName: 'google-slides', command: 'npx', args: ['-y', '@antigravity/gslides-mcp'] }],
        rules: [],
        sidecars: [],
        suggestedPrompts: ['Generate architecture slide deck', 'Update presentation slides']
      },
      {
        id: 'antigravity-plugins-official/plugin/gdrive',
        slug: 'gdrive',
        marketplace: 'antigravity-plugins-official',
        displayName: 'Google Drive',
        description: 'Search, upload, download, and share files.',
        logo: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><path fill="%23FFC107" d="M17 6L6 25l6 10.5h11L17 6z"/><path fill="%232196F3" d="M31 6H17l11 19h14L31 6z"/><path fill="%234CAF50" d="M12 35.5l5.5 9.5h22l-6-9.5H12z"/></svg>',
        version: '1.0.0',
        tags: ['workspace', 'drive', 'google'],
        readme: '# Google Drive\n\nAccess your organization Google Drive files, shared team drives, and assets directly within Antigravity.\n\n### Capabilities\n- Search Drive files by name and content\n- Download datasets, models, and specifications\n- Upload build artifacts and documentation packages',
        skills: [{ name: 'gdrive-files', description: 'Search and download files from Google Drive.' }],
        agents: [],
        mcpServers: [{ serverName: 'google-drive', command: 'npx', args: ['-y', '@antigravity/gdrive-mcp'] }],
        rules: [],
        sidecars: [],
        suggestedPrompts: ['Search Drive for onboarding documents', 'Download test fixtures from Drive']
      },
      {
        id: 'antigravity-plugins-official/plugin/gcalendar',
        slug: 'gcalendar',
        marketplace: 'antigravity-plugins-official',
        displayName: 'Google Calendar',
        description: 'Check availability, schedule events, and RSVP.',
        logo: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><rect width="36" height="36" x="6" y="6" fill="%23fff" rx="4"/><path fill="%231976D2" d="M6 10a4 4 0 0 1 4-4h28a4 4 0 0 1 4 4v6H6z"/><text x="24" y="34" fill="%231976D2" font-family="sans-serif" font-size="18" font-weight="bold" text-anchor="middle">31</text></svg>',
        version: '1.0.0',
        tags: ['workspace', 'calendar', 'google'],
        readme: '# Google Calendar\n\nCalendar integration for scheduling team demos, code reviews, and tracking release events.\n\n### Capabilities\n- Check team calendar schedules\n- Book review meetings and sync reminders\n- Retrieve upcoming release windows',
        skills: [{ name: 'gcalendar-events', description: 'Inspect and schedule Google Calendar events.' }],
        agents: [],
        mcpServers: [{ serverName: 'google-calendar', command: 'npx', args: ['-y', '@antigravity/gcalendar-mcp'] }],
        rules: [],
        sidecars: [],
        suggestedPrompts: ['Check upcoming calendar events', 'Schedule release review meeting']
      },

      // Build with Google
      {
        id: 'antigravity-plugins-official/plugin/gemini-api',
        slug: 'gemini-api',
        marketplace: 'antigravity-plugins-official',
        displayName: 'Gemini API',
        description: 'Build applications with the Gemini Interactions API and multimodal models.',
        logo: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><defs><linearGradient id="gem" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="%231BA1E2"/><stop offset="50%" stop-color="%239B59B6"/><stop offset="100%" stop-color="%23E67E22"/></linearGradient></defs><path fill="url(%23gem)" d="M24 2C24 14.15 14.15 24 2 24c12.15 0 22 9.85 22 22 0-12.15 9.85-22 22-22-12.15 0-22-9.85-22-22z"/></svg>',
        version: '1.0.0',
        tags: ['google', 'gemini', 'api'],
        readme: '# Gemini API\n\nBuild cutting-edge AI applications with Google Gemini 2.5 Flash, Gemini 2.5 Pro, and multimodal Live APIs.\n\n### Capabilities\n- Multimodal audio, video, image, and text generation\n- Structured JSON schema validation and function calling\n- Embeddings and semantic search generation',
        skills: [{ name: 'gemini-generate', description: 'Call Gemini models with multimodal payloads.' }],
        agents: [],
        mcpServers: [{ serverName: 'gemini', command: 'npx', args: ['-y', '@google/gemini-mcp'] }],
        rules: [],
        sidecars: [],
        suggestedPrompts: ['Test prompt against Gemini 2.5 Pro', 'Inspect Gemini function calling schema']
      },
      {
        id: 'antigravity-plugins-official/plugin/chrome-devtools-plugin',
        slug: 'chrome-devtools-plugin',
        marketplace: 'antigravity-plugins-official',
        displayName: 'Chrome DevTools',
        description: 'Reliable automation, in-depth debugging, and performance profiling.',
        logo: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><circle cx="24" cy="24" r="20" fill="%234285F4"/><circle cx="24" cy="24" r="9" fill="%23fff"/><circle cx="24" cy="24" r="7" fill="%231976D2"/><path fill="%23EA4335" d="M24 4c7.4 0 13.9 4 17.3 10H24z"/><path fill="%23FBBC05" d="M41.3 14c2.2 3.8 3.5 8.2 3.5 13 0 7.8-3.5 14.8-9 19.3L24 24z"/><path fill="%2334A853" d="M35.8 46.3C32.4 48.7 28.4 50 24 50 12.9 50 3.6 42.4 1 32l11.5-6.6z"/></svg>',
        version: '1.0.0',
        tags: ['google', 'chrome', 'devtools'],
        readme: '# Chrome DevTools\n\nAutomate web interactions, inspect network requests, analyze memory heaps, and capture frontend performance traces.\n\n### Capabilities\n- Automated browser test runs with Puppeteer\n- Network trace collection and HAR export\n- DOM screenshotting and accessibility tree audit',
        skills: [{ name: 'chrome-inspect', description: 'Control headless Chrome and extract performance traces.' }],
        agents: [],
        mcpServers: [{ serverName: 'chrome-devtools', command: 'npx', args: ['-y', 'chrome-devtools-mcp'] }],
        rules: [],
        sidecars: [],
        suggestedPrompts: ['Inspect console errors on running page', 'Capture performance trace of main view']
      },
      {
        id: 'antigravity-plugins-official/plugin/android-cli',
        slug: 'android-cli',
        marketplace: 'antigravity-plugins-official',
        displayName: 'Android CLI',
        description: 'Core tools and knowledge required to develop for Android.',
        logo: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><path fill="%233DDC84" d="M12 28a12 12 0 0 1 24 0v4H12zm5-12l-3-5a1 1 0 1 1 1.7-1l3.1 5.2a14 14 0 0 1 10.4 0L32.3 10a1 1 0 1 1 1.7 1l-3 5A12 12 0 0 1 36 24H12a12 12 0 0 1 5-8zm1 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4zm12 0a2 2 0 1 0 0-4 2 2 0 0 0 0 4z"/></svg>',
        version: '1.0.0',
        tags: ['google', 'android', 'cli'],
        readme: '# Android CLI\n\nManage Android Virtual Devices, install APKs, inspect layouts, and control test devices over ADB.\n\n### Capabilities\n- Build and install APK / AAB artifacts\n- Mirror and interact with running emulators\n- Capture bug reports and live logcat traces',
        skills: [{ name: 'android-tools', description: 'Run ADB, Gradle, and Android SDK commands.' }],
        agents: [],
        mcpServers: [{ serverName: 'android-cli', command: 'npx', args: ['-y', '@antigravity/android-mcp'] }],
        rules: [],
        sidecars: [],
        suggestedPrompts: ['Check connected Android devices', 'Install latest debug APK']
      },
      {
        id: 'antigravity-plugins-official/plugin/google-antigravity-sdk',
        slug: 'google-antigravity-sdk',
        marketplace: 'antigravity-plugins-official',
        displayName: 'Google Antigravity SDK',
        description: 'Using the Google Antigravity Python SDK to build custom tools and agents.',
        logo: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><path fill="%234285F4" d="M24 4L6 40h10l8-18 8 18h10z"/><circle cx="24" cy="18" r="4" fill="%2334A853"/></svg>',
        version: '1.0.0',
        tags: ['google', 'sdk', 'antigravity'],
        readme: '# Google Antigravity SDK\n\nDeveloper toolkit for writing custom agents, ConnectRPC plugins, and local MCP tool providers.\n\n### Capabilities\n- Custom subagent definitions and invocation contracts\n- High performance ConnectRPC protocol bindings\n- Stream handling and prompt orchestration tools',
        skills: [{ name: 'agy-sdk-scaffold', description: 'Scaffold new Antigravity tools and skills.' }],
        agents: [],
        mcpServers: [],
        rules: [],
        sidecars: [],
        suggestedPrompts: ['Scaffold a new custom agent', 'Inspect Antigravity plugin manifest']
      },

      // Design, Creative & Media
      {
        id: 'antigravity-plugins-partners/plugin/figma',
        slug: 'figma',
        marketplace: 'antigravity-plugins-partners',
        displayName: 'Figma',
        description: 'Turn Figma designs into production code, map components with Code Connect.',
        logo: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><path fill="%23F24E1E" d="M16 6h8v12h-8a6 6 0 0 1 0-12z"/><path fill="%23A259FF" d="M16 18h8v12h-8a6 6 0 0 1 0-12z"/><path fill="%230ACF83" d="M16 30h8v6a6 6 0 0 1-6 6 6 6 0 0 1-2-12z"/><path fill="%23FF7262" d="M24 6h8a6 6 0 0 1 0 12h-8z"/><circle cx="30" cy="24" r="6" fill="%231ABCFE"/></svg>',
        version: '1.0.0',
        tags: ['design', 'figma', 'ui'],
        readme: '# Figma\n\nTurn Figma designs into clean, production-ready frontend code. Map design tokens, components, and variables directly into code with Code Connect.\n\n### Capabilities\n- Extract design tokens (colors, typography, spacing)\n- Inspect selected components and auto-layout hierarchies\n- Convert vector nodes to SVG and Tailwind CSS code',
        skills: [
          { name: 'figma-inspect', description: 'Inspect component layers, tokens, and CSS properties from Figma files.' }
        ],
        agents: [],
        mcpServers: [
          { serverName: 'figma', command: 'npx', args: ['-y', '@figma/mcp-server'] }
        ],
        rules: [],
        sidecars: [],
        suggestedPrompts: [
          'Inspect Figma component tokens',
          'Generate React component from Figma URL'
        ]
      },
      {
        id: 'antigravity-plugins-partners/plugin/canva',
        slug: 'canva',
        marketplace: 'antigravity-plugins-partners',
        displayName: 'Canva',
        description: 'Create, edit, review, resize, and brand-check Canva designs with MCP.',
        logo: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><defs><linearGradient id="canvaGrad" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="%2300C4CC"/><stop offset="100%" stop-color="%237D2AE8"/></linearGradient></defs><circle cx="24" cy="24" r="20" fill="url(%23canvaGrad)"/><path fill="%23fff" d="M22 14c-4.5 0-7 3.5-7 9.5 0 7 3.5 10.5 8 10.5 3 0 5-1.5 6-3.5l-2.5-1.5c-.8 1.2-2 2-3.5 2-2.5 0-4.5-2-4.5-7 0-4.5 1.5-7 4-7 1.5 0 2.5.8 3.2 2l2.5-1.5C26.5 15.5 24.5 14 22 14z"/></svg>',
        version: '1.0.0',
        tags: ['design', 'canva', 'creative'],
        readme: '# Canva\n\nCreate, edit, review, resize, and brand-check marketing and product assets with Canva MCP integration.\n\n### Capabilities\n- Automate brand design asset exports\n- Check typography and color palette consistency\n- Generate social and marketing previews',
        skills: [{ name: 'canva-tools', description: 'Create and resize Canva graphic designs.' }],
        agents: [],
        mcpServers: [{ serverName: 'canva', command: 'npx', args: ['-y', '@canva/mcp-server'] }],
        rules: [],
        sidecars: [],
        suggestedPrompts: ['Resize marketing asset for web', 'Export product banner in SVG']
      },
      {
        id: 'antigravity-plugins-partners/plugin/mobbin',
        slug: 'mobbin',
        marketplace: 'antigravity-plugins-partners',
        displayName: 'Mobbin',
        description: 'Give your AI agent 600,000+ real app screens, and the skills to use them.',
        logo: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><rect width="48" height="48" rx="10" fill="%23000"/><text x="24" y="32" fill="%23fff" font-family="sans-serif" font-size="20" font-weight="900" text-anchor="middle">M</text></svg>',
        version: '1.0.0',
        tags: ['design', 'mobile', 'screens'],
        readme: '# Mobbin\n\nAccess over 600,000 real-world iOS, Android, and Web design patterns, onboarding flows, and UI screen flows.\n\n### Capabilities\n- Search UI patterns for authentication and checkout flows\n- Benchmark user interface patterns against top apps\n- Inspect mobile navigation architectures',
        skills: [{ name: 'mobbin-search', description: 'Search real mobile application UI designs.' }],
        agents: [],
        mcpServers: [{ serverName: 'mobbin', command: 'npx', args: ['-y', '@mobbin/mcp-server'] }],
        rules: [],
        sidecars: [],
        suggestedPrompts: ['Find best onboarding flows for mobile', 'Search mobile settings screen examples']
      },

      // Productivity & Project Management
      {
        id: 'antigravity-plugins-partners/plugin/dropbox',
        slug: 'dropbox',
        marketplace: 'antigravity-plugins-partners',
        displayName: 'Dropbox',
        description: 'Connect Antigravity to Dropbox to search, inspect, and organize files.',
        logo: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><path fill="%230061FF" d="M14 9l10 6.5-10 6.5-10-6.5L14 9zm20 0l10 6.5-10 6.5-10-6.5L34 9zm-20 20l10-6.5 10 6.5-10 6.5-10-6.5zm-10-7l10 6.5 10-6.5-10-6.5-10 6.5zm30 0l10 6.5-10 6.5-10-6.5 10-6.5z"/></svg>',
        version: '1.0.0',
        tags: ['productivity', 'storage', 'dropbox'],
        readme: '# Dropbox\n\nManage files, collaborate on team folders, and sync shared media assets from Dropbox.\n\n### Capabilities\n- Search and download Dropbox files\n- Create upload requests and shareable links\n- Inspect folder revisions and activity logs',
        skills: [{ name: 'dropbox-files', description: 'Browse and download files from Dropbox.' }],
        agents: [],
        mcpServers: [{ serverName: 'dropbox', command: 'npx', args: ['-y', '@dropbox/mcp-server'] }],
        rules: [],
        sidecars: [],
        suggestedPrompts: ['Search Dropbox for media assets', 'Download project attachments from Dropbox']
      },
      {
        id: 'antigravity-plugins-partners/plugin/atlassian-twg-cli',
        slug: 'atlassian-twg-cli',
        marketplace: 'antigravity-plugins-partners',
        displayName: 'Atlassian TWG',
        description: "Teamwork Graph CLI is Atlassian's agent-first interface to your work context.",
        logo: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><path fill="%230052CC" d="M23.5 10c-.5 0-.9.3-1.1.7L12 28.5c-.3.5 0 1.2.6 1.3h10.4c.5 0 .9-.4.9-.9V10.4c0-.2-.2-.4-.4-.4zm1 28c.5 0 .9-.3 1.1-.7l10.4-17.8c.3-.5 0-1.2-.6-1.3H25c-.5 0-.9.4-.9.9v18.5c0 .2.2.4.4.4z"/></svg>',
        version: '1.0.0',
        tags: ['productivity', 'atlassian', 'jira', 'confluence'],
        readme: '# Atlassian Teamwork Graph\n\nConnect Jira issues, Confluence pages, and Bitbucket pull requests seamlessly with your AI agent context.\n\n### Capabilities\n- Read Jira ticket requirements and acceptance criteria\n- Query Confluence documentation spaces\n- Track Bitbucket PR feedback and status',
        skills: [{ name: 'twg-query', description: 'Search Jira issues and Confluence pages.' }],
        agents: [],
        mcpServers: [{ serverName: 'atlassian', command: 'npx', args: ['-y', '@atlassian/twg-mcp'] }],
        rules: [],
        sidecars: [],
        suggestedPrompts: ['Fetch acceptance criteria for active Jira ticket', 'Search Confluence for API architecture']
      },

      // Cloud Hosting & Deployment
      {
        id: 'antigravity-plugins-partners/plugin/vercel-plugin',
        slug: 'vercel-plugin',
        marketplace: 'antigravity-plugins-partners',
        displayName: 'Vercel',
        description: 'Build and deploy web apps and AI agents on Vercel with skills for Next.js.',
        logo: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><rect width="48" height="48" rx="10" fill="%23000"/><polygon points="24,10 38,36 10,36" fill="%23fff"/></svg>',
        version: '1.0.0',
        tags: ['cloud', 'hosting', 'vercel', 'nextjs'],
        readme: '# Vercel\n\nDeploy Next.js, AI SDK, and web applications to Vercel globally distributed edge network.\n\n### Capabilities\n- Inspect deployment status and preview URLs\n- Monitor Edge Middleware and Serverless execution logs\n- Manage project environment variables',
        skills: [{ name: 'vercel-deploy', description: 'Manage Vercel deployments and environment variables.' }],
        agents: [],
        mcpServers: [{ serverName: 'vercel', command: 'npx', args: ['-y', '@vercel/mcp-server'] }],
        rules: [],
        sidecars: [],
        suggestedPrompts: ['Check Vercel preview deployment status', 'Tail serverless function logs']
      },
      {
        id: 'antigravity-plugins-partners/plugin/netlify',
        slug: 'netlify',
        marketplace: 'antigravity-plugins-partners',
        displayName: 'Netlify',
        description: 'Build and deploy on Netlify: functions, edge functions, blobs, database, and forms.',
        logo: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><rect width="48" height="48" rx="10" fill="%2300C7B7"/><path d="M16 16h16l-8 16z" fill="%230E1E25"/></svg>',
        version: '1.0.0',
        tags: ['cloud', 'hosting', 'netlify'],
        readme: '# Netlify\n\nGlobal web hosting with automated CI/CD, serverless Edge Functions, and Netlify Blobs storage.\n\n### Capabilities\n- Deploy static sites and edge functions\n- Inspect build logs and deployment previews\n- Manage Netlify DNS and redirect rules',
        skills: [{ name: 'netlify-cli', description: 'Deploy and test Netlify applications.' }],
        agents: [],
        mcpServers: [{ serverName: 'netlify', command: 'npx', args: ['-y', '@netlify/mcp-server'] }],
        rules: [],
        sidecars: [],
        suggestedPrompts: ['Check Netlify build logs', 'Deploy preview build to Netlify']
      },
      {
        id: 'antigravity-plugins-partners/plugin/railway',
        slug: 'railway',
        marketplace: 'antigravity-plugins-partners',
        displayName: 'Railway',
        description: 'Deploy, configure, monitor, and troubleshoot apps and databases on Railway.',
        logo: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><rect width="48" height="48" rx="10" fill="%2313111C"/><path d="M12 28l12-16 12 16H12z" fill="%23FF4081"/></svg>',
        version: '1.0.0',
        tags: ['cloud', 'hosting', 'railway'],
        readme: '# Railway\n\nInfrastructure platform to provision databases, microservices, and web servers with zero configuration.\n\n### Capabilities\n- Deploy PostgreSQL, Redis, and Docker containers\n- Tail real-time service logs\n- Roll back deployments and manage variables',
        skills: [{ name: 'railway-ops', description: 'Monitor and configure Railway services.' }],
        agents: [],
        mcpServers: [{ serverName: 'railway', command: 'npx', args: ['-y', '@railway/mcp-server'] }],
        rules: [],
        sidecars: [],
        suggestedPrompts: ['Check Railway container health', 'Provision managed PostgreSQL on Railway']
      },

      // Developer Tools
      {
        id: 'antigravity-plugins-partners/plugin/auth0',
        slug: 'auth0',
        marketplace: 'antigravity-plugins-partners',
        displayName: 'Auth0',
        description: 'Add Auth0 authentication to any app: login, MFA, SSO, Organizations, and RBAC.',
        logo: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><path fill="%23EB5424" d="M24 4L10 9v14c0 10.5 6 20.3 14 23 8-2.7 14-12.5 14-23V9L24 4zm0 8a6 6 0 1 1 0 12 6 6 0 0 1 0-12zm0 16c4.5 0 9 2.3 9 6.8v1.6c-2.5 4-6 6.8-9 8.2-3-1.4-6.5-4.2-9-8.2v-1.6c0-4.5 4.5-6.8 9-6.8z"/></svg>',
        version: '1.0.0',
        tags: ['devtools', 'auth', 'auth0'],
        readme: '# Auth0\n\nUniversal identity platform: passwordless login, social SSO, multi-factor authentication, and user access management.\n\n### Capabilities\n- Configure OAuth2 and OIDC application credentials\n- Manage user roles and permissions (RBAC)\n- Inspect login activity and security logs',
        skills: [{ name: 'auth0-config', description: 'Inspect and configure Auth0 application settings.' }],
        agents: [],
        mcpServers: [{ serverName: 'auth0', command: 'npx', args: ['-y', '@auth0/mcp-server'] }],
        rules: [],
        sidecars: [],
        suggestedPrompts: ['Inspect Auth0 client configuration', 'Check recent Auth0 login events']
      },
      {
        id: 'antigravity-plugins-partners/plugin/browse',
        slug: 'browse',
        marketplace: 'antigravity-plugins-partners',
        displayName: 'Browserbase',
        description: 'Give your agent a real browser: navigate, click, type, screenshot, and extract data.',
        logo: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><rect width="48" height="48" rx="10" fill="%23FF4F00"/><circle cx="24" cy="24" r="12" fill="%23fff"/><circle cx="24" cy="24" r="6" fill="%23FF4F00"/></svg>',
        version: '1.0.0',
        tags: ['devtools', 'browser', 'browserbase'],
        readme: '# Browserbase\n\nHeadless cloud browsers with built-in stealth, proxy rotation, CAPTCHA solving, and session playback.\n\n### Capabilities\n- High reliability web scraping and automated dogfooding\n- Stealth browsing resistant to bot detection\n- Full video recordings and network logs for each run',
        skills: [{ name: 'browserbase-run', description: 'Run cloud browser tasks with Browserbase.' }],
        agents: [],
        mcpServers: [{ serverName: 'browserbase', command: 'npx', args: ['-y', '@browserbase/mcp-server'] }],
        rules: [],
        sidecars: [],
        suggestedPrompts: ['QA test live website flow', 'Scrape dynamic web page without blocking']
      },
      {
        id: 'antigravity-plugins-partners/plugin/base44',
        slug: 'base44',
        marketplace: 'antigravity-plugins-partners',
        displayName: 'Base44',
        description: 'Build and deploy Base44 full-stack apps: CLI project management and SDKs.',
        logo: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><rect width="48" height="48" rx="10" fill="%231E293B"/><text x="24" y="32" fill="%2338BDF8" font-family="sans-serif" font-size="20" font-weight="bold" text-anchor="middle">44</text></svg>',
        version: '1.0.0',
        tags: ['devtools', 'fullstack', 'base44'],
        readme: '# Base44\n\nFull-stack app development framework with automated state synchronization and real-time backend primitives.\n\n### Capabilities\n- Scaffold new full-stack features\n- Sync client-side states with persistent store\n- Monitor app health and background tasks',
        skills: [{ name: 'base44-cli', description: 'Manage Base44 application stacks.' }],
        agents: [],
        mcpServers: [{ serverName: 'base44', command: 'npx', args: ['-y', '@base44/mcp-server'] }],
        rules: [],
        sidecars: [],
        suggestedPrompts: ['Inspect Base44 project structure', 'Run Base44 state migrations']
      },

      // Business
      {
        id: 'antigravity-plugins-partners/plugin/zoho-bigin',
        slug: 'zoho-bigin',
        marketplace: 'antigravity-plugins-partners',
        displayName: 'Bigin',
        description: 'Manage Bigin CRM: pipelines, contacts, deals, call logs, and customer follow-ups.',
        logo: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><rect width="48" height="48" rx="10" fill="%230072CE"/><text x="24" y="32" fill="%23fff" font-family="sans-serif" font-size="18" font-weight="bold" text-anchor="middle">CRM</text></svg>',
        version: '1.0.0',
        tags: ['business', 'crm', 'bigin'],
        readme: '# Bigin by Zoho\n\nPipeline-centric CRM for customer relationship management, deal tracking, and follow-up logging.',
        skills: [{ name: 'bigin-crm', description: 'Query CRM pipelines and contacts.' }],
        agents: [],
        mcpServers: [{ serverName: 'bigin', command: 'npx', args: ['-y', '@zoho/bigin-mcp'] }],
        rules: [],
        sidecars: [],
        suggestedPrompts: ['List active pipeline deals', 'Record call summary in CRM']
      },
      {
        id: 'antigravity-plugins-partners/plugin/databricks',
        slug: 'databricks',
        marketplace: 'antigravity-plugins-partners',
        displayName: 'Databricks',
        description: 'Databricks CLI, Lakebase, Model Serving, Lakeflow Jobs, and Spark pipelines.',
        logo: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><rect width="48" height="48" rx="10" fill="%23FF3621"/><path d="M12 16l12-6 12 6-12 6-12-6zm0 8l12-6 12 6-12 6-12-6zm0 8l12-6 12 6-12 6-12-6z" fill="%23fff"/></svg>',
        version: '1.0.0',
        tags: ['business', 'data', 'databricks', 'spark'],
        readme: '# Databricks\n\nUnified data and AI platform: execute Apache Spark jobs, manage Delta Lake tables, and query Model Serving endpoints.\n\n### Capabilities\n- Submit Spark jobs and monitor cluster status\n- Query Delta Lake tables with SQL\n- Deploy and test fine-tuned model serving endpoints',
        skills: [{ name: 'databricks-cli', description: 'Interact with Databricks workspace and clusters.' }],
        agents: [],
        mcpServers: [{ serverName: 'databricks', command: 'npx', args: ['-y', '@databricks/mcp-server'] }],
        rules: [],
        sidecars: [],
        suggestedPrompts: ['Check Databricks cluster status', 'Run query on Lakebase table']
      }
    ];

    const OFFICIAL_GROUPS = [
      {
        id: 'google-workspace',
        displayName: 'Google Workspace',
        description: 'Connect to Google Workspace, including Docs, Sheets, Slides, Drive, and Calendar.',
        memberIds: [
          'antigravity-plugins-official/plugin/gdocs',
          'antigravity-plugins-official/plugin/gsheets',
          'antigravity-plugins-official/plugin/gslides',
          'antigravity-plugins-official/plugin/gdrive',
          'antigravity-plugins-official/plugin/gcalendar'
        ],
        nextPageToken: ''
      },
      {
        id: 'build-with-google',
        displayName: 'Build with Google',
        description: "Build on Google's developer platforms, including Android, Chrome, Gemini, and Google Cloud.",
        memberIds: [
          'antigravity-plugins-official/plugin/gemini-api',
          'antigravity-plugins-official/plugin/chrome-devtools-plugin',
          'antigravity-plugins-official/plugin/firebase',
          'antigravity-plugins-official/plugin/android-cli',
          'antigravity-plugins-official/plugin/google-antigravity-sdk'
        ],
        nextPageToken: ''
      },
      {
        id: 'design-creative-media',
        displayName: 'Design, Creative & Media',
        description: 'Design, creative, and media tools.',
        memberIds: [
          'antigravity-plugins-partners/plugin/canva',
          'antigravity-plugins-partners/plugin/figma',
          'antigravity-plugins-partners/plugin/mobbin'
        ],
        nextPageToken: ''
      },
      {
        id: 'productivity-project-management',
        displayName: 'Productivity & Project Management',
        description: 'Plan work, track issues, sign documents, and manage your notes and files.',
        memberIds: [
          'antigravity-plugins-partners/plugin/linear',
          'antigravity-plugins-partners/plugin/dropbox',
          'antigravity-plugins-partners/plugin/atlassian-twg-cli',
          'antigravity-plugins-partners/plugin/notion'
        ],
        nextPageToken: ''
      },
      {
        id: 'cloud-hosting-deployment',
        displayName: 'Cloud Hosting & Deployment',
        description: 'Deploy and host your apps, sites, databases, and backends.',
        memberIds: [
          'antigravity-plugins-partners/plugin/netlify',
          'antigravity-plugins-partners/plugin/railway',
          'antigravity-plugins-partners/plugin/vercel-plugin',
          'antigravity-plugins-partners/plugin/supabase'
        ],
        nextPageToken: ''
      },
      {
        id: 'developer-tools',
        displayName: 'Developer Tools',
        description: 'APIs, services, and tools to build, test, secure, and run your apps.',
        memberIds: [
          'antigravity-plugins-partners/plugin/auth0',
          'antigravity-plugins-partners/plugin/base44',
          'antigravity-plugins-partners/plugin/browse'
        ],
        nextPageToken: ''
      },
      {
        id: 'business',
        displayName: 'Business',
        description: 'Payments, CRM, accounting, data, identity, customer support, marketing, and workflow automation.',
        memberIds: [
          'antigravity-plugins-partners/plugin/zoho-bigin',
          'antigravity-plugins-partners/plugin/databricks'
        ],
        nextPageToken: ''
      }
    ];

    function findPluginItem(targetId) {
      if (!targetId) return null;
      const clean = String(targetId).trim();
      const slug = clean.split('/').pop().toLowerCase();
      const all = [CONTEXT7_ITEM, ...OFFICIAL_PLUGINS];
      const match = all.find(function(c) {
        if (c.id === clean) return true;
        if (c.slug && c.slug.toLowerCase() === slug) return true;
        if (c.id.toLowerCase().endsWith('/' + slug)) return true;
        return false;
      });
      if (match) return match;
      const parts = clean.split('/');
      const mkt = parts.length > 1 ? parts[0] : 'antigravity-plugins-partners';
      const cleanSlug = parts.pop() || 'plugin';
      const displayName = cleanSlug.charAt(0).toUpperCase() + cleanSlug.slice(1);
      return {
        id: clean,
        slug: cleanSlug,
        marketplace: mkt,
        displayName: displayName,
        description: 'Customization ' + clean,
        logo: '',
        version: '1.0.0',
        tags: [],
        readme: '# ' + displayName + '\n\nCustomization ' + clean,
        skills: [],
        agents: [],
        mcpServers: [],
        rules: [],
        sidecars: [],
        suggestedPrompts: []
      };
    }

    function getInstalledPluginsList() {
      try {
        const raw = window.localStorage.getItem('ag_installed_marketplace_plugins');
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) return parsed;
        }
      } catch (_) {}
      return [];
    }

    function addInstalledPlugin(targetId) {
      if (!targetId) return;
      const clean = String(targetId).trim();
      const list = getInstalledPluginsList();
      if (!list.includes(clean)) {
        list.push(clean);
        try {
          window.localStorage.setItem('ag_installed_marketplace_plugins', JSON.stringify(list));
        } catch (_) {}
      }
    }

    function removeInstalledPlugin(targetId) {
      if (!targetId) return;
      const clean = String(targetId).trim().toLowerCase();
      const slug = clean.split('/').pop();
      let list = getInstalledPluginsList();
      list = list.filter(function(x) {
        const xClean = String(x).trim().toLowerCase();
        const xSlug = xClean.split('/').pop();
        return xClean !== clean && xSlug !== slug;
      });
      try {
        window.localStorage.setItem('ag_installed_marketplace_plugins', JSON.stringify(list));
      } catch (_) {}
    }

    function buildInstalledPluginObject(item) {
      const pluginSlug = item.slug || (item.id ? item.id.split('/').pop() : 'plugin');
      return {
        name: pluginSlug,
        displayName: item.displayName || pluginSlug,
        display_name: item.displayName || pluginSlug,
        description: item.description || '',
        path: 'file:///C:/Users/amine/.gemini/config/plugins/' + pluginSlug,
        isGlobal: false,
        is_global: false,
        disabled: false,
        installedFrom: {
          marketplace: item.marketplace || 'antigravity-plugins-official',
          id: item.id,
          version: item.version || '1.0.0'
        },
        installed_from: {
          marketplace: item.marketplace || 'antigravity-plugins-official',
          id: item.id,
          version: item.version || '1.0.0'
        },
        userConfig: {
          enabled: true,
          installedFrom: {
            marketplace: item.marketplace || 'antigravity-plugins-official',
            id: item.id,
            version: item.version || '1.0.0'
          }
        },
        user_config: {
          enabled: true,
          installed_from: {
            marketplace: item.marketplace || 'antigravity-plugins-official',
            id: item.id,
            version: item.version || '1.0.0'
          }
        },
        version: item.version || '1.0.0',
        logo: item.logo || '',
        skills: (item.skills || []).map(function(s) {
          return {
            name: s.name,
            description: s.description || ('Skill: ' + s.name),
            path: 'C:/Users/amine/.gemini/config/plugins/' + pluginSlug + '/skills/' + s.name + '.md'
          };
        }),
        agents: item.agents || [],
        mcpServers: (item.mcpServers || []).map(function(m) {
          return {
            serverName: m.serverName,
            displayName: m.displayName || m.serverName,
            command: m.command || '',
            args: m.args || []
          };
        }),
        mcp_servers: (item.mcpServers || []).map(function(m) {
          return {
            server_name: m.serverName,
            serverName: m.serverName,
            display_name: m.displayName || m.serverName,
            displayName: m.displayName || m.serverName,
            command: m.command || '',
            args: m.args || []
          };
        }),
        rules: item.rules || [],
        sidecars: item.sidecars || [],
        suggestedPrompts: item.suggestedPrompts || [],
        suggested_prompts: item.suggestedPrompts || [],
        readme: item.readme || ('# ' + (item.displayName || pluginSlug) + '\n\n' + (item.description || ''))
      };
    }


        window.fetch = async function(...args) {
      const url = typeof args[0] === 'string' ? args[0] : (args[0] && args[0].url ? args[0].url : (args[0] && args[0].href ? args[0].href : ''));
      const reqHeaders = args[1] && args[1].headers;
      const isAllWorkflows = typeof url === 'string' && url.includes('LanguageServerService/GetAllWorkflows');
      const isSlashCommands = typeof url === 'string' && url.includes('LanguageServerService/GetSlashCommands');
      const isCascadeInteraction = typeof url === 'string' && url.includes('LanguageServerService/HandleCascadeUserInteraction');

      // Intercept and deduplicate HandleCascadeUserInteraction to prevent "input not registered for step X"
      if (isCascadeInteraction) {
        try {
          cleanRecentInteractions();
          let bodyKey = '';
          if (args[1] && args[1].body) {
            if (typeof args[1].body === 'string') {
              bodyKey = args[1].body;
            } else if (args[1].body instanceof Uint8Array || args[1].body instanceof ArrayBuffer) {
              const u8 = args[1].body instanceof Uint8Array ? args[1].body : new Uint8Array(args[1].body);
              bodyKey = u8.byteLength + ':' + u8.slice(0, 64).join(',');
            }
          }
          const interactionKey = url + ':' + bodyKey;
          const now = Date.now();
          const lastTime = recentCascadeInteractions.get(interactionKey) || 0;
          if (now - lastTime < 1200) {
            return formatResponse({}, reqHeaders);
          }
          recentCascadeInteractions.set(interactionKey, now);

          try {
            const res = await origFetch.apply(this, args);
            if (!res.ok) {
              const cloned = res.clone();
              const txt = await cloned.text().catch(() => '');
              if (txt.includes('input not registered') || txt.includes('interceptor.go')) {
                return formatResponse({}, reqHeaders);
              }
            }
            return res;
          } catch (netErr) {
            const msg = String(netErr && netErr.message || netErr || '');
            if (msg.includes('input not registered') || msg.includes('interceptor.go')) {
              return formatResponse({}, reqHeaders);
            }
            throw netErr;
          }
        } catch (err) {
          console.debug('[AG] HandleCascadeUserInteraction deduplication notice:', err);
        }
      }

      // 1. Intercept GetAllWorkflows: merge official workflows with custom skills
      if (isAllWorkflows) {
        try {
          if (cachedSkillsWorkflows && (Date.now() - lastSkillsFetchTime < 60000)) {
            return formatResponse({ workflows: cachedSkillsWorkflows }, reqHeaders);
          }

          let officialWorkflows = [];
          try {
            const origRes = await origFetch.apply(this, args);
            if (origRes.ok) {
              const origData = await origRes.clone().json();
              if (Array.isArray(origData.workflows)) {
                officialWorkflows = origData.workflows;
              }
            }
          } catch (_) {}

          let skillWorkflows = [];
          try {
            const skillsUrl = url.replace('GetAllWorkflows', 'GetAllSkills');
            const skillsRes = await origFetch.apply(this, [skillsUrl, Object.assign({}, args[1], { body: '{}' })]);
            if (skillsRes.ok) {
              const skillsData = await skillsRes.json();
              const rawSkills = skillsData.skills || [];
              skillWorkflows = rawSkills.map(function(s) {
                return {
                  $typeName: 'exa.cortex_pb.WorkflowSpec',
                  name: s.name,
                  description: s.description || ('Skill: ' + s.name),
                  path: s.path || s.name,
                  content: s.content || ''
                };
              });
            }
          } catch (_) {}

          const officialNames = new Set(officialWorkflows.map(function(w) { return w.name; }));
          cachedSkillsWorkflows = officialWorkflows.concat(
            skillWorkflows.filter(function(s) { return !officialNames.has(s.name); })
          );
          lastSkillsFetchTime = Date.now();
          return formatResponse({ workflows: cachedSkillsWorkflows }, reqHeaders);
        } catch (wfErr) {
          console.warn('[AG] GetAllWorkflows skill conversion error in rendererHook:', wfErr);
        }
      }

      // 2. Sanitize outgoing GetSlashCommands request: ensure planModel is valid
      if (isSlashCommands && args[1]) {
        try {
          let reqObj = null;
          if (typeof args[1].body === 'string') {
            reqObj = JSON.parse(args[1].body);
          } else if (args[1].body && (args[1].body instanceof Uint8Array || (typeof Buffer !== 'undefined' && Buffer.isBuffer(args[1].body)))) {
            reqObj = JSON.parse(new TextDecoder().decode(args[1].body));
          }
          if (reqObj) {
            if (!reqObj.cascadeConfig) reqObj.cascadeConfig = {};
            if (!reqObj.cascadeConfig.plannerConfig) reqObj.cascadeConfig.plannerConfig = {};
            const pm = reqObj.cascadeConfig.plannerConfig.planModel;
            if (!pm || typeof pm !== 'string' || !pm.startsWith('MODEL_PLACEHOLDER_M')) {
              reqObj.cascadeConfig.plannerConfig.planModel = (pm && typeof pm === 'string' && pm.toLowerCase().includes('flash')) ? 'MODEL_PLACEHOLDER_M16' : 'MODEL_PLACEHOLDER_M54';
            }
            const newBody = JSON.stringify(reqObj);
            args[1].body = (args[1].body instanceof Uint8Array) ? new TextEncoder().encode(newBody) : newBody;
            if (args[1].headers && typeof args[1].headers === 'object') {
              if ('content-length' in args[1].headers) delete args[1].headers['content-length'];
              if ('Content-Length' in args[1].headers) delete args[1].headers['Content-Length'];
            }
          }
        } catch (_) {}
      }


      const isSearchMarketplaceCustomizations = typeof url === 'string' && url.includes('LanguageServerService/SearchMarketplaceCustomizations');
      const isListRemotePlugins = typeof url === 'string' && url.includes('LanguageServerService/ListRemotePlugins');
      const isMarketplaceFeatured = typeof url === 'string' && url.includes('LanguageServerService/GetMarketplaceFeatured');
      const isMarketplaceBundles = typeof url === 'string' && url.includes('LanguageServerService/GetMarketplaceBundles');
      const isSearchMarketplace = typeof url === 'string' && url.includes('LanguageServerService/SearchMarketplace') && !isSearchMarketplaceCustomizations;
      const isMarketplaceCustomization = typeof url === 'string' && url.includes('LanguageServerService/GetMarketplaceCustomization');
      const isInstallCustomization = typeof url === 'string' && url.includes('LanguageServerService/InstallCustomization');
      const isGetAllPlugins = typeof url === 'string' && url.includes('LanguageServerService/GetAllPlugins');
      const isGetPlugin = typeof url === 'string' && url.includes('LanguageServerService/GetPlugin');
      const isDeletePlugin = typeof url === 'string' && url.includes('LanguageServerService/DeletePlugin');
      const isSubscribeToPlugins = typeof url === 'string' && url.includes('LanguageServerService/SubscribeToPlugins');

      // 3. Intercept GetMarketplaceFeatured: display authentic Context7 spotlight banner with 6 companion icons
      if (isMarketplaceFeatured) {
        return formatResponse({
          featured: [
            {
              id: 'antigravity-plugins-partners/plugin/context7',
              eyebrow: 'Featured',
              displayName: 'Context7',
              display_name: 'Context7',
              description: 'Up-to-date documentation lookup. Pull version-specific documentation and code examples directly from source repositories into your LLM context.',
              memberIds: [
                'antigravity-plugins-official/plugin/firebase',
                'antigravity-plugins-partners/plugin/context7',
                'antigravity-plugins-partners/plugin/linear',
                'antigravity-plugins-partners/plugin/notion',
                'antigravity-plugins-partners/plugin/cursor',
                'antigravity-plugins-partners/plugin/supabase'
              ],
              member_ids: [
                'antigravity-plugins-official/plugin/firebase',
                'antigravity-plugins-partners/plugin/context7',
                'antigravity-plugins-partners/plugin/linear',
                'antigravity-plugins-partners/plugin/notion',
                'antigravity-plugins-partners/plugin/cursor',
                'antigravity-plugins-partners/plugin/supabase'
              ]
            }
          ],
          customizations: [
            CONTEXT7_ITEM,
            ...OFFICIAL_PLUGINS
          ]
        }, reqHeaders);
      }

      // 4. Intercept GetMarketplaceBundles: suppress synthetic bundles shelf
      if (isMarketplaceBundles) {
        return formatResponse({
          bundles: [],
          customizations: []
        }, reqHeaders);
      }

      // 5. Intercept SearchMarketplace: display authentic official catalog and shelves
      if (isSearchMarketplace) {
        try {
          let reqQuery = '';
          let reqGroupId = '';
          try {
            let bText = typeof args[1]?.body === 'string' ? args[1].body : (args[1]?.body ? new TextDecoder().decode(args[1].body) : '');
            if (!bText && args[0]?.body) {
              bText = typeof args[0].body === 'string' ? args[0].body : new TextDecoder().decode(args[0].body);
            }
            if (bText) {
              const qMatch = bText.match(/"query"\s*:\s*"([^"]*)"/);
              if (qMatch && qMatch[1]) reqQuery = qMatch[1].toLowerCase().trim();
              const gMatch = bText.match(/"groupId"\s*:\s*"([^"]*)"/);
              if (gMatch && gMatch[1]) reqGroupId = gMatch[1].trim();
            }
          } catch (_) {}

          let allItems = [CONTEXT7_ITEM, ...OFFICIAL_PLUGINS];

          if (reqGroupId) {
            const selectedGroup = OFFICIAL_GROUPS.find(function(g) { return g.id === reqGroupId; });
            const groupMemberSet = new Set(selectedGroup ? selectedGroup.memberIds : []);
            const groupItems = allItems.filter(function(c) { return groupMemberSet.has(c.id); });
            return formatResponse({
              customizations: groupItems,
              groups: [],
              nextPageToken: ''
            }, reqHeaders);
          }

          let outItems = allItems;
          if (reqQuery) {
            outItems = outItems.filter(function(c) {
              return c.id.toLowerCase().includes(reqQuery) ||
                (c.slug && c.slug.toLowerCase().includes(reqQuery)) ||
                (c.displayName && c.displayName.toLowerCase().includes(reqQuery)) ||
                (c.description && c.description.toLowerCase().includes(reqQuery)) ||
                (c.tags && c.tags.some(function(t) { return t.toLowerCase().includes(reqQuery); }));
            });
          }

          const currentIdSet = new Set(outItems.map(function(c) { return c.id; }));
          const outGroups = OFFICIAL_GROUPS.map(function(g) {
            return Object.assign({}, g, {
              memberIds: g.memberIds.filter(function(id) { return currentIdSet.has(id); })
            });
          }).filter(function(g) { return g.memberIds.length > 0; });

          return formatResponse({
            customizations: outItems,
            groups: outGroups,
            nextPageToken: ''
          }, reqHeaders);
        } catch (searchErr) {
          console.warn('[AG] SearchMarketplace error in rendererHook:', searchErr);
        }
      }

            function extractRequestBodyText(callArgs) {
        try {
          const raw = callArgs[1]?.body || (callArgs[0] && callArgs[0].body);
          if (!raw) return '';
          if (typeof raw === 'string') return raw;
          const u8 = raw instanceof Uint8Array ? raw : (raw.buffer ? new Uint8Array(raw.buffer, raw.byteOffset || 0, raw.byteLength || raw.length) : null);
          if (u8) {
            if (u8.length > 5 && u8[0] === 0) {
              const len = new DataView(u8.buffer, u8.byteOffset, 5).getUint32(1, false);
              return new TextDecoder().decode(u8.subarray(5, 5 + len));
            }
            return new TextDecoder().decode(u8);
          }
        } catch (_) {}
        return '';
      }

      // 6. Intercept GetMarketplaceCustomization: return full details, SVG icon, and rich capabilities
      if (isMarketplaceCustomization) {
        try {
          let targetId = '';
          try {
            const bText = extractRequestBodyText(args);
            if (bText) {
              const idMatch = bText.match(/"id"\s*:\s*"([^"]+)"/);
              if (idMatch && idMatch[1]) {
                targetId = idMatch[1];
              } else {
                const firstBrace = bText.indexOf('{');
                if (firstBrace !== -1) {
                  const bObj = JSON.parse(bText.slice(firstBrace));
                  if (bObj && bObj.id) targetId = bObj.id;
                }
              }
            }
            if (!targetId && typeof url === 'string') {
              const u = new URL(url, 'http://127.0.0.1');
              if (u.searchParams.get('id')) targetId = u.searchParams.get('id');
            }
          } catch (_) {}

          const item = findPluginItem(targetId) || {
            id: targetId,
            slug: targetId ? targetId.split('/').pop() : 'plugin',
            displayName: targetId ? targetId.split('/').pop() : 'Plugin',
            description: 'Customization ' + targetId,
            marketplace: targetId && targetId.includes('/') ? targetId.split('/')[0] : 'antigravity-plugins-partners',
            logo: '',
            version: '1.0.0',
            tags: [],
            readme: '# ' + targetId,
            skills: [],
            agents: [],
            mcpServers: [],
            rules: [],
            sidecars: [],
            suggestedPrompts: []
          };

          const pluginPayload = {
            name: item.displayName,
            displayName: item.displayName,
            display_name: item.displayName,
            description: item.description,
            readme: item.readme || ('# ' + item.displayName + '\n\n' + item.description),
            logo: item.logo,
            skills: item.skills || [],
            agents: item.agents || [],
            mcpServers: item.mcpServers || [],
            mcp_servers: item.mcpServers || [],
            rules: item.rules || [],
            sidecars: item.sidecars || [],
            suggestedPrompts: item.suggestedPrompts || [],
            suggested_prompts: item.suggestedPrompts || [],
            version: item.version || '1.0.0'
          };

          return formatResponse({
            customization: {
              marketplace: item.marketplace,
              id: item.id,
              displayName: item.displayName,
              display_name: item.displayName,
              description: item.description,
              logo: item.logo,
              version: item.version || '1.0.0',
              homepage: item.homepage || '',
              repository: item.repository || ''
            },
            plugin: pluginPayload,
            preview: {
              case: 'plugin',
              value: pluginPayload
            }
          }, reqHeaders);
        } catch (detailErr) {
          console.warn('[AG] GetMarketplaceCustomization error in rendererHook:', detailErr);
        }
      }

      // 6.5 Intercept SubscribeToPlugins: return Unimplemented (code 12) so CustomizationsStore cleanly disables streaming and falls back to GetAllPlugins without stream errors
      if (isSubscribeToPlugins) {
        return new Response('', {
          status: 404,
          headers: {
            'content-type': 'application/grpc-web+proto',
            'grpc-status': '12',
            'grpc-message': 'Unimplemented',
            'x-grpc-web': '1'
          }
        });
      }

      // 6.6 Intercept GetAllPlugins: decode gRPC-Web framing, merge native plugins with user-added marketplace plugins
      if (isGetAllPlugins) {
        try {
          const origRes = await origFetch.apply(this, args);
          let origPlugins = [];
          if (origRes && origRes.ok) {
            try {
              const origBuf = await origRes.clone().arrayBuffer();
              const u8 = new Uint8Array(origBuf);
              let jsonText = '';
              if (u8.length > 5 && u8[0] === 0) {
                const len = new DataView(u8.buffer, u8.byteOffset, 5).getUint32(1, false);
                jsonText = new TextDecoder().decode(u8.subarray(5, 5 + len));
              } else {
                jsonText = new TextDecoder().decode(u8);
              }
              if (jsonText) {
                const parsed = JSON.parse(jsonText);
                if (Array.isArray(parsed.plugins)) origPlugins = parsed.plugins;
              }
            } catch (decErr) {
              console.warn('[AG] Could not parse orig plugins buffer in GetAllPlugins:', decErr);
            }
          }

          const installedList = getInstalledPluginsList();
          const merged = [...origPlugins];
          for (const id of installedList) {
            const item = findPluginItem(id);
            if (!item) continue;
            const already = merged.some(function(p) {
              return (p.installedFrom && (p.installedFrom.id === item.id || p.installedFrom.id === id)) ||
                     (p.installed_from && (p.installed_from.id === item.id || p.installed_from.id === id)) ||
                     p.name === item.slug;
            });
            if (!already) {
              merged.push(buildInstalledPluginObject(item));
            }
          }

          return formatResponse({ plugins: merged }, reqHeaders);
        } catch (pluginsErr) {
          console.warn('[AG] GetAllPlugins error in rendererHook:', pluginsErr);
        }
      }

      // 6.7 Intercept GetPlugin: return installed/marketplace plugin descriptor
      if (isGetPlugin) {
        let pluginId = '';
        try {
          const bText = extractRequestBodyText(args);
          if (bText) {
            const pMatch = bText.match(/"pluginId"\s*:\s*"([^"]+)"/);
            if (pMatch && pMatch[1]) pluginId = pMatch[1];
          }
          if (!pluginId && typeof url === 'string') {
            const u = new URL(url, 'http://127.0.0.1');
            if (u.searchParams.get('pluginId')) pluginId = u.searchParams.get('pluginId');
          }
        } catch (_) {}

        const pItem = findPluginItem(pluginId);
        if (pItem) {
          return formatResponse({
            plugin: buildInstalledPluginObject(pItem)
          }, reqHeaders);
        }
      }

      // 7. Intercept InstallCustomization: register in persistent installed store and disk
      if (isInstallCustomization) {
        let targetId = '';
        try {
          const bText = extractRequestBodyText(args);
          if (bText) {
            const idMatch = bText.match(/"id"\s*:\s*"([^"]+)"/);
            if (idMatch && idMatch[1]) targetId = idMatch[1];
          }
          if (!targetId && typeof url === 'string') {
            const u = new URL(url, 'http://127.0.0.1');
            if (u.searchParams.get('id')) targetId = u.searchParams.get('id');
          }
        } catch (_) {}
        const pItem = findPluginItem(targetId);
        const slug = pItem ? pItem.slug : (targetId.split('/').pop() || 'customization');
        if (targetId) {
          addInstalledPlugin(targetId);
        }
        try {
          fetch(LOCAL_PROXY_ORIGIN + '/api/plugins/install', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ id: targetId, item: pItem || { id: targetId, slug: slug } })
          }).catch(() => {});
        } catch (_) {}
        return formatResponse({
          success: true,
          message: 'Plugin ' + (pItem ? pItem.displayName : slug) + ' installed successfully.',
          installDir: '~/.gemini/config/plugins/' + slug,
          install_dir: '~/.gemini/config/plugins/' + slug
        }, reqHeaders);
      }

      // 7.5 Intercept DeletePlugin: remove from persistent installed store and disk
      if (isDeletePlugin) {
        let pluginId = '';
        try {
          const bText = extractRequestBodyText(args);
          if (bText) {
            const pMatch = bText.match(/"pluginId"\s*:\s*"([^"]+)"/);
            if (pMatch && pMatch[1]) pluginId = pMatch[1];
          }
          if (!pluginId && typeof url === 'string') {
            const u = new URL(url, 'http://127.0.0.1');
            if (u.searchParams.get('pluginId')) pluginId = u.searchParams.get('pluginId');
          }
        } catch (_) {}
        if (pluginId) {
          removeInstalledPlugin(pluginId);
        }
        try {
          fetch(LOCAL_PROXY_ORIGIN + '/api/plugins/uninstall', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ pluginId: pluginId })
          }).catch(() => {});
        } catch (_) {}
        return formatResponse({
          success: true,
          message: 'Plugin uninstalled successfully.'
        }, reqHeaders);
      }

// 8. Intercept SearchMarketplaceCustomizations: return empty for internal Google CL extensions
      if (isSearchMarketplaceCustomizations) {
        return formatResponse({
          extensions: [],
          hasMore: false
        }, reqHeaders);
      }

      return origFetch.apply(this, args);
    };
  })();


  console.log('[Antigravity 2.0] Initializing Remote Environment Hook...');

  const DEFAULT_HOST = window.__AG_REMOTE_HOST || 'http://127.0.0.1:8090';
  const DEFAULT_TOKEN = ''; // Set AG_REMOTE_TOKEN or configure via settings UI
  const LOCAL_PROXY_PORT = window.__AG_PROXY_PORT || 51074;
  const LOCAL_PROXY_ORIGIN = window.__AG_PROXY_ORIGIN || `http://127.0.0.1:${LOCAL_PROXY_PORT}`;

  function getRemoteConfig() {
    try {
      let storedHost = localStorage.getItem('ag_remote_host');
      let storedToken = localStorage.getItem('ag_remote_token');
      if (!storedHost || storedHost === 'null' || storedHost === 'undefined') {
        storedHost = DEFAULT_HOST;
        localStorage.setItem('ag_remote_host', DEFAULT_HOST);
      }
      if (!storedToken || storedToken === 'null' || storedToken === 'undefined' || storedToken.trim() === '') {
        storedToken = DEFAULT_TOKEN;
        localStorage.setItem('ag_remote_token', DEFAULT_TOKEN);
      }
      return {
        host: storedHost,
        token: storedToken,
        configured: true,
      };
    } catch (e) {
      console.warn('[RemoteHook] Failed to read remote config:', e);
      return { host: DEFAULT_HOST, token: DEFAULT_TOKEN, configured: true };
    }
  }

  function syncRemoteStateToProxy(active, host, remoteSessions, token) {
    const cfg = getRemoteConfig();
    const finalToken = (token && token !== 'null' && token !== 'undefined' && token.trim().length > 0)
      ? token.trim()
      : cfg.token;
    const finalHost = host || cfg.host;

    if (window.nativeStorage && typeof window.nativeStorage.setRemoteState === 'function') {
      window.nativeStorage.setRemoteState({ active, host: finalHost, token: finalToken, remoteSessions }).catch(() => {});
    }
    try {
      fetch(`${LOCAL_PROXY_ORIGIN}/api/remote/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active, host: finalHost, token: finalToken, remoteSessions }),
      }).catch((err) => {
        console.debug('[RemoteHook] Could not reach proxy status endpoint:', err);
      });
    } catch (err) {
      console.debug('[RemoteHook] syncRemoteStateToProxy fetch exception:', err);
    }
  }

  function saveRemoteConfig(host, token) {
    try {
      const finalHost = host || DEFAULT_HOST;
      const finalToken = (token && token !== 'null' && token !== 'undefined' && token.trim().length > 0)
        ? token.trim()
        : DEFAULT_TOKEN;
      localStorage.setItem('ag_remote_host', finalHost);
      localStorage.setItem('ag_remote_token', finalToken);
      localStorage.setItem('ag_remote_configured', 'true');
      syncRemoteStateToProxy(true, finalHost, getRemoteSessions(), finalToken);
    } catch (_) {}
  }

  function getRemoteSessions() {
    try {
      return JSON.parse(localStorage.getItem('ag_remote_sessions') || '{}');
    } catch (_) {
      return {};
    }
  }

  function setSessionRemote(cascadeId, isRemote) {
    if (!cascadeId) return;
    try {
      const map = getRemoteSessions();
      if (isRemote) {
        map[cascadeId] = true;
      } else {
        delete map[cascadeId];
      }
      localStorage.setItem('ag_remote_sessions', JSON.stringify(map));
      const cfg = getRemoteConfig();
      syncRemoteStateToProxy(isRemote, cfg.host, { [cascadeId]: isRemote });
    } catch (_) {}
  }

  function getActiveSessionId() {
    const path = window.location.pathname || '';
    const parts = path.split('/c/');
    if (parts.length > 1) {
      const id = parts[1].split('/')[0].split('?')[0];
      if (id) return id;
    }
    const promptBox = document.querySelector('[contenteditable="true"]') || document.querySelector('textarea');
    if (promptBox) {
      const key = Object.keys(promptBox).find((k) => k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$'));
      let fiber = key ? promptBox[key] : null;
      while (fiber) {
        if (fiber.memoizedProps && (fiber.memoizedProps.cascadeId || fiber.memoizedProps.conversationId)) {
          return fiber.memoizedProps.cascadeId || fiber.memoizedProps.conversationId;
        }
        fiber = fiber.return;
      }
    }
    return null;
  }

  function isCurrentSessionRemote() {
    const cid = getActiveSessionId();
    if (cid) {
      const map = getRemoteSessions();
      return !!map[cid];
    }
    return !!window.__ag_draft_remote;
  }

  window.__ag_is_remote_session = isCurrentSessionRemote;

  function closeEnvironmentPopover() {
    try {
      window.dispatchEvent(new PointerEvent('pointerdown', { clientX: 10, clientY: 10, bubbles: true }));
    } catch (_) {}
  }

  function getActiveProjectName() {
    try {
      const headerTitle = document.querySelector('header, [role="banner"], .chat-header');
      if (headerTitle) {
        const txt = headerTitle.textContent || '';
        if (txt.includes('/')) {
          const p = txt.split('/')[0].trim();
          if (p && !p.includes('\n') && p.length < 60) return p;
        }
      }
      if (document.title && document.title.includes('—')) {
        const p = document.title.split('—')[0].trim();
        if (p && p.length < 60) return p;
      }
    } catch (_) {}
    return '';
  }

  // --- Command Execution on Remote VPS ---
  function executeRemoteCommand(command, timeoutMs = 15000) {
    return new Promise((resolve) => {
      const cfg = getRemoteConfig();
      const token = cfg.token;
      const host = cfg.host;
      if (!host) {
        resolve({ ok: false, error: 'Hôte non configuré' });
        return;
      }

      const currentConvId = getActiveSessionId();
      const bindings = getSessionBindings();
      const currentBinding = currentConvId ? bindings[currentConvId] : null;
      const boundSessionId = currentBinding ? currentBinding.remoteSessionId : '';
      let targetWs = currentBinding ? currentBinding.workspaceId : '';
      if (!targetWs) {
        targetWs = getActiveProjectName();
      }

      const wsProto = host.startsWith('https:') ? 'wss:' : 'ws:';
      const cleanHost = host.replace('https://', '').replace('http://', '');
      let wsUrl = `${wsProto}//${cleanHost}/v2/terminal?terminalId=exec_${Date.now()}_${Math.random().toString(36).slice(2, 7)}&token=${encodeURIComponent(token)}`;
      if (targetWs) {
        wsUrl += `&workspaceId=${encodeURIComponent(targetWs)}`;
      }
      if (boundSessionId) {
        wsUrl += `&sessionId=${encodeURIComponent(boundSessionId)}`;
      }

      async function fallbackViaProxy() {
        try {
          const resp = await fetch(`${LOCAL_PROXY_ORIGIN}/api/remote/cmd`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ command, host, token, workspaceId: targetWs })
          });
          if (resp.ok) {
            const d = await resp.json();
            return { ok: d.ok !== false, stdout: d.stdout || '', stderr: d.stderr || '', exitCode: d.exitCode ?? 0 };
          }
        } catch (err) {
          console.debug('[RemoteHook] Proxy fallback error:', err);
        }
        return null;
      }

      let sock;
      try {
        sock = new WebSocket(wsUrl);
      } catch (e) {
        fallbackViaProxy().then((res) => {
          if (res) resolve(res);
          else resolve({ ok: false, error: e.message || 'WebSocket init failed' });
        });
        return;
      }

      let output = '';
      const endMarker = '___REMOTE_EXEC_DONE___';
      const timer = setTimeout(() => {
        try { sock.close(); } catch (_) {}
        fallbackViaProxy().then((res) => {
          if (res) resolve(res);
          else resolve({ ok: false, error: 'Timeout dépassé', stdout: output });
        });
      }, timeoutMs);

      sock.onopen = () => {
        const wrapped = `${command}\necho "\n${endMarker} $?\n"\n`;
        sock.send(JSON.stringify({ type: 'input', data: wrapped }));
      };

      sock.onmessage = (evt) => {
        try {
          const msg = JSON.parse(evt.data);
          if (msg.type === 'output') {
            output += msg.data;
            if (output.includes(endMarker)) {
              clearTimeout(timer);
              try { sock.close(); } catch (_) {}
              const parts = output.split(endMarker);
              const rawStdout = parts[0].trim();
              const exitCodeStr = (parts[1] || '').trim().split(' ')[0];
              const exitCode = parseInt(exitCodeStr, 10) || 0;
              resolve({ ok: exitCode === 0, stdout: rawStdout, stderr: '', exitCode });
            }
          }
        } catch (_) {}
      };

      sock.onerror = () => {
        clearTimeout(timer);
        try { sock.close(); } catch (_) {}
        fallbackViaProxy().then((res) => {
          if (res) resolve(res);
          else resolve({ ok: false, error: 'Erreur de connexion WebSocket', stdout: output });
        });
      };
    });
  }

  window.__ag_execute_remote_command = executeRemoteCommand;

  // --- Connection Prober (Bypasses CORS & Mixed Content) ---
  // --- Connection Prober (Fast WebSocket first, then IPC fallback) ---
  async function probeConnection(h, t) {
    // 1. WebSocket probe (instant in Chromium renderer, bypasses CORS & Mixed Content)
    const wsResult = await new Promise((resolve) => {
      let wsProto = 'wss:';
      let cleanHost = h.replace(/^https?:\/\//i, '').replace(/\/+$/, '');
      if (/^(127\.0\.0\.1|localhost|0\.0\.0\.0)(:\d+)?$/i.test(cleanHost) || (cleanHost.includes(':') && !cleanHost.endsWith(':443'))) {
        wsProto = 'ws:';
      }
      if (h.startsWith('http://')) wsProto = 'ws:';
      if (h.startsWith('https://')) wsProto = 'wss:';

      const wsUrl = `${wsProto}//${cleanHost}/ws?token=${encodeURIComponent(t)}`;
      let resolved = false;
      let sock;
      try {
        sock = new WebSocket(wsUrl);
      } catch (err) {
        resolve({ ok: false, error: err.message || 'Échec initialisation WebSocket' });
        return;
      }

      const timer = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          try { sock.close(); } catch (_) {}
          resolve({ ok: false, error: "Délai d'attente dépassé (timeout)" });
        }
      }, 2000);

      sock.onopen = () => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timer);
          try { sock.close(); } catch (_) {}
          resolve({ ok: true, data: { platform: 'daemon', connected: true }, via: 'websocket' });
        }
      };

      sock.onerror = () => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timer);
          resolve({ ok: false, error: 'Connexion refusée ou port fermé' });
        }
      };

      sock.onclose = (e) => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timer);
          if (e.code === 1008 || e.code === 4401 || (e.reason && e.reason.toLowerCase().includes('unauthor'))) {
            resolve({ ok: false, error: "Jeton d'authentification refusé (401)" });
          } else {
            resolve({ ok: false, error: `Fermé par l'hôte (code ${e.code})` });
          }
        }
      };
    });

    if (wsResult.ok) return wsResult;

    // 2. Try Electron IPC fallback if available
    if (window.nativeStorage && typeof window.nativeStorage.testRemoteHealth === 'function') {
      try {
        const ipcRes = await window.nativeStorage.testRemoteHealth({ host: h, token: t });
        if (ipcRes && ipcRes.ok) {
          return { ok: true, data: ipcRes.data || {}, via: 'ipc' };
        }
      } catch (_) {}
    }

    return wsResult;
  }

  // --- Configuration Modal ---
  function openRemoteConfigModal() {
    let modal = document.getElementById('__ag_remote_config_modal');
    if (modal) modal.remove();

    const cfg = getRemoteConfig();
    modal = document.createElement('div');
    modal.id = '__ag_remote_config_modal';
    modal.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;z-index:99999;background:rgba(0,0,0,0.65);backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;';

    modal.innerHTML = `
      <div style="width:480px;background:#1e1e1e;border:1px solid rgba(255,255,255,0.15);border-radius:12px;box-shadow:0 20px 40px rgba(0,0,0,0.6);padding:22px;color:#e5e5e5;">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
          <span style="font-size:18px;">☁️</span>
          <span style="font-size:15px;font-weight:600;color:#fff;">Configuration Runtime Agent Remote (VPS)</span>
        </div>
        <p style="font-size:12px;color:#a3a3a3;margin:0 0 16px 0;">Configurez l'accès au daemon distant <code>ag-agentd</code> ou bridge local.</p>

        <div style="margin-bottom:12px;">
          <label style="display:block;font-size:12px;font-weight:500;margin-bottom:4px;color:#d4d4d4;">Hôte / URL du Daemon (IP:Port ou Domaine)</label>
          <input id="__ag_cfg_host" type="text" value="${cfg.host}" style="width:100%;box-sizing:border-box;background:#262626;border:1px solid rgba(255,255,255,0.15);border-radius:6px;padding:8px 10px;font-size:12px;color:#fff;outline:none;" />
          <div style="display:flex;gap:6px;margin-top:8px;flex-wrap:wrap;">
            <button type="button" class="__ag_preset_btn" data-host="127.0.0.1:8090" data-token="" style="background:#262626;border:1px solid rgba(255,255,255,0.15);color:#93c5fd;border-radius:4px;padding:4px 8px;font-size:11px;cursor:pointer;">⚡ Local (127.0.0.1:8090)</button>
          </div>
        </div>

        <div style="margin-bottom:14px;">
          <label style="display:block;font-size:12px;font-weight:500;margin-bottom:4px;color:#d4d4d4;">Jeton d'authentification (Auth Token)</label>
          <input id="__ag_cfg_token" type="password" value="${cfg.token}" style="width:100%;box-sizing:border-box;background:#262626;border:1px solid rgba(255,255,255,0.15);border-radius:6px;padding:8px 10px;font-size:12px;color:#fff;outline:none;" />
        </div>

        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:18px;background:rgba(255,255,255,0.03);padding:8px 12px;border-radius:6px;border:1px solid rgba(255,255,255,0.07);">
          <button id="__ag_cfg_test" style="background:#333;border:1px solid rgba(255,255,255,0.15);color:#fff;border-radius:5px;padding:5px 12px;font-size:11px;cursor:pointer;">Tester la connexion</button>
          <span id="__ag_cfg_status" style="font-size:11px;color:#a3a3a3;">Prêt</span>
        </div>

        <div style="display:flex;align-items:center;justify-content:flex-end;gap:8px;">
          <button id="__ag_cfg_cancel" style="background:transparent;border:1px solid rgba(255,255,255,0.15);color:#ccc;border-radius:6px;padding:7px 14px;font-size:12px;cursor:pointer;">Annuler</button>
          <button id="__ag_cfg_save" style="background:#2563eb;border:none;color:#fff;border-radius:6px;padding:7px 14px;font-size:12px;font-weight:500;cursor:pointer;">Enregistrer & Sélectionner</button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    const hostInput = modal.querySelector('#__ag_cfg_host');
    const tokenInput = modal.querySelector('#__ag_cfg_token');
    const statusSpan = modal.querySelector('#__ag_cfg_status');

    modal.querySelectorAll('.__ag_preset_btn').forEach((btn) => {
      btn.onclick = () => {
        hostInput.value = btn.getAttribute('data-host') || '';
        tokenInput.value = btn.getAttribute('data-token') || '';
        statusSpan.style.color = '#93c5fd';
        statusSpan.textContent = 'Prêt à tester';
      };
    });

    modal.querySelector('#__ag_cfg_test').onclick = async () => {
      statusSpan.style.color = '#93c5fd';
      statusSpan.textContent = 'Test en cours...';
      try {
        let h = hostInput.value.trim();
        while (h.endsWith('/')) h = h.slice(0, -1);
        const t = tokenInput.value.trim();
        if (!h) {
          statusSpan.style.color = '#f87171';
          statusSpan.textContent = 'Veuillez entrer une URL';
          return;
        }
        const res = await probeConnection(h, t);
        if (res.ok) {
          statusSpan.style.color = '#4ade80';
          const info = res.data || {};
          const label = info.tunnelProvider || info.platform || (res.via === 'websocket' ? 'WebSocket OK' : 'Connecté');
          statusSpan.textContent = `● En ligne (${label}${info.pid ? ' / PID ' + info.pid : ''})`;
        } else {
          statusSpan.style.color = '#f87171';
          statusSpan.textContent = `Échec: ${res.error || 'injoignable'}`;
        }
      } catch (err) {
        statusSpan.style.color = '#f87171';
        statusSpan.textContent = `Échec: ${err.message || 'injoignable'}`;
      }
    };

    modal.querySelector('#__ag_cfg_cancel').onclick = () => modal.remove();

    modal.querySelector('#__ag_cfg_save').onclick = () => {
      let h = hostInput.value.trim();
      while (h.endsWith('/')) h = h.slice(0, -1);
      const t = tokenInput.value.trim();
      saveRemoteConfig(h, t);
      const cid = getActiveSessionId();
      if (cid) setSessionRemote(cid, true);
      else window.__ag_draft_remote = true;
      updateTriggerButton();
      modal.remove();
    };
  }

  window.__ag_open_config = openRemoteConfigModal;

  // --- UI Updates ---
  function updateTriggerButton() {
    const isRemote = isCurrentSessionRemote();
    const trigger = document.querySelector('[aria-label="Select Environment"]') ||
                    document.querySelector('[aria-label^="Environment:"]') ||
                    Array.from(document.querySelectorAll('button')).find((b) => {
                      const txt = (b.innerText || '').trim();
                      return txt === 'Local' || txt === 'Remote (VPS)' || txt === 'New Worktree' || txt === 'New Workspace';
                    });

    if (trigger) {
      const labelSpan = trigger.querySelector('.select-none.truncate') || trigger.querySelector('span');
      const iconContainer = trigger.querySelector('[class*="shrink-0"]') || trigger.querySelector('div, span');
      if (isRemote) {
        trigger.setAttribute('aria-label', 'Environment: Remote (VPS)');
        if (labelSpan && labelSpan.textContent !== 'Remote (VPS)') {
          labelSpan.textContent = 'Remote (VPS)';
        }
        trigger.style.color = '#34d399';
        trigger.style.borderColor = 'rgba(52, 211, 153, 0.4)';
      } else {
        trigger.setAttribute('aria-label', 'Environment: Local');
        if (labelSpan && labelSpan.textContent === 'Remote (VPS)') {
          labelSpan.textContent = 'Local';
        }
        trigger.style.color = '';
        trigger.style.borderColor = '';
      }
    }

    // Remote Status Pill next to prompt input container
    let pill = document.getElementById('__ag_remote_pill');
    const inputContainer = document.querySelector('#antigravity\\.agentSidePanelInputBox') ||
                           document.querySelector('.relative.flex.flex-col.p-px.rounded-2xl.bg-card-border');

    if (inputContainer) {
      if (isRemote) {
        const cfg = getRemoteConfig();
        const rawH = (cfg.host || '127.0.0.1:8090').trim();
        const cleanH = rawH.replace(/^https?:\/\//i, '').replace(/\/+$/, '');
        const proto = rawH.startsWith('https') ? 'https' : 'http';
        const consoleUrl = `${proto}://${cleanH}/web/?token=${encodeURIComponent(cfg.token)}`;
        if (!pill) {
          pill = document.createElement('div');
          pill.id = '__ag_remote_pill';
          pill.style.cssText = 'display:flex;align-items:center;gap:8px;padding:4px 10px;margin:4px 8px;background:rgba(16,185,129,0.12);border:1px solid rgba(16,185,129,0.35);border-radius:9999px;font-size:11px;font-weight:500;color:#34d399;width:fit-content;user-select:none;transition:all 0.2s;';
          pill.innerHTML = `
            <span>☁️ Remote: <b>${cleanH}</b></span>
            <button id="__ag_btn_console" title="Ouvrir la Console Cloud Web" style="background:rgba(255,255,255,0.12);border:none;border-radius:4px;color:#fff;padding:2px 7px;font-size:10px;cursor:pointer;display:flex;align-items:center;gap:3px;">⚡ Console</button>
            <span id="__ag_btn_cfg" style="font-size:11px;cursor:pointer;opacity:0.85;" title="Configurer">⚙️</span>
          `;
          pill.querySelector('#__ag_btn_console').onclick = (e) => {
            e.stopPropagation();
            if (window.electronNative && typeof window.electronNative.openExternal === 'function') {
              window.electronNative.openExternal(consoleUrl);
            } else {
              window.open(consoleUrl, '_blank');
            }
          };
          pill.querySelector('#__ag_btn_cfg').onclick = (e) => {
            e.stopPropagation();
            openRemoteConfigModal();
          };
          pill.onclick = (e) => {
            if (e.target && e.target.id !== '__ag_btn_console' && e.target.id !== '__ag_btn_cfg') {
              openRemoteConfigModal();
            }
          };
          const targetSlot = (inputContainer.previousElementSibling && inputContainer.previousElementSibling.classList && inputContainer.previousElementSibling.classList.contains('agy-live-dock-slot'))
            ? inputContainer.previousElementSibling
            : inputContainer;
          if (targetSlot && targetSlot.parentElement) {
            targetSlot.parentElement.insertBefore(pill, targetSlot);
          }
        }
      } else if (pill) {
        pill.remove();
      }
    }

    // Inline Environment Toggle Button next to Model Selector (disabled/hidden)
    const oldInlineBtn = document.getElementById('__ag_inline_remote_btn');
    if (oldInlineBtn) oldInlineBtn.remove();

  }

  // --- Popover Item Injection ---
  function injectRemoteOption() {
    const all = Array.from(document.querySelectorAll('.main-row-trigger, [class*="popover-item"], button, div[role="menuitem"], div[role="option"], div.cursor-pointer'));
    for (const row of all) {
      const text = (row.innerText || row.textContent || '').trim();
      if ((text.includes('New Worktree') || text.includes('New Workspace')) && !text.includes('Remote')) {
        let container = row;
        if (row.parentElement && row.parentElement.classList.contains('w-full') && row.parentElement.parentElement) {
          container = row.parentElement;
        }
        const parent = container.parentElement;
        if (!parent || parent.querySelector('[data-ag-remote="true"]')) continue;

        const clone = container.cloneNode(true);
        clone.setAttribute('data-ag-remote', 'true');

        // Target Title and Subtitle precisely
        const spans = Array.from(clone.querySelectorAll('span'));
        let foundTitle = false;
        for (const sp of spans) {
          const txt = sp.textContent.trim();
          if (txt === 'New Worktree' || txt === 'New Workspace' || txt.includes('Worktree') || txt.includes('Workspace')) {
            sp.textContent = 'Remote (VPS)';
            foundTitle = true;
          } else if (foundTitle && txt.length > 3 && !txt.includes('Remote')) {
            const cfg = getRemoteConfig();
            sp.textContent = `${cfg.host || 'Daemon distant'} (24/7 Autonome)`;
          }
        }

        // Target and replace Icon with Cloud icon
        const iconWrap = clone.querySelector('.shrink-0') || clone.querySelector('div');
        if (iconWrap) {
          iconWrap.innerHTML = '<span style="font-size:14px;line-height:1;">☁️</span>';
        }

        const clickable = clone.classList.contains('main-row-trigger') || clone.classList.contains('cursor-pointer')
          ? clone
          : (clone.querySelector('.main-row-trigger') || clone.querySelector('.cursor-pointer') || clone);

        clickable.onclick = (e) => {
          e.stopPropagation();
          e.preventDefault();
          console.log('[Antigravity 2.0 Remote] Clicked Remote (VPS)!');
          const cfg = getRemoteConfig();
          if (e.shiftKey || e.altKey || !cfg.configured) {
            openRemoteConfigModal();
          } else {
            const cid = getActiveSessionId();
            if (cid) setSessionRemote(cid, true);
            else {
              window.__ag_draft_remote = true;
              syncRemoteStateToProxy(true, cfg.host, getRemoteSessions());
            }
            updateTriggerButton();
            closeEnvironmentPopover();
          }
        };

        parent.appendChild(clone);
        console.log('[Antigravity 2.0 Remote] Injected Remote (VPS) row into popover.');
      }
    }
  }

  // --- Global Top Bar Status Button (disabled/hidden) ---
  function injectTopBarButton() {
    const oldTopBtn = document.getElementById('__ag_topbar_remote_btn');
    if (oldTopBtn) oldTopBtn.remove();
  }

  // Note: Chat UI enhancements (Retry button & Suggestion pills) are handled exclusively by chatUiEnhancer.js

  // --- Observer & Listeners ---
  let isUpdating = false;
  let rafId = null;

  function scheduleUpdate() {
    if (rafId) return;
    rafId = requestAnimationFrame(() => {
      rafId = null;
      if (isUpdating) return;
      isUpdating = true;
      try {
        injectRemoteOption();
        injectTopBarButton();
        updateTriggerButton();
      } catch (err) {
        console.warn('[AG Remote Hook] Error in scheduleUpdate:', err);
      } finally {
        setTimeout(() => { isUpdating = false; }, 60);
      }
    });
  }

  function startObserver() {
    if (window.__ag_dom_observer) {
      window.__ag_dom_observer.disconnect();
    }
    const obs = new MutationObserver((mutations) => {
      let onlyOurs = true;
      for (let i = 0; i < mutations.length; i++) {
        const t = mutations[i].target;
        if (!t || !t.closest || !t.closest('#__ag_topbar_remote_btn, #__ag_remote_pill, #__ag_inline_remote_btn, #__ag_inline_retry_btn, #__ag_suggestion_pills_bar, [data-ag-remote]')) {
          onlyOurs = false;
          break;
        }
      }
      if (onlyOurs) return;
      scheduleUpdate();
    });
    obs.observe(document.body || document.documentElement, { childList: true, subtree: true });
    window.__ag_dom_observer = obs;

    scheduleUpdate();
  }

  document.addEventListener('click', (e) => {
    setTimeout(scheduleUpdate, 25);
    setTimeout(scheduleUpdate, 100);
    setTimeout(scheduleUpdate, 250);

    const target = e.target;
    if (!target) return;
    const item = (target.closest && (target.closest('.main-row-trigger') || target.closest('button') || target.closest('[role="menuitem"]') || target.closest('.cursor-pointer'))) || target;
    const text = item.textContent || '';
    if (text.includes('Local') && !text.includes('Remote')) {
      const cid = getActiveSessionId();
      if (cid) setSessionRemote(cid, false);
      else window.__ag_draft_remote = false;
      scheduleUpdate();
    } else if (text.includes('New Worktree') || text.includes('New Workspace')) {
      const cid = getActiveSessionId();
      if (cid) setSessionRemote(cid, false);
      else window.__ag_draft_remote = false;
      scheduleUpdate();
    }
  }, true);


  window.addEventListener('popstate', scheduleUpdate);
  const origPush = history.pushState;
  history.pushState = function() {
    const ret = origPush.apply(this, arguments);
    scheduleUpdate();
    return ret;
  };
  const origReplace = history.replaceState;
  history.replaceState = function() {
    const ret = origReplace.apply(this, arguments);
    scheduleUpdate();
    return ret;
  };

  setInterval(scheduleUpdate, 1500);
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      startObserver();
      scheduleUpdate();
    });
    window.addEventListener('load', scheduleUpdate);
  } else {
    startObserver();
    scheduleUpdate();
  }

  // Prompt submit interceptor: guarantees active session is registered on proxy before LLM dispatch
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      if (isCurrentSessionRemote()) {
        const cid = getActiveSessionId();
        if (cid) setSessionRemote(cid, true);
        const cfg = getRemoteConfig();
        syncRemoteStateToProxy(true, cfg.host, cid ? { [cid]: true } : {});
      }
    }
  }, true);


  document.addEventListener('click', (e) => {
    const sendBtn = e.target && (e.target.closest && (e.target.closest('button[aria-label*="Send"]') || e.target.closest('button[type="submit"]') || e.target.closest('.send-button')));
    if (sendBtn && isCurrentSessionRemote()) {
      const cid = getActiveSessionId();
      if (cid) setSessionRemote(cid, true);
      const cfg = getRemoteConfig();
      syncRemoteStateToProxy(true, cfg.host, cid ? { [cid]: true } : {});
    }
  }, true);


  // Sync initial state from Proxy / nativeStorage
  try {
    fetch(`${LOCAL_PROXY_ORIGIN}/api/remote/status`)
      .then((r) => r.json())
      .then((data) => {
        if (data && data.remoteSessions) {
          const cur = getRemoteSessions();
          localStorage.setItem('ag_remote_sessions', JSON.stringify({ ...cur, ...data.remoteSessions }));
        }
        if (data && data.host && !localStorage.getItem('ag_remote_host')) {
          localStorage.setItem('ag_remote_host', data.host);
        }
        const cid = getActiveSessionId();
        if (cid && isCurrentSessionRemote()) {
          const cfg = getRemoteConfig();
          syncRemoteStateToProxy(true, cfg.host, { [cid]: true });
        }
        updateTriggerButton();
        injectTopBarButton();
      })
      .catch(() => {});
  } catch (_) {}

  try {
    if (window.nativeStorage && typeof window.nativeStorage.getRemoteState === 'function') {
      window.nativeStorage.getRemoteState().then((res) => {
        if (res && res.ok && res.state) {
          if (res.state.host && !localStorage.getItem('ag_remote_host')) {
            localStorage.setItem('ag_remote_host', res.state.host);
          }
          if (res.state.remoteSessions) {
            const cur = getRemoteSessions();
            localStorage.setItem('ag_remote_sessions', JSON.stringify({ ...cur, ...res.state.remoteSessions }));
          }
          updateTriggerButton();
          injectTopBarButton();
        }
      }).catch(() => {});
    }
  } catch (_) {}

  // --- Active Cloud Session Auto-Discovery & Real-Time Live Handover ---
  function getSessionBindings() {
    try {
      return JSON.parse(localStorage.getItem('ag_session_bindings') || '{}');
    } catch (_) {
      return {};
    }
  }

  function setSessionBinding(conversationId, remoteSessionId, workspaceId) {
    if (!conversationId) return;
    try {
      const bindings = getSessionBindings();
      bindings[conversationId] = {
        remoteSessionId,
        workspaceId,
        updatedAt: Date.now()
      };
      localStorage.setItem('ag_session_bindings', JSON.stringify(bindings));
    } catch (_) {}
  }

  let activeLiveWs = null;
  let attachedSessionId = null;

  async function checkActiveCloudSessions() {
    const cfg = getRemoteConfig();
    if (!cfg.host || !cfg.token) return;

    let apiBase = cfg.host;
    if (!apiBase.startsWith('http://') && !apiBase.startsWith('https://')) {
      apiBase = 'https://' + apiBase;
    }
    apiBase = apiBase.replace(/\/+$/, '');

    const currentConvId = getActiveSessionId();
    const bindings = getSessionBindings();
    const currentBinding = currentConvId ? bindings[currentConvId] : null;

    try {
      const resp = await fetch(`${apiBase}/v2/sessions?token=${encodeURIComponent(cfg.token)}`, {
        signal: AbortSignal.timeout(3500),
      });
      if (!resp.ok) return;
      const data = await resp.json();
      const sessions = data.sessions || [];

      // Strict session scoping: only attach if explicitly bound to this conversation
      // Never guess by arbitrary running state or workspace alone (prevents cross-session hijack)
      let targetSession = null;
      if (currentBinding && currentBinding.remoteSessionId) {
        targetSession = sessions.find((s) => s.id === currentBinding.remoteSessionId && (s.state === 'running' || s.state === 'waiting_input'));
      } else if (currentConvId) {
        targetSession = sessions.find((s) => s.metadata && s.metadata.conversationId === currentConvId && (s.state === 'running' || s.state === 'waiting_input'));
        if (targetSession) {
          setSessionBinding(currentConvId, targetSession.id, targetSession.workspaceId);
        }
      }

      renderCloudLiveBanner(targetSession);
      updateScopedPromptFreeze(targetSession, currentConvId);
    } catch (_) {}
  }

  function updateScopedPromptFreeze(session, conversationId) {
    const promptBox = document.querySelector('[contenteditable="true"]') || document.querySelector('textarea');
    if (!promptBox) return;

    if (session && (session.state === 'running' || session.state === 'starting')) {
      promptBox.setAttribute('data-ag-frozen-conv', conversationId || '');
      promptBox.setAttribute('disabled', 'true');
      promptBox.style.opacity = '0.65';
      promptBox.style.cursor = 'not-allowed';
      if (!promptBox.getAttribute('data-ag-orig-placeholder')) {
        promptBox.setAttribute('data-ag-orig-placeholder', promptBox.getAttribute('placeholder') || '');
      }
      promptBox.setAttribute('placeholder', '🔒 Session Cloud active pour ce projet — saisie locale temporairement réservée.');
    } else if (promptBox.getAttribute('data-ag-frozen-conv')) {
      promptBox.removeAttribute('disabled');
      promptBox.style.opacity = '1';
      promptBox.style.cursor = 'text';
      const orig = promptBox.getAttribute('data-ag-orig-placeholder');
      if (orig) promptBox.setAttribute('placeholder', orig);
      promptBox.removeAttribute('data-ag-frozen-conv');
    }
  }

  function renderCloudLiveBanner(session) {
    let banner = document.getElementById('__ag_cloud_live_banner');
    if (!session) {
      if (banner) banner.remove();
      return;
    }

    if (!banner) {
      banner = document.createElement('div');
      banner.id = '__ag_cloud_live_banner';
      banner.style.cssText = 'position:fixed;bottom:84px;left:50%;transform:translateX(-50%);z-index:9998;display:flex;align-items:center;gap:12px;padding:8px 18px;border-radius:12px;background:rgba(15,23,42,0.94);border:1px solid rgba(52,211,153,0.45);box-shadow:0 8px 30px rgba(0,0,0,0.6);color:#e2e8f0;font-family:system-ui,-apple-system,sans-serif;font-size:12px;backdrop-filter:blur(10px);user-select:none;transition:all 0.2s ease-in-out;';
      document.body.appendChild(banner);
    }

    const isAttached = attachedSessionId === session.id;
    const rawTitle = session.title || session.id || 'Session 24/7';
    const cleanTitle = rawTitle.length > 35 ? rawTitle.slice(0, 32) + '...' : rawTitle;
    banner.innerHTML = `
      <span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:#34d399;box-shadow:0 0 10px #34d399;flex-shrink:0;"></span>
      <span style="font-weight:500;"><strong>Session Cloud VPS active :</strong> "${cleanTitle}"</span>
      <span style="color:#94a3b8;font-size:11px;background:rgba(255,255,255,0.06);padding:2px 6px;border-radius:4px;">Session verrouillée</span>
      <button id="__ag_attach_live_btn" style="background:${isAttached ? 'rgba(52,211,153,0.2)' : '#059669'};color:${isAttached ? '#34d399' : '#ffffff'};border:${isAttached ? '1px solid #34d399' : 'none'};padding:5px 12px;border-radius:6px;font-size:11px;font-weight:600;cursor:pointer;transition:all 0.15s;">
        ${isAttached ? '🟢 En direct' : '⚡ Suivre le direct'}
      </button>
    `;

    const attachBtn = document.getElementById('__ag_attach_live_btn');
    if (attachBtn) {
      attachBtn.onclick = () => {
        if (!isAttached) attachToLiveSession(session.id);
      };
    }
  }

  function attachToLiveSession(sessionId) {
    if (activeLiveWs) {
      try { activeLiveWs.close(); } catch (_) {}
    }
    const cfg = getRemoteConfig();
    let wsBase = cfg.host;
    let wsProto = wsBase.startsWith('https://') ? 'wss:' : 'ws:';
    wsBase = wsBase.replace(/^https?:\/\//i, '').replace(/\/+$/, '');
    const wsUrl = `${wsProto}//${wsBase}/v2/ws?token=${encodeURIComponent(cfg.token)}`;

    try {
      activeLiveWs = new WebSocket(wsUrl);
      attachedSessionId = sessionId;

      activeLiveWs.onopen = () => {
        activeLiveWs.send(JSON.stringify({
          version: '2.0',
          type: 'session.attach',
          sessionId: sessionId,
          lastSequence: 0
        }));
        showLiveStreamDrawer(sessionId);
        checkActiveCloudSessions();
      };

      activeLiveWs.onmessage = (evt) => {
        try {
          const msg = JSON.parse(evt.data);
          handleLiveStreamEvent(msg);
        } catch (_) {}
      };

      activeLiveWs.onclose = () => {
        attachedSessionId = null;
        checkActiveCloudSessions();
      };
    } catch (_) {}
  }

  async function handleSafeSyncClick() {
    const cfg = getRemoteConfig();
    let apiBase = cfg.host;
    if (!apiBase.startsWith('http://') && !apiBase.startsWith('https://')) {
      apiBase = 'https://' + apiBase;
    }
    apiBase = apiBase.replace(/\/+$/, '');

    const btn = document.getElementById('__ag_sync_local_btn');
    if (btn) {
      btn.disabled = true;
      btn.textContent = '⏳ Garde-fou preflight...';
    }

    try {
      // 1. Exécuter le preflight de sécurité
      const pfResp = await fetch(`${apiBase}/v2/workspaces/sync?token=${encodeURIComponent(cfg.token)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'preflight' }),
      });
      const pf = await pfResp.json();

      if (!pf.canSync) {
        if (btn) {
          btn.disabled = false;
          btn.style.background = '#dc2626';
          btn.textContent = '❌ Sync bloquée';
        }
        alert(`⚠️ Synchronisation bloquée par sécurité :\n\n${pf.reason}\n\nStratégie : ${pf.strategy}`);
        return;
      }

      // 2. Safe Fast-Forward pull
      if (btn) btn.textContent = '📥 Fast-forward...';
      const syncResp = await fetch(`${apiBase}/v2/workspaces/sync?token=${encodeURIComponent(cfg.token)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'safe_pull' }),
      });
      const syncRes = await syncResp.json();

      if (syncResp.ok && syncRes.success) {
        if (btn) {
          btn.style.background = '#059669';
          btn.textContent = '✅ Synchronisé !';
        }
      } else {
        if (btn) {
          btn.disabled = false;
          btn.style.background = '#d97706';
          btn.textContent = '⚠️ Erreur sync';
        }
        alert(`Échec : ${syncRes.error || syncRes.message}`);
      }
    } catch (err) {
      if (btn) {
        btn.disabled = false;
        btn.textContent = '❌ Erreur réseau';
      }
    }
  }

  function showLiveStreamDrawer(sessionId) {
    let drawer = document.getElementById('__ag_live_stream_drawer');
    if (!drawer) {
      drawer = document.createElement('div');
      drawer.id = '__ag_live_stream_drawer';
      drawer.style.cssText = 'position:fixed;bottom:135px;right:24px;width:440px;max-height:360px;z-index:9999;border-radius:12px;background:rgba(15,23,42,0.96);border:1px solid rgba(52,211,153,0.3);box-shadow:0 12px 35px rgba(0,0,0,0.7);backdrop-filter:blur(12px);display:flex;flex-direction:column;overflow:hidden;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;font-size:11px;color:#cbd5e1;';
      drawer.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 12px;background:rgba(0,0,0,0.3);border-bottom:1px solid rgba(255,255,255,0.08);">
          <span style="font-weight:600;color:#34d399;">☁️ Live Feed VPS (${sessionId.slice(0, 8)})</span>
          <button id="__ag_close_live_drawer" style="background:none;border:none;color:#94a3b8;cursor:pointer;font-size:14px;line-height:1;">✕</button>
        </div>
        <div id="__ag_live_log_container" style="flex:1;overflow-y:auto;padding:10px;line-height:1.5;max-height:280px;">
          <div style="color:#64748b;">Connexion établie avec le VPS. Réception du flux live...</div>
        </div>
        <div id="__ag_live_sync_footer" style="display:none;padding:8px 12px;background:rgba(52,211,153,0.1);border-top:1px solid rgba(52,211,153,0.3);text-align:center;">
          <span style="color:#34d399;font-weight:500;">🎉 Tâche terminée sur le VPS !</span>
          <button id="__ag_sync_local_btn" style="margin-left:8px;background:#10b981;color:#fff;border:none;padding:3px 8px;border-radius:4px;cursor:pointer;font-size:11px;font-weight:600;">📥 Git Pull Sécurisé</button>
        </div>
      `;
      document.body.appendChild(drawer);

      document.getElementById('__ag_sync_local_btn').onclick = handleSafeSyncClick;

      document.getElementById('__ag_close_live_drawer').onclick = () => {
        if (activeLiveWs) {
          try { activeLiveWs.close(); } catch (_) {}
          activeLiveWs = null;
        }
        attachedSessionId = null;
        drawer.remove();
        checkActiveCloudSessions();
      };
    }
  }

  function handleLiveStreamEvent(msg) {
    const logs = document.getElementById('__ag_live_log_container');
    if (!logs) return;

    if (msg.type === 'session.catchup' && Array.isArray(msg.events)) {
      for (const ev of msg.events) {
        appendLiveEventLog(logs, ev);
      }
    } else if (msg.type === 'session.event' && msg.event) {
      appendLiveEventLog(logs, msg.event);
    }
  }

  function appendLiveEventLog(container, ev) {
    const el = document.createElement('div');
    el.style.marginBottom = '4px';

    if (ev.type === 'agent.thought_chunk') {
      try {
        const p = JSON.parse(ev.payload);
        el.style.color = '#93c5fd';
        el.textContent = '💭 ' + p.chunk;
      } catch (_) {}
    } else if (ev.type === 'tool.call') {
      try {
        const p = JSON.parse(ev.payload);
        el.style.color = '#fbbf24';
        el.textContent = `⚙️ [Outil] ${p.name}`;
      } catch (_) {}
    } else if (ev.type === 'git.auto_checkpoint') {
      try {
        const p = JSON.parse(ev.payload);
        el.style.color = '#34d399';
        el.style.fontWeight = 'bold';
        el.textContent = `📌 [Git Auto-Checkpoint] ${p.commitHash?.slice(0, 7) || ''} (${p.branch}) -> ${p.pushed ? 'origin pushed ✅' : 'local'}`;
      } catch (_) {}
    } else if (ev.type === 'agent.completed') {
      el.style.color = '#34d399';
      el.style.fontWeight = 'bold';
      el.textContent = '✅ [Terminé] Tâche terminée avec succès sur le VPS.';
      const footer = document.getElementById('__ag_live_sync_footer');
      if (footer) footer.style.display = 'block';
    } else {
      el.style.color = '#64748b';
      el.textContent = `• ${ev.type}`;
    }

    container.appendChild(el);
    container.scrollTop = container.scrollHeight;
  }

  setInterval(checkActiveCloudSessions, 4000);
  window.addEventListener('focus', checkActiveCloudSessions);
  checkActiveCloudSessions();

  window.__ag_update_trigger = updateTriggerButton;
  console.log('[Antigravity 2.0 Remote] Hook setup completed successfully.');
})();
