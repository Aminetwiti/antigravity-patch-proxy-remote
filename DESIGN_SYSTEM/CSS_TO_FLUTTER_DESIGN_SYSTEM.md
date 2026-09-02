# CARTOGRAPHIE COMPLÈTE DU DESIGN SYSTEM CSS → FLUTTER (ANTIGRAVITY 2.0)

Ce document consigne la correspondance exhaustive entre le Design System CSS réel d'Antigravity 2.0 (ag-doctor-ui/src/renderer/styles.css, doctor-ui.js, wizardHtml.js) et son implémentation native au sein de l'application Flutter (remote/mobile).

---

## 1. Surfaces & Canvas (Zinc Scale)

| Variable CSS (styles.css) | Valeur Hex / RGBA | Équivalent Flutter | Utilisation & Sémantique |
|---|---|---|---|
| --bg-0 | #09090B | AppColors.surfaceBase / AppGradients.zenithal | Canvas de fond le plus profond |
| --bg-1 | #18181B | AppColors.surfaceRaised / AppColors.panel | Surface d'application (panneaux latéraux, drawers) |
| --bg-2 | #27272A | AppColors.surfaceInput | Conteneurs d'input, cartes intérieures |
| --bg-3 | #3F3F46 | AppColors.surfaceHover | Surface surélevée au survol et focus |
| --bg-4 | #52525B | AppColors.surfaceBorder | Bordures prononcées et hover actif |

---

## 2. Glassmorphism & Translucidité

| Variable CSS | Valeur RGBA | Équivalent Flutter | Utilisation |
|---|---|---|---|
| --glass-bg | rgba(24, 24, 27, 0.85) | AppColors.glassBg (0xD918181B) | Verre standard pour cartes flottantes |
| --glass-bg-tier-1 | rgba(24, 24, 27, 0.90) | AppColors.glassBgTier1 (0xE618181B) | Navigation rail et en-tête supérieur |
| --glass-bg-tier-2 | rgba(39, 39, 42, 0.75) | AppColors.glassBgTier2 (0xBF27272A) | Panneaux héro et surfaces de dialogue |
| --glass-bg-strong | rgba(39, 39, 42, 0.95) | AppColors.glassBgStrong (0xF227272A)| Modales et fiches d'approbation d'outils |
| --glass-border | rgba(255, 255, 255, 0.08)| AppColors.glassBorder (0x14FFFFFF) | Liseré de verre subtil (1 px) |
| --glass-border-strong | rgba(255, 255, 255, 0.15)| AppColors.glassBorderStrong (0x26FFFFFF)| Liseré renforcé sur surfaces actives |
| --glass-inner-highlight| rgba(255, 255, 255, 0.03)| AppColors.glassInnerHighlight (0x08FFFFFF)| Reflet intérieur au sommet des cartes |

---

## 3. Accents & Dégradés de Marque

| Variable CSS | Valeur CSS | Équivalent Flutter | Utilisation |
|---|---|---|---|
| --accent-blue | #2563EB | AppColors.accentBlue | Boutons d'action principaux, focus |
| --accent-blue-bright | #3B82F6 | AppColors.accentBlueBright | Hover et éléments actifs cliquables |
| --accent-purple | #8B5CF6 | AppColors.accentPurple | Modèles Custom / Anthropic / Agents |
| --accent-purple-bright| #A78BFA | AppColors.accentPurpleBright | Badges et icônes de sous-agents |
| --accent-cyan | #06B6D4 | AppColors.accentCyan | Indicateurs de streaming et requêtes réseau |
| --gradient-primary | 135deg, #2563EB → #1D4ED8 | AppGradients.primaryLinear | Bouton primaire et branding héro |
| --gradient-accent | 135deg, #2563EB → #3B82F6 | AppGradients.accentLinear | Liserés de sélection et badges premium |
| --gradient-header | 180deg, #18181B → #09090B | AppGradients.headerLinear | Fond des barres de titre et de navigation |

---

## 4. Statuts Opérationnels & Remplissages Subtils

| Variable CSS | Couleur Texte | Fond Subtil (--*-bg) | Bordure Subtile (--*-border) | Équivalents Flutter |
|---|---|---|---|---|
| Succès / OK | #22C55E (--ok) | rgba(34, 197, 94, 0.12) | rgba(34, 197, 94, 0.25) | AppColors.positive, AppColors.okBg, AppColors.okBorder |
| Avertissement | #EAB308 (--warn) | rgba(234, 179, 8, 0.12) | rgba(234, 179, 8, 0.25) | AppColors.warning, AppColors.warnBg, AppColors.warnBorder |
| Erreur / Danger | #EF4444 (--err) | rgba(239, 68, 68, 0.12) | rgba(239, 68, 68, 0.25) | AppColors.danger, AppColors.errBg, AppColors.errBorder |
| Information | #3B82F6 (--info) | rgba(59, 130, 246, 0.12) | rgba(59, 130, 246, 0.25) | AppColors.info, AppColors.infoBg, AppColors.infoBorder |

