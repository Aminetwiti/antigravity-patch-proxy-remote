/**
 * Lightweight internationalization (i18n) engine for ag-doctor-ui.
 */

export type Locale = 'en' | 'fr';

export const TRANSLATIONS: Record<Locale, Record<string, string>> = {
  en: {
    'status.ready': 'Ready',
    'status.running': 'Running diagnostic...',
    'status.healthy': 'All Systems Operational',
    'status.warning': 'Attention Needed',
    'status.error': 'Issues Detected',
    'btn.runDoctor': 'Run doctor',
    'btn.repair': 'Auto-repair',
    'btn.save': 'Save',
    'btn.cancel': 'Cancel',
    'btn.delete': 'Delete',
    'btn.test': 'Test Connection',
    'modal.provider.titleAdd': 'Add Provider',
    'modal.provider.titleEdit': 'Edit Provider',
    'modal.provider.nameRequired': 'Provider name is required.',
    'modal.provider.urlRequired': 'API URL is required.',
    'modal.provider.keyRequired': 'API Key is required.',
    'daemon.started': 'Daemon started successfully.',
    'daemon.stopped': 'Daemon stopped manually.',
    'proxy.portConflict': 'Port 50999 is in use by another process.',
    'proxy.killed': 'Process terminated on port 50999.',
  },
  fr: {
    'status.ready': 'Prêt',
    'status.running': 'Diagnostic en cours...',
    'status.healthy': 'Tous les systèmes sont opérationnels',
    'status.warning': 'Attention requise',
    'status.error': 'Anomalies détectées',
    'btn.runDoctor': 'Lancer le diagnostic',
    'btn.repair': 'Auto-réparation',
    'btn.save': 'Enregistrer',
    'btn.cancel': 'Annuler',
    'btn.delete': 'Supprimer',
    'btn.test': 'Tester la connexion',
    'modal.provider.titleAdd': 'Ajouter un fournisseur',
    'modal.provider.titleEdit': 'Modifier le fournisseur',
    'modal.provider.nameRequired': 'Le nom du fournisseur est requis.',
    'modal.provider.urlRequired': "L'URL de l'API est requise.",
    'modal.provider.keyRequired': "La clé d'API est requise.",
    'daemon.started': 'Daemon démarré avec succès.',
    'daemon.stopped': 'Daemon arrêté manuellement.',
    'proxy.portConflict': 'Le port 50999 est déjà utilisé.',
    'proxy.killed': 'Processus terminé sur le port 50999.',
  },
};

let currentLocale: Locale = 'en';

export function setLocale(locale: Locale): void {
  if (TRANSLATIONS[locale]) {
    currentLocale = locale;
  }
}

export function getLocale(): Locale {
  return currentLocale;
}

export function t(key: string, fallback?: string): string {
  const dict = TRANSLATIONS[currentLocale] || TRANSLATIONS.en;
  return dict[key] || fallback || key;
}
