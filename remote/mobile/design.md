# Antigravity 2.0 — Master Design System Specification

> Fiche Design System niveau développeur, directement exploitable pour Flutter, React et Tailwind. Reconstitution fidèle et rigoureuse du langage visuel d'Antigravity 2.0 (**"The Quiet Console"**).

---

## 1. Architecture du Design System

```text
design-system/
├── colors.json          # Surfaces sombres, bordures, encres et états
├── typography.json      # Google Sans / Flex / Mono et échelles
├── spacing.json         # Grille 4px et dimensions de layout
├── radius.json          # Échelle d'arrondis soft (6px, 8px, 12px, 16px)
├── shadows.json         # Élévations discrètes axées surfaces
├── icons.json           # Google Symbols / Material Icons
├── motion.json          # Durées et courbes d'animation
├── z-index.json         # Hiérarchie des couches d'élévation
├── components.json      # Spécifications géométriques des composants
├── states.json          # Machine à états agentiques (Running, Queued, Review...)
├── ux-rules.json        # Principes ergonomiques fondamentaux
└── theme.json           # Thème complet unifié
```

---

## 2. Tokens de Couleur — `colors.json`

```json
{
  "background": {
    "default": "#202020",
    "elevated": "#242424",
    "subtle": "#282828",
    "hover": "#2D2D2D",
    "active": "#323232",
    "inverse": "#FFFFFF"
  },

  "surface": {
    "default": "#242424",
    "raised": "#282828",
    "overlay": "#2B2B2B",
    "hover": "#2F2F2F",
    "pressed": "#353535",
    "disabled": "#222222"
  },

  "border": {
    "subtle": "#303030",
    "default": "#3A3A3A",
    "strong": "#4A4A4A",
    "focus": "#8AB4F8"
  },

  "text": {
    "primary": "#F1F1F1",
    "secondary": "#B8B8B8",
    "tertiary": "#969696",
    "muted": "#858585",
    "disabled": "#606060",
    "inverse": "#202020"
  },

  "accent": {
    "primary": "#8AB4F8",
    "primaryHover": "#AECBFA",
    "primaryPressed": "#669DF6",
    "subtle": "#263447"
  },

  "status": {
    "success": "#81C995",
    "successSubtle": "#20352A",
    "warning": "#FDD663",
    "warningSubtle": "#3A321A",
    "error": "#F28B82",
    "errorSubtle": "#3A2423",
    "info": "#8AB4F8",
    "infoSubtle": "#263447",
    "neutral": "#9AA0A6",
    "neutralSubtle": "#2B2B2B"
  },

  "interactive": {
    "focusRing": "#8AB4F8",
    "selection": "#3C4043",
    "keyboardFocus": "#AECBFA"
  },

  "code": {
    "background": "#1A1A1A",
    "foreground": "#E8EAED",
    "comment": "#80868B",
    "keyword": "#A8C7FA",
    "string": "#C7E1A3",
    "number": "#F8C8DC"
  }
}
```

### Règle d'or de répartition des couleurs
```text
80–90% → Neutral dark (surfaces principales)
5–15%  → Secondary surfaces (panneaux, cartes)
<5%    → Accent / Status (l'accent ne doit jamais envahir l'écran)
```

---

## 3. Typographie — `typography.json`

```json
{
  "fontFamily": {
    "ui": "\"Google Sans Flex\", \"Google Sans\", Arial, sans-serif",
    "body": "\"Google Sans Flex\", \"Google Sans\", Arial, sans-serif",
    "code": "\"Google Sans Mono\", \"Roboto Mono\", Consolas, monospace"
  },

  "weights": {
    "regular": 400,
    "medium": 500,
    "semibold": 600,
    "bold": 700
  },

  "sizes": {
    "xs": "10px",
    "sm": "12px",
    "md": "13px",
    "base": "14px",
    "lg": "16px",
    "xl": "18px",
    "2xl": "22px",
    "3xl": "28px",
    "4xl": "32px",
    "5xl": "40px"
  },

  "lineHeight": {
    "tight": 1.2,
    "snug": 1.3,
    "normal": 1.45,
    "relaxed": 1.6
  },

  "styles": {
    "display": { "size": "32px", "weight": 500, "lineHeight": 1.2 },
    "pageTitle": { "size": "22px", "weight": 500, "lineHeight": 1.3 },
    "sectionTitle": { "size": "16px", "weight": 500, "lineHeight": 1.4 },
    "body": { "size": "14px", "weight": 400, "lineHeight": 1.5 },
    "bodyStrong": { "size": "14px", "weight": 500, "lineHeight": 1.5 },
    "label": { "size": "12px", "weight": 500, "lineHeight": 1.4 },
    "caption": { "size": "11px", "weight": 400, "lineHeight": 1.4 },
    "code": { "size": "13px", "weight": 400, "lineHeight": 1.55 }
  }
}
```

