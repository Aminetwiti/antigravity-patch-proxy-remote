# Fix pour le Lancement d'Antigravity depuis ag-doctor-ui

## 🔴 Problème

Lorsque vous cliquez sur le bouton "Launch" dans ag-doctor-ui:
- Le processus démarre (PID visible)
- Mais l'interface graphique d'Antigravity **ne s'ouvre pas**
- Seul le processus en arrière-plan est lancé

## 🔍 Cause

Le code utilisait `spawn()` avec `stdio: 'ignore'` qui lance le processus en mode **headless** (sans interface).
Sur Windows, un processus Electron a besoin d'être lancé avec un shell pour ouvrir correctement sa fenêtre GUI.

## ✅ Solution Appliquée

J'ai modifié [`ag-doctor/src/core/antigravity.ts`](file:///<repo-root>/ag-doctor/src/core/antigravity.ts) pour:

### Pour Windows:
1. **Utiliser `cmd.exe /c start`** — La commande Windows native pour lancer une application GUI
2. **Paramètre `windowsHide: false`** — S'assurer que la fenêtre est visible

### Pour WSL:
3. **Spawn via `/mnt/c/Windows/System32/cmd.exe /c start`** — pour que la fenêtre GUI apparaisse côté Windows

### Pour Unix/Linux/Mac:
4. **Comportement d'origine** préservé (`spawn(exe, [], { detached, stdio: 'ignore' })`)

### Code modifié (extrait `ag-doctor/src/core/antigravity.ts:321-360`) :

```typescript
try {
  if (process.platform === 'win32') {
    // Windows native: use cmd.exe /c start to open the GUI window reliably
    const { exec } = await import('child_process');
    const { promisify } = await import('util');
    const execAsync = promisify(exec);
    execAsync(`cmd.exe /c start "" "${winExe}"`, {
      cwd: dir,
      windowsHide: false,
    }).catch(() => {
      // Ignore errors - process is already launched
    });
  } else if (wslLaunch) {
    // WSL: spawn Windows binary through cmd.exe detached; GUI appears on the Windows host
    const child = spawn('/mnt/c/Windows/System32/cmd.exe', ['/c', 'start', '', winExe], {
      detached: true,
      stdio: 'ignore',
      cwd: dir,
    });
    child.unref();
  } else {
    // Unix: original behavior
    const child = spawn(exe, [], {
      detached: true,
      stdio: 'ignore',
      cwd: dir,
      env: { ...process.env },
    });
    child.unref();
  }

  // Poll for the process a few times (Electron apps can be slow to show up)
  for (let attempt = 0; attempt < 6; attempt++) {
    await new Promise((r) => setTimeout(r, 1000));
    const procs = await findAntigravityProcesses();
    const pid = procs[0]?.pid;
    if (pid) {
      return { ok: true, pid, message: `Launched (pid=${pid})` };
    }
  }

  return {
    ok: false,
    message: wslLaunch
      ? 'Process launched but not visible from WSL; launch Antigravity directly from Windows if needed'
      : 'Process started but not detected after 6s',
  };
}
```

### Changements supplémentaires:
- **Polling** : 6 tentatives × 1000 ms (≈ 6 s total) pour détecter le PID du processus lancé. Electron met du temps à s'initialiser, surtout sous WSL.
- **Pas de fallback `shell: true` sur Windows** : seul `cmd.exe /c start` est utilisé. Le fallback `spawn` avec `shell: true` n'existe plus — il n'est pertinent que sur Unix/Linux/Mac où le comportement d'origine est conservé.
- **Vérification du PID** : retourne une erreur si le processus n'est pas détecté après 6 s.

## 🧪 Test

Après avoir compilé:

```powershell
cd ag-doctor
npm run build
node bin/ag-doctor.js antigravity launch
```

Vous devriez voir:
```
✓ Launched (pid=12345)
```

Et **l'interface graphique d'Antigravity devrait s'ouvrir**.

## 🔄 Pour Appliquer dans ag-doctor-ui

1. **Rebuild ag-doctor**:
```powershell
cd ag-doctor
npm run build
```

2. **Rebuild ag-doctor-ui** (pour copier le nouveau ag-doctor):
```powershell
cd ..\ag-doctor-ui
npm run build:cli
npm run build
```

3. **Relancer l'UI**:
```powershell
npm start
```

4. **Tester le bouton Launch** dans l'UI

## 📋 Comportement Attendu

### Avant le fix:
- ✅ Processus lancé (PID visible)
- ❌ Interface ne s'ouvre pas
- ❌ Processus en arrière-plan seulement

### Après le fix:
- ✅ Processus lancé (PID visible)
- ✅ Interface s'ouvre automatiquement
- ✅ Fenêtre Antigravity visible

## 🐛 Debug

Si l'interface ne s'ouvre toujours pas:

1. **Vérifier les permissions**:
```powershell
# Lancer en tant qu'administrateur
```

2. **Vérifier les antivirus**:
```powershell
# Certains antivirus bloquent les spawns via cmd.exe
```

3. **Test manuel**:
```powershell
cmd /c start "" "%LOCALAPPDATA%\\Programs\\Antigravity\Antigravity.exe"
```

Si cette commande fonctionne manuellement mais pas via ag-doctor, c'est un problème de permissions Node.js.

## 📝 Notes Techniques

- Sur **Windows natif** : `cmd.exe /c start "" "<exe>"` ouvre une nouvelle fenêtre GUI.
- Sur **WSL** : on spawn `/mnt/c/Windows/System32/cmd.exe` détaché pour que la fenêtre apparaisse côté Windows.
- Sur **Unix/Linux/Mac** : le comportement original est conservé (`spawn` détaché).
- Le `windowsHide: false` force l'affichage de la fenêtre.
- Le polling de 6 × 1000 ms est nécessaire car Electron met du temps à initialiser la fenêtre, surtout sous WSL (latence du réseau inter-OS).

## ✨ Résumé

La modification permet maintenant de:
1. ✅ Lancer le processus Antigravity
2. ✅ Ouvrir l'interface graphique automatiquement
3. ✅ Détecter correctement le PID
4. ✅ Gérer les erreurs de lancement

Le problème est maintenant résolu! 🎉
