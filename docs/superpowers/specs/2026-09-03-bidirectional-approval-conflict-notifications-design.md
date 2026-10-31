# Spécification Technique : Notifications Bidirectionnelles de Résolution d'Approbation & Gestion des Conflits

**Date** : 2026-09-03  
**Auteur** : Antigravity Core Team  
**Statut** : Validé  

---

## 1. Contexte & Objectif

Dans l'écosystème **Antigravity Remote**, l'utilisateur peut interagir simultanément depuis son environnement Desktop (IDE sur PC) et son application Mobile (compagnon sur smartphone).

Lorsqu'une approbation (commande shell, outil MCP, permission de fichier, accès web, etc.) ou une question interactive (`ask_question`) est demandée par l'agent :
1. L'action peut être validée ou refusée indifféremment sur le PC ou sur le téléphone.
2. Lorsqu'un côté résout l'action, l'autre côté doit être immédiatement informé visuellement pour éviter toute confusion ou conflit de décision.
3. En cas d'action concurrente simultanée (Desktop et Mobile agissant au même instant), le système doit arbitrer sans blocage et prévenir les deux terminaux.

Cette spécification définit :
- **Sur Mobile** : Une bannière flottante discrète (Floating Pill / SnackBar style "Quiet Console") prévenant de la résolution par le PC ou de l'arbitrage d'un conflit.
- **Sur Desktop** : Une notification d'action à distance (notification système Windows et log structuré) indiquant que l'action a été arbitrée depuis le mobile.

---

## 2. Architecture & Flux de Données

```
                     ┌────────────────────────────────────────┐
                     │      Language Server Antigravity       │
                     │         (Processus Go :27208)          │
                     └───────────────────┬────────────────────┘
                                         │ gRPC-Web ConnectRPC
                                         ▼
                     ┌────────────────────────────────────────┐
                     │          Daemon Bridge (:8091)         │
                     │  - Arbitrage des conflits de course    │
                     │  - Broadcast WebSocket bidirectionnel  │
                     └───────────────┬────────────────▲───────┘
                                     │                │
            approval_resolved        │                │ submit_approval
     (source: "desktop"|"remote")    │                │ (allow/deny, deviceId)
                                     ▼                │
                     ┌────────────────────────────────┴───────┐
                     │      Application Mobile Flutter        │
                     │       (Samsung Galaxy S21 FE)          │
                     │  - Floating Resolution Banner          │
                     │  - Fermeture immédiate de la carte     │
                     └────────────────────────────────────────┘
```

---

## 3. Spécification Détaillée Côté Mobile (`remote/mobile`)

### 3.1 Déclencheur & Événement WebSocket
À la réception du message `approval_resolved` dans `chat_stream_screen.dart` :
```json
{
  "type": "approval_resolved",
  "cascadeId": "casc-123",
  "data": {
    "cascadeId": "casc-123",
    "decision": "allow",
    "approvalType": "run_command",
    "source": "desktop"
  }
}
```

### 3.2 Composant UI : `FloatingResolutionBanner`
- **Emplacement** : Flottant au sommet du viewport de chat (sous la barre d'outils et au-dessus des bulles de messages) pour une visibilité immédiate sans recouvrir la zone de saisie.
- **Design Tokens ("Quiet Console")** :
  - Fond : `AppColors.surfaceCard` avec bordure `AppColors.borderSubtle`.
  - Typographie : Monospace pour le type d'action, font-weight 600.
  - Icône : `Icons.desktop_windows_outlined` (couleur `AppColors.accentBlueBright` ou `AppColors.inkSecondary`).
  - Animation : Slide-in doux (200ms ease-out) $\rightarrow$ affichage 3 secondes $\rightarrow$ Fade-out automatique.
- **Variantes de Texte** :
  1. **Résolution Normale Desktop** :
     - Si validé sur PC : `💻 Action approuvée sur le PC (run_command)`
     - Si refusé sur PC : `💻 Action refusée sur le PC (run_command)`
  2. **Collision Concurrentielle (Race Condition évité)** :
     - Si l'utilisateur mobile cliquait au même instant : `⚡ Conflit évité : action déjà arbitrée sur le PC`.

---

## 4. Spécification Détaillée Côté Desktop (`remote/daemon`)

### 4.1 Déclencheur & Résolution Mobile
Lorsque le mobile envoie `submit_approval` :
```json
{
  "type": "submit_approval",
  "cascadeId": "casc-123",
  "decision": "allow",
  "approvalType": "mcp_tool",
  "command": "coolify/get_application"
}
```
1. Le Daemon valide la requête auprès du Language Server.
2. Le Daemon émet une notification locale Windows (via `notification.Notify` ou commande PowerShell non-bloquante) :
   - **Titre** : `Antigravity Remote (Mobile)`
   - **Message** : `Action "coolify/get_application" autorisée à distance.`
3. Le Daemon diffuse sur le WebSocket `approval_resolved` avec `"source": "remote"` pour que tout client Desktop ou observateur connecté mette à jour son interface.

---

## 5. Gestion des Conflits de Concurrence

1. **Course Critique (Race Condition)** :
   - Le Daemon applique un verrou atomique `s.clearApproval(cascadeID)`.
   - Le premier événement enregistré (Desktop via `!u.WaitingForInput` ou Mobile via `submit_approval`) gagne.
   - Toute soumission ultérieure pour la même `cascadeID` est immédiatement rejetée avec l'indication `"already_resolved"`, déclenchant l'alerte de conflit évité sans causer d'erreur fatale.
2. **Expiration Simultanée** :
   - Si le compte à rebours expire avant que le paquet d'approbation arrive, la garde de fraîcheur refuse la validation et maintient la sécurité de l'hôte.

---

## 6. Plan de Validation

1. **Test Unitaire Go** : Vérifier que le Daemon refuse poliment une deuxième approbation concurrente avec statut `"already_resolved"` et diffuse `approval_resolved`.
2. **Test Widget Flutter** : Vérifier l'apparition du `FloatingResolutionBanner` lors de la réception d'`approval_resolved` avec `source: "desktop"` et sa disparition au bout de 3 secondes.
3. **Test Matériel en Direct** : Déclencher une action sur l'IDE PC et observer l'apparition de la bannière sur le Galaxy S21 FE, puis inversement.
