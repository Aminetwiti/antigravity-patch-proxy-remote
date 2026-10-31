import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/core/protocol/daemon_api.dart';
import 'package:mobile/features/artifacts/artifact_action_bar.dart';
import 'package:mobile/widgets/artifact_viewer_modal.dart';

void main() {
  group('ArtifactActionBar', () {
    testWidgets('ArtifactActionBar emits onProceed when Proceed tapped', (tester) async {
      bool proceedTapped = false;
      bool feedbackTapped = false;

      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            bottomNavigationBar: ArtifactActionBar(
              requestFeedback: true,
              onProceed: () => proceedTapped = true,
              onRequestFeedback: () => feedbackTapped = true,
            ),
          ),
        ),
      );

      expect(find.text('Proceed'), findsOneWidget);
      expect(find.text('Request Changes'), findsOneWidget);

      await tester.tap(find.text('Proceed'));
      await tester.pumpAndSettle();

      expect(proceedTapped, isTrue);
      expect(feedbackTapped, isFalse);
    });

    testWidgets('ArtifactActionBar emits onRequestFeedback when Request Changes tapped', (tester) async {
      bool proceedTapped = false;
      bool feedbackTapped = false;

      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            bottomNavigationBar: ArtifactActionBar(
              requestFeedback: true,
              onProceed: () => proceedTapped = true,
              onRequestFeedback: () => feedbackTapped = true,
            ),
          ),
        ),
      );

      expect(find.text('Request Changes'), findsOneWidget);

      await tester.tap(find.text('Request Changes'));
      await tester.pumpAndSettle();

      expect(feedbackTapped, isTrue);
      expect(proceedTapped, isFalse);
    });

    testWidgets('ArtifactActionBar renders nothing when requestFeedback is false', (tester) async {
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            bottomNavigationBar: ArtifactActionBar(
              requestFeedback: false,
              onProceed: () {},
              onRequestFeedback: () {},
            ),
          ),
        ),
      );

      expect(find.text('Proceed'), findsNothing);
      expect(find.text('Request Changes'), findsNothing);
    });
  });

  group('ArtifactViewerModal Integration', () {
    testWidgets('ArtifactViewerModal shows action bar when requestFeedback is true', (tester) async {
      bool proceedTriggered = false;
      final api = DaemonApi(sendRaw: (_) {});

      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: ArtifactViewerModal(
              api: api,
              artifactPath: 'brain/plan.md',
              artifactName: 'plan.md',
              requestFeedback: true,
              onProceed: () => proceedTriggered = true,
            ),
          ),
        ),
      );

      await tester.pump();

      expect(find.byType(ArtifactActionBar), findsOneWidget);
      expect(find.text('Proceed'), findsOneWidget);

      await tester.tap(find.text('Proceed'));
      await tester.pumpAndSettle();

      expect(proceedTriggered, isTrue);
    });
  });
}
