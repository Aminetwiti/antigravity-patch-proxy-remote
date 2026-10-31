# PALETTE VISUELLE — ANTIGRAVITY 2.0 (THE QUIET CONSOLE)

Document de référence exhaustif des couleurs réelles extraites du code source de l'application et de ses composants injectés.

---

## 1. Neutrals & Surfaces (Dark Zinc)

| Nom | HEX | RGB | Rôle | Usage | Source Réelle |
|---|---|---|---|---|---|
| `canvas-deep` | `#09090B` | `rgb(9, 9, 11)` | Fond le plus profond | Arrière-plan de l'application | `styles.css: L9` (`--bg-0`) |
| `surface-base` | `#18181B` | `rgb(24, 24, 27)` | Surface primaire | Fond de fenêtre, modales, cartes | `styles.css: L2711` (`--qc-surface-base`) |
| `surface-raised`| `#1C1C1F` | `rgb(28, 28, 31)` | Surface surélevée | Survol de carte, suggestions | `styles.css: L2712` (`--qc-surface-raised`) |
| `surface-input` | `#27272A` | `rgb(39, 39, 42)` | Surface interactive | Champs de texte, dropdowns | `styles.css: L2713` (`--qc-surface-input`) |
| `window-native` | `#131313` | `rgb(19, 19, 19)` | Chrome Electron | Initialisation de BrowserWindow | `app.asar -> dist/utils.js: L106` |

---

## 2. Bordures (Borders)

| Nom | HEX | RGB | Rôle | Usage | Source Réelle |
|---|---|---|---|---|---|
| `border-subtle` | `#27272A` | `rgb(39, 39, 42)` | Bordure au repos | Délimitation des cartes et panneaux | `styles.css: L2714` (`--qc-border-subtle`) |
| `border-strong` | `#3F3F46` | `rgb(63, 63, 70)` | Bordure active | Cadre de modale, survol de cartes | `styles.css: L2715` (`--qc-border-strong`) |
| `border-focus` | `#8AB4F8` | `rgb(138, 180, 248)` | Focus ring | Contour d'accessibilité clavier | `app_colors.dart: L22` |

---

## 3. Typographie (Ink)

| Nom | HEX | RGB | Contraste vs #18181B | Usage | Source Réelle |
|---|---|---|---|---|---|
| `ink-primary` | `#F4F4F5` | `rgb(244, 244, 245)` | 14.2:1 (AAA) | Titres, corps de texte principal | `styles.css: L2716` (`--qc-ink-primary`) |
| `ink-secondary`| `#A1A1AA` | `rgb(161, 161, 170)` | 6.5:1 (AA) | Sous-titres, placeholders, métadonnées | `styles.css: L2717` (`--qc-ink-secondary`) |
| `ink-muted` | `#71717A` | `rgb(113, 113, 122)` | 4.0:1 | Identifiants, hints, fermetures | `styles.css: L2718` (`--qc-ink-muted`) |

---

## 4. Accents & Sémantique

| Nom | HEX | RGB | Rôle | Usage | Source Réelle |
|---|---|---|---|---|---|
| `accent-blue` | `#3B82F6` | `rgb(59, 130, 246)` | Action primaire | Bouton d'action principal | `styles.css: L2719` |
| `accent-hover`| `#2563EB` | `rgb(37, 99, 235)` | Action survol | État de survol bouton | `styles.css: L2720` |
| `positive` | `#22C55E` | `rgb(34, 197, 94)` | Succès | Indicateur connecté, succès | `styles.css: L2721` |
| `warning` | `#EAB308` | `rgb(234, 179, 8)` | Avertissement | Quota, avertissements | `DESIGN.md: L17` |
| `danger` | `#EF4444` | `rgb(239, 68, 68)` | Erreur | Toasts d'erreur, échecs | `styles.css: L2722` |

---

## 5. Fournisseurs IA (Provider Badges)

| Provider | Glyphe HEX | Fond Teinté (Hex Alpha 22) | Source Réelle |
|---|---|---|---|
| **OpenAI** | `#10A37F` | `#10A37F22` | `DESIGN.md: L20` |
| **Anthropic** | `#D97757` | `#D9775722` | `DESIGN.md: L21` |
| **Google** | `#4285F4` | `#4285F422` | `DESIGN.md: L22` |
| **Ollama** | `#F0F0F0` | `#F0F0F022` | `DESIGN.md: L23` |
| **OpenRouter** | `#FF7A45` | `#FF7A4522` | `DESIGN.md: L24` |
| **Custom** | `#A855F7` | `#A855F722` | `DESIGN.md: L25` |
