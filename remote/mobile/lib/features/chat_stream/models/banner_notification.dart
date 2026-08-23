import 'package:flutter/material.dart';

/// Type de notification pour la bannière unifiée
enum BannerType {
  quotaExceeded,
  modelCapacity,
  apiKeyInvalid,
  fallbackActive,
  contextLimit,
}

/// Sévérité visuelle (définit la couleur de bordure, l'icône et l'arrière-plan)
enum BannerSeverity {
  info,
  warning,
  error,
  critical,
}

/// Action unifiée (bouton) dans la bannière
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

/// Modèle de données pour une alerte de bannière
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

  /// Priorité numérique : plus petit = plus prioritaire dans la file
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

/// Moteur de classification pour extraire et formater les alertes
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

    // 1. Quota Exceeded (Individual quota reached, baseline model quota reached, 402, insufficient_quota)
    if (lower.contains('individual quota reached') ||
        lower.contains('baseline model quota reached') ||
        lower.contains('insufficient_quota') ||
        lower.contains('quota exceeded') ||
        lower.contains('402 payment required') ||
        lower.contains('http 402') ||
        (lower.contains('resets in') && lower.contains('quota')) ||
        (lower.contains('refresh on') && lower.contains('quota'))) {
      
      // Extraction de la date/heure de réinitialisation
      final resetMatch = RegExp(
        r'(?:resets in|refresh on)\s+([0-9a-zA-Z\s/:\-]+?)(?:\.|\n|$)',
        caseSensitive: false,
      ).firstMatch(errorText);
      final resetStr = resetMatch?.group(1)?.trim();

      // Extraction de l'Error ID
      final errorIdMatch = RegExp(
        r'error\s*id:\s*([0-9a-fA-F\-]+)',
        caseSensitive: false,
      ).firstMatch(errorText);
      final errorId = errorIdMatch?.group(1)?.trim();

      final actions = <BannerAction>[
        if (onDismiss != null)
          BannerAction(label: 'Dismiss', onPressed: onDismiss),
        if (onSeePlans != null)
          BannerAction(label: 'See Plans', onPressed: onSeePlans),
        if (onSwitchModel != null)
          BannerAction(label: 'Enable Overages', onPressed: onSwitchModel, isPrimary: true),
      ];

      return BannerNotificationData(
        id: 'quota-exceeded',
        type: BannerType.quotaExceeded,
        severity: BannerSeverity.critical,
        title: 'Baseline model quota reached',
        message: resetStr != null
            ? "Your plan's baseline quota will refresh on $resetStr. You can upgrade to a Google AI Ultra plan to receive higher rate limits. See plans."
            : "Your plan's baseline quota has been reached. You can upgrade to a Google AI Ultra plan to receive higher rate limits or switch to another model.",
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
        message: 'Les serveurs sont saturés. Basculez vers Gemini 3.7 Flash, Claude ou un modèle custom.',
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
          if (onDismiss != null)
            BannerAction(label: 'Ignorer', onPressed: onDismiss),
          if (onSeePlans != null)
            BannerAction(label: 'Forfaits', onPressed: onSeePlans),
          if (onSwitchModel != null)
            BannerAction(label: 'Changer de modèle', onPressed: onSwitchModel, isPrimary: true),
        ],
      );
    }
    return null;
  }
}
