# 12. Registre des Espaces de Travail (`storage.json`)

> **Localisation & Résolution des Workspaces VS Code**

---

## 1. Emplacement du Fichier
`%APPDATA%\Antigravity IDE\User\globalStorage\storage.json`

---

## 2. Structure des Clés Utiles

```json
{
  "backupWorkspaces": {
    "folders": [
      { "folderUri": "file:///c%3A/Users/amine/Downloads/antigravity-add-model-main" },
      { "folderUri": "file:///c%3A/Users/amine/Desktop/mon-projet" }
    ]
  },
  "windowsState": {
    "lastActiveWindow": {
      "folder": "file:///c%3A/Users/amine/Downloads/antigravity-add-model-main"
    }
  }
}
```

---

## 3. Décodage des URIs Windows
Les URIs encodées (ex: `file:///c%3A/Users/...`) sont automatiquement décodées en chemins absolus Windows normaux (`C:\Users\...`) par le Daemon Go avant d'être transmises au Mobile.
