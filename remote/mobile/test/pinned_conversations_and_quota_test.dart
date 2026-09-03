import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/core/protocol/messages.dart';
import 'package:mobile/features/chat_stream/models/banner_notification.dart';
import 'package:mobile/features/chat_stream/widgets/execution_progress_view.dart';
import 'package:mobile/features/sessions/sessions_list.dart';
import 'package:mobile/widgets/app_notification_banner.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() {
    SharedPreferences.setMockInitialValues({
      'pinned_session_ids': ['sess-pin-1', 'sess-pin-2'],
    });
  });

  group('Pinned Conversations & Desktop 1:1 Layout Tests', () {
    testWidgets('LeftSidebarDrawer renders Pinned Conversations section with pinned items', (tester) async {
      final sessions = [
        const CascadeSession(
          id: 'sess-pin-1',
          workspacePath: '/path/project1',
          title: 'NaviCab Business Logic Contradiction Audit',
          status: 'CASCADE_STATUS_RUNNING',
          time: '1m',
          isPinned: true,
        ),
        const CascadeSession(
          id: 'sess-pin-2',
          workspacePath: '/path/project1',
          title: 'Impeccable Audit Request',
          status: 'CASCADE_STATUS_READY',
          time: '4m',
          isPinned: true,
        ),
        const CascadeSession(
          id: 'sess-regular-1',
          workspacePath: '/path/project1',
          title: 'Running Flutter On Device',
          status: 'CASCADE_STATUS_READY',
          time: '1h',
          isPinned: false,
        ),
      ];

      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: LeftSidebarDrawer(
              activeSessionId: 'sess-pin-1',
              sessions: sessions,
              onSessionSelected: (_) {},
              onNewConversation: () {},
              onToggleConnection: () {},
            ),
          ),
        ),
      );
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 100));

      expect(find.text('New Conversation'), findsOneWidget);
      expect(find.text('Conversation History'), findsOneWidget);
      expect(find.text('Scheduled Tasks'), findsOneWidget);
      expect(find.text('Pinned Conversations'), findsOneWidget);
      expect(find.text('NaviCab Business Logic Contradiction Audit'), findsOneWidget);
      expect(find.text('Impeccable Audit Request'), findsOneWidget);

      await tester.pumpWidget(const SizedBox());
    });

    testWidgets('BannerClassifier correctly classifies 429 RESOURCE_EXHAUSTED Individual quota reached', (tester) async {
      const errorMsg = 'RESOURCE_EXHAUSTED (code 429): Individual quota reached. Please upgrade your subscription to increase your limits. Resets in 3h57m11s.\nError ID: 53628a95-d513-4328-b19e-97484b5071cd-2371';
      
      final banner = BannerClassifier.classifyError(
        errorMsg,
        onDismiss: () {},
        onSeePlans: () {},
        onSwitchModel: () {},
      );

      expect(banner, isNotNull);
      expect(banner!.title, 'Baseline model quota reached');
      expect(banner.resetTime, '3h57m11s');
      expect(banner.errorId, '53628a95-d513-4328-b19e-97484b5071cd-2371');
      expect(banner.actions.map((a) => a.label).toList(), ['Dismiss', 'See Plans', 'Enable Overages']);
    });

    testWidgets('AppNotificationBanner renders Baseline model quota reached card 1:1', (tester) async {
      bool dismissed = false;
      bool overages = false;

      final bannerData = BannerNotificationData(
        id: 'quota-exceeded',
        type: BannerType.quotaExceeded,
        severity: BannerSeverity.critical,
        title: 'Baseline model quota reached',
        message: "Your plan's baseline quota will refresh on 02/09/2026 00:02:08. You can upgrade to a Google AI Ultra plan to receive higher rate limits. See plans.",
        resetTime: '02/09/2026 00:02:08',
        errorId: '53628a95-d513-4328-b19e-97484b5071cd-2371',
        actions: [
          BannerAction(label: 'Dismiss', onPressed: () => dismissed = true),
          BannerAction(label: 'See Plans', onPressed: () {}),
          BannerAction(label: 'Enable Overages', onPressed: () => overages = true, isPrimary: true),
        ],
      );

      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: AppNotificationBanner(data: bannerData),
          ),
        ),
      );
      await tester.pump();

      expect(find.text('Baseline model quota reached'), findsOneWidget);
      expect(find.text('Dismiss'), findsOneWidget);
      expect(find.text('See Plans'), findsOneWidget);
      expect(find.text('Enable Overages'), findsOneWidget);

      await tester.tap(find.text('Dismiss'));
      expect(dismissed, isTrue);

      await tester.tap(find.text('Enable Overages'));
      expect(overages, isTrue);

      await tester.pumpWidget(const SizedBox());
    });

    testWidgets('ExecutionProgressView parses and displays Error and Error ID', (tester) async {
      const thoughtContent = '''Worked for 1m
Worked for 1s
Error Individual quota reached. Please upgrade your subscription to increase your limits. Resets in 3h57m11s.
Error ID: 53628a95-d513-4328-b19e-97484b5071cd-2371''';

      await tester.pumpWidget(
        const MaterialApp(
          home: Scaffold(
            body: ExecutionProgressView(
              thoughtText: thoughtContent,
              initiallyExpanded: true,
            ),
          ),
        ),
      );
      await tester.pump();

      expect(find.textContaining('Individual quota reached'), findsOneWidget);
      expect(find.text('Error ID: 53628a95-d513-4328-b19e-97484b5071cd-2371'), findsOneWidget);

      await tester.pumpWidget(const SizedBox());
    });

    testWidgets('LeftSidebarDrawer dynamically syncs pins when unpinned on desktop', (tester) async {
      final initialSessions = <CascadeSession>[
        const CascadeSession(
          id: 'sess-sync-1',
          workspacePath: '/path/project1',
          title: 'Session to be unpinned',
          status: 'CASCADE_STATUS_READY',
          time: '2m',
          isPinned: true,
        ),
      ];

      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: LeftSidebarDrawer(
              activeSessionId: 'sess-sync-1',
              sessions: initialSessions,
              onSessionSelected: (_) {},
              onNewConversation: () {},
              onToggleConnection: () {},
            ),
          ),
        ),
      );
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 100));

      expect(find.text('Pinned Conversations'), findsOneWidget);
      expect(find.text('Session to be unpinned'), findsOneWidget);

      // Desktop updates: session is now unpinned
      final updatedSessions = <CascadeSession>[
        const CascadeSession(
          id: 'sess-sync-1',
          workspacePath: '/path/project1',
          title: 'Session to be unpinned',
          status: 'CASCADE_STATUS_READY',
          time: '3m',
          isPinned: false,
        ),
      ];

      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: LeftSidebarDrawer(
              activeSessionId: 'sess-sync-1',
              sessions: updatedSessions,
              onSessionSelected: (_) {},
              onNewConversation: () {},
              onToggleConnection: () {},
            ),
          ),
        ),
      );
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 100));

      // Pinned section should now disappear because 0 sessions are pinned
      expect(find.text('Pinned Conversations'), findsNothing);

      await tester.pumpWidget(const SizedBox());
    });
  });
}
