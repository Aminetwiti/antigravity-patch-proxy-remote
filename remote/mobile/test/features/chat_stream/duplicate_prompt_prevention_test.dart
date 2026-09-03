import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/core/protocol/daemon_api.dart';
import 'package:mobile/features/chat_stream/chat_stream_screen.dart';
import 'package:mobile/widgets/markdown_bubble.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  setUp(() {
    SharedPreferences.setMockInitialValues({});
  });

  testWidgets('Sending initial prompt and receiving stream_start does not duplicate user message', (WidgetTester tester) async {
    final ctrl = StreamController<dynamic>.broadcast();
    final out = <Map<String, dynamic>>[];
    final api = DaemonApi(
      incoming: ctrl.stream,
      send: (d) {
        final map = d as Map<String, dynamic>;
        out.add(map);
        final reqId = map['requestId'] as String?;
        final type = map['type'] as String?;
        if (reqId != null && type != 'send_prompt') {
          scheduleMicrotask(() {
            if (!ctrl.isClosed) {
              ctrl.add(jsonEncode({
                'requestId': reqId,
                'data': type == 'get_session_history' ? {'messages': []} : {},
              }));
            }
          });
        }
      },
    );

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: ChatStreamScreen(
            api: api,
            activeSessionId: 'session-new-1',
            activeProjectName: 'Test Project',
            isConnected: true,
          ),
        ),
      ),
    );
    await tester.pump(const Duration(milliseconds: 200));

    // Envoyer "hi"
    await tester.enterText(find.byType(TextField), 'hi');
    await tester.pump();
    await tester.tap(find.byIcon(Icons.arrow_forward));
    await tester.pump();

    final reqId = out.last['requestId'] as String;

    // Emettre stream_start avec userPrompt
    ctrl.add(jsonEncode({
      'type': 'stream_start',
      'requestId': reqId,
      'cascadeId': 'session-new-1',
      'data': {
        'userPrompt': 'hi',
        'model': 'Gemini 3.7 Flash',
      },
    }));
    await tester.pump(const Duration(milliseconds: 100));

    // Faire défiler vers le haut pour révéler la bulle utilisateur
    await tester.drag(find.byKey(const PageStorageKey('chat_list_session-new-1')), const Offset(0, 300));
    await tester.pump();

    // Verifier que la bulle 'hi' existe et n'est présente qu'une seule fois
    expect(find.widgetWithText(MarkdownBubble, 'hi'), findsOneWidget);

    // Emettre stream_delta
    ctrl.add(jsonEncode({
      'type': 'stream_delta',
      'requestId': reqId,
      'cascadeId': 'session-new-1',
      'data': {
        'events': [
          {'kind': 'text', 'delta': 'Hello! How can I help you today?'},
        ],
      },
    }));
    await tester.pump(const Duration(milliseconds: 100));

    // Verifier que 'hi' est toujours unique
    expect(find.widgetWithText(MarkdownBubble, 'hi'), findsOneWidget);

    // Faire défiler vers le bas pour révéler la réponse assistante
    await tester.drag(find.byKey(const PageStorageKey('chat_list_session-new-1')), const Offset(0, -300));
    await tester.pump();
    expect(find.widgetWithText(MarkdownBubble, 'Hello! How can I help you today?'), findsOneWidget);

    // Emettre stream_end pour terminer proprement le stream
    ctrl.add(jsonEncode({
      'type': 'stream_end',
      'requestId': reqId,
      'cascadeId': 'session-new-1',
    }));
    await tester.pump(const Duration(milliseconds: 100));
    await ctrl.close();
  });
}
