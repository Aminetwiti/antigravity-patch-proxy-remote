# 17. Implémentation de la Passerelle Daemon Go (`ide_gateway.go`)

> **Architecture Modulaire du Pont Serveur**

---

## 1. Structure du Package `pkg/gateway`

```go
package gateway

type IdeGateway struct {
    client    *connectrpc.Client
    port      int
    csrfToken string
    activeSession string
}

func NewIdeGateway(port int, csrfToken string) *IdeGateway {
    return &IdeGateway{
        client:    connectrpc.NewClient(port, csrfToken),
        port:      port,
        csrfToken: csrfToken,
    }
}
```

---

## 2. Handlers WebSocket
- `ide.list_workspaces` : Parse `%APPDATA%\Antigravity IDE\...\storage.json`.
- `ide.list_sessions` : Scanne `~/.gemini/antigravity-ide/brain/`.
- `ide.send_prompt` : Exécute `SendMessageStream` et pousse les événements JSON.
