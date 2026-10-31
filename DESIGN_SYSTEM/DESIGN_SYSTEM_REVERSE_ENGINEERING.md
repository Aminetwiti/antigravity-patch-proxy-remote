# ANTIGRAVITY 2.0 — MASTER DESIGN SYSTEM SPECIFICATION (REVERSE ENGINEERING)

**Date d'analyse** : 2026-09-02  
**Source Primaire** : `remote/vendor/antigravity/resources/app.asar` (Stock v2.11.0 & Patched v3.4.2)  
**Sources de Référence et Validation** :  
- `app.asar` → `dist/utils.js`, `dist/loadingOverlay.js`, `dist/main.js`  
- `ag-doctor-ui/src/renderer/styles.css` (Lignes 2710–2845)  
- `remote/mobile/lib/theme/app_colors.dart`  
- `remote/mobile/design.md` & `DESIGN.md`  
- `.impeccable/design.json`  

---

## 1. Design Philosophy

### Creative North Star : *"The Quiet Console"*
Le système de design de Google Antigravity repose sur le paradigme de **"The Quiet Console"** (la console silencieuse). Conçu pour un environnement de développement agentique immersif, il refuse explicitement le style "dashboard IA tape-à-l'œil" (dégradés néon agressifs, glassmorphism excessif, illustrations superflues).

### Principes Directeurs :
1. **L'Invisibilité Délibérée** : L'interface se fond dans le chrome de l'environnement de développement. Les surfaces neutres sombres (Zinc 900–800) portent 85 à 90 % de la composition.
2. **The One Voice Rule (Règle de la Voix Unique)** : L'accent coloré (Bleu Google `#8AB4F8` ou Bleu Accent `#3B82F6`) n'occupe jamais plus de 10 % d'une vue. Les teintes de marque des fournisseurs tiers (vert OpenAI, corail Anthropic, violet Custom) sont strictement circonscrites à des bulles d'icônes de 16 à 32 px ou des badges de 10 px.
3. **The Flat-by-Default Rule** : Les surfaces de travail et panneaux intégrés sont plats (séparés par des bordures subtiles d'1 px et des paliers tonals). Les ombres portées sont strictement réservées aux élévations flottantes (fenêtres modales, menus contextuels, toasts d'alerte).
4. **Visibilité Agentique Tripartite** : L'état d'un agent asynchrone n'est jamais communiqué par la couleur seule. Chaque transition repose sur la triade **Icône + Label Textuel + Couleur d'état**.

---

## 2. Color System

### 2.1 Surfaces & Arrière-plans (Surfaces Neutres)

| Rôle Token | Valeur Hex | Source Exacte | Niveau de Confiance |
|---|---|---|---|
| `background.default` | `#202020` | `remote/mobile/lib/theme/app_colors.dart: L7` | **CONFIRMED** |
| `surface.base` | `#18181B` | `DESIGN.md: L5` / `.impeccable/design.json: L7` | **CONFIRMED** |
| `surface.raised` | `#1C1C1F` / `#242424` | `DESIGN.md: L6` / `app_colors.dart: L8` | **CONFIRMED** |
| `surface.input` | `#27272A` / `#282828` | `DESIGN.md: L7` / `app_colors.dart: L9` | **CONFIRMED** |
| `surface.overlay` | `#2B2B2B` | `remote/mobile/lib/theme/app_colors.dart: L10` | **CONFIRMED** |
| `surface.hover` | `#2F2F2F` | `remote/mobile/lib/theme/app_colors.dart: L11` | **CONFIRMED** |
| `surface.pressed` | `#353535` | `remote/mobile/lib/theme/app_colors.dart: L12` | **CONFIRMED** |
| `editor.background` | `#1A1A1A` | `remote/mobile/lib/theme/app_colors.dart: L15` | **CONFIRMED** |

### 2.2 Bordures (Border Scale)

