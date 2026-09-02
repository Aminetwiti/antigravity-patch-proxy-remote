import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/core/protocol/messages.dart';
import 'package:mobile/core/protocol/stream_parser.dart';
import 'package:mobile/features/chat_stream/widgets/execution_progress_view.dart';
import 'package:mobile/widgets/antigravity_dot_pulse_loader.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  group('Agent Live Streaming UI & Progressive Lifecycle', () {
    testWidgets('ExecutionProgressView renders progressive Search and Runner blocks',
        (tester) async {
      const thoughtText = '''
Search *.dart
✓ 42 files found
Ran flutter test --exclude-tags=live
```console
> flutter test --exclude-tags=live
00:01 +12: all tests passed
```
✓ Tests completed
Edited lib/main.dart +12 -3
Thinking about next optimization
''';

      await tester.pumpWidget(
        const MaterialApp(
          home: Scaffold(
            body: ExecutionProgressView(
              thoughtText: thoughtText,
              isStreaming: true,
              initiallyExpanded: true,
            ),

          ),
        ),
      );
      await tester.pump();

      // Check Search step
      expect(find.textContaining('*.dart'), findsOneWidget);
      // Check Runner step
      expect(find.textContaining('flutter test'), findsOneWidget);
      // Check File edit step
      expect(find.textContaining('lib/main.dart'), findsOneWidget);
      // Check Thinking step
      expect(find.textContaining('Thinking'), findsOneWidget);
    });

    testWidgets('ExecutionProgressView renders live Thinking when stream is active',
        (tester) async {
      await tester.pumpWidget(
        const MaterialApp(
          home: Scaffold(
            body: ExecutionProgressView(
              thoughtText: '',
              isStreaming: true,
            ),
          ),
        ),
      );
      await tester.pump();

      expect(find.textContaining('Thinking'), findsOneWidget);
      expect(find.textContaining('…'), findsOneWidget);
      expect(find.byType(AntigravityDotPulseLoader), findsOneWidget);
    });

    test('StreamDeltaParser parses multi-part lifecycle events correctly', () {
      final msg = {
        'type': 'stream_delta',
        'data': {
          'events': [
            {
              'kind': 'text',
              'delta': 'Hello from ',
            },
            {
              'kind': 'text',
              'delta': 'agent!',
            },
            {
              'kind': 'tool_call',
              'tool': 'runner',
              'detail': '{"command": "git status"}',
            },
            {
              'kind': 'tool_output',
              'tool': 'runner_output',
              'detail': 'On branch main\nclean',
            },
          ]
        }
      };

      final text = StreamDeltaParser.textOf(msg);
      expect(text, 'Hello from agent!');

      final thought = StreamDeltaParser.thinkingOf(msg);
      expect(thought, contains('Ran git status'));
      expect(thought, contains('✓'));
    });

    test('Multi-session buffer update does not mix sessions', () {
      final sessionMessages = <String, List<ChatMessage>>{};

      // Event for session X
      final bufX = sessionMessages.putIfAbsent('session-X', () => []);
      bufX.add(const ChatMessage(
        id: 'msg-x1',
        sender: 'user',
        text: 'Task X',
        timestamp: '12:00',
      ));

      // Event for session Y arrives in background
      final bufY = sessionMessages.putIfAbsent('session-Y', () => []);
      bufY.add(const ChatMessage(
        id: 'msg-y1',
        sender: 'assistant',
        text: 'Result Y',
        timestamp: '12:01',
        isStreaming: true,
      ));

      expect(sessionMessages['session-X']!.length, 1);
      expect(sessionMessages['session-X']!.first.text, 'Task X');
      expect(sessionMessages['session-Y']!.length, 1);
      expect(sessionMessages['session-Y']!.first.text, 'Result Y');
      expect(sessionMessages['session-Y']!.first.isStreaming, isTrue);
    });
  });
}
