import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/widgets/session_top_tabs.dart';

void main() {
  group('SessionTopTabs Widget Tests', () {
    testWidgets('renders Chat, Review, Overview tabs and triggers onTabChanged', (tester) async {
      SessionTabType selectedTab = SessionTabType.chat;

      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: SessionTopTabs(
              activeTab: selectedTab,
              onTabChanged: (tab) => selectedTab = tab,
              filesChangedCount: 3,
              runningTasksCount: 1,
            ),
          ),
        ),
      );

      expect(find.text('Chat'), findsOneWidget);
      expect(find.text('Review'), findsOneWidget);
      expect(find.text('+3'), findsOneWidget);
      expect(find.text('Overview'), findsOneWidget);
      expect(find.text('1'), findsOneWidget);

      await tester.tap(find.text('Review'));
      await tester.pumpAndSettle();

      expect(selectedTab, equals(SessionTabType.review));
    });

    testWidgets('renders search icon button and triggers onToggleSearch', (tester) async {
      bool searchToggled = false;

      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: SessionTopTabs(
              activeTab: SessionTabType.chat,
              onTabChanged: (_) {},
              onToggleSearch: () => searchToggled = true,
            ),
          ),
        ),
      );

      expect(find.byIcon(Icons.search_rounded), findsOneWidget);

      await tester.tap(find.byIcon(Icons.search_rounded));
      await tester.pumpAndSettle();

      expect(searchToggled, isTrue);
    });
  });
}
