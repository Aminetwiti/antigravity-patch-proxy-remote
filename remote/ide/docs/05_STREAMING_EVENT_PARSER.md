# 05. Parseur d'Événements de Streaming & Deltas

> **Algorithme d'Extraction des Tokens & Événements en Direct**

---

## 1. Décomposition des Champs Protobuf

```go
func ParseFrameEvents(raw []byte, cascadeID string) []StreamEvent {
    fields := DecodeFields(raw)
    var events []StreamEvent
    for _, f := range fields {
        switch f.Num {
        case 5: // Text Delta
            events = append(events, StreamEvent{Kind: "text", Delta: string(f.Bytes)})
        case 6: // Thinking Delta
            events = append(events, StreamEvent{Kind: "thinking", Delta: string(f.Bytes)})
        case 7: // Tool Call Start
            events = append(events, parseToolCall(f.Bytes))
        case 8: // Tool Call Output
            events = append(events, parseToolOutput(f.Bytes))
        case 9: // Run Status
            events = append(events, StreamEvent{Kind: "status_update", Status: decodeStatus(f.Varint)})
        }
    }
    return events
}
```

---

## 2. Typologie des Événements Reçus par le Mobile
- `text` : Morceau de réponse textuelle destiné à l'affichage.
- `thinking` : Raisonnement interne à afficher dans le bloc accordéon rétractable.
- `approval_required` : Demande d'approbation affichant une carte avec boutons Valider/Refuser.
- `tool_output` : Résultat d'une commande shell ou d'une écriture de fichier.
