import 'package:shared_preferences/shared_preferences.dart';

import '../config/env_config.dart';
import 'saved_connections_store.dart';

/// Persistance des réglages utilisateur via `shared_preferences`.
/// Écriture atomique par clé, lecture paresseuse au démarrage (initState).
/// ponytail: stockage clé/valeur simple — pas de schéma versionné; ajouter
/// un `settingsVersion` si le nombre de clés grandit.
class SettingsStore {
  static const _kHost = 'settings.daemonHost';
  static const _kPort = 'settings.daemonPort';
  static const _kSsl = 'settings.useSsl';
  static const _kCsrf = 'settings.csrfToken';
  static const _kPin = 'settings.pin';
  static const _kThemeMode = 'settings.themeMode';
  static const _kDefaultModel = 'settings.defaultModel';
  static const _kDisplayName = 'settings.displayName';
  static const _kRole = 'settings.role';
  static const _kStatus = 'settings.status';
  static const _kToolNotifications = 'settings.toolNotifications';
  static const _kApprovalTimeout = 'settings.approvalTimeoutMinutes';
  static const _kAutoAccept = 'settings.autoAcceptEnabled';
  static const _kCompactBubbles = 'settings.compactBubbles';
  static const _kMonospaceCode = 'settings.monospaceCode';
  static const _kIsGeminiEnterprise = 'settings.isGeminiEnterprise';
  static const _kGeTier = 'settings.geTier';
  static const _kInferenceRegion = 'settings.inferenceRegion';
  static const _kMcpAllowlistStrict = 'settings.mcpAllowlistStrict';
  static const _kExecutionPolicy = 'settings.executionPolicy';
  static const _kActiveBranch = 'settings.activeBranch';
  static const _kAutoFollow = 'settings.autoFollowEnabled';

  // Session persistée : URL ws complète + token + pin + sessionId actif. Sauvegardée
  // à chaque connexion réussie (le tunnel Cloudflare change d'URL à chaque
  // redémarrage du daemon → on re-sauvegarde systématiquement).
  static const _kLastWsUrl = 'session.lastWsUrl';
  static const _kLastWsToken = 'session.lastWsToken';
  static const _kLastSessionId = 'session.lastSessionId';
  static const _kLastPin = 'session.lastPin';
  static const _kLastHost = 'session.lastHost';
  static const _kLastPort = 'session.lastPort';
  static const _kLastSsl = 'session.lastSsl';
  static const _kSessionSavedAt = 'session.savedAt';

  static const _kVerboseAgentChat = 'settings.verboseAgentChat';
  static const _kConversationWidth = 'settings.conversationWidth';
  static const _kQueuedMessagesMode = 'settings.queuedMessagesMode';
  static const _kSecurityPreset = 'settings.securityPreset';
  static const _kArtifactReviewPolicy = 'settings.artifactReviewPolicy';
  static const _kLightPreset = 'settings.lightPreset';
  static const _kDarkPreset = 'settings.darkPreset';
  static const _kEnableCreditOverages = 'settings.enableCreditOverages';
  static const _kReasoningEffort = 'settings.reasoningEffort';
  static const _kBrowserHeadlessMode = 'settings.browserHeadlessMode';
  static const _kBrowserAutoCapture = 'settings.browserAutoCapture';
  static const _kFileAccessPolicy = 'settings.fileAccessPolicy';
  static const _kInternetPolicy = 'settings.internetPolicy';

  SettingsStore._();

