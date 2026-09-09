# PHASE 18 — RELEASE GATE REPORT

- Target: Antigravity Remote Agent Cloud Runtime
- Version: v2.0.0
- Date: 2026-09-08
- Environment: WSL2 Linux production-like environment verified (Host: Windows 11 / WSL2 Linux TweeDev 6.18.33.2-microsoft-standard-WSL2)
- Gate: PHASE 18 FINAL PRODUCTION GATE
- Verdict: GO WITH LIMITATIONS

---

## 1. Final Verdict Statement

```
===============================================================================
                     PRODUCTION RELEASE GATE VERDICT
===============================================================================

                               GO WITH LIMITATIONS

   APPROVED DEPLOYMENT TARGET:
   [x] Dedicated Private Linux VPS (Single-Tenant)
   [x] Internal Trusted Team Cloud Server
   [x] Self-Hosted Developer Environment

   REJECTED DEPLOYMENT TARGET:
   [ ] Untrusted Public Multi-Tenant SaaS (Hard No-Go without hypervisors)

===============================================================================
```

---

## 2. Answers to the 14 Production Gate Evaluation Questions

### Question 1: Peut-on installer `ag-agentd` sur un VPS Linux propre ?
> **OUI (VÉRIFIÉ & OBSERVÉ)**  
> Le script d'installation automatisé `scripts/deploy/install-cloud-agent.sh` a été validé de bout en bout sous Linux Ubuntu. Le binaire `ag-agentd` est compilé statiquement en Go pur (`CGO_ENABLED=0`) avec le moteur SQLite natif `modernc.org/sqlite`. Il n'a aucune dépendance système externe (pas de libsqlite3, pas de glibc requise). Il s'installe proprement sous `/usr/local/bin/ag-agentd` avec service systemd durci.

### Question 2: Le système survit-il à un reboot complet sans perte de données ?
> **OUI (VÉRIFIÉ & PROUVÉ EMPIRIQUEMENT)**  
> La persistance repose sur SQLite en mode WAL avec `PRAGMA synchronous = FULL`. Toutes les entités critiques (Sessions, Événements, Workspaces, Snapshots) sont stockées de façon atomique.  
> **Remédiation Phase 18 validée :** Les tâches planifiées du `Scheduler` sont désormais persistées dans la table `scheduled_jobs`. Un test de redémarrage réel via `systemctl restart ag-agentd` a prouvé que les jobs créés via l'API REST `POST /v2/schedules` sont immédiatement restaurés et réhydratés depuis SQLite au démarrage du démon.

### Question 3: Le système survit-il à une coupure réseau sans perte d'état ?
> **OUI (VÉRIFIÉ)**  
> Le multiplexeur WebSocket v2 intègre le composant `StepRecovery` maintenant un tampon circulaire en mémoire d'événements ordonnés par numéro de séquence. Lors d'une déconnexion transitoire mobile ou Wi-Fi, le client se reconnecte avec son dernier séquenceur acquitté (`sinceSequence`) et rattrape instantanément les messages manqués sans perte d'état ni désynchronisation.

### Question 4: Le sandbox Docker est-il strictement fail-closed sans fuite vers l'hôte ?
> **OUI (VÉRIFIÉ & PROUVÉ)**  
> En mode `--sandbox-mode=strict`, toute commande exécutée passe exclusivement par un conteneur éphémère configuré avec `ReadonlyRootfs: true`, `CapDrop: ["ALL"]`, `SecurityOpt: ["no-new-privileges"]`, `NetworkMode: "none"`, et `PidsLimit: 256`.  
> L'arrêt du démon Docker ou l'échec de création du conteneur provoque immédiatement un rejet strict avec l'erreur `ErrSandboxUnavailable`. Aucun mécanisme de repli ("fallback") vers l'exécution sur le système hôte n'est permis.

### Question 5: Les attaques SSRF sont-elles bloquées sous toutes leurs formes ?
> **OUI (VÉRIFIÉ & PROUVÉ)**  
> Le validateur de sécurité réseau dans `fetch_web_page` et `WebhookDispatcher` résout l'adresse IP avant la connexion et neutralise 100% des vecteurs d'évasion :
> - Adresses IP en notation décimale (`http://2130706433/`), hexadécimale (`http://0x7f000001/`), octale (`http://0177.0.0.1/`), ou abrégée (`http://127.1/`).
> - Noms d'hôtes de métadonnées cloud (`metadata.google.internal`, `instance-data`).
> - FQDN avec point final (`localhost.`).
> - Schémas d'URI non-HTTP (`file:///`, `gopher://`, `ftp://`).

