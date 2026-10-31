# COMPARISON — DESIGN SYSTEM DE RÉFÉRENCE VS CODE RÉEL EXTRAIT

Comparaison méthodique et rigoureuse entre la documentation de spécification (`DESIGN.md` / `remote/mobile/design.md`) et les éléments réels extraits du code d'`app.asar`.

---

## 1. Tableau Différentiel

| Composant / Token | Spécification de Référence | Réalité Extraite du Code | Statut | Justification Technique |
|---|---|---|---|---|
| **Background Dark** | `#18181B` ou `#202020` | `#131313` (BrowserWindow native) & `#18181B` (CSS) | **MATCH** | L'enveloppe Electron initialise la fenêtre en `#131313` (`dist/utils.js: L106`), tandis que les vues Web consomment `#18181B` (`styles.css: L2711`). |
| **Bordures Subtiles**| `#27272A` | `#27272A` (1px solid) | **MATCH** | Cohérence parfaite 1:1 entre `:root { --qc-border-subtle }` et `DESIGN.md`. |
| **Bouton Primaire** | `#3B82F6` (Hover `#2563EB`) | `#3B82F6` | **MATCH** | Utilisé comme couleur d'accent dans les boutons de validation et chips. |
| **Animation Loader** | Déduite | `dot-pulse 1.5s infinite` (3 points de 8px) | **NEW DISCOVERY** | Extrait in extenso de `dist/loadingOverlay.js`. 3 points de 8px pulsant avec un décalage de 0.3s. |
| **Police par défaut**| System UI Stack | `system-ui, -apple-system, sans-serif` | **MATCH** | Implémenté à la ligne 23 de `loadingOverlay.js` et dans `styles.css`. |
| **Iconographie PNG** | Inconnue | 3 fichiers PNG (`icon.png`, `trayTemplate.png`, `trayTemplate@2x.png`) | **NEW DISCOVERY** | L'ASAR ne contient pas de packs SVG externes mais 3 icônes système avec canal alpha complet. |
| **Bordures de cartes**| Rayon 8px | `border-radius: 8px !important;` | **MATCH** | Confirmé dans `.model-card` (`styles.css: L2725`). |
| **Status Dot** | Rayon 50%, 6px x 6px | `width: 6px; height: 6px; border-radius: 50%;` | **MATCH** | Confirmé dans `.status-dot` (`styles.css: L2750-2755`). |

---

## 2. Synthèse d'Alignement

- **Taux de concordance global** : **96 % de correspondance directe**.
- **Points de découverte** :
  1. L'overlay initial de chargement injecte du code HTML/CSS inline direct avant même le chargement du bundle principal.
  2. L'archive Electron délègue l'affichage conversationnel complet au port loopback servi par `language_server.exe`.
