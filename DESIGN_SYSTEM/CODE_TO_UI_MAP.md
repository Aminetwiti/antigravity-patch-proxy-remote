# CODE TO UI MAPPING — ANTIGRAVITY 2.0

Cette cartographie relie directement chaque composant visuel observé à son emplacement précis dans le code source de l'archive `app.asar` et des fichiers de style injectés.

---

## 1. Matrice Composant → Code

```text
COMPOSANT VISUEL           RÈGLE CSS                  FICHIER SOURCE (ASAR / REPO)
──────────────────────────────────────────────────────────────────────────────────────────
Fenêtre Principale         titleBarStyle: 'hidden'    app.asar -> dist/utils.js: L108-120
Écran de Chargement        body { margin: 0; }        app.asar -> dist/loadingOverlay.js: L15-45
  └─ Dot Pulse (3 points)  animation: dot-pulse 1.5s  app.asar -> dist/loadingOverlay.js: L41-44
Menu Système / Tray        new Tray(iconPath)         app.asar -> dist/tray.js: L30-65
Modale Provider Manager    .agy-modal                 ag-doctor-ui/src/renderer/styles.css: L2710
  └─ En-tête de modale     .agy-modal-header          ag-doctor-ui/src/renderer/styles.css: L2725
  └─ Bouton fermer         .agy-close                 ag-doctor-ui/src/renderer/styles.css: L2745
Carte de Modèle            .model-card                ag-doctor-ui/src/renderer/styles.css: L2725
  └─ Titre du modèle       .model-name                ag-doctor-ui/src/renderer/styles.css: L2735
  └─ Status Dot            .status-dot                ag-doctor-ui/src/renderer/styles.css: L2750
Toast d'Erreur Contexte    .agy-toast                 .impeccable/design.json: L56-58
Bouton Primaire            .agy-button-primary        DESIGN.md: L59-64
Chip Provider              .agy-badge                 DESIGN.md: L70-75
Champ de Saisie            input[type="text"]         DESIGN.md: L81-85
```

---

## 2. Décomposition de l'Implémentation

### A. Écran de Démarrage (`app.asar -> dist/loadingOverlay.js`)
- **Code exact extrait** :
```css
body {
  margin: 0;
  padding: 0;
  background: ${backgroundColor}; /* #131313 en mode sombre */
  color: ${foregroundColor};      /* #FAFAFA en mode sombre */
  font-family: system-ui, -apple-system, sans-serif;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100vh;
}
.loader {
  display: flex;
  gap: 8px;
  margin-bottom: 16px;
}
.loader div {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background-color: ${foregroundColor};
  opacity: 0.3;
  animation: dot-pulse 1.5s infinite ease-in-out;
}
@keyframes dot-pulse {
  0%, 100% { opacity: 0.2; transform: scale(0.9); }
  50% { opacity: 0.7; transform: scale(1.1); }
}
```

### B. Carte de Modèle Injectée (`ag-doctor-ui/src/renderer/styles.css`)
- **Code exact extrait** :
```css
#view-models .model-card {
  background-color: var(--qc-surface-base) !important; /* #18181b */
  border: 1px solid var(--qc-border-subtle) !important; /* #27272a */
  border-radius: 8px !important;
  padding: 12px 16px !important;
  box-shadow: none !important;
  transition: all 0.2s ease !important;
}

#view-models .model-card:hover {
  background-color: var(--qc-surface-raised) !important; /* #1c1c1f */
  border-color: var(--qc-border-strong) !important;      /* #3f3f46 */
}
```
