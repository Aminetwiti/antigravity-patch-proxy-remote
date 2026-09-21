# Security Policy

## Supported Versions

Only the latest major release of Google Antigravity Custom Model Proxy receives active security updates.

| Version | Supported |
|---|---|
| 3.x.x | :white_check_mark: |
| 2.x.x | :x: |
| < 2.0 | :x: |

---

## Security Architecture Overview

This project is built with security as a core priority:
- **Encryption at Rest**: Custom model API keys are encrypted using **AES-256-GCM** via Electron `safeStorage` (Windows DPAPI, macOS Keychain, Linux Secret Service).
- **Zero Remote Storage**: API keys and proxy configuration remain 100% local on your machine.
- **Header & Log Scrubbing**: Sensitive authorization tokens and CSRF headers are automatically masked in diagnostic logs.
- **Safe JSON Parsing**: Response stream parsing uses string-based state machines (`jsonRepair.ts`) with zero use of `eval()` or dynamic code evaluation.

---

## Reporting a Vulnerability

If you discover a security vulnerability within this project, please follow these steps:

1. **Do NOT open a public GitHub issue** for security vulnerabilities.
2. Report the vulnerability privately via GitHub Security Advisories or by contacting the repository maintainers directly.
3. Include detailed steps to reproduce the issue, environment information, and any proof-of-concept material.

### Response Timeline
- **Acknowledgement**: Within 48 hours.
- **Assessment & Patch**: Security fixes will be released as patch updates as quickly as possible.