| Rôle Token | Valeur Hex | Source Exacte | Niveau de Confiance |
|---|---|---|---|
| `border.subtle` | `#27272A` / `#303030` | `DESIGN.md: L8` / `app_colors.dart: L19` | **CONFIRMED** |
| `border.default` | `#3A3A3A` | `remote/mobile/lib/theme/app_colors.dart: L20` | **CONFIRMED** |
| `border.strong` | `#3F3F46` / `#4A4A4A` | `DESIGN.md: L9` / `app_colors.dart: L21` | **CONFIRMED** |
| `border.focus` | `#8AB4F8` | `remote/mobile/lib/theme/app_colors.dart: L22` | **CONFIRMED** |

### 2.3 Typographie / Encre (Ink Scale)

| Rôle Token | Valeur Hex | Contraste vs Fond | Source Exacte | Niveau de Confiance |
|---|---|---|---|---|
| `text.primary` | `#F4F4F5` / `#F1F1F1` | 14:1 (AAA) | `DESIGN.md: L11` / `app_colors.dart: L25` | **CONFIRMED** |
| `text.secondary` | `#A1A1AA` / `#B8B8B8` | 6.5:1 (AA) | `DESIGN.md: L12` / `app_colors.dart: L26` | **CONFIRMED** |
| `text.tertiary` | `#969696` | 4.8:1 (AA) | `remote/mobile/lib/theme/app_colors.dart: L27` | **CONFIRMED** |
| `text.muted` | `#71717A` / `#858585` | 4.0:1 | `DESIGN.md: L13` / `app_colors.dart: L28` | **CONFIRMED** |
| `text.disabled` | `#606060` | 2.8:1 | `remote/mobile/lib/theme/app_colors.dart: L29` | **CONFIRMED** |

### 2.4 Accents & Actions

| Rôle Token | Valeur Hex | Description / Usage | Source Exacte | Niveau de Confiance |
|---|---|---|---|---|
| `accent.blue` | `#3B82F6` | Boutons d'action principaux Desktop | `DESIGN.md: L14` | **CONFIRMED** |
| `accent.blueHover` | `#2563EB` | Survol bouton primaire | `DESIGN.md: L15` | **CONFIRMED** |
| `accent.googleBlue` | `#8AB4F8` | Accent natif Google IDE | `remote/mobile/lib/theme/app_colors.dart: L34` | **CONFIRMED** |
| `accent.googleBlueHover`| `#AECBFA` | Survol accent IDE | `remote/mobile/lib/theme/app_colors.dart: L35` | **CONFIRMED** |
| `accent.subtle` | `#263447` | Fond sélection douce / badge accent | `remote/mobile/lib/theme/app_colors.dart: L39` | **CONFIRMED** |

### 2.5 États Sémantiques

| État | Couleur Hex | Teinte d'atténuation (Subtle) | Source Exacte | Niveau de Confiance |
|---|---|---|---|---|
| **Success** | `#22C55E` / `#81C995` | `#20352A` | `DESIGN.md: L16` / `app_colors.dart: L43-45` | **CONFIRMED** |
| **Warning** | `#EAB308` / `#FDD663` | `#3A321A` | `DESIGN.md: L17` / `app_colors.dart: L46-47` | **CONFIRMED** |
| **Danger / Error**| `#EF4444` / `#F28B82` | `#3A2423` | `DESIGN.md: L18` / `app_colors.dart: L48-50` | **CONFIRMED** |
| **Info** | `#8AB4F8` | `#263447` | `remote/mobile/lib/theme/app_colors.dart: L52-53` | **CONFIRMED** |

### 2.6 Identités Fournisseurs LLM (Provider Accents)

