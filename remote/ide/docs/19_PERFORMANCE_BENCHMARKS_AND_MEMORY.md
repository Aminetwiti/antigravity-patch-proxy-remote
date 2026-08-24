# 19. Métriques de Performance & Empreinte Mémoire

> **Benchmarks Comparatifs & Analyse des Ressources**

---

## 1. Empreinte RAM par Instance

| Composant | Consommation RAM Typique | Notes |
|:---|:---:|:---|
| `Antigravity IDE.exe` (Maître + GPU + Renderers) | ~450 Mo | Workbench VS Code complet |
| `language_server_windows_x64.exe` | ~85 Mo | Moteur Go léger au repos |
| Index vectoriel local (Embeddings SQLite) | +20 à 50 Mo | Selon le nombre de fichiers du workspace |
| Proxy Local `:51074` | ~35 Mo | Serveur proxy Node.js / Electron |
| Daemon Go Bridge `:8090` | ~18 Mo | Hub WebSocket et StepRecovery buffer |

---

## 2. Latences de Streaming
- **Temps jusqu'au 1er token (TTFT)** : ~240 ms (via Proxy local + Gemini Flash).
- **Débit de streaming** : ~45-60 tokens/seconde.
- **Délai de retransmission WebSocket vers Mobile** : < 5 ms en LAN local, ~35 ms via tunnel Cloudflare.
