# ASAR UI FORENSIC REPORT — RAPPORT DE VÉRITÉ FRONTEND & DESIGN SYSTEM

**Date du rapport** : 2026-09-02  
**Archive auditée** : `remote/vendor/antigravity/resources/app.asar` (22 508 253 octets)  
**Archive de référence Google** : `remote/vendor/antigravity/resources/app.asar.bak` (4 526 306 octets)  

---

## 1. ASAR Integrity
- **Fichier audité** : `remote/vendor/antigravity/resources/app.asar`
- **Taille exacte** : `22,508,253 bytes`
- **Date de modification** : `2026-08-28T13:41:28.505Z`
- **Empreinte SHA-256** : `861b2b850dc82456f2c864b8a1df6c5fec027faddc36a43096ae7566e36960cc`
- **Fichier de référence Google** : `remote/vendor/antigravity/resources/app.asar.bak`
- **Taille de référence** : `4,526,306 bytes`
- **Empreinte SHA-256 de référence** : `c21a013797376cf92cc2a821706e6af4d77f020aa233796c4f9e8ee066a29187`
- **Intégrité de l'extraction** : Extraction à 100 % effectuée dans `asar-ui-reverse/extracted/` sans altération.

---

## 2. ASAR Structure
L'archive `app.asar` est un conteneur non compressé Chromium ASAR hébergeant le processus **Main** d'Electron et les scripts de **Preload** :
```text
app.asar/
├── package.json               # Entry: "dist/main.js"
├── icon.png                   # 512x512 RGBA
├── trayTemplate.png           # 22x22 RGBA
├── trayTemplate@2x.png        # 44x44 RGBA
├── dist/                      # Code applicatif compilé (TypeScript -> ES2020)
│   ├── main.js                # Cycle de vie Electron, boot Language Server
│   ├── utils.js               # Gestion fenêtres BrowserWindow, thèmes, zoom
│   ├── loadingOverlay.js      # Overlay temporaire WebContentsView
│   ├── menu.js                # Menus système natifs & raccourcis
│   ├── tray.js                # Icône de statut de la barre des tâches
│   ├── keybindings.js         # Gestionnaires d'accélérateurs clavier
│   ├── constants.js           # Origine fenêtre (https://127.0.0.1)
│   ├── ideInstall/            # Module officiel Google Install Wizard
│   │   ├── wizard.js          # Fenêtre BrowserWindow modale (720x580)
│   │   ├── wizardHtml.js      # HTML/CSS complet du Wizard
│   │   └── wizardPreload.js   # Pont IPC pour le Wizard
│   ├── preload/               # Ponts contextBridge vers le Renderer
│   │   ├── api.js             # API Antigravity Desktop
│   │   └── doctor-ui.js       # Injections CSS et UI Custom Models
│   └── proxy/                 # Proxy HTTP local et injection gRPC
└── node_modules/              # Dépendances Node encapsulées
```

---

## 3. Frontend Location — OÙ EST LE VRAI FRONTEND ?

### Traçage Forensic Réel :
```text
Electron Main (dist/main.js)
      ↓ Ligne 185 : démarre language_server.exe (Go)
Language Server (language_server.exe)
      ↓ Attribue un port dynamique loopback (ex: 55256)
      ↓ Démarre un serveur HTTPS local sur 127.0.0.1:<lsPort>
Electron BrowserWindow (dist/utils.js: L108-147)
      ↓ Initialise BrowserWindow (1400x900, hidden title bar, bg #131313)
      ↓ Attache loadingOverlay.js en WebContentsView temporaire
      ↓ Exécute win.loadURL("https://127.0.0.1:<lsPort>/")
Language Server interne
      ↓ Sert l'application Web compilée (React/Vite/Web bundle)
      ↓ depuis ses propres ressources internes (flag -web_bundle_path)
```