| Provider | Couleur Glyphe | Fond Teinté (22% Alpha) | Source Exacte |
|---|---|---|---|
| **OpenAI** | `#10A37F` | `rgba(16, 163, 127, 0.13)` | `DESIGN.md: L20` / `app_colors.dart: L79` |
| **Anthropic** | `#D97757` | `rgba(217, 119, 87, 0.13)` | `DESIGN.md: L21` / `app_colors.dart: L80` |
| **Google** | `#4285F4` | `rgba(66, 133, 244, 0.13)` | `DESIGN.md: L22` / `app_colors.dart: L81` |
| **Ollama** | `#F0F0F0` | `rgba(240, 240, 240, 0.13)` | `DESIGN.md: L23` / `app_colors.dart: L82` |
| **OpenRouter** | `#FF7A45` | `rgba(255, 122, 69, 0.13)` | `DESIGN.md: L24` / `app_colors.dart: L83` |
| **Custom / Unknown**| `#A855F7` | `rgba(168, 85, 247, 0.13)` | `DESIGN.md: L25` / `app_colors.dart: L84` |

---

## 3. Typography

### 3.1 Piles de Polices (Font Stacks)
- **UI & Body Stack** :
  ```css
  font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
  ```
  *Source* : `app.asar` → `dist/loadingOverlay.js: L23` & `DESIGN.md: L28`.
- **Branded IDE Stack** :
  ```css
  font-family: 'Google Sans Flex', 'Google Sans', Arial, sans-serif;
  ```
  *Source* : `remote/mobile/design.md: L116-117`.
- **Monospace Stack** :
  ```css
  font-family: 'Google Sans Mono', 'Roboto Mono', Consolas, monospace;
  ```
  *Source* : `remote/mobile/design.md: L118`.

### 3.2 Échelle Typographique Détectée

| Rôle | Taille | Graisse (Weight) | Hauteur de ligne | Espacement | Usage |
|---|---|---|---|---|---|
| **Display** | `32px` | 500 (Medium) | 1.2 | normal | Écrans d'accueil / Empty states majeurs |
| **PageTitle**| `22px` | 500 (Medium) | 1.3 | normal | Titres de fenêtres / Vues |
| **Heading** | `18px` | 600 (SemiBold) | 1.2 | normal | Titres de modales / Tiroirs |
| **Section** | `16px` | 500 (Medium) | 1.4 | normal | Séparateurs de sections |
| **Title** | `14px` | 500 (Medium) | 1.3 | normal | Nom de modèle, cartes |
| **Body** | `13px` | 400 (Regular) | 1.4 | normal | Texte courant Desktop, toasts |
| **Body Mobile**| `14px` | 400 (Regular) | 1.5 | normal | Conversation chat mobile |
| **Label** | `10px` | 600 (SemiBold) | 1.4 | `0.5px` (UPPER) | Badges de fournisseur, chips |
| **Caption** | `11px` | 400 (Regular) | 1.4 | `0.03em` | Timestamps, indicateurs de log |
| **Code** | `13px` | 400 (Regular) | 1.55 | normal | Terminaux, blocs markdown |

---

## 4. Spacing System

Le système géométrique est strictement articulé autour d'une **grille fondamentale en base 4 px** :

```text
4px  (xs)  → Gaps minimaux, espacement pastille statut
8px  (sm)  → Gaps entre icône et label, padding vertical boutons
12px (md)  → Padding cartes, gouttières de formulaire
16px (lg)  → Marges internes de conteneurs, padding de cartes
24px (xl)  → Gouttières de modale, espacements de section
32px (2xl) → Marges de page
48px (3xl) → Hauteur des en-têtes
64px (4xl) → Largeur barre latérale repliée
```

---

## 5. Radius

Échelle soft-corner évitant l'effet "bulle" :
- `xs` (`4px`) : Champs de saisie texte, boutons d'action desktop.
- `sm` (`6px`) : Cartes de statut, éléments de liste condensés.
- `md` (`8px`) : Cartes de modèle (`model-card`), blocs de code.
- `lg` (`12px`) : Fenêtres modales (`agy-modal`), toasts de notification.
- `xl` (`16px`) : Tiroirs de sessions (Drawers).
- `pill` (`999px`) : Badges de statut, pastilles d'action rapide.
- `circle` (`50%`) : Status dots (6px), avatars.

---

## 6. Borders

