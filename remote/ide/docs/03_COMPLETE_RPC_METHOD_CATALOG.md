# 03. Catalogue Exhaustif des Méthodes ConnectRPC (200+ RPCs)

> **Tableau de Référence du Service `exa.language_server_pb.LanguageServerService`**

---

## 1. Cycle de Vie des Sessions (Cascade)
- `StartCascade` : Instanciation de session (`workspace_uri`, `project_id`, `model_uid`).
- `GetAllCascadeTrajectories` : Liste des sessions (Hub).
- `GetCascadeTrajectory` : Historique complet structuré par étapes.
- `DeleteCascadeTrajectory` : Suppression définitive.
- `ForkConversation` : Création d'une branche alternative à partir d'un step donné.
- `RevertToCascadeStep` : Rollback des modifications de code jusqu'à une étape antérieure.
- `CancelCascadeInvocation` : Interruption immédiate du tour en cours.
- `SetBrowserOpenConversation` : Commande d'ouverture dans le panneau de l'IDE.

---

## 2. Streaming & Modèles LLM
- `SendUserCascadeMessage` : Envoi du prompt avec streaming des réponses et des outils.
- `GetAvailableModels` : Liste des modèles IA injectés par le proxy.
- `RetrieveUserQuotaSummary` : Quota de tokens et statut de facturation.
- `GetUserStatus` : Statut du compte utilisateur et niveau de plan (Pro/Ultra).

---

## 3. Système de Fichiers & Git
- `ReadFile` / `WriteFile` : E/S sécurisées confinées au workspace.
- `GetVersionControlState` : État Git temps réel (branche, modified, staged).
- `GitStage` / `GitUnstage` / `GitDiscard` : Gestion granulaire du repository.
- `GetTurnDiff` : Calcul du diff prévisionnel et appliqué pour une étape.
