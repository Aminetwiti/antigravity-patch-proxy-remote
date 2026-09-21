# Guide & Architecture : Antigravity Remote Agent (Modèle Claude Code Remote sur Serveur Privé)

Ce document détaille le fonctionnement, l'installation et l'utilisation du mode **Remote Cloud Agent** dans **Antigravity IDE**, calqué exactement sur l'architecture de **Claude Code Remote / Claude Code on the Web**.

---

## 1. La Vision & Le Problème Résolu

### Le comportement souhaité :
1. **En mode "Local" (Windows)** :
   - Antigravity travaille nativement sur vos projets locaux (ex: `structuba`, etc.).
   - Aucune injection de prompt, aucun appel vers le VPS, aucun risque d'exécuter des commandes Linux sur Windows.
2. **En mode "Remote" (Serveur Privé / VPS Ubuntu)** :
   - Antigravity se connecte au démon autonome `ag-agentd` qui s'exécute sur votre serveur distant (ex: `62.169.27.8`).
   - Vous lancez une mission (ex: refactorisation, audit de sécurité, exécution de tests Docker, migrations).
   - **Vous pouvez fermer Antigravity et éteindre complètement votre ordinateur.**
   - L'agent continue d'exécuter la tâche 24/7 sur le serveur distant dans son conteneur Docker et enregistre tous les événements dans sa base SQLite WAL.
   - Dès que vous rallumez votre PC (ou depuis votre smartphone / tablette via la console web), vous retrouvez l'avancement exact grâce au rattrapage automatique (`session.catchup`).

---

## 2. Schéma d'Architecture

```text
┌─────────────────────────────────────────────────────────────┐
│                    ANTIGRAVITY IDE (DESKTOP)                │
│                                                             │
│   [ Sélecteur d'Environnement (en bas à gauche) ]           │
│        │                                                    │
│        ├─► LOCAL :                                          │
│        │   • Antigravity Local Language Server (Windows)    │
│        │   • Fichiers locaux Windows (C:\Users\...)         │
│        │   • Isolation totale, 0 altération proxy           │
│        │                                                    │
│        └─► REMOTE (VPS Cloud Agent) :                       │
│            • Badge interactif "Runtime Agent Remote"        │
│            • Bouton "⚡ Console Cloud"                       │
│            • Bouton ">_ Terminal VPS"                       │
│            • Connexion WSS / HTTPS vers ag-agentd           │
└─────────────────────────────────────────────────────────────┘
                               ▲
                               │ WSS / HTTPS (/v2/ws, /v2/sessions)
                               ▼
┌─────────────────────────────────────────────────────────────┐
│             SERVEUR PRIVÉ DISTANT (UBUNTU VPS)              │
│                     ag-agentd v2.0.0                        │
│                                                             │
│   • Moteur Autonome (Goroutine loop)                        │
│   • Persistance SQLite WAL (Sessions & Trajectoires)        │
│   • Sandbox Docker Fail-Closed                              │
│   • Terminal PTY persistant (/v2/terminal)                  │
│   • Console Web autonome (/console)                         │
│   • Clés d'API autonomes (/etc/antigravity/ag-agentd.env)   │
│                                                             │
│   * Exécution continue 24/7 même avec le PC éteint *        │
└─────────────────────────────────────────────────────────────┘
```

---

## 3. Utilisation au Quotidien dans Antigravity IDE

### Étape 1 : Basculer entre Local et Remote
- En bas à gauche de la fenêtre de chat d'Antigravity IDE, cliquez sur le menu déroulant d'environnement :
  - **Local** : Vous développez en local sur Windows. Le chat utilise le moteur local standard.
  - **Remote** : Vous passez sur le serveur distant. La pastille verte `🟢 Runtime Agent Remote (VPS)` s'affiche au-dessus du champ de saisie.

### Étape 2 : Lancer une tâche autonome sur le serveur
1. Cliquez sur le bouton **`⚡ Console Cloud`** dans la pastille.
2. La fenêtre **Antigravity Remote Agent Cloud Runtime** s'ouvre.
3. Cliquez sur **`+ Nouvelle Mission`** :
   - Indiquez la consigne (ex: `Exécuter le build et corriger les tests unitaires`).
   - Choisissez le répertoire sur le VPS (ex: `/var/lib/antigravity/workspaces/default`).
   - Choisissez la sandbox : `Docker Sandbox (Fail-Closed, Sécurisé)`.
