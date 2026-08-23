import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/services/secure_credentials.dart';

/// Config globale exécutée avant CHAQUE fichier de test (mécanisme officiel
/// flutter_test). SEC-04 : flutter_secure_storage est un vrai plugin platform —
/// en zone fake-async (testWidgets), l'appel channel ne résout JAMAIS et le
/// test pend 10 min. On injecte donc un coffre en mémoire par défaut.
///
/// Un test qui veut des valeurs précises écrase simplement la map :
///   SecureCredentials.testValues = {'session.token': 'tok'};
/// Un test qui veut le chemin réel (rare, `test()` synchrone uniquement) :
///   SecureCredentials.testValues = null;
Future<void> testExecutable(FutureOr<void> Function() testMain) async {
  SecureCredentials.testValues ??= {};
  await testMain();
}
