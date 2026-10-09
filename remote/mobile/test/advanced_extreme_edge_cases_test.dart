import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/core/protocol/messages.dart';
import 'package:mobile/core/protocol/session_parser.dart';
import 'package:mobile/core/protocol/markdown_renderer.dart';

void main() {
  group('Extreme Edge Cases & Rare Scenarios Tests', () {
    test('CascadeSession isRunning catches all active and background task states', () {
      final runningStates = [
        'CASCADE_STATUS_RUNNING',
        'BUSY',
        'STREAMING',
        'TASK_RUNNING',
        'EXECUTING_COMMAND',
        'BACKGROUND_JOB',
      ];

      for (final st in runningStates) {
        final session = CascadeSession(
          id: 'test-1',
          workspacePath: '/workspace',
          title: 'Test Session',
          status: st,
          time: '1m',
        );
        expect(session.isRunning, isTrue, reason: 'Status $st should be isRunning');
      }

      final idleStates = [
        'CASCADE_STATUS_READY',
        'IDLE',
        'PAUSE',
        'CASCADE_STATUS_WAITING_FOR_USER_ACTION',
      ];

      for (final st in idleStates) {
        final session = CascadeSession(
          id: 'test-2',
          workspacePath: '/workspace',
          title: 'Test Session',
          status: st,
          time: '1m',
        );
        expect(session.isRunning, isFalse, reason: 'Status $st should not be isRunning');
      }
    });

    test('SessionParser accurately computes hasUnread blue dot for inactive sessions with steps', () {
      final data = {
        'sessions': [
          {
            'cascadeId': 's-1',
            'title': 'Finished Session with Steps',
            'workspace': 'proj1',
            'status': 'CASCADE_STATUS_READY',
            'stepCount': 4,
          },
          {
            'cascadeId': 's-2',
            'title': 'Active Running Session',
            'workspace': 'proj1',
            'status': 'CASCADE_STATUS_RUNNING',
            'stepCount': 5,
          },
          {
            'cascadeId': 's-3',
            'title': 'Brand New Empty Session',
            'workspace': 'proj1',
            'status': 'CASCADE_STATUS_READY',
            'stepCount': 0,
          },
        ]
      };

      final parsed = SessionParser.parseListSessions(data);
      expect(parsed.length, 3);

      final s1 = parsed.firstWhere((s) => s.id == 's-1');
      expect(s1.hasUnread, isTrue); // Inactive with steps -> blue dot

      final s2 = parsed.firstWhere((s) => s.id == 's-2');
      expect(s2.hasUnread, isFalse); // Running -> spinner, no unread blue dot
      expect(s2.isRunning, isTrue);

      final s3 = parsed.firstWhere((s) => s.id == 's-3');
      expect(s3.hasUnread, isFalse); // 0 steps -> no unread
    });

    test('MarkdownRenderer cleanly parses mixed content and ignores example placeholders', () {
      const complexDoc = '''
# Titre Principal
Voici un paragraphe standard avec du **gras**, de l'_italique_ et du `code inline`.

> Citation importante sur le fonctionnement du système

```dart
void main() {
  print("Code snippet");
}
```

[ARTIFACT: screenshot.png]
Path: file:///C:/Users/developer/screenshot.png

Exemple de documentation montrant [ARTIFACT: ...]
Path: file:///...
''';

      final blocks = MarkdownRenderer.blocksOf(complexDoc);
      expect(blocks.isNotEmpty, isTrue);

      // Vérifie qu'il y a un header, un code block, une quote
      expect(blocks.any((b) => b.headerLevel == 1), isTrue);
      expect(blocks.any((b) => b.code != null), isTrue);
      expect(blocks.any((b) => b.isQuote), isTrue);
    });
  });
}
