import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/chat_stream/widgets/turn_navigation_fab.dart';

void main() {
  testWidgets('TurnNavigationFab renders both arrows and triggers callbacks',
      (tester) async {
    bool upTapped = false;
    bool downTapped = false;
    bool bottomDoubleTapped = false;

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: TurnNavigationFab(
            onNavigateUp: () => upTapped = true,
            onNavigateDown: () => downTapped = true,
            onScrollToBottom: () => bottomDoubleTapped = true,
            isAtBottom: false,
          ),
        ),
      ),
    );

    expect(find.byIcon(Icons.keyboard_arrow_up_rounded), findsOneWidget);
    expect(find.byIcon(Icons.keyboard_arrow_down_rounded), findsOneWidget);

    // Tap Up
    await tester.tap(find.byIcon(Icons.keyboard_arrow_up_rounded));
    expect(upTapped, isTrue);

    // Tap Down
    await tester.tap(find.byIcon(Icons.keyboard_arrow_down_rounded));
    await tester.pumpAndSettle();
    expect(downTapped, isTrue);

    // Long press Down triggers onScrollToBottom
    await tester.longPress(find.byIcon(Icons.keyboard_arrow_down_rounded));
    await tester.pumpAndSettle();
    expect(bottomDoubleTapped, isTrue);
  });
}
