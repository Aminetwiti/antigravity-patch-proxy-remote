import 'package:flutter/widgets.dart';

/// AppTypography : Tokens de typographie et hiérarchie de texte pour Antigravity Mobile.
/// Remplace l'intégralité des TextStyle fontSize / fontWeight hardcodés.
abstract class AppTypography {
  static const titleLarge = TextStyle(
    fontSize: 20.0,
    fontWeight: FontWeight.w700,
    letterSpacing: -0.2,
  );

  static const titleMedium = TextStyle(
    fontSize: 16.0,
    fontWeight: FontWeight.w600,
    letterSpacing: -0.1,
  );

  static const titleSmall = TextStyle(
    fontSize: 14.0,
    fontWeight: FontWeight.w600,
  );

  static const bodyLarge = TextStyle(
    fontSize: 15.0,
    fontWeight: FontWeight.w400,
    letterSpacing: 0.1,
  );

  static const bodyMedium = TextStyle(
    fontSize: 13.0,
    fontWeight: FontWeight.w400,
  );

  static const bodySmall = TextStyle(
    fontSize: 12.0,
    fontWeight: FontWeight.w400,
  );

  static const caption = TextStyle(
    fontSize: 11.0,
    fontWeight: FontWeight.w400,
    letterSpacing: 0.2,
  );

  static const codeSmall = TextStyle(
    fontFamily: 'JetBrainsMono',
    fontSize: 12.0,
    fontWeight: FontWeight.w400,
  );

  /// Section headers (uppercase, tracking 0.8px, Zinc-500)
  static const TextStyle sectionHeader = TextStyle(
    fontSize: 11,
    fontWeight: FontWeight.w600,
    letterSpacing: 0.8,
  );

  /// Monospace technical metadata (file paths, line numbers, IDs)
  static const TextStyle monoMetadata = TextStyle(
    fontSize: 11,
    fontFamily: 'monospace',
    fontWeight: FontWeight.w400,
  );

  /// Compact uppercase pill label
  static const TextStyle pillLabel = TextStyle(
    fontSize: 10,
    fontWeight: FontWeight.w600,
    letterSpacing: 0.5,
  );
}
