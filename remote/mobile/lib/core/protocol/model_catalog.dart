import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'daemon_api.dart';

/// Represents a model entry in the Antigravity 2.0 dropdown catalog.
class AntigravityModel {
  final String id;
  final String displayName;
  final String? tag; // e.g. 'Fast'
  final String? effort; // e.g. 'Medium', 'Low', 'High', '(Thinking)'
  final bool isThinking;
  final bool isCustom;
  final int? latencyMs;
  final String? status; // 'online', 'degraded', 'offline'

  final int? modelEnum;

  const AntigravityModel({
    required this.id,
    required this.displayName,
    this.tag,
    this.effort,
    this.isThinking = false,
    this.isCustom = false,
    this.latencyMs,
    this.status,
    this.modelEnum,
  });

  /// Base model name without effort suffix (e.g. "Gemini 3.7 Flash")
  String get baseName {
    if (isCustom) return displayName;
    if (displayName.startsWith('Gemini')) {
      final parts = displayName.split(' ');
      if (parts.length >= 3) {
        return parts.take(3).join(' ');
      }
    }
    return displayName;
  }

  /// Whether this model supports reasoning effort degrees (Low, Medium, High).
  bool get supportsEffort => displayName.startsWith('Gemini') && !isCustom;

  /// Clones the model with an updated reasoning effort degree.
  AntigravityModel withEffort(String newEffort) {
    return AntigravityModel(
      id: id,
      displayName: '$baseName $newEffort',
      tag: tag,
      effort: newEffort,
      isThinking: isThinking,
      isCustom: isCustom,
      latencyMs: latencyMs,
      status: status,
      modelEnum: modelEnum,
    );
  }

  /// Short display title for the compact button in the input bar.
  String get shortName {
    if (isCustom) {
      return displayName;
    }
    return displayName;
  }

  /// Full formatted label for custom models (e.g. "797ms • deepseek-v4-flash")
  String get customLabel {
    if (latencyMs != null) {
      return '${latencyMs}ms • $displayName';
    }
    return displayName;
  }
}

/// Quota usage statistics for Antigravity model families.
class ModelUsageStats {
  final int geminiWeeklyPercent;
  final int geminiFiveHourPercent;
  final int claudeGptWeeklyPercent;
  final int claudeGptFiveHourPercent;

  const ModelUsageStats({
    this.geminiWeeklyPercent = 51,
    this.geminiFiveHourPercent = 95,
    this.claudeGptWeeklyPercent = 81,
    this.claudeGptFiveHourPercent = 100,
  });
}

/// Central catalog managing native Antigravity 2.0 models & custom injected models.
class ModelCatalog {
  /// Standard Antigravity 2.0 built-in models (source of truth from Antigravity IDE UI).
  static const List<AntigravityModel> standardModels = [
    AntigravityModel(
      id: 'gemini-3.7-flash',
      displayName: 'Gemini 3.7 Flash High',
      tag: 'Fast',
      effort: 'High',
      modelEnum: 312,
    ),
    AntigravityModel(
      id: 'gemini-3.6-flash',
      displayName: 'Gemini 3.6 Flash Medium',
      tag: 'Fast',
      effort: 'Medium',
      modelEnum: 312,
    ),
    AntigravityModel(
      id: 'gemini-3.5-flash',
      displayName: 'Gemini 3.5 Flash Medium',
      tag: 'Fast',
      effort: 'Medium',
      modelEnum: 312,
    ),
    AntigravityModel(
      id: 'gemini-3.1-pro',
      displayName: 'Gemini 3.1 Pro Low',
      effort: 'Low',
      modelEnum: 246,
    ),
    AntigravityModel(
      id: 'claude-sonnet-4.6-thinking',
      displayName: 'Claude Sonnet 4.6 (Thinking)',
      isThinking: true,
      effort: 'Thinking',
      modelEnum: 334,
    ),
    AntigravityModel(
      id: 'claude-opus-4.6-thinking',
      displayName: 'Claude Opus 4.6 (Thinking)',
      isThinking: true,
      effort: 'Thinking',
      modelEnum: 291,
    ),
    AntigravityModel(
      id: 'gpt-oss-120b',
      displayName: 'GPT-OSS 120B (Medium)',
      effort: 'Medium',
      modelEnum: 342,
    ),
  ];

  /// Default model when opening a fresh session.
  static const AntigravityModel defaultModel = AntigravityModel(
    id: 'gemini-3.7-flash',
    displayName: 'Gemini 3.7 Flash High',
    tag: 'Fast',
    effort: 'High',
    modelEnum: 312,
  );