  /// Charge l'état initial (valeurs par défaut si jamais persistées).
  static Future<Map<String, dynamic>> load() async {
    final prefs = await SharedPreferences.getInstance();
    return {
      'host': prefs.getString(_kHost) ?? '127.0.0.1',
      'port': prefs.getInt(_kPort) ?? EnvConfig.daemonPort,
      'ssl': prefs.getBool(_kSsl) ?? false,
      'csrf': prefs.getString(_kCsrf) ?? '',
      'pin': prefs.getString(_kPin) ?? '',
      'themeMode': prefs.getInt(_kThemeMode) ?? 0,
      'defaultModel': prefs.getString(_kDefaultModel) ?? 'Gemini 3.6 Flash Medium',
      'displayName': prefs.getString(_kDisplayName) ?? 'Developer',
      'role': prefs.getString(_kRole) ?? 'Remote Host Controller',
      'status': prefs.getString(_kStatus) ?? 'Online',
      'toolNotifications': prefs.getBool(_kToolNotifications) ?? true,
      'approvalTimeoutMinutes': prefs.getInt(_kApprovalTimeout) ?? 5,
      'autoAcceptEnabled': prefs.getBool(_kAutoAccept) ?? false,
      'compactBubbles': prefs.getBool(_kCompactBubbles) ?? false,
      'monospaceCode': prefs.getBool(_kMonospaceCode) ?? true,
      'isGeminiEnterprise': prefs.getBool(_kIsGeminiEnterprise) ?? true,
      'geTier': prefs.getString(_kGeTier) ?? 'GE-Plus',
      'inferenceRegion': prefs.getString(_kInferenceRegion) ?? 'UE (Europe)',
      'mcpAllowlistStrict': prefs.getBool(_kMcpAllowlistStrict) ?? true,
      'executionPolicy': prefs.getString(_kExecutionPolicy) ?? 'request-review',
      'activeBranch': prefs.getString(_kActiveBranch) ?? 'main',
      'autoFollowEnabled': prefs.getBool(_kAutoFollow) ?? true,
      'verboseAgentChat': prefs.getBool(_kVerboseAgentChat) ?? true,
      'conversationWidth': prefs.getString(_kConversationWidth) ?? 'Default',
      'queuedMessagesMode': prefs.getString(_kQueuedMessagesMode) ?? 'queue',
      'securityPreset': prefs.getString(_kSecurityPreset) ?? 'Default',
      'artifactReviewPolicy': prefs.getString(_kArtifactReviewPolicy) ?? 'Always Ask',
      'lightPreset': prefs.getString(_kLightPreset) ?? 'Default Light',
      'darkPreset': prefs.getString(_kDarkPreset) ?? 'Default Dark',
      'enableCreditOverages': prefs.getBool(_kEnableCreditOverages) ?? false,
      'reasoningEffort': prefs.getString(_kReasoningEffort) ?? 'medium',
      'browserHeadlessMode': prefs.getBool(_kBrowserHeadlessMode) ?? true,
      'browserAutoCapture': prefs.getBool(_kBrowserAutoCapture) ?? true,
      'fileAccessPolicy': prefs.getString(_kFileAccessPolicy) ?? 'AGENT_SETTING_POLICY_ASK',
      'internetPolicy': prefs.getString(_kInternetPolicy) ?? 'AGENT_SETTING_POLICY_ASK',
    };
  }

  /// Persiste une carte de réglages (les clés absentes ne sont pas touchées).
  static Future<void> save(Map<String, dynamic> values) async {
    final prefs = await SharedPreferences.getInstance();
    for (final entry in values.entries) {
      switch (entry.key) {
        case 'host':
          await prefs.setString(_kHost, entry.value as String);
        case 'port':
          await prefs.setInt(_kPort, entry.value as int);
        case 'ssl':
          await prefs.setBool(_kSsl, entry.value as bool);
        case 'csrf':
          await prefs.setString(_kCsrf, entry.value as String);
        case 'pin':
          await prefs.setString(_kPin, entry.value as String);
        case 'themeMode':
          await prefs.setInt(_kThemeMode, entry.value as int);
        case 'defaultModel':
          await prefs.setString(_kDefaultModel, entry.value as String);
        case 'displayName':
          await prefs.setString(_kDisplayName, entry.value as String);
        case 'role':
          await prefs.setString(_kRole, entry.value as String);
        case 'status':
          await prefs.setString(_kStatus, entry.value as String);
        case 'toolNotifications':
          await prefs.setBool(_kToolNotifications, entry.value as bool);
        case 'approvalTimeoutMinutes':
          await prefs.setInt(_kApprovalTimeout, entry.value as int);
        case 'autoAcceptEnabled':
          await prefs.setBool(_kAutoAccept, entry.value as bool);
        case 'compactBubbles':
          await prefs.setBool(_kCompactBubbles, entry.value as bool);
        case 'monospaceCode':
          await prefs.setBool(_kMonospaceCode, entry.value as bool);
        case 'isGeminiEnterprise':
          await prefs.setBool(_kIsGeminiEnterprise, entry.value as bool);
        case 'geTier':
          await prefs.setString(_kGeTier, entry.value as String);
        case 'inferenceRegion':
          await prefs.setString(_kInferenceRegion, entry.value as String);
        case 'mcpAllowlistStrict':
          await prefs.setBool(_kMcpAllowlistStrict, entry.value as bool);
        case 'executionPolicy':
          await prefs.setString(_kExecutionPolicy, entry.value as String);
        case 'activeBranch':
          await prefs.setString(_kActiveBranch, entry.value as String);
        case 'autoFollowEnabled':
          await prefs.setBool(_kAutoFollow, entry.value as bool);
        case 'verboseAgentChat':
          await prefs.setBool(_kVerboseAgentChat, entry.value as bool);
        case 'conversationWidth':
          await prefs.setString(_kConversationWidth, entry.value as String);
        case 'queuedMessagesMode':
          await prefs.setString(_kQueuedMessagesMode, entry.value as String);
        case 'securityPreset':
          await prefs.setString(_kSecurityPreset, entry.value as String);
        case 'artifactReviewPolicy':
          await prefs.setString(_kArtifactReviewPolicy, entry.value as String);
        case 'lightPreset':
          await prefs.setString(_kLightPreset, entry.value as String);
        case 'darkPreset':
          await prefs.setString(_kDarkPreset, entry.value as String);
        case 'enableCreditOverages':
          await prefs.setBool(_kEnableCreditOverages, entry.value as bool);
        case 'reasoningEffort':
          await prefs.setString(_kReasoningEffort, entry.value as String);
        case 'browserHeadlessMode':
          await prefs.setBool(_kBrowserHeadlessMode, entry.value as bool);
        case 'browserAutoCapture':
          await prefs.setBool(_kBrowserAutoCapture, entry.value as bool);
        case 'fileAccessPolicy':
          await prefs.setString(_kFileAccessPolicy, entry.value as String);
        case 'internetPolicy':
          await prefs.setString(_kInternetPolicy, entry.value as String);
      }
    }
  }

