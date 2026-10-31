import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/core/utils/code_speech_formatter.dart';

void main() {
  group('CodeSpeechFormatter Tests', () {
    test('formats files with extensions into backticks', () {
      final input = 'regarde le fichier main.dart et modifie package.json';
      final formatted = CodeSpeechFormatter.format(input);
      expect(formatted, contains('`main.dart`'));
      expect(formatted, contains('`package.json`'));
    });

    test('formats CLI commands into backticks', () {
      final input = 'lance la commande git status et ensuite npm test';
      final formatted = CodeSpeechFormatter.format(input);
      expect(formatted, contains('`git status`'));
      expect(formatted, contains('`npm test`'));
    });

    test('formats camelCase identifiers and function calls', () {
      final input = 'appelle getSessionHistory() pour vérifier activeCascadeId';
      final formatted = CodeSpeechFormatter.format(input);
      expect(formatted, contains('`getSessionHistory()`'));
      expect(formatted, contains('`activeCascadeId`'));
    });

    test('replaces spoken punctuation', () {
      final input = 'est ce que tout fonctionne point d interrogation à la ligne merci';
      final formatted = CodeSpeechFormatter.format(input);
      expect(formatted, contains('?'));
      expect(formatted, contains('\n'));
    });

    test('handles empty and whitespace strings gracefully', () {
      expect(CodeSpeechFormatter.format(''), equals(''));
      expect(CodeSpeechFormatter.format('   '), equals(''));
    });
  });
}
