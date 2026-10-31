/// Formateur intelligent de transcriptions vocales pour développeur.
/// Transforme les dictées vocales brutes en prompts structurés et lisibles,
/// avec encapsulation automatique des commandes, fichiers et identifiants techniques entre backticks.
class CodeSpeechFormatter {
  // Regex pour fichiers et extensions courantes
  static final RegExp _filePattern = RegExp(
    r'\b([a-zA-Z0-9_-]+\.(?:dart|ts|tsx|js|jsx|json|go|py|rs|html|css|scss|md|yaml|yml|sql|sh|ps1|pb|pbtxt|proto|env|lock))\b',
    caseSensitive: false,
  );

  // Regex pour commandes CLI courantes
  static final RegExp _cliCommandPattern = RegExp(
    r'\b((?:git|npm|yarn|pnpm|flutter|dart|go|cargo|docker|kubectl|npx)\s+(?:status|commit|push|pull|fetch|run|build|test|add|checkout|branch|diff|log|install|init|update|deploy|analyze|[a-z0-9_:\-]+(?:\s+-[a-zA-Z0-9_\-]+)*))\b',
    caseSensitive: false,
  );

  // Regex pour appels de fonctions comme `functionName()`
  static final RegExp _functionCallPattern = RegExp(
    r'\b([a-zA-Z_][a-zA-Z0-9_]*\(\))',
  );

  // Regex pour identifiants camelCase / PascalCase
  static final RegExp _camelCasePattern = RegExp(
    r'\b([a-z]+[A-Z0-9][a-zA-Z0-9]*)\b',
  );

  /// Nettoie et formate une dictée vocale brute.
  static String format(String input) {
    if (input.trim().isEmpty) return '';

    String text = input.trim();

    // 1. Remplacements des ponctuations dictées en français / anglais
    text = _replaceSpokenPunctuation(text);

    // 2. Encapsulation des fichiers EN PREMIER
    text = text.replaceAllMapped(_filePattern, (m) {
      final match = m.group(1)!;
      if (_isAlreadyQuoted(text, m.start, m.end)) return match;
      return '`$match`';
    });

    // 3. Encapsulation des appels de fonctions (sans \b terminal pour capturer les parenthèses)
    text = text.replaceAllMapped(_functionCallPattern, (m) {
      final match = m.group(1)!;
      if (_isAlreadyQuoted(text, m.start, m.end)) return match;
      return '`$match`';
    });

    // 4. Encapsulation des commandes CLI
    text = text.replaceAllMapped(_cliCommandPattern, (m) {
      final match = m.group(1)!;
      if (_isAlreadyQuoted(text, m.start, m.end)) return match;
      return '`$match`';
    });

    // 5. Encapsulation des identifiants camelCase
    text = text.replaceAllMapped(_camelCasePattern, (m) {
      final match = m.group(1)!;
      if (_isAlreadyQuoted(text, m.start, m.end)) return match;
      if (match.length < 3) return match;
      return '`$match`';
    });

    // 6. Nettoyage des doubles espaces et majuscule initiale
    text = text.replaceAll(RegExp(r'[ \t]+'), ' ').trim();
    if (text.isNotEmpty) {
      text = text[0].toUpperCase() + text.substring(1);
    }

    return text;
  }

  static String _replaceSpokenPunctuation(String text) {
    var out = text;
    final replacements = <Pattern, String>{
      RegExp(r'\b(?:point d\x27interrogation|point d interrogation)\b', caseSensitive: false): '?',
      RegExp(r'\b(?:point d\x27exclamation|point d exclamation)\b', caseSensitive: false): '!',
      RegExp(r'(?:à la ligne|a la ligne|nouvelle ligne|retour chariot)', caseSensitive: false): '\n',
      RegExp(r'\b(?:deux points)\b', caseSensitive: false): ':',
      RegExp(r'\b(?:point virgule)\b', caseSensitive: false): ';',
      RegExp(r'\b(?:virgule)\b', caseSensitive: false): ',',
      RegExp(r'\b(?:ouvre la parenthèse|ouvrir la parenthèse)\b', caseSensitive: false): '(',
      RegExp(r'\b(?:ferme la parenthèse|fermer la parenthèse)\b', caseSensitive: false): ')',
      RegExp(r'\b(?:ouvre les guillemets)\b', caseSensitive: false): '"',
      RegExp(r'\b(?:ferme les guillemets)\b', caseSensitive: false): '"',
    };

    for (final entry in replacements.entries) {
      out = out.replaceAll(entry.key, entry.value);
    }
    return out;
  }

  static bool _isAlreadyQuoted(String fullText, int start, int end) {
    if (start > 0 && fullText[start - 1] == '`') return true;
    if (end < fullText.length && fullText[end] == '`') return true;
    return false;
  }
}
