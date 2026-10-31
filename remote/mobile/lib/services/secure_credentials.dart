import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// Coffre-fort pour les secrets de session (token daemon, PIN de pairing).
///
/// SEC-04 : ces valeurs étaient persistées en clair dans SharedPreferences
/// (XML lisible, inclus dans les backups adb/cloud). Elles passent dans le
/// Keychain (iOS) / Keystore (Android) via flutter_secure_storage.
///
/// Les lectures/écritures échouent silencieusement (retour vide) sur les
/// environnements sans backend sécurisé (tests VM, desktop sans keychain) :
/// un stockage indisponible ne doit jamais faire planter l'app — au pire
/// l'utilisateur se réappaire.
class SecureCredentials {
  SecureCredentials._();

  static const _storage = FlutterSecureStorage(
    aOptions: AndroidOptions(encryptedSharedPreferences: true),
  );

  /// Injection pour les tests unitaires (VM, sans plugin channel) :
  /// `SecureCredentials.testValues = {'session.token': 'x'};`
  static Map<String, String>? testValues;

  static Future<String?> read(String key) async {
    if (testValues != null) return testValues![key];
    try {
      return await _storage.read(key: key).timeout(
        const Duration(seconds: 1),
        onTimeout: () => null,
      );
    } catch (_) {
      return null;
    }
  }

  static Future<void> write(String key, String value) async {
    if (value.isEmpty) return;
    if (testValues != null) {
      testValues![key] = value;
      return;
    }
    try {
      await _storage.write(key: key, value: value).timeout(
        const Duration(seconds: 1),
        onTimeout: () {},
      );
    } catch (_) {}
  }

  static Future<void> delete(String key) async {
    if (testValues != null) {
      testValues!.remove(key);
      return;
    }
    try {
      await _storage.delete(key: key).timeout(
        const Duration(seconds: 1),
        onTimeout: () {},
      );
    } catch (_) {}
  }
}