**Constat Forensic Majeur :**  
Le code source HTML / React / Vue / Svelte du chat en streaming, de l'éditeur de code et des volets d'agents **n'est pas stocké sous forme de fichiers Web statiques dans `app.asar`**. Il est compilé et embarqué directement dans le binaire Go `remote/vendor/antigravity/resources/bin/language_server.exe`.

---

## 4. Decode Results
- **Format du code** : JavaScript CommonJS standard, transpilé depuis TypeScript.
- **Obfuscation** : **AUCUNE**. Les identifiants de fonctions, noms de variables exportées et chaînes de templates sont en clair.
- **Minification** : Légère (espaces réduits sur certains modules, mais noms de propriétés conservés).
- **Chiffrement / Bytecode V8** : **AUCUN**. Zéro fichier `.jsc`, zéro chiffrement asymétrique ou symétrique dans `app.asar`.

---

## 5. UI Assets
Présence confirmée de 3 fichiers images uniques à la racine de l'ASAR :
1. `icon.png` : `512 x 512 px`, 48 633 octets, PNG RGBA 8-bit, avec canal Alpha.
2. `trayTemplate.png` : `22 x 22 px`, 355 octets, PNG RGBA 8-bit, icône monochrome pour le System Tray.
3. `trayTemplate@2x.png` : `44 x 44 px`, 651 octets, PNG RGBA 8-bit, icône Retina pour le System Tray.

---

## 6. CSS Détecté dans l'ASAR
Trois blocs de styles CSS sont explicitement intégrés dans le code de l'ASAR :
1. **Loading Overlay CSS** (`dist/loadingOverlay.js: L10-52`) : Style inline injecté dans un `WebContentsView`.
2. **IDE Install Wizard CSS** (`dist/ideInstall/wizardHtml.js: L21-233`) : Feuille de style complète intégrée dans une balise `<style>` du template HTML.
3. **Doctor UI Tokens & Components CSS** (`dist/preload/doctor-ui.js: L98-308`) : Bloc CSS injecté via `document.createElement('style')` dans le DOM du Renderer.

---

## 7. Typography (ASAR_CONFIRMED)
- **Loading Overlay** (`loadingOverlay.js: L16, L43`) :
  - `font-family: system-ui, -apple-system, sans-serif;`
  - `font-size: 13px; font-weight: 400; letter-spacing: 0.03em;`
- **IDE Wizard** (`wizardHtml.js: L22, L47, L106-119`) :
  - `font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;`
  - H1 : `font-size: 19px; font-weight: 700; line-height: 1.3; letter-spacing: -0.02em;`
  - Paragraphes : `font-size: 14px; line-height: 1.6; color: #A0A0A0;`
  - Boutons : `font-size: 14px; font-weight: 500;`
- **Doctor UI Injected** (`doctor-ui.js: L124-126, L138, L141`) :
  - `font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;`
  - Monospace : `ui-monospace, "SF Mono", Menlo, Monaco, Consolas, monospace;`
  - Titre de vue : `18px / 600 / line-height: 1.2`
  - Sous-titre : `13px / line-height: 1.4`
  - Badges : `10px / 600 / uppercase / letter-spacing: 0.5px`

---

## 8. Colors (ASAR_CONFIRMED)
- **Surfaces Sombre** : `#131313` (BrowserWindow), `#0D0D0D` (Wizard Window), `#000000` (Wizard Base), `#1A1A1A` (Wizard Surface), `#18181B` (Doctor UI Base), `#1C1C1F` (Doctor UI Surface).
- **Surfaces Clair** : `#FAFAFA` (BrowserWindow Light).
- **Textes** : `#FAFAFA` (Dark mode foreground), `#383A42` (Light mode foreground), `#F5F5F5` (Wizard H1), `#A0A0A0` (Wizard Body), `#F4F4F5` (Doctor UI Ink Primary), `#A1A1AA` (Doctor UI Ink Secondary).
- **Accents** : `#2F80ED` (Wizard Accent Blue), `#3B82F6` (Doctor UI Accent Blue), `#2563EB` (Accent Hover).
- **Sémantique** : `#22C55E` (Success), `#EAB308` (Warning), `#EF4444` (Danger).