---

## 5. Typographie & Contrastes

| Token CSS | Échelle CSS | Équivalent Flutter (AppTypography / TextTheme) | Rôle |
|---|---|---|---|
| --fs-xs | 11px | AppTypography.caption / labelMedium | Métadonnées monospace, numéros de ligne |
| --fs-sm | 12px | AppTypography.bodySmall | Étapes d'exécution, badges d'outils |
| --fs-base | 13px | AppTypography.bodyMedium | Texte courant de conversation, boutons |
| --fs-md | 14px | AppTypography.titleSmall / titleMedium | Titres de cartes, en-têtes d'onglets |
| --fs-lg | 16px | AppTypography.titleMedium | En-têtes d'écrans et modals |
| --fs-xl | 20px | AppTypography.titleLarge | Grands titres de sections |
| --fs-2xl | 26px | displaySmall | Valeurs chiffrées héro (KPIs, quotas) |
| --fs-3xl | 32px | displayMedium | Chiffres d'accueil Welcome |
| --fw-regular | 400 | FontWeight.w400 | Texte de lecture standard |
| --fw-medium | 500 | FontWeight.w500 | Labels d'interaction et verbes d'action |
| --fw-semibold | 600 | FontWeight.w600 | Titres et boutons |
| --fw-bold | 700 | FontWeight.w700 | Chiffres d'alerte et logos |

---

## 6. Géométrie & Rayons de Courbure (Border Radius)

| Token CSS | Rayon CSS | Équivalent Flutter (AppRadius) | Utilisation |
|---|---|---|---|
| --r-sm | 4px | AppRadius.xs (4.0) | Badges de diff, chips de code, tags |
| --r-md | 6px | AppRadius.sm (6.0) | Boutons compacts, boîtes de console terminal |
| --r-lg | 10px | AppRadius.md (8.0 / 10.0) | Cartes standards, menus déroulants, inputs |
| --r-xl | 14px | AppRadius.lg (12.0 / 14.0) | Modales, volets coulissants, bottom sheets |
| --r-pill | 999px | AppRadius.pill (999.0) | Pilules de statut, pastilles d'agent en cours |

---

## 7. Système d'Élévations & Ombres (AppShadows)

| Token CSS | Définition CSS | Équivalent Flutter (AppShadows) | Effet Visuel |
|---|---|---|---|
| --shadow-sm | 0 1px 0 hsla(0, 0%, 0%, 0.4) | AppShadows.sm | Séparation discrète sous liseré |
| --shadow-md | 0 3px 6px hsla(0, 0%, 0%, 0.4) | AppShadows.md | Élévation standard des cartes |
| --shadow-lg | 0 8px 24px hsla(0, 0%, 0%, 0.5) | AppShadows.lg | Modales et dialogues suspendus |
| --shadow-glass | 0 8px 32px hsla(220, 40%, 4%, 0.45) | AppShadows.glass | Effet de profondeur sur panneau translucide |
| --shadow-glow-blue | 0 0 18px hsla(217, 91%, 60%, 0.30) | AppShadows.glowBlue | Halo bleuté d'agent actif ou focus input |
| --shadow-rail-elevation | 8px 0 24px hsla(220, 40%, 4%, 0.35) | AppShadows.railElevation | Ombre portée latérale sur drawer ouvert |

---

## 8. Courbes & Durées Temporelles (AppMotion)

| Token CSS | Durée / Courbe CSS | Équivalent Flutter (AppMotion) | Utilisation |
|---|---|---|---|
| --t-fast | 120ms | AppMotion.fast (Duration(milliseconds: 120)) | Micro-interactions, hover, clics |
| --t-base | 180ms | AppMotion.base (Duration(milliseconds: 180)) | Ouvertures d'accordéons et onglets |
| --t-slow | 320ms | AppMotion.slow (Duration(milliseconds: 320)) | Transitions d'écrans et tiroirs latéraux |
| --ease | cubic-bezier(0.4, 0, 0.2, 1) | AppMotion.easeStandard | Accélération et décélération symétrique |
| --ease-out | cubic-bezier(0.16, 1, 0.3, 1) | AppMotion.expoOut | Décélération fluide pour entrées d'écrans |