  static Future<void> clear() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.clear();
  }

  /// Dernière session connectée : `{wsUrl, token, sessionId, pin, host, port, ssl, savedAt}`.
  /// Persiste indéfiniment après fermeture et réouverture de l'application.
  static Future<Map<String, dynamic>> loadSession() async {
    final prefs = await SharedPreferences.getInstance();
    final url = prefs.getString(_kLastWsUrl) ?? '';
    final lastToken = prefs.getString(_kLastWsToken);
    final lastHost = prefs.getString(_kLastHost);
    final savedAt = DateTime.tryParse(prefs.getString(_kSessionSavedAt) ?? '');

    if (url.isEmpty && lastToken == null && lastHost == null) {
      return const {};
    }

    final token = lastToken ?? prefs.getString(_kCsrf) ?? '';
    final host = lastHost ?? prefs.getString(_kHost) ?? '';
    final port = prefs.getInt(_kLastPort) ?? prefs.getInt(_kPort) ?? EnvConfig.daemonPort;
    final ssl = prefs.getBool(_kLastSsl) ?? prefs.getBool(_kSsl) ?? false;
    final pin = prefs.getString(_kLastPin) ?? prefs.getString(_kPin) ?? '';
    final sessionId = prefs.getString(_kLastSessionId) ?? '';

    return {
      'wsUrl': url,
      'token': token,
      'sessionId': sessionId,
      'pin': pin,
      'host': host,
      'port': port,
      'ssl': ssl,
      'savedAt': savedAt ?? DateTime.now(),
    };
  }

  /// Persiste la session courante et l'ajoute à l'historique des connexions.
  static Future<void> saveSession({
    required String wsUrl,
    String token = '',
    String sessionId = '',
    String pin = '',
    String host = '',
    int? port,
    bool? ssl,
    String? label,
  }) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_kLastWsUrl, wsUrl);
    if (token.isNotEmpty) {
      await prefs.setString(_kLastWsToken, token);
      await prefs.setString(_kCsrf, token);
    }
    if (sessionId.isNotEmpty) {
      await prefs.setString(_kLastSessionId, sessionId);
    }
    if (pin.isNotEmpty) {
      await prefs.setString(_kLastPin, pin);
      await prefs.setString(_kPin, pin);
    }
    if (host.isNotEmpty) {
      await prefs.setString(_kLastHost, host);
      await prefs.setString(_kHost, host);
    }
    if (port != null) {
      await prefs.setInt(_kLastPort, port);
      await prefs.setInt(_kPort, port);
    }
    if (ssl != null) {
      await prefs.setBool(_kLastSsl, ssl);
      await prefs.setBool(_kSsl, ssl);
    }
    await prefs.setString(_kSessionSavedAt, DateTime.now().toIso8601String());

    // Mémorise dans la liste des connexions sauvegardées
    final resolvedHost = host.isNotEmpty ? host : (Uri.tryParse(wsUrl)?.host ?? '127.0.0.1');
    final resolvedPort = port ?? Uri.tryParse(wsUrl)?.port ?? EnvConfig.daemonPort;
    final resolvedSsl = ssl ?? (wsUrl.startsWith('wss') || wsUrl.startsWith('https'));
    final effectiveToken = token.isNotEmpty ? token : (prefs.getString(_kLastWsToken) ?? '');
    final effectivePin = pin.isNotEmpty ? pin : (prefs.getString(_kLastPin) ?? '');

    final conn = SavedConnection(
      id: '$resolvedHost:$resolvedPort',
      label: label ?? (resolvedHost == '127.0.0.1' ? 'PC Local (127.0.0.1)' : resolvedHost),
      host: resolvedHost,
      port: resolvedPort,
      ssl: resolvedSsl,
      authToken: effectiveToken,
      pin: effectivePin,
      wsUrl: wsUrl,
      lastConnectedAt: DateTime.now(),
    );
    await SavedConnectionsStore.saveConnection(conn);
  }

  /// Efface la session persistée (déconnexion manuelle explicite).
  static Future<void> clearSession() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove(_kLastWsUrl);
    await prefs.remove(_kLastWsToken);
    await prefs.remove(_kLastSessionId);
    await prefs.remove(_kLastPin);
    await prefs.remove(_kLastHost);
    await prefs.remove(_kLastPort);
    await prefs.remove(_kLastSsl);
    await prefs.remove(_kSessionSavedAt);
  }
}