  /// Helper to find a model by its id, displayName or shortName.
  static AntigravityModel findModel(String query, {List<AntigravityModel>? customModels}) {
    final lower = query.toLowerCase().trim();
    if (lower.isEmpty) return defaultModel;
    final all = [...standardModels, ...(customModels ?? const [])];
    for (final m in all) {
      if (m.id.toLowerCase() == lower ||
          m.displayName.toLowerCase() == lower ||
          m.shortName.toLowerCase() == lower ||
          lower.contains(m.id.toLowerCase()) ||
          lower.contains(m.shortName.toLowerCase())) {
        return m;
      }
    }
    // Dynamic fallback for custom/injected proxy models (e.g. gpt-4o, claude-3-7-sonnet, deepseek-r1)
    return AntigravityModel(
      id: query.trim(),
      displayName: query.trim(),
      isCustom: true,
    );
  }

  /// Fetches custom models dynamically from the daemon or custom_models.json.
  static Future<List<AntigravityModel>> fetchCustomModels(DaemonApi? api) async {
    if (api == null) return const [];
    try {
      // Lecture du fichier custom_models.json (format Antigravity 2.0 / 3.0)
      String content = '';
      try {
        final res = await api.readFile('custom_models.json', workspacePath: '.gemini/antigravity');
        content = res['content']?.toString() ?? '';
      } catch (_) {
        try {
          final res = await api.readFile('custom_models.json', workspacePath: '.gemini/antigravity-ide');
          content = res['content']?.toString() ?? '';
        } catch (_) {}
      }

      if (content.isEmpty) return const [];
      final dynamic parsed = jsonDecode(content);
      final customList = <AntigravityModel>[];

      // Support format tableau plat [ {...}, {...} ]
      if (parsed is List) {
        for (final m in parsed) {
          if (m is! Map) continue;
          final item = Map<String, dynamic>.from(m);
          final id = item['name']?.toString() ?? item['externalModelName']?.toString() ?? '';
          final displayName = item['displayName']?.toString() ?? id;
          if (id.isNotEmpty) {
            customList.add(AntigravityModel(
              id: id,
              displayName: displayName,
              isCustom: true,
              isThinking: id.toLowerCase().contains('r1') || id.toLowerCase().contains('reasoning'),
            ));
          }
        }
        return customList;
      }

      if (parsed is! Map) return const [];
      final parsedMap = Map<String, dynamic>.from(parsed);

      final providers = parsedMap['providers'] as List<dynamic>? ?? [];
      for (final p in providers) {
        if (p is! Map) continue;
        final pMap = Map<String, dynamic>.from(p);
        final enabled = pMap['enabled'] == true;
        if (!enabled) continue;

        final latencyMs = (pMap['latencyMs'] as num?)?.toInt();
        final status = pMap['status'] as String? ?? 'online';
        final models = pMap['models'] as List<dynamic>? ?? [];

        for (final m in models) {
          if (m is! Map) continue;
          final mMap = Map<String, dynamic>.from(m);
          if (mMap['enabled'] == false) continue;

          final id = mMap['id']?.toString() ?? '';
          final displayName = mMap['displayName']?.toString() ?? id;
          if (id.isEmpty) continue;

          customList.add(AntigravityModel(
            id: id,
            displayName: displayName,
            isCustom: true,
            latencyMs: latencyMs,
            status: status,
          ));
        }
      }

      // Also check flat models array if present
      final flatModels = parsedMap['models'] as List<dynamic>? ?? [];
      for (final m in flatModels) {
        if (m is! Map) continue;
        final mMap = Map<String, dynamic>.from(m);
        if (mMap['enabled'] == false) continue;
        final id = mMap['id']?.toString() ?? '';
        final displayName = mMap['displayName']?.toString() ?? id;
        if (id.isNotEmpty && !customList.any((c) => c.id == id)) {
          customList.add(AntigravityModel(
            id: id,
            displayName: displayName,
            isCustom: true,
          ));
        }
      }

      return customList;
    } catch (e) {
      debugPrint('[ModelCatalog] Failed to fetch custom models: $e');
      return const [];
    }
  }

  /// Returns full combined list of available models.
  static Future<List<AntigravityModel>> getAllAvailableModels(DaemonApi? api) async {
    final custom = await fetchCustomModels(api);
    if (custom.isEmpty) {
      return standardModels;
    }
    return [...standardModels, ...custom];
  }
}
