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
    if (event && event.message && event.message.includes('DraftCommentEditor: A line number or selection context is required')) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }, true);

  // Auto-bootstrap Enterprise & Google Internal capabilities and custom flags
  try {
    const existingOverride = window.localStorage.getItem('jetski.developer.featureEnvironmentOverride');
    if (existingOverride && (existingOverride.includes('"host":1') || existingOverride.includes('"host": 1'))) {
      window.localStorage.removeItem('jetski.developer.featureEnvironmentOverride');
    }
    if (!window.localStorage.getItem('jetski.developer.featureEnvironmentOverride')) {
      window.localStorage.setItem('jetski.developer.featureEnvironmentOverride', JSON.stringify({
        enabled: true,
        userCohort: 'google',
        binary: 'hub',
        os: 'windows'
      }));
    }
    if (!window.localStorage.getItem('jetski.developer.customFlagOverrides')) {
      window.localStorage.setItem('jetski.developer.customFlagOverrides', JSON.stringify({
        'enable-developer-mode': true,
        'enable-permissions-selector': true,
        'enable-thought-editing': true,
        'enable-thought-steering-from-selection': true,
        'enable-battle-mode': true,
        'enable-battle-contrib-variants': true,
        'enable-battle-mode-custom-agents': true,
        'jetski-autonomous-mode': true,
        'labs-autonomous-mode': true,
        'enable-agent-team': true,
        'enable-swarm-monitor': true,
        'enable-critique-preview': true,
        'enable-conversation-forking': true,
        'enable-fork-at-historical-step': true,
        'enable-fork-in-new-worktree': true,
        'enable-conversation-navigator': true,
        'enable-conversation-groups': true,
        'enable-conversation-sharing-prototype': true,
        'enable-trajectory-debug-tools': true,
        'enable-hub-builtin-browser': true,
        'enable-pdf-viewer': true,
        'enable-notebook-rendering': true,
        'enable-audio-transcription': true,
        'enable-voice-relay': true,
        'google-workspace-mentions': true,
        'enable-plugins': true,
        'enable-plugin-bundles': true,
        'enable-plugin-context-providers': true,
        'enable-mcp-plugin-auth': true,
        'enable-split-view': true,
        'enable-input-autocomplete': true,
        'enable-file-explorer-tab': true,
        'enable-code-search-palette': true,
        'enable-git-vcs-ui': true,
        'enable-jj-vcs-ui': true,
        'markdown-table-v2': true,
        'scheduled-tasks-v2': true,
        'enable-tasks': true,
        'enable-remote-ai': true,
        'enable-auto-permission-preset': true,
        'enable-sidebar-unread-dot': true,
        'enable-sidecar-pill-auto-open': true,
        'enable-terminal-setup-script': true,
        'enable-context-menu-system': true,
        'configure-artifact-width': true
      }));
    }
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

    const BUILTIN_PLUGINS = [
      // Google Workspace (Original Google Ecosystem)
      {
        id: 'google-docs',
        displayName: 'Google Docs',
        description: 'Read, draft, and edit docs.',
        logo: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><path fill="%234285F4" d="M30 6H14a4 4 0 0 0-4 4v28a4 4 0 0 0 4 4h20a4 4 0 0 0 4-4V14l-8-8z"/><path fill="%23A1C2FA" d="M30 6v8h8z"/><path fill="%23fff" d="M16 22h16v2.5H16zm0 6h16v2.5H16zm0 6h10v2.5H16z"/></svg>',
        marketplace: 'builtin',
        plugin: {},
        version: '1.0.0',
        tags: ['workspace', 'docs', 'google']
      },
      {
        id: 'google-sheets',
        displayName: 'Google Sheets',
        description: 'Read, write, and format spreadsheets.',
        logo: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><path fill="%230F9D58" d="M30 6H14a4 4 0 0 0-4 4v28a4 4 0 0 0 4 4h20a4 4 0 0 0 4-4V14l-8-8z"/><path fill="%2387CEAC" d="M30 6v8h8z"/><path fill="%23fff" d="M16 22h16v14H16zm2 2v2.5h5V24zm7 0v2.5h5V24zm-7 4.5v2.5h5v-2.5zm7 0v2.5h5v-2.5zm-7 4.5v2.5h5V33zm7 0v2.5h5V33z"/></svg>',
        marketplace: 'builtin',
        plugin: {},
        version: '1.0.0',
        tags: ['workspace', 'sheets', 'google']
      },
      {
        id: 'google-slides',
        displayName: 'Google Slides',
        description: 'Read, edit, and export presentations.',
        logo: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><path fill="%23F4B400" d="M30 6H14a4 4 0 0 0-4 4v28a4 4 0 0 0 4 4h20a4 4 0 0 0 4-4V14l-8-8z"/><path fill="%23FBE38E" d="M30 6v8h8z"/><path fill="%23fff" d="M16 22h16v12H16zm2 2v8h12v-8z"/></svg>',
        marketplace: 'builtin',
        plugin: {},
        version: '1.0.0',
        tags: ['workspace', 'slides', 'google']
      },
      {
        id: 'google-drive',
        displayName: 'Google Drive',
        description: 'Search, upload, download, and share files.',
        logo: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><path fill="%23FFC107" d="M17 6L6 25l6 10.5h11L17 6z"/><path fill="%232196F3" d="M31 6H17l11 19h14L31 6z"/><path fill="%234CAF50" d="M12 35.5l5.5 9.5h22l-6-9.5H12z"/></svg>',
        marketplace: 'builtin',
        plugin: {},
        version: '1.0.0',
        tags: ['workspace', 'drive', 'google']
      },
      {
        id: 'google-calendar',
        displayName: 'Google Calendar',
        description: 'Check availability, schedule events, and RSVP.',
        logo: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><rect width="36" height="36" x="6" y="6" fill="%23fff" rx="4"/><path fill="%231976D2" d="M6 10a4 4 0 0 1 4-4h28a4 4 0 0 1 4 4v6H6z"/><text x="24" y="34" fill="%231976D2" font-family="sans-serif" font-size="18" font-weight="bold" text-anchor="middle">31</text></svg>',
        marketplace: 'builtin',
        plugin: {},
        version: '1.0.0',
        tags: ['workspace', 'calendar', 'google']
      },

      // Build with Google
      {
        id: 'gemini-api',
        displayName: 'Gemini API',
        description: 'Build applications with the Gemini Interactions API and multimodal models.',
        logo: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><defs><linearGradient id="gem" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="%231BA1E2"/><stop offset="50%" stop-color="%239B59B6"/><stop offset="100%" stop-color="%23E67E22"/></linearGradient></defs><path fill="url(%23gem)" d="M24 2C24 14.15 14.15 24 2 24c12.15 0 22 9.85 22 22 0-12.15 9.85-22 22-22-12.15 0-22-9.85-22-22z"/></svg>',
        marketplace: 'builtin',
        plugin: {},
        version: '1.0.0',
        tags: ['google', 'gemini', 'api']
      },
      {
        id: 'chrome-devtools',
        displayName: 'Chrome DevTools',
        description: 'Reliable automation, in-depth debugging, and performance profiling.',
        logo: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><circle cx="24" cy="24" r="20" fill="%234285F4"/><circle cx="24" cy="24" r="9" fill="%23fff"/><circle cx="24" cy="24" r="7" fill="%231976D2"/><path fill="%23EA4335" d="M24 4c7.4 0 13.9 4 17.3 10H24z"/><path fill="%23FBBC05" d="M41.3 14c2.2 3.8 3.5 8.2 3.5 13 0 7.8-3.5 14.8-9 19.3L24 24z"/><path fill="%2334A853" d="M35.8 46.3C32.4 48.7 28.4 50 24 50 12.9 50 3.6 42.4 1 32l11.5-6.6z"/></svg>',
        marketplace: 'builtin',
        plugin: {},
        version: '1.0.0',
        tags: ['google', 'chrome', 'devtools']
      },
      {
        id: 'android-cli',
        displayName: 'Android CLI',
        description: 'Core tools and knowledge required to develop for Android.',
        logo: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><path fill="%233DDC84" d="M12 28a12 12 0 0 1 24 0v4H12zm5-12l-3-5a1 1 0 1 1 1.7-1l3.1 5.2a14 14 0 0 1 10.4 0L32.3 10a1 1 0 1 1 1.7 1l-3 5A12 12 0 0 1 36 24H12a12 12 0 0 1 5-8zm1 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4zm12 0a2 2 0 1 0 0-4 2 2 0 0 0 0 4z"/></svg>',
        marketplace: 'builtin',
        plugin: {},
        version: '1.0.0',
        tags: ['google', 'android', 'cli']
      },
      {
        id: 'firebase',
        displayName: 'Firebase',
        description: 'Prototype, build & run modern apps that users love.',
        logo: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><path fill="%23FFA000" d="M8 38L18 6l6 12-5.5 10.5z"/><path fill="%23FFCA28" d="M40 38l-7-25-15 25z"/><path fill="%23F57C00" d="M23.5 28.5L18 6l-10 32h32z"/></svg>',
        marketplace: 'builtin',
        plugin: {},
        version: '1.0.0',
        tags: ['google', 'firebase', 'cloud']
      },
      {
        id: 'science',
        displayName: 'Science',
        description: 'Curated collection of agent skills for science tasks.',
        logo: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><circle cx="24" cy="24" r="4" fill="%23fff"/><ellipse cx="24" cy="24" rx="20" ry="7" fill="none" stroke="%23fff" stroke-width="2.5" transform="rotate(30 24 24)"/><ellipse cx="24" cy="24" rx="20" ry="7" fill="none" stroke="%23fff" stroke-width="2.5" transform="rotate(90 24 24)"/><ellipse cx="24" cy="24" rx="20" ry="7" fill="none" stroke="%23fff" stroke-width="2.5" transform="rotate(150 24 24)"/></svg>',
        marketplace: 'builtin',
        skill: {},
        version: '1.0.0',
        tags: ['google', 'science', 'skill']
      },
      {
        id: 'google-antigravity-sdk',
        displayName: 'Google Antigravity SDK',
        description: 'Using the Google Antigravity Python SDK to build custom tools and agents.',
        logo: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><path fill="%234285F4" d="M24 4L6 40h10l8-18 8 18h10z"/><circle cx="24" cy="18" r="4" fill="%2334A853"/></svg>',
        marketplace: 'builtin',
        plugin: {},
        version: '1.0.0',
        tags: ['google', 'sdk', 'antigravity']
      },

      // Superpowers & Core Plugins
      {
        id: 'automation',
        displayName: 'Automation & Scheduled Tasks',
        description: 'Design and manage recurring background tasks, cron workflows, and daily automations.',
        logo: '',
        marketplace: 'builtin',
        plugin: {},
        version: '2.0.0',
        tags: ['automation', 'cron', 'system', 'tools']
      },
      {
        id: 'chrome-devtools-mcp',
        displayName: 'Chrome DevTools MCP',
        description: 'Direct browser DOM inspection, console logs, network monitoring and live debugging.',
        logo: '',
        marketplace: 'builtin',
        plugin: {},
        version: '1.2.0',
        tags: ['devtools', 'browser', 'debugging', 'mcp']
      },
      {
        id: 'generative_ui',
        displayName: 'Generative UI & Visual Artifacts',
        description: 'Render interactive HTML, SVG charts, data visualizations, and live reactive widgets in chat.',
        logo: '',
        marketplace: 'builtin',
        plugin: {},
        version: '2.0.0',
        tags: ['ui', 'artifacts', 'visualization', 'frontend']
      },
      {
        id: 'plugin',
        displayName: 'Plugin Management Hub',
        description: 'Install, manage, toggle and bundle skills, rules, MCP servers and custom agents as unified plugins.',
        logo: '',
        marketplace: 'builtin',
        plugin: {},
        version: '2.1.0',
        tags: ['plugins', 'ecosystem', 'management']
      },
      {
        id: 'ui-plugin-navigation',
        displayName: 'UI Sidecar & Panel Navigation',
        description: 'One-click shortcuts to discover and toggle side panels, status widgets and active tools.',
        logo: '',
        marketplace: 'builtin',
        plugin: {},
        version: '1.5.0',
        tags: ['ui', 'navigation', 'sidecar']
      },
      {
        id: 'permissioned-github',
        displayName: 'Permissioned GitHub Integration',
        description: 'Secure GitHub operations with per-action branch guardrails and PR merge automation.',
        logo: '',
        marketplace: 'builtin',
        plugin: {},
        version: '1.1.0',
        tags: ['github', 'vcs', 'security']
      }
    ];

    const CORE_SKILLS = [
      { id: 'boost', displayName: 'Boost Multi-Agent Swarm', description: 'Invoke the Boost multi-agent orchestrator for complex tasks, system design, and formal verification.', skill: {} },
      { id: 'owl', displayName: 'Owl Autonomous Multi-Agent', description: 'Invoke the Owl multi-agent orchestrator for complex tasks and system design.', skill: {} },
      { id: 'teamwork', displayName: 'Teamwork Swarm Orchestrator', description: 'Teamwork multi-agent swarm for parallel execution and adversarial code review.', skill: {} },
      { id: 'reverse-engineer-anything', displayName: 'Reverse Engineer Anything (REA)', description: 'Reverse engineer native, managed, Electron/JS, packaged, and browser targets.', skill: {} },
      { id: 'ponytail', displayName: 'Ponytail Senior Dev Suite', description: 'Forces the minimal working solution: senior dev mode, audit, and debt ledger.', skill: {} },
      { id: 'impeccable', displayName: 'Impeccable UI & Behavioral Polish', description: 'Design, shape, critique and polish frontend interfaces with 65 behavioral psychology principles.', skill: {} },
      { id: 'security-review', displayName: 'Codebase Security Scanner', description: 'AI-powered codebase security scanner tracing data flows and catching vulnerabilities.', skill: {} },
      { id: 'autoplan', displayName: 'Autoplan Review Suite', description: 'Automated strategy, design, engineering architecture and DX reviews.', skill: {} },
      { id: 'antislop', displayName: 'Anti-Slop Suite for Coding Agents', description: 'Universal filter to prevent AI slop across code comments, UI design, typography and layouts.', skill: {} },
      { id: 'investigate', displayName: 'Systematic Root Cause Investigator', description: 'Systematic debugging with root cause investigation and verification.', skill: {} }
    ];

    const GROUPS = [
      {
        id: 'google-workspace',
        displayName: 'Google Workspace',
        description: 'Connect to Google Workspace, including Docs, Sheets, Slides, Drive, and Calendar.',
        memberIds: ['google-docs', 'google-sheets', 'google-slides', 'google-drive', 'google-calendar'],
        nextPageToken: ''
      },
      {
        id: 'build-with-google',
        displayName: 'Build with Google',
        description: "Build on Google's developer platforms, including Android, Chrome, Gemini, and Google Cloud.",
        memberIds: ['gemini-api', 'chrome-devtools', 'android-cli', 'firebase', 'science', 'google-antigravity-sdk'],
        nextPageToken: ''
      },
      {
        id: 'featured',
        displayName: '⭐ Featured Superpowers & Plugins',
        description: 'Curated autonomous swarms, reverse engineering, and developer suites.',
        memberIds: ['automation', 'chrome-devtools-mcp', 'boost', 'owl', 'teamwork', 'reverse-engineer-anything', 'ponytail', 'security-review', 'generative_ui'],
        nextPageToken: ''
      },
      {
        id: 'architecture',
        displayName: '🛠️ Developer Experience & Architecture',
        description: 'Codebase analysis, refactoring, code review swarms, and root-cause debugging.',
        memberIds: ['investigate', 'systematic-debugging', 'autoplan', 'devex-review', 'health', 'plan', 'spec', 'writing-plans', 'executing-plans'],
        nextPageToken: ''
      },
      {
        id: 'frontend-design',
        displayName: '🎨 UI, Design & Behavioral Polish',
        description: 'Cognitive psychology UX audits, generative UI widgets, anti-slop filters, and design systems.',
        memberIds: ['impeccable', 'generative_ui', 'antislop', 'design-consultation', 'design-review', 'design-html', 'design-shotgun'],
        nextPageToken: ''
      },
      {
        id: 'qa-security',
        displayName: '🛡️ Security, QA & Automated Deployment',
        description: 'Security vulnerability scanners, QA dogfooding, and protected ship pipelines.',
        memberIds: ['security-review', 'qa', 'qa-only', 'test-driven-development', 'careful', 'guard', 'ship', 'land-and-deploy'],
        nextPageToken: ''
      }
    ];

    window.fetch = async function(...args) {
      const url = typeof args[0] === 'string' ? args[0] : (args[0] && args[0].url ? args[0].url : (args[0] && args[0].href ? args[0].href : ''));
      const reqHeaders = args[1] && args[1].headers;
      const isAllWorkflows = typeof url === 'string' && url.includes('LanguageServerService/GetAllWorkflows');
      const isSlashCommands = typeof url === 'string' && url.includes('LanguageServerService/GetSlashCommands');
      const isSearchMarketplaceCustomizations = typeof url === 'string' && url.includes('LanguageServerService/SearchMarketplaceCustomizations');
      const isListRemotePlugins = typeof url === 'string' && url.includes('LanguageServerService/ListRemotePlugins');
      const isSearchMarketplace = typeof url === 'string' && url.includes('LanguageServerService/SearchMarketplace') && !isSearchMarketplaceCustomizations;
      const isMarketplaceBundles = typeof url === 'string' && url.includes('LanguageServerService/GetMarketplaceBundles');
      const isMarketplaceCustomization = typeof url === 'string' && url.includes('LanguageServerService/GetMarketplaceCustomization');
      const isInstallCustomization = typeof url === 'string' && url.includes('LanguageServerService/InstallCustomization');

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

      // 3. Intercept ListRemotePlugins (avoid 403 / unimplemented error in local mode)
      if (isListRemotePlugins) {
        return formatResponse({ plugins: [] }, reqHeaders);
      }

      // 4. Intercept SearchMarketplace: populate the Marketplace catalog with built-in plugins & skills
      if (isSearchMarketplace) {
        try {
          let reqQuery = '';
          let reqGroupId = '';
          try {
            let bText = typeof args[1]?.body === 'string' ? args[1].body : (args[1]?.body ? new TextDecoder().decode(args[1].body) : '');
            if (bText) {
              const bObj = JSON.parse(bText);
              if (bObj.query) reqQuery = bObj.query.trim().toLowerCase();
              if (bObj.groupId) reqGroupId = bObj.groupId;
            }
          } catch (_) {}

          if (!cachedMarketplaceItems || (Date.now() - lastMarketplaceFetchTime > 60000)) {
            let rawSkills = [];
            try {
              const skillsUrl = url.replace('SearchMarketplace', 'GetAllSkills');
              const skillsRes = await origFetch.apply(this, [skillsUrl, Object.assign({}, args[1], { body: '{}' })]);
              if (skillsRes.ok) {
                const sData = await skillsRes.json();
                rawSkills = sData.skills || [];
              }
            } catch (_) {}

            const formatTitle = function(name) {
              if (!name) return '';
              return name.replace(/^skill-/, '')
                .split(/[-_]+/)
                .map(function(w) { return w.charAt(0).toUpperCase() + w.slice(1); })
                .join(' ');
            };

            const skillItems = rawSkills.map(function(s) {
              return {
                id: s.name,
                displayName: formatTitle(s.name),
                description: s.description || ('Capability: ' + s.name),
                logo: '',
                marketplace: 'builtin',
                skill: {},
                version: '1.0.0',
                tags: ['skill'].concat(s.name.split('-'))
              };
            });

            const seen = new Set(BUILTIN_PLUGINS.map(function(p) { return p.id; }));
            const merged = BUILTIN_PLUGINS.slice();
            skillItems.forEach(function(s) {
              if (!seen.has(s.id)) {
                seen.add(s.id);
                merged.push(s);
              }
            });
            CORE_SKILLS.forEach(function(s) {
              if (!seen.has(s.id)) {
                seen.add(s.id);
                merged.push(Object.assign({
                  marketplace: 'builtin',
                  logo: '',
                  version: '1.0.0',
                  tags: ['skill'].concat(s.id.split('-'))
                }, s));
              }
            });

            cachedMarketplaceItems = merged;
            lastMarketplaceFetchTime = Date.now();
          }

          if (reqGroupId) {
            const selectedGroup = GROUPS.find(function(g) { return g.id === reqGroupId; });
            const groupMemberSet = new Set(selectedGroup ? selectedGroup.memberIds : []);
            const groupItems = (cachedMarketplaceItems || []).filter(function(c) { return groupMemberSet.has(c.id); });
            return formatResponse({
              customizations: groupItems,
              groups: [],
              nextPageToken: ''
            }, reqHeaders);
          }

          let outItems = cachedMarketplaceItems || [];
          if (reqQuery) {
            outItems = outItems.filter(function(c) {
              return c.id.toLowerCase().includes(reqQuery) ||
                (c.displayName && c.displayName.toLowerCase().includes(reqQuery)) ||
                (c.description && c.description.toLowerCase().includes(reqQuery)) ||
                (c.tags && c.tags.some(function(t) { return t.toLowerCase().includes(reqQuery); }));
            });
          }

          const currentIdSet = new Set(outItems.map(function(c) { return c.id; }));
          const outGroups = GROUPS.map(function(g) {
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

      // 5. Intercept GetMarketplaceBundles: return curated packs for the bundles shelf
      if (isMarketplaceBundles) {
        return formatResponse({
          bundles: [
            {
              id: 'bundle-senior-dev',
              displayName: 'Senior Dev & Optimization Pack',
              description: 'Ponytail lazy senior dev mode, root cause investigation, and security review.',
              marketplace: 'builtin',
              memberIds: ['ponytail', 'security-review', 'investigate']
            },
            {
              id: 'bundle-swarms',
              displayName: 'Autonomous Swarm Ensemble',
              description: 'Multi-agent orchestration, Boost swarm reasoning, and Teamwork swarm.',
              marketplace: 'builtin',
              memberIds: ['boost', 'owl', 'teamwork']
            },
            {
              id: 'bundle-ux-polish',
              displayName: 'UI / UX Design & Behavioral Polish',
              description: '65 behavioral psychology principles, generative UI components, and anti-slop filters.',
              marketplace: 'builtin',
              memberIds: ['impeccable', 'generative_ui', 'antislop']
            }
          ],
          customizations: cachedMarketplaceItems || BUILTIN_PLUGINS
        }, reqHeaders);
      }

      // 6. Intercept GetMarketplaceCustomization: return full details and markdown preview
      if (isMarketplaceCustomization) {
        try {
          let targetId = '';
          try {
            let bText = typeof args[1]?.body === 'string' ? args[1].body : (args[1]?.body ? new TextDecoder().decode(args[1].body) : '');
            if (bText) {
              const bObj = JSON.parse(bText);
              if (bObj.id) targetId = bObj.id;
            }
          } catch (_) {}

          const item = (cachedMarketplaceItems || []).find(function(c) { return c.id === targetId; }) || {
            id: targetId,
            displayName: targetId,
            description: 'Customization ' + targetId,
            marketplace: 'builtin',
            skill: {},
            version: '1.0.0',
            tags: []
          };

          return formatResponse({
            customization: item,
            preview: {
              case: item.plugin ? 'plugin' : 'skill',
              value: {
                readme: '# ' + (item.displayName || item.id) + '\n\n' + (item.description || '') + '\n\n### Status\nBuilt-in / Installed capability ready for immediate use.',
                overview: item.description || item.displayName
              }
            }
          }, reqHeaders);
        } catch (detailErr) {
          console.warn('[AG] GetMarketplaceCustomization error in rendererHook:', detailErr);
        }
      }

      // 7. Intercept InstallCustomization: acknowledge installation
      if (isInstallCustomization) {
        return formatResponse({ success: true }, reqHeaders);
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
          inputContainer.parentElement.insertBefore(pill, inputContainer);
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

  // --- Permanent Inline Retry Button ---
  function injectRetryButton() {
    const promptBox = document.querySelector('[contenteditable="true"]') || document.querySelector('textarea');
    const inputCard = document.querySelector('#antigravity\\.agentSidePanelInputBox') ||
                      document.querySelector('.relative.flex.flex-col.p-px.rounded-2xl.bg-card-border') ||
                      (promptBox ? (promptBox.closest('.rounded-2xl') || promptBox.closest('.relative.flex.flex-col.p-px') || promptBox.closest('[class*="rounded"]') || promptBox.parentElement?.parentElement?.parentElement) : null);

    const sendBtn = document.querySelector('button[data-testid="send-button"]') ||
                    document.querySelector('[data-tooltip-id="input-send-button-send-tooltip"]') ||
                    document.querySelector('[data-testid="send-button-pending"]') ||
                    document.querySelector('button[data-tooltip-id="input-send-button-cancel-tooltip"]') ||
                    document.querySelector('button[aria-label*="Send"]') ||
                    document.querySelector('button[aria-label*="send"]') ||
                    (inputCard ? inputCard.querySelector('button:last-of-type') : null);

    let container = null;
    if (sendBtn && sendBtn.parentElement) {
      container = sendBtn.parentElement;
    } else if (inputCard) {
      container = inputCard.querySelector('.flex.items-center.gap-1') ||
                  inputCard.querySelector('.flex.items-center:last-child') ||
                  inputCard.querySelector('div:last-child');
    }

    if (!container) return;

    let retryBtn = document.getElementById('__ag_inline_retry_btn');
    if (chatUiConfig.retryButton === false) {
      if (retryBtn) retryBtn.remove();
      return;
    }
    if (!retryBtn) {
      retryBtn = document.createElement('button');
      retryBtn.id = '__ag_inline_retry_btn';
      retryBtn.type = 'button';
      retryBtn.setAttribute('aria-label', 'Retry');
      retryBtn.setAttribute('data-testid', 'inline-retry-button');
      retryBtn.title = 'Retry / Continue (Reprendre)';
      retryBtn.style.cssText = 'display:inline-flex;align-items:center;gap:4px;padding:3px 10px;margin-left:4px;border-radius:9999px;font-size:12px;font-weight:600;font-family:system-ui,-apple-system,sans-serif;cursor:pointer;user-select:none;transition:all 0.15s ease-in-out;background:#0b57d0;color:#ffffff;border:none;box-shadow:0 1px 2px rgba(0,0,0,0.25);';
      retryBtn.innerHTML = `
        <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" style="flex-shrink:0;">
          <path d="M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z"/>
        </svg>
        <span>Retry</span>
      `;
      retryBtn.onmouseenter = () => { retryBtn.style.background = '#1b6ef3'; };
      retryBtn.onmouseleave = () => { retryBtn.style.background = '#0b57d0'; };

      retryBtn.onclick = (e) => {
        e.stopPropagation();
        e.preventDefault();
        console.log('[Antigravity 2.0] Retry button clicked!');

        // 1. Check if native error notification with "Retry" or "Try again" exists in DOM
        const nativeButtons = Array.from(document.querySelectorAll('button')).filter((b) => {
          if (b === retryBtn || b.id === '__ag_inline_retry_btn') return false;
          const txt = (b.innerText || b.textContent || '').trim();
          return txt === 'Retry' || txt === 'Try again';
        });
        if (nativeButtons.length > 0) {
          console.log('[Antigravity 2.0] Clicking native Retry button from error notification');
          nativeButtons[0].click();
          return;
        }

        // 2. Extract sendMessage from React Fiber
        const anchor = document.querySelector('[contenteditable="true"]') ||
                       document.querySelector('textarea') ||
                       sendBtn;
        let foundSend = null;
        if (anchor) {
          const key = Object.keys(anchor).find((k) => k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$'));
          let fiber = key ? anchor[key] : null;
          while (fiber) {
            if (fiber.memoizedProps && typeof fiber.memoizedProps.sendMessage === 'function') {
              foundSend = fiber.memoizedProps.sendMessage;
              break;
            }
            fiber = fiber.return;
          }
        }

        const cid = getActiveSessionId();
        if (foundSend && cid) {
          console.log('[Antigravity 2.0] Invoking sendMessage({ type: 7 }) via React Fiber for cascadeId:', cid);
          foundSend({ type: 7, cascadeId: cid });
          return;
        }

        // 3. Fallback: prompt "Continue" into input and click send
        const promptBox = document.querySelector('[contenteditable="true"]') || document.querySelector('textarea');
        if (promptBox) {
          console.log('[Antigravity 2.0] Fallback: injecting Continue into prompt box');
          promptBox.focus();
          if (promptBox.tagName === 'TEXTAREA' || promptBox.tagName === 'INPUT') {
            promptBox.value = 'Continue';
            promptBox.dispatchEvent(new Event('input', { bubbles: true }));
          } else {
            promptBox.innerText = 'Continue';
            promptBox.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: 'Continue' }));
          }
          setTimeout(() => {
            const currentSend = document.querySelector('button[data-testid="send-button"]') ||
                                document.querySelector('button[aria-label="Send message"]');
            if (currentSend) currentSend.click();
          }, 60);
        }
      };
    }

    // Ensure it is positioned to the right of the send button
    if (sendBtn && sendBtn.parentElement === container) {
      if (sendBtn.nextSibling !== retryBtn) {
        container.insertBefore(retryBtn, sendBtn.nextSibling);
      }
    } else if (!container.contains(retryBtn)) {
      container.appendChild(retryBtn);
    }
  }

  // --- Message Suggestion Pills Bar & Retry Button Configuration ---
  const DEFAULT_SUGGESTIONS = [
    { label: '/plan', text: '/plan ' },
    { label: 'Continue', text: 'Continue' },
    { label: 'Analyser et auditer', text: 'Analyser et auditer le code et les erreurs' },
    { label: 'Keep going', text: 'Keep going' },
    { label: 'Exécuter all steps', text: 'Exécuter toutes les étapes prévues' },
    { label: 'Next phase', text: 'Passer à la phase suivante (Next phase)' }
  ];

  let chatUiConfig = {
    retryButton: true,
    suggestionPills: true,
    suggestions: DEFAULT_SUGGESTIONS
  };

  try {
    const rawStored = localStorage.getItem('ag_chat_ui_config');
    if (rawStored) {
      const parsed = JSON.parse(rawStored);
      if (parsed && typeof parsed === 'object') {
        chatUiConfig = {
          retryButton: parsed.retryButton !== undefined ? Boolean(parsed.retryButton) : true,
          suggestionPills: parsed.suggestionPills !== undefined ? Boolean(parsed.suggestionPills) : true,
          suggestions: Array.isArray(parsed.suggestions) && parsed.suggestions.length > 0 ? parsed.suggestions : DEFAULT_SUGGESTIONS
        };
      }
    }
  } catch (_) {}

  async function fetchChatUiConfig() {
    try {
      const res = await fetch(`${LOCAL_PROXY_ORIGIN}/api/ui/config`);
      if (res.ok) {
        const data = await res.json();
        if (data && typeof data === 'object') {
          const next = {
            retryButton: data.retryButton !== undefined ? Boolean(data.retryButton) : true,
            suggestionPills: data.suggestionPills !== undefined ? Boolean(data.suggestionPills) : true,
            suggestions: Array.isArray(data.suggestions) && data.suggestions.length > 0 ? data.suggestions : DEFAULT_SUGGESTIONS
          };
          const changed = JSON.stringify(next) !== JSON.stringify(chatUiConfig);
          chatUiConfig = next;
          localStorage.setItem('ag_chat_ui_config', JSON.stringify(chatUiConfig));
          if (changed) {
            scheduleUpdate();
          }
        }
      }
    } catch (_) {}
  }

  fetchChatUiConfig();
  window.addEventListener('focus', () => { fetchChatUiConfig(); });
  setInterval(fetchChatUiConfig, 10000);

  function insertTextIntoPrompt(text, autoSubmit = false) {
    const promptBox = document.querySelector('[contenteditable="true"]');
    if (!promptBox) return;

    const key = Object.keys(promptBox).find((k) => k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$'));
    let fiber = key ? promptBox[key] : null;
    let editor = null;
    while (fiber) {
      if (fiber.memoizedProps && fiber.memoizedProps.editor) {
        editor = fiber.memoizedProps.editor;
        break;
      }
      fiber = fiber.return;
    }

    if (editor && editor._nodes) {
      const TextNode = editor._nodes.get('text')?.klass;
      if (TextNode) {
        editor.update(() => {
          const state = editor._pendingEditorState || editor._editorState;
          const root = state ? state._nodeMap.get('root') : null;
          if (root) {
            root.clear();
            const sel = root.selectEnd();
            sel.insertNodes([new TextNode(text)]);
          }
        });
        editor.focus();

        if (autoSubmit) {
          setTimeout(() => {
            const sendBtn = document.querySelector('button[data-testid="send-button"]') ||
                            document.querySelector('button[aria-label="Send message"]');
            if (sendBtn) sendBtn.click();
          }, 80);
        }
        return;
      }
    }

    // Fallback: execCommand / input event
    promptBox.focus();
    try {
      const sel = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(promptBox);
      sel.removeAllRanges();
      sel.addRange(range);
      document.execCommand('insertText', false, text);
    } catch (_) {
      promptBox.innerText = text;
      promptBox.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
    }

    if (autoSubmit) {
      setTimeout(() => {
        const sendBtn = document.querySelector('button[data-testid="send-button"]') ||
                        document.querySelector('button[aria-label="Send message"]');
        if (sendBtn) sendBtn.click();
      }, 80);
    }
  }

  function injectSuggestionPills() {
    let bar = document.getElementById('__ag_suggestion_pills_bar');
    if (chatUiConfig.suggestionPills === false) {
      if (bar) bar.remove();
      return;
    }

    let inputCard = document.querySelector('#antigravity\\.agentSidePanelInputBox') ||
                    document.querySelector('.relative.flex.flex-col.p-px.rounded-2xl.bg-card-border');
    if (!inputCard) {
      const promptBox = document.querySelector('[contenteditable="true"]') || document.querySelector('textarea');
      if (promptBox) {
        inputCard = promptBox.closest('.relative.flex.flex-col.p-px') ||
                    promptBox.closest('.rounded-2xl') ||
                    promptBox.closest('[class*="rounded"]') ||
                    promptBox.parentElement?.parentElement?.parentElement?.parentElement ||
                    promptBox.parentElement?.parentElement;
      }
    }
    if (!inputCard || !inputCard.parentElement) return;

    if (!bar) {
      bar = document.createElement('div');
      bar.id = '__ag_suggestion_pills_bar';
    }

    if (!document.getElementById('__ag_pills_style')) {
      const st = document.createElement('style');
      st.id = '__ag_pills_style';
      st.textContent = '#__ag_suggestion_pills_bar::-webkit-scrollbar { display: none !important; width: 0 !important; height: 0 !important; }';
      (document.head || document.documentElement).appendChild(st);
    }

    bar.style.cssText = 'display:flex;align-items:center;flex-wrap:nowrap;gap:6px;padding:4px 2px 6px 2px;width:100%;max-width:100%;box-sizing:border-box;user-select:none;z-index:5;overflow-x:auto;overflow-y:hidden;scrollbar-width:none;-webkit-overflow-scrolling:touch;scroll-behavior:smooth;';

    if (!bar.__ag_wheel_attached) {
      bar.__ag_wheel_attached = true;
      bar.addEventListener('wheel', (e) => {
        if (e.deltaY !== 0) {
          e.preventDefault();
          bar.scrollLeft += e.deltaY;
        }
      }, { passive: false });
    }

    const currentSuggestions = Array.isArray(chatUiConfig.suggestions) && chatUiConfig.suggestions.length > 0
      ? chatUiConfig.suggestions
      : DEFAULT_SUGGESTIONS;

    const signature = JSON.stringify(currentSuggestions);
    if (bar.dataset.suggestionsSignature !== signature) {
      bar.dataset.suggestionsSignature = signature;
      bar.innerHTML = '';
      currentSuggestions.forEach((sug) => {
        const pill = document.createElement('button');
        pill.type = 'button';
        pill.className = '__ag_suggestion_pill';
        pill.setAttribute('data-ag-suggestion', sug.text);
        pill.title = `Insérer: "${sug.text}"`;
        pill.style.cssText = 'display:inline-flex;align-items:center;gap:4px;padding:3px 10px;border-radius:12px;font-size:11.5px;font-weight:500;font-family:system-ui,-apple-system,sans-serif;color:rgba(255,255,255,0.85);background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.12);cursor:pointer;transition:all 0.15s ease-in-out;backdrop-filter:blur(4px);white-space:nowrap;flex-shrink:0;';

        pill.innerHTML = `
          <span style="opacity:0.65;font-size:10px;">✦</span>
          <span>${sug.label}</span>
        `;

        pill.onmouseenter = () => {
          pill.style.background = 'rgba(255,255,255,0.14)';
          pill.style.borderColor = 'rgba(255,255,255,0.25)';
          pill.style.color = '#ffffff';
          pill.style.transform = 'translateY(-1px)';
        };
        pill.onmouseleave = () => {
          pill.style.background = 'rgba(255,255,255,0.06)';
          pill.style.borderColor = 'rgba(255,255,255,0.12)';
          pill.style.color = 'rgba(255,255,255,0.85)';
          pill.style.transform = 'translateY(0)';
        };

        pill.onclick = (e) => {
          e.stopPropagation();
          e.preventDefault();
          insertTextIntoPrompt(sug.text, false);
        };

        bar.appendChild(pill);
      });
    }

    if (inputCard.previousElementSibling !== bar) {
      inputCard.parentElement.insertBefore(bar, inputCard);
    }
  }

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
        injectRetryButton();
        injectSuggestionPills();
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
