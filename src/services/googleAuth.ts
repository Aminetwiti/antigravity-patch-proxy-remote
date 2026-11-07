// ─── Google Auth Façade (Backwards-Compatibility & Domain Assembly) ─────────
// Decomposed into modular domain engines in src/services/auth/

export * from './auth/tokenManager';
export * from './auth/modelNormalizer';
export * from './auth/payloadSanitizer';
export * from './auth/quotaPoller';
