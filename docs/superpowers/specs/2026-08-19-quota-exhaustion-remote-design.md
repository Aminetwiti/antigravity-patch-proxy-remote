# Spécification Technique : Gestion des Quotas Épuisés sur Antigravity Remote

**Date** : 2026-08-19  
**Auteur** : Antigravity Core Team  
**Statut** : Validé  

---

## 1. Contexte & Objectif

Dans l'IDE Antigravity Desktop, lorsqu'un modèle atteint la limite de quota utilisateur (ou de capacité), l'interface affiche :
1. **Un message d'erreur enrichi** dans la conversation (*"Error: Individual quota reached... Resets in 2h14m11s."* avec l'*Error ID*).
2. **Une bannière persistante et actionnable** juste au-dessus de la barre de saisie (*"Baseline model quota reached"*, date de reset, boutons `[Dismiss]`, `[See Plans]`, `[Switch Model / Enable Overages]`).

L'objectif de cette spécification est de reproduire fidèlement cette logique et ce design 1:1 dans **Antigravity Remote** (application mobile Flutter et daemon Go).

---

## 2. Architecture & Composants

```
┌──────────────────────────────────────────────────────────────┐
│  Language Server / Daemon Go (ConnectRPC / WebSocket)        │
└──────────────────────────────┬───────────────────────────────┘
                               │  stream_end (outcome: "error", error: "...")
                               │  quota_update { weeklyPercent: 100, ... }
                               ▼
┌──────────────────────────────────────────────────────────────┐
│  Flutter Mobile App (ChatStreamScreen)                       │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ 1. Chat Stream Bubble                                  │  │
│  │    • Icone d'alerte & Message d'erreur formaté         │  │
│  │    • Horodatage / Compte à rebours de reset            │  │
│  │    • Error ID copiable                                 │  │
│  │    • Bouton d'action rapide : "Changer de modèle"      │  │
│  └────────────────────────────────────────────────────────┘  │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ 2. QuotaBannerCard (Au-dessus de la barre de saisie)   │  │
│  │    • En-tête : [Icone] Baseline model quota reached     │  │
│  │    • Texte : Your plan's baseline quota will refresh...│  │
│  │    • Actions : [Ignorer] [Forfaits] [Changer de modèle]│  │
│  └────────────────────────────────────────────────────────┘  │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ 3. ChatInputBar                                        │  │
│  │    • Sélecteur de modèle réactif (Switch instantané)   │  │
│  └────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────┘
```

---

## 3. Spécifications Détaillées des Composants

### 3.1 Détection des Erreurs de Quota
Une erreur est classée comme dépassement de quota si :
- Le message d'erreur contient :
  - `Individual quota reached`
  - `Baseline model quota reached`
  - `quota exceeded` / `insufficient_quota`
  - `RESOURCE_EXHAUSTED` / `MODEL_CAPACITY_EXHAUSTED`
  - `HTTP 402` / `HTTP 429`
  - `Resets in` / `will refresh on`
- Ou si les pourcentages de quotas remontés par `quota_update` ou `get_quota_summary` atteignent 100%.

### 3.2 Composant Bannière `QuotaBannerCard` (`lib/widgets/quota_banner_card.dart`)
- **Design Tokens (1:1 Antigravity Desktop)** :
  - Background : `Color(0xFF191A1E)` (Dark mode 95% opacity) avec effet d'élévation `boxShadow`.
  - Bordure : `1px solid rgba(255, 255, 255, 0.12)`.
  - Rayon de courbure : `8px`.
  - Padding : `14px 16px`.
- **En-tête** :
  - Icône rectangulaire stylisée `Icons.error_outline_rounded` (couleur gris métallisé `#9DA5B4` / rose danger `#FCA5A5`).
  - Titre gras : `"Baseline model quota reached"` (ou *"Quota de modèle atteint"*).
- **Corps de texte** :
  - Message dynamique incluant la date/heure de réinitialisation extraite ou formatée :
    *"Your plan's baseline quota will refresh on [date/reset]. You can switch to a custom model or upgrade your plan to continue."*
- **Boutons d'actions** :
  - `[Ignorer / Dismiss]` : masque la bannière pour la session en cours.
  - `[Forfaits / See Plans]` : ouvre le volet des quotas et crédits (`ModelsSettingsSection`).
  - `[Changer de modèle / Switch Model]` : bouton bleu primaire (`#007ACC` / `Theme.primary`) ouvrant directement la sélection de modèle dans la barre de saisie.

### 3.3 Bulle de Message d'Erreur Quota dans le Flux de Chat
- Affichage dans `chat_stream_screen.dart` :
  - Détection dédiée pour afficher un conteneur stylisé rouge/bordeaux foncé (`Color(0xFF1E1214)` et bordure `Color(0xFF5C1D24)`).
  - Ligne de statut avec icône d'alerte rouge.
  - Texte explicatif de l'erreur avec mention du temps restant pour la réinitialisation.
  - Ligne discrète contenant l'*Error ID* avec bouton de copie rapide.
  - Action inline : bouton puce permettant de basculer instantanément de modèle.

### 3.4 Intégration dans `ChatStreamScreen`
- Ajout de l'état `_quotaAlertInfo` (non-null dès qu'une erreur de quota survient ou qu'un seuil critique est atteint).
- Positionnement du `QuotaBannerCard` directement au-dessus du `ChatInputBar` dans la colonne principale.
- Liaison de l'action `onSwitchModel` pour déclencher l'ouverture du sélecteur de modèles de `ChatInputBar`.

---

## 4. Plan de Tests & Vérification

1. **Tests Unitaires Flutter (`remote/mobile/test/`)** :
   - Test de parsing et détection des patterns d'erreur de quota (`Individual quota reached`, `Resets in 2h...`, `Error ID`).
   - Test de rendu du widget `QuotaBannerCard` (titre, message, callbacks de boutons).
   - Test du comportement de masquage lors du tap sur `Dismiss`.
   - Test du déclenchement du sélecteur de modèle sur tap `Switch Model`.
2. **Tests d'Intégration Flux de Chat** :
   - Simulation d'une réponse de stream avec erreur de quota (`stream_end` avec message d'erreur).
   - Vérification de l'affichage simultané de la carte d'erreur dans la liste des messages et de la bannière au-dessus de la saisie.
3. **Validation Globale** :
   - `flutter analyze` dans `remote/mobile` (0 avertissements).
   - `flutter test --exclude-tags=live` (tous les tests passent).

---

## 5. Résumé de l'Impact
- **Fichiers Créés / Modifiés** :
  - `[NEW]` `remote/mobile/lib/widgets/quota_banner_card.dart`
  - `[MODIFY]` `remote/mobile/lib/features/chat_stream/chat_stream_screen.dart`
  - `[MODIFY]` `remote/mobile/lib/widgets/chat_input_bar.dart` (méthode publique / callback pour ouvrir le sélecteur)
  - `[NEW]` `remote/mobile/test/quota_banner_card_test.dart`
- **Dépendances** : Aucune nouvelle dépendance. Réutilisation stricte des composants et tokens existants.