---

## 4. Espacement & Layout — `spacing.json`

Grille fondamentale en base 4 :

```json
{
  "base": 4,

  "scale": {
    "0": "0px",
    "1": "4px",
    "2": "8px",
    "3": "12px",
    "4": "16px",
    "5": "20px",
    "6": "24px",
    "7": "28px",
    "8": "32px",
    "9": "36px",
    "10": "40px",
    "12": "48px",
    "14": "56px",
    "16": "64px",
    "20": "80px",
    "24": "96px"
  },

  "component": {
    "iconGap": "8px",
    "labelGap": "6px",
    "inputPaddingX": "12px",
    "inputPaddingY": "8px",
    "buttonPaddingX": "14px",
    "buttonPaddingY": "8px",
    "cardPadding": "16px",
    "modalPadding": "24px"
  },

  "layout": {
    "sidebarWidth": "260px",
    "sidebarCollapsedWidth": "64px",
    "contentMaxWidth": "960px",
    "pagePadding": "24px",
    "sectionGap": "32px"
  }
}
```

---

## 5. Rayons d'arrondi — `radius.json`

```json
{
  "none": "0px",
  "xs": "4px",
  "sm": "6px",
  "md": "8px",
  "lg": "12px",
  "xl": "16px",
  "2xl": "20px",
  "pill": "999px"
}
```

> **Règle :** L'UI doit rester **soft**, sans tomber dans le "bubble UI". Utiliser principalement `6px`, `8px`, `12px` et `16px`. Réserver `pill (999px)` aux badges et pastilles d'action.

---

## 6. Ombres & Élévation — `shadows.json`

Le système privilégie la séparation par teintes de surface plutôt que les ombres lourdes.

```json
{
  "none": "none",
  "sm": "0 1px 2px rgba(0,0,0,0.18)",
  "md": "0 4px 12px rgba(0,0,0,0.22)",
  "lg": "0 8px 24px rgba(0,0,0,0.28)",
  "xl": "0 16px 40px rgba(0,0,0,0.32)",
  "focus": "0 0 0 2px rgba(138,180,248,0.35)",
  "modal": "0 20px 60px rgba(0,0,0,0.42)"
}
```

---

## 7. Machine à États Agentiques — `states.json`

Un logiciel agentique doit rendre son état toujours visible et univoque :

```json
{
  "idle": { "label": "Idle", "icon": "circle", "color": "#9AA0A6" },
  "queued": { "label": "Queued", "icon": "schedule", "color": "#9AA0A6" },
  "running": { "label": "Running", "icon": "progress_activity", "color": "#8AB4F8", "animated": true },
  "waiting": { "label": "Waiting", "icon": "hourglass_empty", "color": "#FDD663" },
  "success": { "label": "Completed", "icon": "check_circle", "color": "#81C995" },
  "failed": { "label": "Failed", "icon": "error", "color": "#F28B82" },
  "paused": { "label": "Paused", "icon": "pause_circle", "color": "#9AA0A6" },
  "needsReview": { "label": "Needs review", "icon": "rate_review", "color": "#FDD663" },
  "scheduled": { "label": "Scheduled", "icon": "event", "color": "#8AB4F8" }
}
```

> **Règle fondamentale d'accessibilité :** Ne jamais dépendre uniquement de la couleur. Toujours associer **ICÔNE + LABEL + COULEUR**.

---

## 8. Modèle d'Interaction Spécifique aux Agents

L'exécution agentique suit un pipeline observable :

```text
User Request → Planning → Queued → Running → Tool Execution → Sub-agent → Artifact → Validation → Completed
```

### Carte de Progression d'Exécution
```text
┌─────────────────────────────────────────┐
│ Agent: Refactor API                     │
│ ● Running                               │
│                                         │
│ Step 3 / 7                              │
│ ├─ Analyzing repository        ✓        │
│ ├─ Updating service            ✓        │
│ ├─ Running tests               ●        │
│ ├─ Reviewing changes            ○       │
│ └─ Final response              ○        │
│                                         │
│ 2m 14s                         Stop     │
└─────────────────────────────────────────┘
```

