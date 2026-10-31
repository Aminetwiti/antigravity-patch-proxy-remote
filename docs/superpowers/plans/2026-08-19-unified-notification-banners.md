# Unified Notification Banner System (`AppNotificationBanner`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement a modular, prioritized notification banner system (`AppNotificationBanner`) on Antigravity Remote Mobile to handle Quota Exceeded, Model Capacity (HTTP 503), Invalid API Key (HTTP 401), Fallback Active, and Context Limit warnings with 1:1 Antigravity Desktop fidelity.

**Architecture:** A unified data model (`BannerNotificationData`) with a priority queue state in `ChatStreamScreen` renders a single, non-intrusive, actionable banner above `ChatInputBar`. Errors in the chat stream are also rendered with dedicated Antigravity-styled cards with quick model-switching pills.

**Tech Stack:** Flutter / Dart, `AppColors` ("The Quiet Console" tokens), `DaemonApi`.

## Global Constraints
- Minimal dependencies, zero new packages.
- Strict adherence to `DESIGN.md` and `AppColors` design tokens.
- All tests must pass via `flutter test --exclude-tags=live` and `flutter analyze` with 0 warnings.

---

### Task 1: Banner Data Model & Classifier

**Files:**
- Create: `remote/mobile/lib/features/chat_stream/models/banner_notification.dart`
- Test: `remote/mobile/test/banner_notification_test.dart`

**Interfaces:**
- Produces: `BannerType`, `BannerSeverity`, `BannerAction`, `BannerNotificationData`, `BannerClassifier.classifyError(String error)`, `BannerClassifier.classifyQuota(Map<String, dynamic> quota)`

- [ ] **Step 1: Write the unit test for banner data model and classifier**

Write `remote/mobile/test/banner_notification_test.dart`:
```dart
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/chat_stream/models/banner_notification.dart';

void main() {
  group('BannerNotificationData & Classifier', () {
    test('classifies quota exceeded error correctly', () {
      const errorMsg = 'Error Individual quota reached. Please upgrade your subscription. Resets in 2h14m11s.';
      final banner = BannerClassifier.classifyError(errorMsg, onSwitchModel: () {}, onSeePlans: () {});
      
      expect(banner, isNotNull);
      expect(banner!.type, BannerType.quotaExceeded);
      expect(banner.severity, BannerSeverity.critical);
      expect(banner.priority, 1);
      expect(banner.resetTime, '2h14m11s');
      expect(banner.actions.length, 3); // Dismiss, See Plans, Switch Model
    });

    test('classifies model capacity 503 error correctly', () {
      const errorMsg = 'HTTP 503 Service Unavailable: MODEL_CAPACITY_EXHAUSTED';
      final banner = BannerClassifier.classifyError(errorMsg, onSwitchModel: () {});
      
      expect(banner, isNotNull);
      expect(banner!.type, BannerType.modelCapacity);
      expect(banner.severity, BannerSeverity.warning);
      expect(banner.priority, 2);
    });

    test('classifies 401 invalid api key error correctly', () {
      const errorMsg = 'HTTP 401 Unauthorized: invalid_api_key provided for OpenAI';
      final banner = BannerClassifier.classifyError(errorMsg, onOpenSettings: () {});
      
      expect(banner, isNotNull);
      expect(banner!.type, BannerType.apiKeyInvalid);
      expect(banner.severity, BannerSeverity.error);
      expect(banner.priority, 3);
    });

    test('classifies quota push at 100% correctly', () {
      final quota = {'weeklyPercent': 100, 'geminiQuotaPercent': 100};
      final banner = BannerClassifier.classifyQuota(quota, onSwitchModel: () {});
      
      expect(banner, isNotNull);
      expect(banner!.type, BannerType.quotaExceeded);
    });
  });
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd remote/mobile && flutter test test/banner_notification_test.dart`
Expected: FAIL (file not found)

- [ ] **Step 3: Implement `banner_notification.dart`**