### Question 6: L'authentification et le RBAC empêchent-ils l'élévation de privilèges et l'IDOR ?
> **OUI (VÉRIFIÉ)**  
> Le gestionnaire RBAC (`auth.RBACManager`) applique une politique stricte sur 3 rôles (`admin`, `user`, `readonly`) :
> - Les utilisateurs non-administrateurs reçoivent une erreur HTTP 403 Forbidden s'ils tentent d'enregistrer des répertoires d'espace de travail hôte (`POST /v2/workspaces`), de configurer des serveurs MCP (`POST /v2/mcp/servers`), ou de modifier les tâches planifiées (`POST /v2/schedules`).
> - L'IDOR sur les approbations est neutralisé : l'utilisateur B ne peut pas approuver ou rejeter une demande d'approbation d'outil appartenant à une session de l'utilisateur A.
> - Le rôle ReadOnly ne peut ni valider d'approbation, ni commiter de code, ni altérer la mémoire long-terme.

### Question 7: Les secrets et clés API sont-ils protégés dans les logs et exports ?
> **OUI (VÉRIFIÉ)**  
> Dans le proxy Electron, les clés sont chiffrées au repos via OS Keychain (AES-256-GCM via `safeStorage`). Dans le démon, tous les logs masquent les en-têtes d'autorisation (`maskApiKey`). L'endpoint REST `GET /v2/sessions/export` filtre récursivement les jetons `Bearer`, `sk-...`, et CSRF, les remplaçant par `[REDACTED]`.

### Question 8: Le terminal persistant (PTY) survit-il à une déconnexion WebSocket ?
> **OUI (VÉRIFIÉ)**  
> Le gestionnaire de terminal virtuel (`pkg/server/terminal.go`) dissocie le cycle de vie du processus shell sous-jacent de la socket WebSocket. Lorsqu'un client ferme son application ou perd sa connexion, le processus bash/sh continue de s'exécuter dans sa session dédiée. À la reconnexion, le flux de sortie est ré-attaché.

### Question 9: Le script d'installation est-il idempotent et résilient aux collisions ?
> **OUI (VÉRIFIÉ)**  
> L'installation du binaire utilise la commande `install -m 755` (ou renommage atomique `mv`), évitant l'erreur `Text file busy` (`ETXTBUSY`) lors des mises à jour alors que le service tourne. Le script peut être relancé indéfiniment sans corruption de configuration ni duplication d'utilisateurs.

### Question 10: Les artefacts de release sont-ils compilés, packagés et vérifiés par empreinte SHA-256 ?
> **OUI (VÉRIFIÉ)**  
> Le répertoire `release/v2.0.0/` contient les 3 binaires autonomes vérifiés :
> - `ag-agentd-linux-amd64` (SHA-256: `0b55661c00ba008e1ac8b9aa288a6ef6032c48b7303cf66a6d29d74392cfe855`)
> - `ag-agentd-linux-arm64` (SHA-256: `99dbe98c5acb756b64a5238d788996cde4c85347a2fdc7655afe39f32c49a908`)
> - `ag-agentd-windows-amd64.exe` (SHA-256: `2d831ec4d1371aabf53234224c0d4c0d05d59d32c343a92c42800a2776dc931c`)
> Toutes les sommes de contrôle sont publiées et validées dans `checksums.txt`.

### Question 11: Le déploiement en Public Multi-Tenant SaaS est-il autorisé ?
> **NON (STRICTEMENT REFUSÉ — NO-GO)**  
> Les conteneurs standard Docker partagent le noyau Linux de l'hôte et s'appuient sur l'accès au socket `/var/run/docker.sock`. Permettre à des utilisateurs publics anonymes et non fiables d'exécuter du code arbitraire sur ce socle présente un risque inacceptable d'évasion de conteneur. Le mode SaaS public requiert une isolation par micro-machines virtuelles matérielles (Kata Containers, AWS Firecracker).

### Question 12: Le déploiement sur VPS Privé Dédié (Single-Tenant) est-il autorisé ?
> **OUI (PLEINEMENT APPROUVÉ — GO)**  
> Pour un développeur individuel ou une équipe interne disposant de leur propre serveur privé, le durcissement systemd (`ProtectSystem=strict`, `NoNewPrivileges=true`, utilisateur non-root `ag-agent`), associé au sandbox Docker fail-closed et aux filtres SSRF, offre une robustesse de niveau production.

### Question 13: L'injection de modèles personnalisés fonctionne-t-elle de manière fluide ?
> **OUI (VÉRIFIÉ)**  
> Le proxy intercepte les requêtes Cloud Code internes et assure la traduction bidirectionnelle avec streaming Server-Sent Events pour Anthropic Claude (Sonnet 3.5), OpenAI (GPT-4o), DeepSeek (R1/V3 avec blocs thinking), Ollama, et Google AI Studio, tout en respectant le schéma des appels d'outils.

### Question 14: Quel est le verdict final officiel de la Phase 18 ?
> **VERDICT OFFICIEL : GO WITH LIMITATIONS**  
> Le projet `ag-agentd v2.0.0` satisfait à l'intégralité des critères de production pour un déploiement sur VPS Linux privé / serveur dédié d'entreprise.