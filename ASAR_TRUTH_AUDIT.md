# ASAR TRUTH AUDIT — AUDIT MÉTHODIQUE DU DESIGN SYSTEM

**Date d'audit** : 2026-09-02  
**Cible analysée** : `remote/vendor/antigravity/resources/app.asar` (SHA-256: `861b2b850dc82456f2c864b8a1df6c5fec027faddc36a43096ae7566e36960cc`) et `app.asar.bak` (Stock v2.11.0, SHA-256: `c21a013797376cf92cc2a821706e6af4d77f020aa233796c4f9e8ee066a29187`)  
**Règle de séparation des sources** :  
- **ASAR_CONFIRMED** : Trouvé directement et littéralement dans `app.asar`.  
- **EXTERNAL_CONFIRMED** : Trouvé dans les fichiers externes (`DESIGN.md`, `ag-doctor-ui/src/renderer/styles.css`, `remote/mobile/lib/theme/app_colors.dart`, `remote/mobile/design.md`, `.impeccable/design.json`).  
- **INFERRED** : Déduit par corrélation architecturale ou comportement dynamique.

---

## 1. Audit des Affirmations du Rapport Précédent

| Affirmation / Token | Source Citée Précédemment | Présent dans ASAR ? | Fichier Exact | Emplacement Précis | Preuve Réelle | Classification | Confiance |
|---|---|---|---|---|---|---|---|
| **Fond natif Sombre (`#131313`)** | `dist/utils.js` | **OUI** | `dist/utils.js` | Ligne 105 | `const backgroundColor = isLight ? '#FAFAFA' : '#131313';` | **ASAR_CONFIRMED** | **HIGH** |
| **Fond natif Clair (`#FAFAFA`)** | `dist/utils.js` | **OUI** | `dist/utils.js` | Ligne 105 | `const backgroundColor = isLight ? '#FAFAFA' : '#131313';` | **ASAR_CONFIRMED** | **HIGH** |
| **Texte natif Sombre (`#383A42`)** | `dist/utils.js` | **OUI** | `dist/utils.js` | Ligne 106 | `const foregroundColor = isLight ? '#383A42' : '#FAFAFA';` | **ASAR_CONFIRMED** | **HIGH** |
| **Texte natif Clair (`#FAFAFA`)** | `dist/utils.js` | **OUI** | `dist/utils.js` | Ligne 106 | `const foregroundColor = isLight ? '#383A42' : '#FAFAFA';` | **ASAR_CONFIRMED** | **HIGH** |
| **Taille Fenêtre (`1400x900`)** | `dist/utils.js` | **OUI** | `dist/utils.js` | Ligne 108 | `width: 1400, height: 900, minWidth: 500, minHeight: 400` | **ASAR_CONFIRMED** | **HIGH** |
| **Barre de titre macOS (`{x:12, y:12}`)** | `dist/utils.js` | **OUI** | `dist/utils.js` | Ligne 118 | `trafficLightPosition: { x: 12, y: 12 }` | **ASAR_CONFIRMED** | **HIGH** |
| **Animation Loader (`dot-pulse 1.5s`)** | `dist/loadingOverlay.js` | **OUI** | `dist/loadingOverlay.js` & `dist/main/windowManager.js` | Ligne 37-51 | `@keyframes dot-pulse { 0%,100%{opacity:0.2; transform:scale(0.9)} 50%{opacity:0.7; transform:scale(1.1)} }` | **ASAR_CONFIRMED** | **HIGH** |
| **Typo Loader (`system-ui`)** | `dist/loadingOverlay.js` | **OUI** | `dist/loadingOverlay.js` | Ligne 16 | `font-family: system-ui, -apple-system, sans-serif;` | **ASAR_CONFIRMED** | **HIGH** |
| **Texte Loader (`13px, 400, 0.03em`)** | `dist/loadingOverlay.js` | **OUI** | `dist/loadingOverlay.js` | Ligne 43-46 | `font-size: 13px; font-weight: 400; letter-spacing: 0.03em;` | **ASAR_CONFIRMED** | **HIGH** |
| **IDE Wizard Bg (`#0D0D0D` / `#000000`)** | Non audité avant | **OUI** | `dist/ideInstall/wizard.js` & `wizardHtml.js` | Ligne 67 (wiz) / Ligne 31 (html) | `backgroundColor: '#0D0D0D'`, `--bg-primary: #000000;` | **ASAR_CONFIRMED** | **HIGH** |
| **IDE Wizard Accent (`#2F80ED`)** | Non audité avant | **OUI** | `dist/ideInstall/wizardHtml.js` | Ligne 38-39 | `--accent: #2F80ED; --accent-hover: #2D74D7;` | **ASAR_CONFIRMED** | **HIGH** |
| **IDE Wizard Text (`#F5F5F5` / `#A0A0A0`)**| Non audité avant | **OUI** | `dist/ideInstall/wizardHtml.js` | Ligne 35-36 | `--text-primary: #F5F5F5; --text-secondary: #A0A0A0;` | **ASAR_CONFIRMED** | **HIGH** |
| **IDE Wizard Radius (`12px` / `8px`)** | Non audité avant | **OUI** | `dist/ideInstall/wizardHtml.js` | Ligne 41-42 | `--radius: 12px; --radius-sm: 8px;` | **ASAR_CONFIRMED** | **HIGH** |
| **IDE Wizard Font (`Inter`)** | Non audité avant | **OUI** | `dist/ideInstall/wizardHtml.js` | Ligne 22, 47 | `@import url('https://fonts.googleapis.com/css2?family=Inter...')` | **ASAR_CONFIRMED** | **HIGH** |
| **Tokens Injected (`--agy-bg-base: #18181b`)** | `dist/preload/doctor-ui.js` | **OUI** (dans ASAR courant repatché) | `dist/preload/doctor-ui.js` | Ligne 100-127 | `:root { --agy-bg-base: #18181b; ... }` | **ASAR_CONFIRMED (INJECTED)** | **HIGH** |
| **Classes Injected (`.agy-modal`, `.agy-view`)**| `dist/preload/doctor-ui.js` | **OUI** (dans ASAR courant repatché) | `dist/preload/doctor-ui.js` | Ligne 130-280 | `.agy-modal { background: var(--agy-bg-surface); ... }` | **ASAR_CONFIRMED (INJECTED)** | **HIGH** |
| **Palette Zinc Sombre (`--bg-0: #09090b`)**| `ag-doctor-ui/src/renderer/styles.css` | **NON** | `ag-doctor-ui/src/renderer/styles.css` | Ligne 9-30 | Externe au bundle ASAR | **EXTERNAL_CONFIRMED** | **HIGH** |
| **Palette Quiet Console (`--qc-*`)** | `ag-doctor-ui/src/renderer/styles.css` | **NON** | `ag-doctor-ui/src/renderer/styles.css` | Ligne 2710-2722 | Externe au bundle ASAR | **EXTERNAL_CONFIRMED** | **HIGH** |
| **Spécification The Quiet Console** | `DESIGN.md` | **NON** | `DESIGN.md` | Ligne 1-213 | Fichier de spec markdown racine | **EXTERNAL_CONFIRMED** | **HIGH** |
| **Couleurs IDE Flutter (`app_colors.dart`)**| `remote/mobile/lib/theme/app_colors.dart` | **NON** | `remote/mobile/lib/theme/app_colors.dart`| Ligne 1-265 | Code Dart client distant (dérivé d'htmlcss.log) | **EXTERNAL_CONFIRMED** | **HIGH** |
| **Web UI Complète de Chat & Editeur**| Aucune dans ASAR | **NON** | `remote/vendor/antigravity/resources/bin/language_server.exe` | Loopback `https://127.0.0.1:<lsPort>/` | Embarqué dans le binaire Go `language_server.exe` | **INFERRED (ARCHITECTURAL TRUTH)** | **HIGH** |

---

## 2. Conclusion Fondamentale de l'Audit

1. **Ce qui est RÉELLEMENT dans `app.asar` Stock (Google Officiel)** :
   - Le chrome de l'application Electron (`dist/main.js`, `dist/utils.js`).
   - L'écran natif de démarrage / chargement injecté (`dist/loadingOverlay.js`).
   - L'assistant d'installation et de bienvenue complet (`dist/ideInstall/wizard.js` et `dist/ideInstall/wizardHtml.js`).
   - Les 3 fichiers visuels d'icônes (`icon.png`, `trayTemplate.png`, `trayTemplate@2x.png`).
   - Le système de menus, de raccourcis clavier et de barre des tâches (`dist/menu.js`, `dist/keybindings.js`, `dist/tray.js`).
   
2. **Ce qui est dans `app.asar` Courant (Version Modifiée / Repatchée)** :
   - Les tokens de styles et composants injectés par `antigravity-patch-proxy` dans `dist/preload/doctor-ui.js` (`:root { --agy-* }`, modale `.agy-modal`, cartes `.agy-provider-row`, badges `.agy-badge`).

3. **Ce qui N'EST PAS dans `app.asar`** :
   - Le code source React / HTML / CSS du chat en temps réel, de l'éditeur de code, de l'arborescence des fichiers et des agents.
   - **Pourquoi ?** Parce que l'application est conçue comme un shell natif léger : le binaire Go compagnon `language_server.exe` démarre son propre serveur HTTPS local sur `127.0.0.1:<lsPort>`, et Electron charge cette URL (`https://127.0.0.1:<lsPort>/`). L'interface principale est compilée dans le binaire Go (ou fournie via `-web_bundle_path`).
