import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/widgets/chat_input_bar.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  setUp(() {
    SharedPreferences.setMockInitialValues({});
  });

  testWidgets('Check ChatInputBar model text', (tester) async {
    tester.view.physicalSize = const Size(1080, 2340);
    tester.view.devicePixelRatio = 3.0;

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: ChatInputBar(
            onSend: (_) {},
            isConnected: true,
          ),
        ),
      ),
    );
    await tester.pump(const Duration(milliseconds: 50));

    final textWidgets = find.byType(Text).evaluate();
    for (final t in textWidgets) {
      final widget = t.widget as Text;
      print('FOUND TEXT: "' + (widget.data ?? '') + '"');
    }
  });
}