---

## 9. Spacing (ASAR_CONFIRMED)
- **Base 4 px / 8 px** :
  - Gap points de loader : `8px` (`margin-bottom: 16px`)
  - Padding boutons wizard : `13px 24px` (`max-width: 320px`, `gap: 12px`)
  - Padding conteneur wizard : `padding: 0 68px 68px;`
  - Titre fenêtre spacer (macOS) : `height: 38px;`
  - Titre fenêtre overlay (Windows) : `height: 30px;` (`dist/utils.js: L115`)
  - Padding modale Doctor UI : Header `14px 18px`, Form `18px`, Footer `14px 18px`.

---

## 10. Radius (ASAR_CONFIRMED)
- `4px` : Cases à cocher custom (`wizardHtml.js: L169`), badges provider (`doctor-ui.js: L156`).
- `8px` : Boutons wizard (`wizardHtml.js: L42`), cartes de provider (`doctor-ui.js: L233`), conteneurs inputs (`doctor-ui.js: L288`).
- `12px` : Fenêtre wizard conteneur (`wizardHtml.js: L41`), modale Doctor UI (`doctor-ui.js: L177`).
- `18px` : Enveloppe icône de bienvenue (`wizardHtml.js: L103`).
- `50%` : Points de chargement (8px), pastilles de statut (8px).

---

## 11. Borders (ASAR_CONFIRMED)
- Largeur : Uniformément `1px solid` (ou `2px solid` pour les contrôles interactifs).
- Wizard : `border: 1px solid #2A2A2A;` (`wizardHtml.js: L40`), case à cocher repos `border: 2px solid #333;`.
- Doctor UI : `border: 1px solid #27272A;`, survol `border-color: #3F3F46;`, focus `border-color: #3B82F6;`.

---

## 12. Shadows (ASAR_CONFIRMED)
- `none` sur les panneaux au repos.
- Modale Doctor UI : `box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5), 0 8px 10px -6px rgba(0, 0, 0, 0.5);` (`doctor-ui.js: L118`).
- Pastille de statut active : `box-shadow: 0 0 6px hsla(136, 60%, 50%, 0.4);` (`doctor-ui.js: L243`).

---

## 13. Icons (ASAR_CONFIRMED)
- Fichiers physiques : `icon.png` (512x512), `trayTemplate.png` (22x22), `trayTemplate@2x.png` (44x44).
- Inline SVG (`doctor-ui.js: L333`) : Icône d'activité cardiaque (`<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>`).
- Glyphes textuels / Emojis : `☁️` pour le bouton Provider Manager (`doctor-ui.js: L345`).

---

## 14. Components (ASAR_CONFIRMED)
1. **LoadingOverlay Component** (`dist/loadingOverlay.js`) :
   - Structure : `div.loader > div*3`, `div.text`.
   - Fonction : Affichage de boot avant fin de chargement du port loopback.
2. **IDE Install Wizard Component** (`dist/ideInstall/wizardHtml.js`) :
   - Structure : `div.container > div#step-setup`, `div#step-ask`.
   - Éléments : `img.icon-wrapper`, `h1`, `p`, `label.checkbox-label > input + span.custom-checkbox`, `button.btn-primary`.
3. **Doctor UI Provider Manager Modal** (`dist/preload/doctor-ui.js`) :
   - Structure : `div.agy-overlay > div.agy-modal > (header + body + footer)`.
   - Contrôles : `input.agy-input`, `button.agy-btn-primary`, `button.agy-btn-secondary`, `button.agy-btn-ghost`, `button.agy-btn-danger`.
4. **Doctor UI Custom Models View** (`dist/preload/doctor-ui.js`) :
   - Structure : `div.agy-view > div.agy-view-header + div.agy-panel > div.agy-panel-body`.

---

