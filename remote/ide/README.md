# 🛰️ Antigravity IDE Integration for Antigravity Remote

> **Dossier Central d'Architecture & de Rétro-Ingénierie pour Antigravity IDE**  
> Ce dossier rassemble l'ensemble des connaissances forensiques, des schémas réels, des protocoles réseau et des guides d'implémentation pour connecter **Antigravity IDE (VS Code v1.107.0)** au système **Antigravity Remote (Daemon Go + Mobile Flutter)**.

---

## 📑 Index Principal de la Documentation

| Fichier | Description & Contenu |
|:---|:---|
| [`DEEP_REVERSE_ENGINEERING_MASTER.md`](./DEEP_REVERSE_ENGINEERING_MASTER.md) | **Rapport Maître Exhaustif de Reverse Engineering** : Verdict complet, topologie binaire Go, 50 descripteurs Protobuf décodés, double canal de streaming, Unified State Sync (USS), concurrence et isolation multi-sessions. |
| [`ADVANCED_SYSTEMS_FORENSICS.md`](./ADVANCED_SYSTEMS_FORENSICS.md) | **Forensique Avancée des Sous-Systèmes** : Moteur d'exécution des outils, bac à sable (sandbox), persistance SQLite `dbtrajectory`, compaction de contexte et protocole thinking/reasoning. |
| [`STREAMING_PROTOCOL_SPEC.md`](./STREAMING_PROTOCOL_SPEC.md) | **Spécification Complète du Protocole de Streaming** : Les 8 canaux gRPC-Web/WebSocket, diagramme de séquence, gestion des tokens/thinking et StepRecovery buffer. |
| [`COMPLETE_PROTO_DESCRIPTORS.md`](./COMPLETE_PROTO_DESCRIPTORS.md) | **Descripteurs Protobuf Complets** : Reconstitution forensique exacte des fichiers `.proto` (`LanguageServerService`, `cortex.proto`, `jetbox_summaries.proto`, diffs, tools). |
| [`PROTOCOLS_AND_SCHEMAS.md`](./PROTOCOLS_AND_SCHEMAS.md) | Tous les protocoles (gRPC-Web, ConnectRPC, WebSocket, Named Pipes) et tous les schémas Protobuf & JSON décodés. |
| [`TECHNICAL_DATASHEETS.md`](./TECHNICAL_DATASHEETS.md) | 5 Fiches techniques de bas niveau : Wire format, bases SQLite `.db`, sécurité des outils, découverte zéro-port, et MCP. |
| [`COMPARISON_ANTIGRAVITY_2_VS_IDE.md`](./COMPARISON_ANTIGRAVITY_2_VS_IDE.md) | Comparatif technique approfondi entre Antigravity 2.0 (Classic Shell) et Antigravity IDE (VS Code Fork). |
| [`INTEGRATION_GUIDE.md`](./INTEGRATION_GUIDE.md) | Guide pratique pas-à-pas pour implémenter le support IDE dans le Daemon Go (`remote/daemon`) et l'application Mobile (`remote/mobile`). |

---

## 📁 Dossier Spécialisé des 20 Fiches Techniques (`docs/`)

Consultez le sous-dossier [`docs/`](./docs/) pour les 20 guides modulaires :
- [`01_PROCESS_TOPOLOGY_AND_LIFECYCLE.md`](./docs/01_PROCESS_TOPOLOGY_AND_LIFECYCLE.md)
- [`02_CONNECTRPC_WIRE_PROTOCOL.md`](./docs/02_CONNECTRPC_WIRE_PROTOCOL.md)
- [`03_COMPLETE_RPC_METHOD_CATALOG.md`](./docs/03_COMPLETE_RPC_METHOD_CATALOG.md)
- [`04_SESSION_TRAJECTORY_ENGINE.md`](./docs/04_SESSION_TRAJECTORY_ENGINE.md)
- [`05_STREAMING_EVENT_PARSER.md`](./docs/05_STREAMING_EVENT_PARSER.md)
- [`06_SQLITE_PERSISTENCE_INTERNALS.md`](./docs/06_SQLITE_PERSISTENCE_INTERNALS.md)
- [`07_TRANSCRIPT_JSONL_SPECIFICATION.md`](./docs/07_TRANSCRIPT_JSONL_SPECIFICATION.md)
- [`08_CONTEXT_WINDOW_AND_CHECKPOINTS.md`](./docs/08_CONTEXT_WINDOW_AND_CHECKPOINTS.md)
- [`09_TOOL_EXECUTION_AND_SANDBOXING.md`](./docs/09_TOOL_EXECUTION_AND_SANDBOXING.md)
- [`10_ASK_QUESTION_INTERACTION_FLOW.md`](./docs/10_ASK_QUESTION_INTERACTION_FLOW.md)
- [`11_DYNAMIC_PORT_AND_CSRF_DISCOVERY.md`](./docs/11_DYNAMIC_PORT_AND_CSRF_DISCOVERY.md)
- [`12_WORKSPACE_AND_STORAGE_REGISTRY.md`](./docs/12_WORKSPACE_AND_STORAGE_REGISTRY.md)
- [`13_NATIVE_CLI_AUTOMATION.md`](./docs/13_NATIVE_CLI_AUTOMATION.md)
- [`14_RULES_AND_CUSTOMIZATIONS_ENGINE.md`](./docs/14_RULES_AND_CUSTOMIZATIONS_ENGINE.md)
- [`15_WORKFLOWS_AND_SLASH_COMMANDS.md`](./docs/15_WORKFLOWS_AND_SLASH_COMMANDS.md)
- [`16_MCP_PROTOCOL_AND_SERVER_BRIDGE.md`](./docs/16_MCP_PROTOCOL_AND_SERVER_BRIDGE.md)
- [`17_DAEMON_GATEWAY_IMPLEMENTATION.md`](./docs/17_DAEMON_GATEWAY_IMPLEMENTATION.md)
- [`18_FLUTTER_MOBILE_CLIENT_INTEGRATION.md`](./docs/18_FLUTTER_MOBILE_CLIENT_INTEGRATION.md)
- [`19_PERFORMANCE_BENCHMARKS_AND_MEMORY.md`](./docs/19_PERFORMANCE_BENCHMARKS_AND_MEMORY.md)
- [`20_FORENSIC_TROUBLESHOOTING_AND_ERRORS.md`](./docs/20_FORENSIC_TROUBLESHOOTING_AND_ERRORS.md)
