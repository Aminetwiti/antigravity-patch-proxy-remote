# ag-doctor-ui

Premium Electron desktop wrapper for the [`ag-doctor`](../ag-doctor) CLI.
Glassmorphism · dark mode · smooth animations.

## Architecture

```
ag-doctor-ui/
├── package.json
├── tsconfig.json
├── scripts/copy-assets.js     # copies HTML/CSS to dist/
├── src/
│   ├── main.ts                # Electron main process (BrowserWindow, IPC, child_process)
│   ├── preload.ts             # contextBridge whitelist
│   └── renderer/
│       ├── index.html         # Single-page UI
│       ├── styles.css         # Design system (tokens + components)
│       └── app.ts             # Vanilla TS controller
└── assets/
    └── icon.svg
```

## Develop

```bash
cd ag-doctor-ui
npm install
npm run build
npm start
```

The build step compiles TypeScript with `tsc` and then copies `index.html` /
`styles.css` to `dist/renderer/`. The Electron app loads from `dist/`.

## How it talks to the CLI

The main process spawns the CLI as a child process via `child_process.spawn`:

```ts
spawn(process.execPath, [cliPath, ...args], {
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
});
```

`ELECTRON_RUN_AS_NODE=1` makes the Electron binary behave as plain Node.js,
so the CLI runs without any Electron dependencies.

The renderer never touches the filesystem directly — it only calls the
preload bridge (`window.ag`), which forwards every call to the main process
through whitelisted IPC channels:

| Channel           | Purpose                                |
| ----------------- | -------------------------------------- |
| `ag:run`          | Run a CLI command, return stdout/stderr |
| `ag:stream:start` | Start a streaming command (e.g. `logs -f`) |
| `ag:stream:cancel`| Cancel an active stream                |
| `ag:info`         | Get Electron/Node/CLI info             |
| `ag:open-external`| Open URL in default browser            |
| `ag:reveal`       | Reveal a file in OS file manager       |

## Security

- `contextIsolation: true`
- `nodeIntegration: false`
- `sandbox: true`
- Strict CSP (no inline scripts, only whitelisted font sources)
- All navigation outside `file:` is blocked and routed to the browser

## Package

```bash
npm run dist     # builds + electron-builder (nsis / dmg / AppImage)
npm run pack     # unpacked build for testing
```