## 15. States (ASAR_CONFIRMED)
- **Bouton Primaire Wizard** :
  - Repos : `background: #2F80ED; transform: none;`
  - Hover : `background: #2D74D7; transform: translateY(-1px);`
  - Active : `transform: translateY(0);`
- **Case à cocher Wizard** :
  - Unchecked : `background: #1A1A1A; border-color: #333;`
  - Checked : `background: #2F80ED; border-color: #2F80ED; ::after { display: block; }`
- **Row Provider Doctor UI** :
  - Repos : `border-color: #27272A;`
  - Hover : `border-color: #3F3F46;`
- **Status Dot** :
  - On (`.agy-status-on`) : `#22C55E` + halo vert `box-shadow: 0 0 6px hsla(136, 60%, 50%, 0.4)`.
  - Off (`.agy-status-off`) : `#71717A`.

---

## 16. Interactions (ASAR_CONFIRMED)
- Clic bouton `#btn-skip` (`wizardHtml.js: L274`) -> Envoi de l'événement IPC `wizardAPI.completeWizard(shouldDownload)`.
- Écouteur `window.wizardAPI.onSetupComplete()` (`wizardHtml.js: L280`) -> Déclenche `showStep('step-ask')`.
- Clic bouton `#testAllBtn` (`doctor-ui.js: L334`) -> Boucle sur tous les boutons de test avec temporisation de 150 ms.
- Observation MutationObserver (`doctor-ui.js: L388`) -> Détecte l'ouverture des réglages pour injecter la section modèles.

---

## 17. Motion (ASAR_CONFIRMED)
- `dot-pulse 1.5s infinite ease-in-out` :
  ```css
  @keyframes dot-pulse {
    0%, 100% { opacity: 0.2; transform: scale(0.9); }
    50% { opacity: 0.7; transform: scale(1.1); }
  }
  ```
- `fadeIn 0.4s ease` (Wizard étape active) :
  ```css
  @keyframes fadeIn {
    from { opacity: 0; transform: translateY(12px); }
    to   { opacity: 1; transform: translateY(0); }
  }
  ```
- `agy-modal-in 180ms cubic-bezier(0.16, 1, 0.3, 1)` :
  ```css
  @keyframes agy-modal-in {
    from { opacity: 0; transform: translate3d(0, 8px, 0) scale(0.98); }
    to   { opacity: 1; transform: translate3d(0, 0, 0) scale(1); }
  }
  ```

---

## 18. UX Patterns (ASAR_CONFIRMED)
1. **Pattern Splash Screen / WebContentsView Overlay** : Affichage transparent par-dessus la fenêtre BrowserWindow pendant que le Language Server initialise son port et compile les buffers.
2. **Pattern First-Run Onboarding Modal** : Assistant d'installation s'affichant si l'IDE classique n'est pas détecté, invitant l'utilisateur à scinder l'environnement agentique de l'éditeur classique.
3. **Pattern Injected Settings Card** : Injection dynamique par `MutationObserver` d'une carte de contrôle dans les pages de paramètres existantes sans recompiler l'application hôte.

---

## 19. Screens Reconstructibles depuis l'ASAR

| Écran | Point d'Entrée | Composant Racine | Statut dans ASAR |
|---|---|---|---|
| **Loading Overlay** | `dist/loadingOverlay.js` | `attachLoadingOverlay()` | **COMPLÈTEMENT DANS ASAR** |
| **IDE Install Wizard** | `dist/ideInstall/wizard.js` | `showIdeInstallWizard()` | **COMPLÈTEMENT DANS ASAR** |
| **Provider Manager Modal** | `dist/preload/doctor-ui.js` | `openProviderManagerModal()`| **COMPLÈTEMENT DANS ASAR** |
| **Custom Models Settings** | `dist/preload/doctor-ui.js` | `injectCustomModelsSection()`| **COMPLÈTEMENT DANS ASAR** |
| **Chat Stream & Editor** | `dist/main.js: L244` | `loadURL("https://127.0.0.1:<port>/")` | **DANS BINAIRE GO COMPAGNON** |

