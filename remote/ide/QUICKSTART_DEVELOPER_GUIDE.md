# ⚡ GUIDE DE DÉMARRAGE RAPIDE & CHEAT SHEET — ANTIGRAVITY IDE & REMOTE

> **Manuel Pratique pour Développeurs, Ingénieurs SRE et Utilisateurs Mobiles**  
> Tout ce dont vous avez besoin pour inspecter, contrôler et développer sur l'écosystème Antigravity IDE (VS Code v1.107.0) et Antigravity Remote.

---

## 🚀 1. Commandes Rapides du CLI `ag-ide`

Le binaire CLI universel est disponible sous [`remote/daemon/bin/ag-ide.exe`](../daemon/bin/ag-ide.exe).

```powershell
# Diagnostic de santé complet (IDE, Workspaces, SQLite, Proxy)
.\remote\daemon\bin\ag-ide.exe doctor

# Lister les instances actives et leurs ports ConnectRPC dynamiques
.\remote\daemon\bin\ag-ide.exe instances

# Afficher les 10 workspaces configurés et le projet actif
.\remote\daemon\bin\ag-ide.exe workspaces

# Lister les 140+ sessions de chat persistées avec nombre d'étapes
.\remote\daemon\bin\ag-ide.exe sessions

# Inspecter l'historique détaillé et les tool calls d'une session
.\remote\daemon\bin\ag-ide.exe view <cascade-id>

# Forcer la fenêtre desktop d'Antigravity IDE à s'ouvrir sur une session
.\remote\daemon\bin\ag-ide.exe focus <cascade-id>

# Créer une nouvelle session pour un workspace spécifique
.\remote\daemon\bin\ag-ide.exe create "c:\chemin\vers\mon-projet" "gemini-2.5-flash"

# Envoyer un prompt et streamer la pensée et la réponse en direct dans le terminal
.\remote\daemon\bin\ag-ide.exe chat <cascade-id> "Explique-moi l'architecture du projet"
```

---

## 🌐 2. Lancement du Pont Distant (Daemon Go Bridge)

Le Daemon Go assure le pont WebSocket multiplexé pour l'application compagnon mobile Flutter :

```powershell
cd remote\daemon

# Lancement standard avec découverte automatique
go run main.go --port 8090 --auth-token secret123

# Lancement avec tunnel Cloudflare automatique pour accès 4G/5G
go run main.go --port 8090 --tunnel cloudflare --auth-token secret123
```

---

## 📱 3. Application Compagnon Mobile (Flutter)

```powershell
cd remote\mobile

# Exécuter l'analyse statique Dart
flutter analyze

# Lancer la suite de 678 tests unitaires & d'isolation multi-sessions
flutter test --exclude-tags=live

# Lancer l'application sur smartphone Android connecté
flutter run -d <device-id>
```

---

## 🛡️ 4. Validation des Tests de Non-Régression (3 Piles)

Pour valider l'intégrité de l'ensemble du projet :

```powershell
# 1. Desktop Proxy & Translators (Vitest - 1475 tests)
npm run lint && npm test && npm run build

# 2. Daemon Go Bridge & Découverte IDE (Go - 100% tests)
cd remote\daemon && go test -v ./pkg/ide ./pkg/gateway

# 3. Mobile Companion (Flutter - 678 tests)
cd ..\mobile && flutter test --exclude-tags=live
```

---

## 📚 5. Index des 10 Spécifications Maîtresses

Pour approfondir chaque dimension de l'écosystème :

| Niveau | Spécification Maîtresse | Focus Majeur |
|:---:|:---|:---|
| **V12** | [`ULTRA_V12_VULNERABILITY_ASSESSMENT_AND_HARDENING.md`](./ULTRA_V12_VULNERABILITY_ASSESSMENT_AND_HARDENING.md) | Sécurité défensive STRIDE, 20 constats CVSS v3.1, patchs et règles Semgrep. |
| **V11** | [`ULTRA_V11_EVOLUTION_ET_MATURITE_ECOSYSTEME.md`](./ULTRA_V11_EVOLUTION_ET_MATURITE_ECOSYSTEME.md) | Vision 2030, NPU Apple/Qualcomm, cryptographie post-quantique (ML-KEM) et DAO. |
| **V10** | [`ULTRA_V10_AUDIT_PRATIQUE_ET_CERTIFICATION.md`](./ULTRA_V10_AUDIT_PRATIQUE_ET_CERTIFICATION.md) | Attestation de production, conformité SOC2/ISO27001, charge 10k sessions et IRP. |
| **V9** | [`ULTRA_V9_ENCYCLOPEDIE_FORENSIQUE_COMPLETE.md`](./ULTRA_V9_ENCYCLOPEDIE_FORENSIQUE_COMPLETE.md) | Spécification formelle TLA+, preuves des invariants $I1$–$I15$ et $ID1$–$ID6$. |
| **V8** | [`ULTRA_V8_ADOPTION_AND_IMPACT.md`](./ULTRA_V8_ADOPTION_AND_IMPACT.md) | 5 Études de cas, productivité mesurée (+38%), onboarding 30 jours et GTM. |
| **V7** | [`ULTRA_V7_ENTERPRISE_PRODUCTION_READINESS.md`](./ULTRA_V7_ENTERPRISE_PRODUCTION_READINESS.md) | Packaging MSI/PKG/DEB, DLP temps réel, SSO SAML/OIDC et Multi-Tenancy. |
| **V6** | [`ULTRA_V6_VALIDATION_AND_IMPLEMENTATION.md`](./ULTRA_V6_VALIDATION_AND_IMPLEMENTATION.md) | 10 Prototypes Go (P1-P10), banc Chaos Testing (CT1-CT10) et Playbook SRE. |
| **V5** | [`ULTRA_V5_RESILIENCE_AND_EXTENSIBILITY.md`](./ULTRA_V5_RESILIENCE_AND_EXTENSIBILITY.md) | Résilience distribuée, Checkpoint S3/Raft, Replay WAL et Zero-Trust. |
| **V4** | [`ULTRA_V4_IDE_FORENSIC_VALIDATION.md`](./ULTRA_V4_IDE_FORENSIC_VALIDATION.md) | Preuves d'isolation multi-sessions et séparation événementielle. |
| **V3** | [`AUTONOMOUS_FORENSIC_AUDIT_REPORT.md`](./AUTONOMOUS_FORENSIC_AUDIT_REPORT.md) | Grand rapport forensique initial en 40 sections. |
