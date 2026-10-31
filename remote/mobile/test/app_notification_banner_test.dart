import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/chat_stream/models/banner_notification.dart';
import 'package:mobile/widgets/app_notification_banner.dart';

void main() {
  testWidgets('renders AppNotificationBanner with title, message and buttons', (tester) async {
    bool dismissed = false;
    bool switched = false;

    final banner = BannerNotificationData(
      id: 'test-quota',
      type: BannerType.quotaExceeded,
      severity: BannerSeverity.critical,
      title: 'Baseline model quota reached',
      message: 'Your plan baseline quota will refresh on 19/08/2026.',
      actions: [
        BannerAction(label: 'Dismiss', onPressed: () => dismissed = true),
        BannerAction(label: 'Switch Model', onPressed: () => switched = true, isPrimary: true),
      ],
    );

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: AppNotificationBanner(data: banner),
        ),
      ),
    );

    expect(find.text('Baseline model quota reached'), findsOneWidget);
    expect(find.text('Your plan baseline quota will refresh on 19/08/2026.'), findsOneWidget);
    expect(find.text('Dismiss'), findsOneWidget);
    expect(find.text('Switch Model'), findsOneWidget);

    await tester.tap(find.text('Switch Model'));
    expect(switched, isTrue);

    await tester.tap(find.text('Dismiss'));
    expect(dismissed, isTrue);
  });

  testWidgets('renders AppNotificationBanner for 401 and dismisses via Ignorer button and top-right close icon', (tester) async {
    String? dismissedId;

    final banner = BannerClassifier.classifyError(
      'HTTP 401 Unauthorized: invalid_api_key provided for OpenAI',
      onDismiss: (id) => dismissedId = id,
    );

    expect(banner, isNotNull);
    expect(banner!.id, 'api-key-invalid');
    expect(banner.title, 'Clé API Invalide (HTTP 401)');

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: AppNotificationBanner(
            data: banner,
            onDismiss: () => dismissedId = banner.id,
          ),
        ),
      ),
    );

    expect(find.text('Clé API Invalide (HTTP 401)'), findsOneWidget);
    expect(find.text('Ignorer'), findsOneWidget);
    expect(find.byIcon(Icons.close_rounded), findsOneWidget);

    // Test tap on "Ignorer" button
    await tester.tap(find.text('Ignorer'));
    expect(dismissedId, 'api-key-invalid');

    // Reset and test tap on top-right close icon
    dismissedId = null;
    await tester.tap(find.byIcon(Icons.close_rounded));
    expect(dismissedId, 'api-key-invalid');
  });
}
