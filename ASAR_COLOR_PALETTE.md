# ASAR COLOR PALETTE — PALETTE STRICTEMENT EXTRAITE D'APP.ASAR

Ce document recense **exclusivement les couleurs dont la présence a été confirmée dans les fichiers décompilés de `app.asar`**.

---

## 1. Palette Officielle Google Antigravity (app.asar.bak & app.asar)

### A. Shell Natif & Fenêtre Principale (`dist/utils.js: L105-106`)

| Token Détecté | Valeur HEX | Valeur RGB | Rôle | Source & Contexte | Classification |
|---|---|---|---|---|---|
| `bg-dark-window` | `#131313` | `rgb(19, 19, 19)` | Arrière-plan BrowserWindow natif sombre | `dist/utils.js: L105` (`isLight ? '#FAFAFA' : '#131313'`) | **ASAR_CONFIRMED** |
| `bg-light-window` | `#FAFAFA` | `rgb(250, 250, 250)` | Arrière-plan BrowserWindow natif clair | `dist/utils.js: L105` (`isLight ? '#FAFAFA' : '#131313'`) | **ASAR_CONFIRMED** |
| `fg-light-window` | `#383A42` | `rgb(56, 58, 66)` | Texte BrowserWindow natif clair (One Dark light) | `dist/utils.js: L106` (`isLight ? '#383A42' : '#FAFAFA'`) | **ASAR_CONFIRMED** |
| `fg-dark-window` | `#FAFAFA` | `rgb(250, 250, 250)` | Texte BrowserWindow natif sombre | `dist/utils.js: L106` (`isLight ? '#383A42' : '#FAFAFA'`) | **ASAR_CONFIRMED** |

### B. Écran de Démarrage / Loading Overlay (`dist/loadingOverlay.js: L14-40`)
*Hérite dynamiquement de `${backgroundColor}` et `${foregroundColor}` de `utils.js`.*

| Rôle Élément | Couleur Calculée (Dark) | Opacité / Animation | Règle CSS Extraite | Classification |
|---|---|---|---|---|
| Fond de page | `#131313` | 1.0 | `background: ${backgroundColor};` | **ASAR_CONFIRMED** |
| Texte "Loading Antigravity"| `#FAFAFA` | `opacity: 0.6` | `font-size: 13px; font-weight: 400; opacity: 0.6;` | **ASAR_CONFIRMED** |
| Loader Dots (3 points) | `#FAFAFA` | `0.2` à `0.7` | `background-color: ${foregroundColor}; animation: dot-pulse 1.5s` | **ASAR_CONFIRMED** |

### C. Assistant d'Installation IDE (`dist/ideInstall/wizard.js` & `wizardHtml.js`)

| Token Détecté | Valeur HEX | Valeur RGB | Rôle | Source & Contexte | Classification |
|---|---|---|---|---|---|
| `wizard-window-bg`| `#0D0D0D` | `rgb(13, 13, 13)` | Fond natif BrowserWindow du wizard | `dist/ideInstall/wizard.js: L67` | **ASAR_CONFIRMED** |
| `--bg-primary` | `#000000` | `rgb(0, 0, 0)` | Fond principal du conteneur HTML | `dist/ideInstall/wizardHtml.js: L31` | **ASAR_CONFIRMED** |
| `--bg-secondary` | `#1A1A1A` | `rgb(26, 26, 26)` | Fond secondaire / cases à cocher | `dist/ideInstall/wizardHtml.js: L32` | **ASAR_CONFIRMED** |
| `--bg-tertiary` | `#242424` | `rgb(36, 36, 36)` | Cartes et surfaces surélevées | `dist/ideInstall/wizardHtml.js: L33` | **ASAR_CONFIRMED** |
| `--bg-hover` | `#2A2A2A` | `rgb(42, 42, 42)` | État de survol des surfaces | `dist/ideInstall/wizardHtml.js: L34` | **ASAR_CONFIRMED** |
| `--text-primary` | `#F5F5F5` | `rgb(245, 245, 245)` | Titre H1 et texte principal | `dist/ideInstall/wizardHtml.js: L35` | **ASAR_CONFIRMED** |
| `--text-secondary`| `#A0A0A0` | `rgb(160, 160, 160)` | Paragraphes descriptifs | `dist/ideInstall/wizardHtml.js: L36` | **ASAR_CONFIRMED** |
| `--text-muted` | `#666666` | `rgb(102, 102, 102)` | Mentions secondaires | `dist/ideInstall/wizardHtml.js: L37` | **ASAR_CONFIRMED** |
| `--accent` | `#2F80ED` | `rgb(47, 128, 237)` | Bouton primaire "Explore Antigravity" | `dist/ideInstall/wizardHtml.js: L38` | **ASAR_CONFIRMED** |
| `--accent-hover` | `#2D74D7` | `rgb(45, 116, 215)` | Survol bouton d'action | `dist/ideInstall/wizardHtml.js: L39` | **ASAR_CONFIRMED** |
| `--border` | `#2A2A2A` | `rgb(42, 42, 42)` | Bordures d'éléments et séparateurs | `dist/ideInstall/wizardHtml.js: L40` | **ASAR_CONFIRMED** |
| `checkbox-border` | `#333333` | `rgb(51, 51, 51)` | Bordure de la case à cocher repos | `dist/ideInstall/wizardHtml.js: L168` | **ASAR_CONFIRMED** |
| `btn-text` | `#FFFFFF` | `rgb(255, 255, 255)` | Texte bouton blanc | `dist/ideInstall/wizardHtml.js: L223` | **ASAR_CONFIRMED** |