### Message Chat
- **Utilisateur** : Aligné à droite, surface subtile (`#282828`), rayon 12px, padding 12/16px, max-width 720px.
- **Agent** : Aligné à gauche, fond transparent, pleine largeur, aucune carte lourde. L'agent est perçu comme **l'opérateur du système**.

### Exécution d'Outil (`ToolExecution`)
```text
┌─────────────────────────────────────────┐
│ terminal                         ✓       │
│ npm test                                 │
│                                          │
│ $ npm test                               │
│ 142 tests passed                         │
│                                          │
│ 4.2s                                     │
└─────────────────────────────────────────┘
```

### Carte d'Artefact
```text
┌──────────────────────────────────────┐
│ report.md                      Open → │
│ Markdown document                    │
│ Updated 12 sec ago                   │
└──────────────────────────────────────┘
```

---

## 9. Motion & Animation — `motion.json`

```json
{
  "duration": {
    "instant": "0ms",
    "fast": "120ms",
    "normal": "180ms",
    "moderate": "240ms",
    "slow": "320ms"
  },

  "easing": {
    "standard": "cubic-bezier(0.2, 0, 0, 1)",
    "enter": "cubic-bezier(0, 0, 0.2, 1)",
    "exit": "cubic-bezier(0.4, 0, 1, 1)"
  },

  "presets": {
    "hover": "180ms",
    "popover": "180ms",
    "modal": "240ms",
    "sidebar": "240ms",
    "agentStatus": "320ms"
  }
}
```

---

## 10. Responsive Breakpoints

```json
{
  "breakpoints": {
    "mobile": "0px",
    "tablet": "768px",
    "desktop": "1024px",
    "wide": "1440px",
    "ultrawide": "1920px"
  },

  "behavior": {
    "mobile": {
      "sidebar": "drawer",
      "secondaryPanel": "drawer",
      "composer": "fixed-bottom"
    },
    "tablet": {
      "sidebar": "collapsible",
      "secondaryPanel": "overlay"
    },
    "desktop": {
      "sidebar": "persistent",
      "secondaryPanel": "optional"
    },
    "wide": {
      "sidebar": "persistent",
      "secondaryPanel": "persistent"
    }
  }
}
```

---

## 11. Architecture Visuelle Finale

```text
┌────────────────────────────────────────────────────────────┐
│                        APP HEADER                           │
├───────────────┬──────────────────────────────┬─────────────┤
│               │                              │             │
│   SIDEBAR     │       CONVERSATION           │  ACTIVITY   │
│               │                              │             │
│ Projects      │  User message                │ Agent       │
│ Conversations │                              │ status      │
│ Tasks         │  Agent response               │             │
│ Agents        │                              │ Tools       │
│               │  Tool execution               │             │
│               │                              │ Artifacts   │
│               │  Artifact                     │             │
│               │                              │             │
│               ├──────────────────────────────┤             │
│               │       CHAT COMPOSER          │             │
└───────────────┴──────────────────────────────┴─────────────┘
```

---

## 12. Correspondance Flutter / Dart (`AppColors.dart`)

Dans l'application Flutter ([`remote/mobile/lib/theme/app_colors.dart`](lib/theme/app_colors.dart)) :

| Token JSON | Équivalent Flutter | Valeur Hex |
|---|---|---|
| `background.default` | `AppColors.surfaceBase` | `#09090B` / `#202020` |
| `surface.raised` | `AppColors.surfaceRaised` | `#18181B` / `#282828` |
| `surface.default` | `AppColors.surfaceInput` | `#27272A` / `#242424` |
| `border.default` | `AppColors.borderStrong` | `#3F3F46` / `#3A3A3A` |
| `text.primary` | `AppColors.inkPrimary` | `#F4F4F5` / `#F1F1F1` |
| `accent.primary` | `AppColors.accentBlue` | `#3B82F6` / `#8AB4F8` |
| `status.success` | `AppColors.positive` | `#22C55E` / `#81C995` |
| `status.warning` | `AppColors.warning` | `#EAB308` / `#FDD663` |
| `status.error` | `AppColors.danger` | `#EF4444` / `#F28B82` |
