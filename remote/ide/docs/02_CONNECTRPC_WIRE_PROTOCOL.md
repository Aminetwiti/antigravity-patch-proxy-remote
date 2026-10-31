# 02. Protocole Réseau ConnectRPC & Cadrage Wire Format

> **Spécification Binaire du Protocole gRPC-Web d'Antigravity IDE**

---

## 1. Cadrage gRPC-Web sur HTTP/1.1 & HTTP/2

Chaque trame transmise sur le flux HTTP possède un en-tête fixe de 5 octets :

```text
 0                   1                   2                   3
 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|     FLAGS     |                  LENGTH (L)                   |
|   (1 octet)   |              (4 octets Big-Endian)            |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                                                               |
+                        PAYLOAD PROTOBUF                       +
|                           (L octets)                          |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
```

### Table des Flags
| Valeur | Signification | Format du Payload |
|:---|:---|:---|
| `0x00` | Trame de données normale (`Data Frame`) | Message Protobuf sérialisé |
| `0x01` | Trame compressée (Gzip / Deflate) | Message Protobuf compressé |
| `0x80` | Trame de fin d'appel (`Trailer Frame`) | En-têtes HTTP de statut : `grpc-status: 0\r\ngrpc-message: ...` |

---

## 2. En-têtes HTTP Obligatoires

```http
POST /exa.language_server_pb.LanguageServerService/SendUserCascadeMessage HTTP/1.1
Host: 127.0.0.1:55432
Content-Type: application/grpc-web+proto
Accept: application/grpc-web+proto,application/grpc-web-text
x-codeium-csrf-token: aca2a2fd-f0e6-4053-931e-a28accf6f5f2
Connect-Protocol-Version: 1
X-Grpc-Web: 1
```
