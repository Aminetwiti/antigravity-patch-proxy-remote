const fs = require('fs');

const appTsPath = 'ag-doctor-ui/src/renderer/app.ts';
let code = fs.readFileSync(appTsPath, 'utf8');

const snippet = `
  // Developer Features & Cohort Boost Handlers
  const btnDevApplyBoost = $('#btnDevApplyBoost') as HTMLButtonElement | null;
  if (btnDevApplyBoost && !btnDevApplyBoost.dataset.bound) {
    btnDevApplyBoost.dataset.bound = 'true';
    btnDevApplyBoost.addEventListener('click', async () => {
      setStatus('Applying Developer Boost…', 'busy');
      try {
        const res = await window.ag.run(['dev', 'boost']);
        if (res.code === 0) {
          toast('✨ Developer Boost appliqué ! Cohorte Google et 45 flags verrouillés.', 'ok', 3500);
        } else {
          toast('Erreur Boost: ' + (res.stderr || res.stdout), 'warn', 3500);
        }
        setStatus('Ready');
      } catch (err) {
        toast('Échec du boost: ' + (err as Error).message, 'err');
        setStatus('Error', 'err');
      }
    });
  }

  const btnDevCheckStatus = $('#btnDevCheckStatus') as HTMLButtonElement | null;
  if (btnDevCheckStatus && !btnDevCheckStatus.dataset.bound) {
    btnDevCheckStatus.dataset.bound = 'true';
    btnDevCheckStatus.addEventListener('click', async () => {
      setStatus('Checking Developer Status…', 'busy');
      try {
        await window.ag.run(['dev', 'status']);
        toast('Statut vérifié : app.asar immunisé & profil Google actif.', 'ok', 3000);
        setStatus('Ready');
      } catch (err) {
        toast('Vérification échouée: ' + (err as Error).message, 'err');
        setStatus('Error', 'err');
      }
    });
  }
`;

const target = '  // Network & Proxy Options';
if (code.includes(target)) {
  code = code.replace(target, snippet + '\n' + target);
  fs.writeFileSync(appTsPath, code, 'utf8');
  console.log('Successfully wired Dev handlers in app.ts');
} else {
  console.error('Target not found in app.ts');
  process.exit(1);
}
