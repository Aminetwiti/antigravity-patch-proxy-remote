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

  /// Jeton d'appairage par défaut (dev) : correspond au démon lancé avec
  /// `-auth-token demo123`. Surchargé par l'appairage QR/discovery réel.
  /// ponytail: plafond connu — jeton partagé en dur; remplacer par un
  /// appairage persisté (QR → stockage sécurisé) en production.
  static const String authToken = String.fromEnvironment(
    'AUTH_TOKEN',
    defaultValue: '11',
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