---

## 2. Palette Injectée par le Patch Proxy (`dist/preload/doctor-ui.js: L100-116`)
*Présente dans `remote/vendor/antigravity/resources/app.asar` (version repatchée).*

| Variable CSS | Valeur HEX | Rôle Déclaré | Ligne Source | Classification |
|---|---|---|---|---|
| `--agy-bg-base` | `#18181B` | Fond de vue / panneau | `doctor-ui.js: L100` | **ASAR_CONFIRMED (INJECTED)** |
| `--agy-bg-surface` | `#1C1C1F` | Surface de modale et carte | `doctor-ui.js: L101` | **ASAR_CONFIRMED (INJECTED)** |
| `--agy-bg-elevated`| `#212124` | Surface surélevée | `doctor-ui.js: L102` | **ASAR_CONFIRMED (INJECTED)** |
| `--agy-bg-input` | `#27272A` | Fond des champs de saisie | `doctor-ui.js: L103` | **ASAR_CONFIRMED (INJECTED)** |
| `--agy-bg-input-hover`| `#3F3F46` | Survol des boutons secondaires | `doctor-ui.js: L104` | **ASAR_CONFIRMED (INJECTED)** |
| `--agy-border` | `#27272A` | Bordure standard de repos | `doctor-ui.js: L105` | **ASAR_CONFIRMED (INJECTED)** |
| `--agy-border-strong`| `#3F3F46` | Bordure de modale / focus | `doctor-ui.js: L106` | **ASAR_CONFIRMED (INJECTED)** |
| `--agy-ink-primary`| `#F4F4F5` | Titres et labels principaux | `doctor-ui.js: L107` | **ASAR_CONFIRMED (INJECTED)** |
| `--agy-ink-secondary`| `#A1A1AA` | Sous-titres et légendes | `doctor-ui.js: L108` | **ASAR_CONFIRMED (INJECTED)** |
| `--agy-ink-muted` | `#71717A` | Glyphes et status dot inactif | `doctor-ui.js: L109` | **ASAR_CONFIRMED (INJECTED)** |
| `--agy-accent` | `#3B82F6` | Accent bleu / boutons primaires | `doctor-ui.js: L110` | **ASAR_CONFIRMED (INJECTED)** |
| `--agy-accent-hover`| `#2563EB` | Survol bouton primaire | `doctor-ui.js: L111` | **ASAR_CONFIRMED (INJECTED)** |
| `--agy-success` | `#22C55E` | Statut connecté / validation | `doctor-ui.js: L112` | **ASAR_CONFIRMED (INJECTED)** |
| `--agy-success-hover`| `#16A34A`| Survol succès | `doctor-ui.js: L113` | **ASAR_CONFIRMED (INJECTED)** |
| `--agy-warning` | `#EAB308` | Alerte jaune | `doctor-ui.js: L114` | **ASAR_CONFIRMED (INJECTED)** |
| `--agy-danger` | `#EF4444` | Erreur rouge / bouton suppression| `doctor-ui.js: L115` | **ASAR_CONFIRMED (INJECTED)** |
| `--agy-danger-hover`| `#DC2626` | Survol suppression rouge | `doctor-ui.js: L116` | **ASAR_CONFIRMED (INJECTED)** |