Write `remote/mobile/lib/features/chat_stream/models/banner_notification.dart`:
```dart
import 'package:flutter/material.dart';

enum BannerType {
  quotaExceeded,
  modelCapacity,
  apiKeyInvalid,
  fallbackActive,
  contextLimit,
}

enum BannerSeverity {
  info,
  warning,
  error,
  critical,
}

class BannerAction {
  final String label;
  final VoidCallback onPressed;
  final bool isPrimary;

  const BannerAction({
    required this.label,
    required this.onPressed,
    this.isPrimary = false,
  });
}

class BannerNotificationData {
  final String id;
  final BannerType type;
  final BannerSeverity severity;
  final String title;
  final String message;
  final String? resetTime;
  final String? errorId;
  final List<BannerAction> actions;
  final bool dismissible;

  const BannerNotificationData({
    required this.id,
    required this.type,
    required this.severity,
    required this.title,
    required this.message,
    this.resetTime,
    this.errorId,
    required this.actions,
    this.dismissible = true,
  });

  int get priority {
    switch (type) {
      case BannerType.quotaExceeded:
        return 1;
      case BannerType.modelCapacity:
        return 2;
      case BannerType.apiKeyInvalid:
        return 3;
      case BannerType.fallbackActive:
        return 4;
      case BannerType.contextLimit:
        return 5;
    }
  }
}

class BannerClassifier {
  static BannerNotificationData? classifyError(
    String errorText, {
    VoidCallback? onDismiss,
    VoidCallback? onSwitchModel,
    VoidCallback? onSeePlans,
    VoidCallback? onOpenSettings,
    VoidCallback? onNewConversation,
  }) {
    final lower = errorText.toLowerCase();

    // 1. Quota Exceeded (Individual quota reached, 402, insufficient_quota)
    if (lower.contains('individual quota reached') ||
        lower.contains('baseline model quota reached') ||
        lower.contains('insufficient_quota') ||
        lower.contains('quota exceeded') ||
        lower.contains('402')) {
      final resetMatch = RegExp(r'(?:resets in|refresh on)\s+([0-9a-zA-Z\s/:\-]+)', caseSensitive: false).firstMatch(errorText);
      final resetStr = resetMatch != null ? resetMatch.group(1)?.trim() : null;

      final errorIdMatch = RegExp(r'error\s*id:\s*([0-9a-fA-F\-]+)', caseSensitive: false).firstMatch(errorText);
      final errorId = errorIdMatch != null ? errorIdMatch.group(1)?.trim() : null;

      final actions = <BannerAction>[
        if (onDismiss != null)
          BannerAction(label: 'Ignorer', onPressed: onDismiss),
        if (onSeePlans != null)
          BannerAction(label: 'Forfaits', onPressed: onSeePlans),
        if (onSwitchModel != null)
          BannerAction(label: 'Changer de modèle', onPressed: onSwitchModel, isPrimary: true),
      ];

      return BannerNotificationData(
        id: 'quota-exceeded',
        type: BannerType.quotaExceeded,
        severity: BannerSeverity.critical,
        title: 'Baseline model quota reached',
        message: resetStr != null
            ? 'Votre quota sera réinitialisé dans $resetStr. Vous pouvez basculer sur un autre modèle ou mettre à niveau votre forfait.'
            : 'Votre quota de modèle est épuisé. Basculez sur un autre modèle ou mettez à niveau votre forfait.',
        resetTime: resetStr,
        errorId: errorId,
        actions: actions,
      );
    }

    // 2. Model Capacity (503 / MODEL_CAPACITY_EXHAUSTED)
    if (lower.contains('model_capacity_exhausted') ||
        lower.contains('no capacity available') ||
        lower.contains('503') ||
        lower.contains('temporarily overloaded')) {
      final actions = <BannerAction>[
        if (onDismiss != null)
          BannerAction(label: 'Ignorer', onPressed: onDismiss),
        if (onSwitchModel != null)
          BannerAction(label: 'Changer de modèle', onPressed: onSwitchModel, isPrimary: true),
      ];

      return BannerNotificationData(
        id: 'model-capacity',
        type: BannerType.modelCapacity,
        severity: BannerSeverity.warning,
        title: 'Capacité du modèle saturée',
        message: 'Les serveurs amont sont saturés. Basculez sur Gemini 3.7 Flash, Claude ou un modèle custom.',
        actions: actions,
      );
    }

    // 3. API Key Invalid (401 / invalid_api_key)
    if (lower.contains('invalid_api_key') ||
        lower.contains('incorrect api key') ||
        lower.contains('401') ||
        lower.contains('unauthorized')) {
      final actions = <BannerAction>[
        if (onDismiss != null)
          BannerAction(label: 'Ignorer', onPressed: onDismiss),
        if (onOpenSettings != null)
          BannerAction(label: 'Configurer Clé API', onPressed: onOpenSettings, isPrimary: true),
      ];

      return BannerNotificationData(
        id: 'api-key-invalid',
        type: BannerType.apiKeyInvalid,
        severity: BannerSeverity.error,
        title: 'Clé API Invalide (HTTP 401)',
        message: 'La clé API fournie pour ce modèle est expirée ou invalide.',
        actions: actions,
      );
    }

    return null;
  }

  static BannerNotificationData? classifyQuota(
    Map<String, dynamic> quota, {
    VoidCallback? onDismiss,
    VoidCallback? onSwitchModel,
    VoidCallback? onSeePlans,
  }) {
    final gRaw = quota['weeklyPercent'] ?? quota['geminiQuotaPercent'];
    final cRaw = quota['weeklyPercentClaude'] ?? quota['claudeQuotaPercent'];
    final gVal = gRaw is num ? gRaw.round() : 0;
    final cVal = cRaw is num ? cRaw.round() : 0;

    if (gVal >= 100 || cVal >= 100) {
      return BannerNotificationData(
        id: 'quota-exceeded-metric',
        type: BannerType.quotaExceeded,
        severity: BannerSeverity.critical,
        title: 'Baseline model quota reached',
        message: 'Le quota hebdomadaire pour ce modèle a atteint 100%. Basculez sur un modèle alternatif.',
        actions: [
          if (onDismiss != null) BannerAction(label: 'Ignorer', onPressed: onDismiss),
          if (onSeePlans != null) BannerAction(label: 'Forfaits', onPressed: onSeePlans),
          if (onSwitchModel != null) BannerAction(label: 'Changer de modèle', onPressed: onSwitchModel, isPrimary: true),
        ],
      );
    }
    return null;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd remote/mobile && flutter test test/banner_notification_test.dart`
