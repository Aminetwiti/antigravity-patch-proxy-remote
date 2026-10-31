import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/widgets/syntax_highlighter.dart';

void main() {
  group('SyntaxHighlighter Tests', () {
    test('highlights Dart keywords, strings, comments, numbers, and annotations', () {
      const code = '''
// Main entrypoint
@override
void main() {
  final count = 42;
  print("Hello Antigravity");
}''';

      final spans = SyntaxHighlighter.highlight(
        code,
        'dart',
        defaultTextColor: Colors.white,
      );

      expect(spans.isNotEmpty, isTrue);

      final hasComment = spans.any((s) =>
          s.text?.contains('// Main entrypoint') == true &&
          s.style?.color == SyntaxHighlighter.colorComment);
      expect(hasComment, isTrue);

      final hasAnnotation = spans.any((s) =>
          s.text?.contains('@override') == true &&
          s.style?.color == SyntaxHighlighter.colorAnnotation);
      expect(hasAnnotation, isTrue);

      final hasKeyword = spans.any((s) =>
          (s.text == 'void' || s.text == 'final') &&
          s.style?.color == SyntaxHighlighter.colorKeyword);
      expect(hasKeyword, isTrue);

      final hasNumber = spans.any((s) =>
          s.text == '42' && s.style?.color == SyntaxHighlighter.colorNumber);
      expect(hasNumber, isTrue);

      final hasString = spans.any((s) =>
          s.text?.contains('Hello Antigravity') == true &&
          s.style?.color == SyntaxHighlighter.colorString);
      expect(hasString, isTrue);
    });

    test('highlights Go keywords, functions, and types', () {
      const code = '''
package main

import "fmt"

func CalculateSum(a int, b int) int {
  return a + b
}''';

      final spans = SyntaxHighlighter.highlight(
        code,
        'go',
        defaultTextColor: Colors.white,
      );

      final hasPackage = spans.any((s) =>
          s.text == 'package' && s.style?.color == SyntaxHighlighter.colorKeyword);
      expect(hasPackage, isTrue);

      final hasReturn = spans.any((s) =>
          s.text == 'return' && s.style?.color == SyntaxHighlighter.colorKeyword);
      expect(hasReturn, isTrue);

      final hasType = spans.any((s) =>
          s.text == 'CalculateSum' && s.style?.color == SyntaxHighlighter.colorType);
      expect(hasType, isTrue);
    });

    test('handles empty or unknown language gracefully', () {
      const code = 'SELECT * FROM users WHERE age > 18;';
      final spans = SyntaxHighlighter.highlight(
        code,
        'sql',
        defaultTextColor: Colors.white,
      );

      expect(spans.isNotEmpty, isTrue);
      final hasSelect = spans.any((s) =>
          s.text == 'SELECT' && s.style?.color == SyntaxHighlighter.colorKeyword);
      expect(hasSelect, isTrue);
    });
  });
}
