# Démarrer Antigravity avec modèles custom

> Note rapide — voir [ANTIGRAVITY_SETUP.md](ANTIGRAVITY_SETUP.md) pour le guide complet.

## 1. Lancer le MITM (admin)
Double-cliquer sur **Start Antigravity MITM.bat** sur le bureau.
Attendre : `[MITM-443] Listening on https://127.0.0.1:443`

## 2. Lancer Antigravity
Double-cliquer `Antigravity.exe` habituellement.

## 3. Vérifier
Les modèles configurés dans `custom_models.json` doivent apparaître dans le sélecteur de modèles d'Antigravity (Settings → Models).

Pour vérifier côté proxy :
```powershell
Get-Content "$env:APPDATA\Antigravity\logs\main.log" -Tail 30 | Select-String "Custom model|Loaded custom models"
```

## Docs complètes
Voir [ANTIGRAVITY_SETUP.md](ANTIGRAVITY_SETUP.md)
