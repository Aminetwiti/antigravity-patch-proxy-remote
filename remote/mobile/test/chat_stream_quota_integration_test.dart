import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/chat_stream/models/banner_notification.dart';
import 'package:mobile/widgets/app_notification_banner.dart';

void main() {
  testWidgets('renders AppNotificationBanner when banner notification is passed', (tester) async {
    final bannerData = BannerNotificationData(
      id: 'quota-test',
      type: BannerType.quotaExceeded,
      severity: BannerSeverity.critical,
      title: 'Baseline model quota reached',
      message: 'Your quota will refresh in 2h14m11s.',
      actions: [
        BannerAction(label: 'Dismiss', onPressed: () {}),
        BannerAction(label: 'Switch Model', onPressed: () {}, isPrimary: true),
      ],
    );

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: AppNotificationBanner(data: bannerData),
        ),
      ),
    );

    expect(find.text('Baseline model quota reached'), findsOneWidget);
    expect(find.text('Your quota will refresh in 2h14m11s.'), findsOneWidget);
    expect(find.text('Switch Model'), findsOneWidget);
  });
}
