import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/widgets/session_top_tabs.dart';

void main() {
  group('SessionTopTabs Artifact Navigation Tests', () {
    testWidgets('Tapping active artifact tab toggles back to chat tab', (tester) async {
      SessionTabType? selectedTab;
      String? openedArtifact;

      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: SessionTopTabs(
              activeTab: SessionTabType.chat,
              activeArtifact: 'notes.md',
              artifactTabs: const ['notes.md'],
              onTabChanged: (tab) => selectedTab = tab,
              onOpenArtifact: (art) => openedArtifact = art,
            ),
          ),
        ),
      );

      // Verify artifact tab pill exists
      expect(find.text('notes.md'), findsOneWidget);

      // Tap on the active artifact pill -> should trigger onTabChanged(SessionTabType.chat)
      await tester.tap(find.text('notes.md'));
      await tester.pumpAndSettle();

      expect(selectedTab, equals(SessionTabType.chat));
      expect(openedArtifact, isNull);
    });

    testWidgets('Tapping inactive artifact tab triggers onOpenArtifact', (tester) async {
      SessionTabType? selectedTab;
      String? openedArtifact;

      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: SessionTopTabs(
              activeTab: SessionTabType.chat,
              activeArtifact: null,
              artifactTabs: const ['plan.md'],
              onTabChanged: (tab) => selectedTab = tab,
              onOpenArtifact: (art) => openedArtifact = art,
            ),
          ),
        ),
      );

      await tester.tap(find.text('plan.md'));
      await tester.pumpAndSettle();

      expect(openedArtifact, equals('plan.md'));
      expect(selectedTab, isNull);
    });

    testWidgets('Active artifact tab shows close icon and clicking it closes tab', (tester) async {
      SessionTabType? selectedTab;

      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: SessionTopTabs(
              activeTab: SessionTabType.chat,
              activeArtifact: 'summary.md',
              artifactTabs: const ['summary.md'],
              onTabChanged: (tab) => selectedTab = tab,
            ),
          ),
        ),
      );

      // Verify close icon exists on active tab
      expect(find.byIcon(Icons.close_rounded), findsOneWidget);

      // Tap the close icon
      await tester.tap(find.byIcon(Icons.close_rounded));
      await tester.pumpAndSettle();

      expect(selectedTab, equals(SessionTabType.chat));
    });
  });
}
