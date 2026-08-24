# 16. Protocole MCP (Model Context Protocol) & Serveurs Outils

> **Intégration des Outils Externes et Services Tiers**

---

## 1. Schéma de Configuration (`mcp_config.json`)

```json
{
  "mcpServers": {
    "coolify": {
      "command": "node",
      "args": ["C:/Users/amine/.gemini/antigravity/mcp/coolify/index.js"],
      "env": {
        "COOLIFY_API_URL": "http://62.169.27.8:8000"
      },
      "tools": {
        "list_servers": { "eager": true },
        "deploy_application": { "background": "always" }
      }
    }
  }
}
```

---

## 2. Modes d'Outils
- **`eager: true`** : Outil injecté en permanence dans le schéma des outils disponibles.
- **`background: "always"`** : Outil exécuté en tâche de fond asynchrone sans bloquer l'agent.
- **`disabledTools`** : Liste noire d'outils désactivés pour des raisons de sécurité.