- **Largeur standard** : Toujours `1px solid`.
- **Règle de contraste** :
  - Sur fond `#18181B` ou `#202020`, les bordures au repos utilisent `#27272A` ou `#303030`.
  - Au survol (`:hover`), la bordure passe à `#3F3F46` ou `#4A4A4A`.
  - Au focus clavier (`:focus-visible`), application de l'anneau `#8AB4F8`.

---

## 7. Shadows & Elevations

Le principe **The Flat-By-Default Rule** réserve les ombres exclusivement aux surfaces décollées :
- `none` : Toutes les cartes et panneaux intégrés dans la page.
- `modalLift` : `0 20px 25px -5px rgba(0, 0, 0, 0.5)` (Modales au premier plan).
- `toastLift` : `0 10px 15px -3px rgba(0, 0, 0, 0.5), 0 4px 6px -2px rgba(0, 0, 0, 0.5)` (Toasts).
- `bannerLift` : `0 4px 6px -1px rgba(0, 0, 0, 0.1)` (Bannières d'alerte persistantes).
- `focusRing` : `0 0 0 2px rgba(138, 180, 248, 0.35)` (Bague d'accessibilité).

---

## 8. Icons & Imagery

- **Bibliothèque** : Google Material Symbols / Google Symbols (Outlined, stroke width 1.5).
- **Tailles calibrées** :
  - `sm` (`16px`) : Actions en ligne dans les listes, chevrons.
  - `md` (`20px`) : Navigation, boutons d'outils, items de menu.
  - `lg` (`24px`) : Icônes d'en-tête, boutons principaux d'action.
- **Cartographie Récurrente** :
  - Session : `chat_bubble_outline`
  - Workspace : `folder_open`
  - MCP & Tools : `construction`
  - Exécution en cours : `progress_activity` (animé)
  - Complété : `check_circle`
  - Échec : `error`
  - Terminal : `terminal`

---

## 9. Layout System

### 9.1 Fenêtre Principale Electron (`utils.js: L108-120`)
- **Dimensions par défaut** : Largeur `1400px`, Hauteur `900px`.
- **Dimensions minimales** : Largeur `500px`, Hauteur `400px`.
- **Barre de titre** : Hauteur `30px` (`titleBarStyle: 'hidden'`, `titleBarOverlay: height 30`).
- **Positions Traffic Lights (macOS)** : `{ x: 12, y: 12 }`.

### 9.2 Grille Fonctionnelle
- **Barre latérale (Sidebar)** : Largeur fixe `260px` (repliée à `64px` en mode compact).
- **Zone de Chat / Contenu** : Largeur maximale centrée à `768px` pour le compositeur de chat, `960px` pour la lecture documentaire.

---

## 10. Components

### 10.1 Button Primary (`.agy-button-primary`)
- **Structure** : `display: inline-flex; align-items: center; justify-content: center; gap: 8px;`
- **Dimensions** : Padding `6px 12px` (Desktop) / `8px 14px` (Mobile).
- **Bordure / Arrondi** : `border: none; border-radius: 4px;`
- **Couleurs** : Fond `#3B82F6` (survol `#2563EB`, pressé `#1D4ED8`), Texte `#FFFFFF`.
- **Typographie** : `font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;`

### 10.2 Model Card (`.model-card` / `.agy-model-row`)
- **Structure** : Ligne horizontale `display: flex; justify-content: space-between; align-items: center;`
- **Dimensions** : Padding `12px 16px; border-radius: 8px;`
- **Couleurs** : Fond `#18181B`, Bordure `1px solid #27272A`.
- **États** : Survol fond `#1C1C1F`, bordure `#3F3F46`. Sélectionné bordure `#22C55E`.

### 10.3 Modal (`.agy-modal`)
- **Structure** : Conteneur centré largeur `650px`, hauteur max `85vh`.
- **Couleurs** : Fond `#18181B`, Bordure `1px solid #3F3F46`, Arrondi `12px`.
- **Ombre** : `0 20px 25px -5px rgba(0, 0, 0, 0.5)`.
- **En-tête** : Padding `16px 24px`, séparateur `1px solid #3F3F46`.

### 10.4 Status Dot (`.status-dot` / `.agy-dot`)
- **Géométrie** : `width: 6px; height: 6px; border-radius: 50%; display: inline-block;`
- **Transition** : `background-color 0.3s ease;`
- **Couleurs** :
  - Non testé / Déconnecté : `#71717A`
  - Connecté / Valide : `#22C55E`
  - En cours : `#8AB4F8`
  - Erreur : `#EF4444`

### 10.5 Contextual Toast (`.agy-toast`)
- **Structure** : Position flottante haut-droite, padding `16px 20px`, arrondi `12px`.
- **Barre d'accent** : Trait vertical gauche de `4px` de large (`#A855F7` ou `#EF4444`).
- **Fond** : `#18181B`, bordure `1px solid #27272A`.

---

## 11. Component States

Chaque composant interactif implémente rigoureusement la matrice d'états :

| État | Modification Visuelle Appliquée |
|---|---|
| **Default** | Fond `surface.base`, bordure `border.subtle`, texte `text.primary`. |
| **Hover** | Fond passe à `surface.raised`, bordure passe à `border.strong`, transition `0.15s ease`. |
| **Active / Pressed**| Échelle `transform: scale(0.98)` ou fond assombri (`#353535`). |
| **Focus-Visible** | Anneau de contour `0 0 0 2px rgba(138, 180, 248, 0.35)`. |
| **Disabled** | Opacité `0.4`, `cursor: not-allowed`, événements pointeur neutralisés. |
| **Streaming** | Curseur pulsant ou texte incrémental à 60/120 Hz sans reflow visuel. |

---

## 12. UX Patterns

### 12.1 Quiet Console Welcome & Action Pills
Lorsqu'aucune session n'est active, la console affiche le titre discret ("Antigravity") suivi d'une série de pastilles d'action rapide (`ActionPills`) horizontales (ex. `Refactor code`, `Run test suite`, `Inspect security`). Clic = remplissage immédiat du prompt.

### 12.2 Pipeline d'Exécution Observable
L'exécution des agents affiche une carte de progression pas à pas (`ExecutionProgressCard`) :
- Étape terminée : Coche verte `check_circle` (`#81C995`).
- Étape courante : Cercle rotatif bleu `progress_activity` (`#8AB4F8`).
- Étape future : Cercle vide gris `circle` (`#71717A`).
- Chronomètre de durée cumulée discret en bas à gauche.

---

## 13. Navigation

- **Mode Desktop** : Double panneau fixe. Barre latérale gauche (sessions, espaces de travail, outils) + Zone centrale de travail (chat + inspecteur d'artefacts).
- **Mode Mobile** : Tiroir de navigation glissant (`Drawer`) accessible via icône hamburger, laissant 100 % de la vue au flux conversationnel.

---

## 14. Responsive Behavior

| Point de rupture | Largeur écran | Comportement de la barre latérale | Compositeur de Chat |
|---|---|---|---|
| **Mobile** | `< 768px` | Tiroir masqué (`drawer`) | Collé en bas d'écran (`fixed-bottom`) |
| **Tablet** | `768px – 1024px` | Repliable sous forme d'icônes (`64px`) | Largeur fluide avec marges `16px` |
| **Desktop** | `1024px – 1440px`| Ouverte en permanence (`260px`) | Largeur maximale `768px` centrée |
| **Wide** | `> 1440px` | Ouverte (`260px`) + Volet droit d'activité | Double colonne côte à côte |

---

## 15. Themes

Le système gère nativement le basculement Clair/Sombre (`utils.js: L106`) :
- **Dark (Par défaut)** : Fond `#131313` / `#202020`, texte `#FAFAFA` / `#F4F4F5`.
- **Light** : Fond `#FAFAFA`, texte `#383A42`, bordures `#D0D7DE`.

---

## 16. Motion / Animation

- **Animations standardisées** :
  - Survol : `150ms ease`
  - Ouverture Modale : `transform 0.2s ease, opacity 0.2s ease` (`scale(0.9) translateY(20px)` → `scale(1) translateY(0)`)
  - Apparition Toast : `cubic-bezier(0.34, 1.56, 0.64, 1) 0.3s` (avec léger rebond)
  - Loader Dot Pulse : `1.5s infinite ease-in-out` (`scale(0.9)` opacité 0.2 → `scale(1.1)` opacité 0.7)

---

## 17. Accessibility (a11y)

- **Contraste de Texte** : Tous les textes principaux respectent WCAG AAA (14:1) sur fond sombre.
- **Règle Tripartite** : L'état d'un agent combine toujours Icône + Label texte + Couleur.
- **Focus Clavier** : Tout composant interactif dispose d'un contour visible `border.focus`.

---

## 18. Screen Inventory

1. **Streaming Chat View** (`/chat`) : Flux d'échange textuel avec rendu Markdown riche, blocs de code syntaxés et cartes d'approbation d'outils.
2. **Workspace & File Explorer** (`/workspace`) : Arborescence de fichiers avec icônes de syntaxe et visionneuse de diffs colorisés.
3. **Provider & Custom Models Manager** (`/settings/models`) : Modale de 650 px en deux étapes permettant de tester et configurer les clés d'API LLM externes.
4. **Scheduled Tasks Dashboard** (`/tasks`) : Panneau de contrôle des tâches périodiques et cron jobs avec historique d'exécution.
5. **MCP Server Explorer** (`/mcp`) : Liste des serveurs MCP connectés avec introspection de leurs outils et schémas JSON.

---

## 19. Design Tokens (Index d'Exportation JSON)

L'ensemble des tokens a été formalisé au format JSON dans `DESIGN_SYSTEM/` :
- `colors.json` : Palette complète, sémantique et fournisseurs.
- `typography.json` : Polices, graisses et échelles.
- `spacing.json` : Grille 4 px et dimensions de composants.
- `radius.json` : Échelle d'arrondis.
- `shadows.json` : Élévations.
- `borders.json` : Échelles de bordures.
- `icons.json` : Dictionnaire des icônes.
- `motion.json` : Durées et courbes de transition.
- `layout.json` : Gabarits de fenêtres et conteneurs.
- `breakpoints.json` : Points de rupture responsive.

---

## 20. Code Mapping

| Composant UI | Fichier Source Réel | Déclaration / Sélecteur |
|---|---|---|
| Fenêtre Principale | `app.asar` → `dist/utils.js` | `createWindow(url, storageManager)` (L100–180) |
| Écran de Chargement | `app.asar` → `dist/loadingOverlay.js` | `getLoadingHtml()` & `attachLoadingOverlay()` (L15–70) |
| Modale Provider Manager | `ag-doctor-ui/src/renderer/styles.css` | `.agy-modal`, `.agy-modal-header` (L2710–2760) |
| Carte de Modèle | `ag-doctor-ui/src/renderer/styles.css` | `.model-card`, `.model-name`, `.status-dot` (L2720–2755) |
| Thème Global Flutter | `remote/mobile/lib/theme/app_colors.dart` | `abstract class AppColors` (L5–105) |
| Spécification Mobile | `remote/mobile/design.md` | `Master Design System Specification` (L1–430) |

---

## 21. Extracted Assets

- `icon.png` (Icône principale de l'application extraite d'app.asar).
- `trayTemplate.png` & `trayTemplate@2x.png` (Icônes pour la barre des tâches système).
- `loadingOverlay.js` (Code CSS & HTML in-line du chargeur de démarrage).

---

## 22. Unknown / Missing Elements

- **Web Bundle interne au binaire Go** : Le binaire `language_server.exe` encapsule son propre serveur web pour certaines vues internes (passé via le flag `-web_bundle_path`). Les sources React brutes ne sont pas présentes en clair dans l'ASAR mais servies dynamiquement par le binaire Go.
- **Source Maps TypeScript** : L'archive `app.asar.bak` originale ne contient pas de fichiers `.map` pour les fichiers système (uniquement présents sur les modules injectés par le patch).