4. Cliquez sur **`🚀 Démarrer l'Agent Autonome`**.

### Étape 3 : Éteindre son PC en toute tranquillité
- Dès que la tâche est lancée, elle est gérée par le processus `ag-agentd` sur le VPS.
- **Vous pouvez fermer la fenêtre Antigravity et éteindre votre ordinateur.**
- L'agent distant continuera de lire les fichiers, d'exécuter les commandes dans Docker, de générer du code et de sauvegarder les diffs.

### Étape 4 : Suivre l'avancement ou se reconnecter
- **Au rallumage du PC** : Rouvrez Antigravity IDE, cliquez sur `⚡ Console Cloud` : la mission en cours ou terminée est listée avec l'historique complet rejoué automatiquement (`session.catchup`).
- **Depuis votre smartphone** : Ouvrez votre navigateur sur `https://<votre-domaine-ou-ip>/console?token=<votre-token>` pour suivre l'agent en direct et approuver d'éventuelles actions.

---

## 4. Installation sur un Nouveau Serveur Privé (Ubuntu / Debian)

Pour installer le runtime `ag-agentd` sur n'importe quel serveur Linux dédié ou VPS :

### Commande unique d'installation :
```bash
sudo bash -c "$(curl -fsSL https://raw.githubusercontent.com/Aminetwiti/antigravity-add-model-main/main/scripts/deploy/install-cloud-agent.sh)"
```
*(Ou en local sur votre serveur depuis le dépôt : `sudo bash scripts/deploy/install-cloud-agent.sh`)*

### Configuration des clés d'API autonomes :
Pour que l'agent sur le VPS puisse réfléchir et exécuter des étapes quand votre PC est éteint, configurez la clé du fournisseur IA de votre choix dans `/etc/antigravity/ag-agentd.env` :

```bash
sudo nano /etc/antigravity/ag-agentd.env
```

Ajoutez votre clé Claude (Anthropic), OpenAI ou votre endpoint Ollama :
```ini
ANTHROPIC_API_KEY=sk-ant-api03-...
# ou OPENAI_API_KEY=sk-proj-...
# ou OLLAMA_HOST=http://127.0.0.1:11434
```

Redémarrez ensuite le service :
```bash
sudo systemctl restart ag-agentd.service
```

---

## 5. Configuration dans Antigravity IDE Desktop

1. Dans la pastille `Runtime Agent Remote`, cliquez sur l'icône **`⚙️`**.
2. Renseignez :
   - **Hôte** : L'adresse IP ou le domaine HTTPS de votre serveur (ex: `https://agent.monserveur.com` ou `http://62.169.27.8:8090`).
   - **Auth Token** : La valeur de `AG_AUTH_TOKEN` définie dans `/etc/antigravity/ag-agentd.env`.
3. Cliquez sur **Tester la connexion** -> Le voyant vert `● En ligne (linux / ag-agentd v2.0.0)` confirme la liaison.
4. Cliquez sur **Sélectionner Runtime Remote**.

---

## 6. Vérification & Garanties Zéro-Régression

| Composant | Garantie Appliquée | Statut |
|---|---|:---:|
| **Workspace Local Windows** | Zéro altération de prompt, zéro instruction VPS injectée, aucun impact sur `structuba` | **GARANTI** |
| **Workspace Remote VPS** | Tâches exécutées dans `ag-agentd` (goroutines + Docker + SQLite) | **GARANTI** |
| **Survie à l'extinction du PC** | Démon Linux indépendant, persistance WAL, StepRecovery à la reconnexion | **GARANTI** |
| **Terminal Shell distant** | Terminal PTY temps réel (`>_ Terminal VPS`) | **GARANTI** |
| **Console Cloud intégrée** | Tableau de bord autonome intégré dans Antigravity IDE (`⚡ Console Cloud`) | **GARANTI** |
