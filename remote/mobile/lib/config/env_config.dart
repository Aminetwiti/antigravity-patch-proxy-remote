/// Environment Configuration for Antigravity Remote Mobile App
/// Passed via `--dart-define` or default fallback to localhost loopback.
class EnvConfig {
  static const String environment = String.fromEnvironment(
    'ENVIRONMENT',
    defaultValue: 'development',
  );

  static const String daemonHost = String.fromEnvironment(
    'DAEMON_HOST',
    defaultValue: '10.0.2.2',
  );

  static const int daemonPort = int.fromEnvironment(
    'DAEMON_PORT',
    defaultValue: 8090,
  );

  /// Jeton d'appairage (SEC-07) : PLUS de valeur par défaut — vide si non
  /// fourni via `--dart-define=AUTH_TOKEN=...`. La connexion sans token
  /// échoue côté daemon (fail-closed) au lieu d'envoyer un secret trivial.
  static const String authToken = String.fromEnvironment(
    'AUTH_TOKEN',
    defaultValue: '',
  );

  static const bool useSsl = bool.fromEnvironment(
    'USE_SSL',
    defaultValue: false,
  );

  static const bool enableLogging = bool.fromEnvironment(
    'ENABLE_LOGGING',
    defaultValue: true,
  );

  static String get wsUrl =>
      '${useSsl ? 'wss' : 'ws'}://$daemonHost:$daemonPort/ws';

  static String get httpUrl =>
      '${useSsl ? 'https' : 'http'}://$daemonHost:$daemonPort';
}
