/**
 * Internationalized error messages and application status strings.
 * Centralizes magic error strings and provides localization support.
 */

export const MESSAGES = {
  en: {
    crypto: {
      decryptionFailed: 'Decryption failed. Incorrect password or corrupted payload.',
      storageUnavailable: 'Native encryption is unavailable in this environment.',
      invalidBase64: 'Invalid Base64 input string.',
      invalidJson: 'Decoded JSON does not contain a valid providers array.',
      malformedPayload: 'Malformed encrypted payload structure.',
    },
    proxy: {
      portInUse: (port: number) => `Port ${port} is already in use, allocating dynamic port.`,
      upstreamTimeout: (timeoutMs: number) => `Upstream request timed out after ${timeoutMs}ms.`,
      requestTooLarge: 'Payload too large (exceeds maximum allowed body size).',
    },
    system: {
      ready: 'Antigravity Patch Proxy is active and ready.',
      stopped: 'Antigravity Patch Proxy has been stopped.',
    },
  },
  fr: {
    crypto: {
      decryptionFailed: 'Déchiffrement échoué : mot de passe incorrect ou données corrompues.',
      storageUnavailable: 'Le trousseau de chiffrement natif est indisponible dans cet environnement.',
      invalidBase64: "Chaîne d'entrée Base64 non valide.",
      invalidJson: 'Le JSON décodé ne contient pas de tableau de fournisseurs valide.',
      malformedPayload: 'Structure du payload chiffré corrompue.',
    },
    proxy: {
      portInUse: (port: number) => `Le port ${port} est déjà utilisé, attribution d'un port dynamique.`,
      upstreamTimeout: (timeoutMs: number) => `La requête vers le serveur amont a expiré après ${timeoutMs}ms.`,
      requestTooLarge: 'Charge utile trop volumineuse (dépasse la taille maximale autorisée).',
    },
    system: {
      ready: 'Le Proxy Patch Antigravity est actif et opérationnel.',
      stopped: 'Le Proxy Patch Antigravity a été arrêté.',
    },
  },
} as const;

export type SupportedLocale = keyof typeof MESSAGES;

/**
 * Resolves active locale from environment variables (AG_LANG or LANG).
 */
export function getLocale(): SupportedLocale {
  const envLang = process.env.AG_LANG || process.env.LANG || 'en';
  return envLang.toLowerCase().startsWith('fr') ? 'fr' : 'en';
}

/**
 * Returns localized message dictionary for active locale.
 */
export function t() {
  return MESSAGES[getLocale()];
}
