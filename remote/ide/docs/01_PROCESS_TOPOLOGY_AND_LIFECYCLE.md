# 01. Topologie des Processus & Cycle de Vie : Antigravity IDE

> **Architecture Système & Arbre des Processus**

---

## 1. Arbre des Processus Windows

```text
Antigravity IDE.exe (Processus Maître Electron / GUI) [PID ~18420]
  ├── crashpad-handler.exe (Surveillance des plantages natifs)
  ├── Antigravity IDE.exe --type=gpu-process (Rendu matériel UI)
  ├── Antigravity IDE.exe --type=utility (Services réseau / Webview)
  ├── Antigravity IDE.exe --type=renderer (Workbench VS Code React)
  └── Antigravity IDE.exe (Extension Host Node.js) [PID ~21524]
        └── language_server_windows_x64.exe (Moteur IA Go) [PID ~25868]
              ├── conhost.exe (Console I/O)
              └── cmd.exe / powershell.exe (Sous-processus lancés par run_command)
```

---

## 2. Arguments CLI Réels à l'Instanciation

```bash
language_server_windows_x64.exe \
  --enable_lsp \
  --csrf_token aca2a2fd-f0e6-4053-931e-a28accf6f5f2 \
  --extension_server_port 55408 \
  --extension_server_csrf_token e9e2fc80-773d-43b5-948d-12e54eed289d \
  --workspace_id 88586e912ee4f8302896f417573e35e4587442bfc3f0c2f3a20687eb270c44b9 \
  --cloud_code_endpoint http://localhost:51074 \
  --subclient_type ide \
  --app_data_dir antigravity-ide \
  --parent_pipe_path \\.\pipe\server_75dfb5b409568f4e
```

---

## 3. Communication par Named Pipes (`\\.\pipe\server_*`)
- L'Extension Host crée un tube nommé bidirectionnel Windows (`parent_pipe_path`).
- En cas de fermeture brutale de la fenêtre Electron, la rupture du tube notifie immédiatement `language_server_windows_x64.exe` qui s'éteint proprement sous 500 ms sans laisser de processus zombie.
