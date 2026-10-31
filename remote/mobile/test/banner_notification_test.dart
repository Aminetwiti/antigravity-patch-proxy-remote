import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/chat_stream/models/banner_notification.dart';

void main() {
  group('BannerNotificationData & Classifier', () {
    test('classifies quota exceeded error correctly', () {
      const errorMsg =
          'Error Individual quota reached. Please upgrade your subscription to increase your limits. Resets in 2h14m11s.\nError ID: 80901749-25f2-4028-8cfb-0ee627a69857-127';
      final banner = BannerClassifier.classifyError(
        errorMsg,
        onSwitchModel: () {},
        onSeePlans: () {},
        onDismiss: () {},
      );

      expect(banner, isNotNull);
      expect(banner!.type, BannerType.quotaExceeded);
      expect(banner.severity, BannerSeverity.critical);
      expect(banner.priority, 1);
      expect(banner.resetTime, '2h14m11s');
      expect(banner.errorId, '80901749-25f2-4028-8cfb-0ee627a69857-127');
      expect(banner.actions.length, 3); // Dismiss, See Plans, Switch Model
    });

    test('classifies baseline model quota reached error correctly', () {
      const errorMsg =
          "Your plan's baseline quota will refresh on 19/08/2026 19:27:02. You can upgrade to a Google AI Ultra plan.";
      final banner = BannerClassifier.classifyError(
        errorMsg,
        onSwitchModel: () {},
        onSeePlans: () {},
      );

      expect(banner, isNotNull);
      expect(banner!.type, BannerType.quotaExceeded);
      expect(banner.resetTime, '19/08/2026 19:27:02');
    });

    test('classifies model capacity 503 error correctly', () {
      const errorMsg = 'HTTP 503 Service Unavailable: MODEL_CAPACITY_EXHAUSTED';
      final banner = BannerClassifier.classifyError(
        errorMsg,
        onSwitchModel: () {},
      );

      expect(banner, isNotNull);
      expect(banner!.type, BannerType.modelCapacity);
      expect(banner.severity, BannerSeverity.warning);
      expect(banner.priority, 2);
    });

    test('classifies 401 invalid api key error correctly', () {
      const errorMsg = 'HTTP 401 Unauthorized: invalid_api_key provided for OpenAI';
      final banner = BannerClassifier.classifyError(
        errorMsg,
        onOpenSettings: () {},
      );

      expect(banner, isNotNull);
      expect(banner!.type, BannerType.apiKeyInvalid);
      expect(banner.severity, BannerSeverity.error);
      expect(banner.priority, 3);
    });

    test('classifies quota push at 100% correctly', () {
      final quota = {'weeklyPercent': 100, 'geminiQuotaPercent': 100};
      final banner = BannerClassifier.classifyQuota(
        quota,
        onSwitchModel: () {},
      );

      expect(banner, isNotNull);
      expect(banner!.type, BannerType.quotaExceeded);
      expect(banner.severity, BannerSeverity.critical);
    });

    test('returns null for normal text', () {
      const normalMsg = 'This is a normal assistant message.';
      final banner = BannerClassifier.classifyError(normalMsg);
      expect(banner, isNull);
    });
  });
}