Expected: PASS

---

### Task 2: Reusable UI Component (`AppNotificationBanner`)

**Files:**
- Create: `remote/mobile/lib/widgets/app_notification_banner.dart`
- Test: `remote/mobile/test/app_notification_banner_test.dart`

**Interfaces:**
- Consumes: `BannerNotificationData`, `AppColors`
- Produces: `AppNotificationBanner(data: ...)` widget

- [ ] **Step 1: Write widget test for `AppNotificationBanner`**

Write `remote/mobile/test/app_notification_banner_test.dart`:
```dart
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
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd remote/mobile && flutter test test/app_notification_banner_test.dart`
Expected: FAIL

- [ ] **Step 3: Implement `AppNotificationBanner`**

Write `remote/mobile/lib/widgets/app_notification_banner.dart`:
```dart
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../features/chat_stream/models/banner_notification.dart';
import '../theme/app_colors.dart';

class AppNotificationBanner extends StatelessWidget {
  final BannerNotificationData data;
  final bool isCompact;

  const AppNotificationBanner({
    super.key,
    required this.data,
    this.isCompact = false,
  });

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final scheme = Theme.of(context).colorScheme;

    Color borderColor;
    Color iconColor;
    IconData iconData;

    switch (data.severity) {
      case BannerSeverity.critical:
      case BannerSeverity.error:
        borderColor = isDark ? const Color(0xFF5C1D24) : scheme.error.withValues(alpha: 0.4);
        iconColor = isDark ? const Color(0xFFFCA5A5) : scheme.error;
        iconData = Icons.indeterminate_check_box_outlined;
        break;
      case BannerSeverity.warning:
        borderColor = isDark ? const Color(0xFF6B4E1B) : const Color(0xFFEAB308).withValues(alpha: 0.4);
        iconColor = const Color(0xFFEAB308);
        iconData = Icons.warning_amber_rounded;
        break;
      case BannerSeverity.info:
      default:
        borderColor = isDark ? const Color(0xFF1D3E6B) : scheme.primary.withValues(alpha: 0.4);
        iconColor = AppColors.accentBlue;
        iconData = Icons.info_outline_rounded;
        break;
    }

    final surfaceBg = isDark ? const Color(0xF2191A1E) : scheme.surfaceContainerHighest.withValues(alpha: 0.95);

    return Container(
      margin: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
      padding: EdgeInsets.symmetric(
        horizontal: 14,
        vertical: isCompact ? 8 : 12,
      ),
      decoration: BoxDecoration(
        color: surfaceBg,
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: borderColor, width: 0.8),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.25),
            blurRadius: 10,
            offset: const Offset(0, 4),
          ),
        ],
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(iconData, size: 16, color: iconColor),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  data.title,
                  style: TextStyle(
                    fontSize: 13,
                    fontWeight: FontWeight.w600,
                    color: isDark ? Colors.white : scheme.onSurface,
                    letterSpacing: -0.01,
                  ),
                ),
              ),
            ],
          ),
          if (!isCompact) ...[
            const SizedBox(height: 6),
            Text(
              data.message,
              style: TextStyle(
                fontSize: 12,
                height: 1.4,
                color: isDark ? const Color(0xFFD4D4D8) : scheme.onSurfaceVariant,
              ),
            ),
          ],
          const SizedBox(height: 10),
          Row(
            mainAxisAlignment: MainAxisAlignment.end,
            children: data.actions.map((action) {
              final isPrimary = action.isPrimary;
              return Padding(
                padding: const EdgeInsets.only(left: 8),
                child: InkWell(
                  onTap: () {
                    HapticFeedback.lightImpact();
                    action.onPressed();
                  },
                  borderRadius: BorderRadius.circular(6),
                  child: Container(
                    padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                    decoration: BoxDecoration(
                      color: isPrimary
                          ? AppColors.accentBlue
                          : (isDark ? Colors.white.withValues(alpha: 0.1) : scheme.surfaceContainerHigh),
                      borderRadius: BorderRadius.circular(6),
                    ),
                    child: Text(
                      action.label,
                      style: TextStyle(
                        fontSize: 12,
                        fontWeight: isPrimary ? FontWeight.w600 : FontWeight.w500,
                        color: isPrimary ? Colors.white : (isDark ? const Color(0xFFE0E0E0) : scheme.onSurface),
                      ),
                    ),
                  ),
                ),
              );
            }).toList(),
          ),
        ],
      ),
    );
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd remote/mobile && flutter test test/app_notification_banner_test.dart`
Expected: PASS

---

### Task 3: ChatInputBar Model Selector Controller Hook

**Files:**
- Modify: `remote/mobile/lib/widgets/chat_input_bar.dart`

- [ ] **Step 1: Add a public method or key support in `ChatInputBar` to trigger model selector directly**
- [ ] **Step 2: Verify `flutter analyze` passes**

---

### Task 4: Integration in `ChatStreamScreen`

**Files:**
- Modify: `remote/mobile/lib/features/chat_stream/chat_stream_screen.dart`

- [ ] **Step 1: Add banner state management (`_activeBanners`, `_dismissedBannerIds`)**
- [ ] **Step 2: In `stream_end` error handler and `_refreshQuotaSummary`, classify errors and update banner state**
- [ ] **Step 3: In chat stream bubble renderer, format quota errors with styled error card and action pills**
- [ ] **Step 4: Render `AppNotificationBanner` directly above `ChatInputBar`**
- [ ] **Step 5: Run tests and verify**

---

### Task 5: Full Verification & Diagnostics

- [ ] **Step 1: Run `flutter analyze`**
- [ ] **Step 2: Run all mobile tests: `flutter test --exclude-tags=live`**