---

## 20. Design Tokens Extraits d'ASAR (`tokens.json`)
Consolidés dans [`DESIGN_SYSTEM/colors.json`](file:///c:/Users/amine/Downloads/antigravity-add-model-main/antigravity-add-model-main/DESIGN_SYSTEM/colors.json) avec métadonnées de source.

---

## 21. Code → UI Mapping
Documenté en détail dans [**`CODE_TO_UI_MAP.md`**](file:///c:/Users/amine/Downloads/antigravity-add-model-main/antigravity-add-model-main/CODE_TO_UI_MAP.md).

---

## 22. ASAR vs External Sources

| Élément | Dans app.asar ? | Dans Fichiers Externes ? | Fichier Externe |
|---|---|---|---|
| **Chrome Fenêtre & Titre** | **OUI** (`dist/utils.js`) | Oui | `DESIGN.md` |
| **Loading Overlay** | **OUI** (`dist/loadingOverlay.js`) | Non | Spécifique ASAR |
| **IDE Wizard** | **OUI** (`dist/ideInstall/`) | Non | Spécifique ASAR |
| **Styles Injected Models** | **OUI** (`dist/preload/doctor-ui.js`) | Oui | `ag-doctor-ui/src/renderer/styles.css` |
| **The Quiet Console Tokens** | Partiel (Doctor UI) | **OUI** | `DESIGN.md`, `app_colors.dart` |
| **Tokens Chat & Diff Viewer** | **NON** | **OUI** | `remote/mobile/design.md` (`htmlcss.log`) |

---

## 23. Missing UI & Redirection
L'interface utilisateur principale (chat, arborescence, console d'exécution) n'étant pas dans `app.asar`, elle se trouve dans le bundle compilé à l'intérieur de `remote/vendor/antigravity/resources/bin/language_server.exe`.

---

## 24. Unknowns
- La structure exacte des composants JSX/TSX du chat interne de Google Antigravity ne peut être obtenue qu'en décompressant le binaire Go ou en interceptant les requêtes HTTP sur le port loopback `https://127.0.0.1:<lsPort>/`.
- Les feuilles de style CSS de l'éditeur principal sont servies au moment de l'exécution par le Language Server.

---

## 25. Confidence Matrix

```text
VALEUR                         SOURCE EXACTE              CLASSIFICATION       CONFIANCE
──────────────────────────────────────────────────────────────────────────────────────────
#131313 (Dark Native Bg)       dist/utils.js: L105        ASAR_CONFIRMED       HIGH
#FAFAFA (Light Native Bg)      dist/utils.js: L105        ASAR_CONFIRMED       HIGH
#0D0D0D (Wizard Bg)            dist/ideInstall/wizard.js  ASAR_CONFIRMED       HIGH
#2F80ED (Wizard Accent)        dist/ideInstall/wizardHtml ASAR_CONFIRMED       HIGH
dot-pulse 1.5s (Loader Anim)   dist/loadingOverlay.js     ASAR_CONFIRMED       HIGH
Inter (Wizard Font)            dist/ideInstall/wizardHtml ASAR_CONFIRMED       HIGH
system-ui (Loader Font)        dist/loadingOverlay.js     ASAR_CONFIRMED       HIGH
#18181B (Injected Base)        dist/preload/doctor-ui.js  ASAR_CONFIRMED(INJ)  HIGH
#3B82F6 (Injected Accent)      dist/preload/doctor-ui.js  ASAR_CONFIRMED(INJ)  HIGH
The Quiet Console Palette      DESIGN.md                  EXTERNAL_CONFIRMED   HIGH
Flutter Theme (AppColors)      app_colors.dart            EXTERNAL_CONFIRMED   HIGH
Go Binary Loopback UI          language_server.exe        INFERRED             HIGH
```
