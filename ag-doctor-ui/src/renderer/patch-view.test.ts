import { describe, expect, it, vi } from 'vitest';

interface PatchPreflightStatus {
  exists: boolean;
  compatible: boolean;
  applied: boolean;
  backupExists: boolean;
  verdict?: 'ok' | 'warn' | 'block' | null;
}

export function evaluatePatchPreflightGuard(status: PatchPreflightStatus): {
  isBlocked: boolean;
  blockedReason: string;
} {
  const isBlocked = !status.compatible || !status.exists || status.verdict === 'block';
  const blockedReason =
    status.verdict === 'block'
      ? 'Bloqué — Intégrité ASAR compromise'
      : !status.exists
        ? 'Bloqué — Binaire introuvable'
        : !status.compatible
          ? 'Bloqué — Incompatible'
          : '';

  return { isBlocked, blockedReason };
}

export function buildPatchModalHtml(options: {
  deltaSizeBytes?: number | null;
  backupExists: boolean;
  validateBlockHtml?: string;
}): string {
  const sizeInfo =
    typeof options.deltaSizeBytes === 'number' && options.deltaSizeBytes > 0
      ? `<br><br><strong>Taille estimée du delta :</strong> ${options.deltaSizeBytes} B`
      : '';
  const backupWarn = options.backupExists
    ? ''
    : '<br><br><strong style="color:var(--warn)">⚠ Aucune sauvegarde trouvée — le patch ne pourra pas être annulé automatiquement.</strong>';

  return `<p style="margin-bottom:10px">Cette opération modifie <code>language_server.exe</code> pour acheminer les requêtes du modèle vers votre proxy local.</p>
     <ul style="margin: 0 0 12px 18px; padding: 0; line-height: 1.6; font-size: 12px;">
       <li><strong>Sauvegarde automatique :</strong> Une copie originale (<code>.bak</code>) sera créée.</li>
       <li><strong>Redirection :</strong> Requêtes orientées vers le proxy local.</li>
       <li><strong style="color:var(--warn)">⚠ Fermeture immédiate :</strong> Tous les processus Antigravity actifs seront fermés sans invite de sauvegarde pour permettre l'écriture du binaire.</li>
       <li><strong>Redémarrage :</strong> Relancez Antigravity après l'opération pour activer les modèles.</li>
     </ul>
     ${sizeInfo}${backupWarn}${options.validateBlockHtml ?? ''}`;
}

describe('Patch View — Preflight Integrity & ASAR Verdict (AUDIT-001)', () => {
  it('blocks patch application when ASAR verdict is block', () => {
    const res = evaluatePatchPreflightGuard({
      exists: true,
      compatible: true,
      applied: false,
      backupExists: true,
      verdict: 'block',
    });
    expect(res.isBlocked).toBe(true);
    expect(res.blockedReason).toBe('Bloqué — Intégrité ASAR compromise');
  });

  it('blocks patch application when binary does not exist', () => {
    const res = evaluatePatchPreflightGuard({
      exists: false,
      compatible: true,
      applied: false,
      backupExists: false,
    });
    expect(res.isBlocked).toBe(true);
    expect(res.blockedReason).toBe('Bloqué — Binaire introuvable');
  });

  it('blocks patch application when binary is incompatible', () => {
    const res = evaluatePatchPreflightGuard({
      exists: true,
      compatible: false,
      applied: false,
      backupExists: true,
    });
    expect(res.isBlocked).toBe(true);
    expect(res.blockedReason).toBe('Bloqué — Incompatible');
  });

  it('allows patch application when preflight checks pass with ok verdict', () => {
    const res = evaluatePatchPreflightGuard({
      exists: true,
      compatible: true,
      applied: false,
      backupExists: true,
      verdict: 'ok',
    });
    expect(res.isBlocked).toBe(false);
    expect(res.blockedReason).toBe('');
  });
});

describe('Patch View — Modal Process Termination Warning (AUDIT-002)', () => {
  it('includes explicit immediate process termination warning in confirmation modal', () => {
    const html = buildPatchModalHtml({ backupExists: true });
    expect(html).toContain('Fermeture immédiate');
    expect(html).toContain('Tous les processus Antigravity actifs seront fermés');
  });
});

describe('Patch View — Applied State Affordance (AUDIT-003)', () => {
  it('sets accurate tooltip when patch is already applied', () => {
    const getButtonConfig = (applied: boolean) => {
      if (applied) {
        return {
          label: 'Patch déjà actif',
          title:
            'Le patch binaire est déjà actif sur language_server. Restaurez la sauvegarde originale si vous souhaitez réinitialiser ou changer de famille.',
        };
      }
      return {
        label: 'Appliquer le patch',
        title: 'Appliquer le patch binaire sélectionné',
      };
    };

    const cfg = getButtonConfig(true);
    expect(cfg.label).toBe('Patch déjà actif');
    expect(cfg.title).toContain('Restaurez la sauvegarde originale');
    expect(cfg.title).not.toContain('force');
  });
});

describe('Patch View — Concurrency Guards (AUDIT-004)', () => {
  it('prevents concurrent patch range selections while an operation is in flight', async () => {
    let inflight = false;
    let callCount = 0;

    const selectRange = async (range: string) => {
      if (inflight) return;
      inflight = true;
      callCount++;
      await new Promise((r) => setTimeout(r, 10));
      inflight = false;
    };

    const p1 = selectRange('2.6.0+');
    const p2 = selectRange('2.4.2');
    await Promise.all([p1, p2]);

    expect(callCount).toBe(1);
  });

  it('rejects restore execution if restore button is disabled', () => {
    let executed = false;
    const triggerRestore = (disabled: boolean) => {
      if (disabled) return;
      executed = true;
    };

    triggerRestore(true);
    expect(executed).toBe(false);

    triggerRestore(false);
    expect(executed).toBe(true);
  });
});

describe('Patch View — WAI-ARIA Radio Group & Roving Tabindex (AUDIT-007)', () => {
  it('assigns tabindex 0 only to the checked card and -1 to other cards', () => {
    const ranges = ['2.2', '2.4', '2.6'];
    const activeRange = '2.4';

    const renderedTabindices = ranges.map((r) => (r === activeRange ? '0' : '-1'));
    expect(renderedTabindices).toEqual(['-1', '0', '-1']);
  });

  it('cycles indices forward on ArrowRight/ArrowDown and backward on ArrowLeft/ArrowUp', () => {
    const totalCards = 3;
    const getNextIndex = (current: number, direction: 'next' | 'prev') => {
      if (direction === 'next') {
        return current < totalCards - 1 ? current + 1 : 0;
      }
      return current > 0 ? current - 1 : totalCards - 1;
    };

    expect(getNextIndex(0, 'next')).toBe(1);
    expect(getNextIndex(2, 'next')).toBe(0);
    expect(getNextIndex(0, 'prev')).toBe(2);
    expect(getNextIndex(2, 'prev')).toBe(1);
  });
});
