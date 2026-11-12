/**
 * Backward-compatible facade for Google Account Resilience & Pooling Subsystem.
 * Modular components are organized in:
 * - ./google/identity (device headers, keys, licensing, disk persistence)
 * - ./google/cooldown (cooldown state, probation, registry, burst, reconciler)
 * - ./google/concurrency (in-flight manager, rate limiter, latency tracker)
 * - ./google/selection (scoring, classifier 429, P2C selector, auto-heal, preflight probe, health interval)
 */

export * from './google';
