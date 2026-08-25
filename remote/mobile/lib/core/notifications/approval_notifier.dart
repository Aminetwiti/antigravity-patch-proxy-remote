import 'dart:async';
import 'dart:ui' show Color;

import 'package:flutter/foundation.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';

/// Notifications locales pour les demandes d'approbation (APPROVAL_REQUIRED)
/// et les fins de tâche (stream_end structuré).
///
/// Objectif : compenser l'absence de FCM (100% local, pas de dépendance
/// Firebase). Le phone peut être en arrière-plan ou verrouillé : la
/// notification le ramène à l'écran d'approbation.
///
/// `ponytail:` — pas de FCM ni de plugin d'état d'écran : on notifie toujours,
/// le host n'émet l'événement que si personne n'est actif sur le PC (l'idle
/// detection vit côté gateway Go, pas ici).
class ApprovalNotifier {
  ApprovalNotifier._();

  static final ApprovalNotifier instance = ApprovalNotifier._();

  /// Callbacks des taps sur notification (B2) : le payload est
  /// `approval:<cascadeId>` ou `task:<cascadeId>` — l'UI écoute ce stream pour
  /// naviguer vers la session concernée. Broadcast : plusieurs écrans peuvent
  /// écouter sans conflit.
  final StreamController<Map<String, dynamic>> _tapController =
      StreamController.broadcast();
  Stream<Map<String, dynamic>> get taps => _tapController.stream;

  /// Sink de simulation (tests uniquement) : émet un tap comme si le plugin
  /// avait décodé le payload d'une notification. ponytail: plafond = les
  /// tests n'exercent pas le plugin natif ; upgrade = fake platform.
  @visibleForTesting
  StreamSink<Map<String, dynamic>> get tapsSink => _tapController.sink;

  /// null avant init() réussi ou quand le registrant de plugin est absent
  /// (flutter test headless) : les méthodes notify* ignorent alors l'appel.
  FlutterLocalNotificationsPlugin? _plugin;

  /// Dernière demande notifiée (callId) pour éviter les doublons quand
  /// plusieurs clients reçoivent le même broadcast.
  String? _lastCallId;
  DateTime? _lastShownAt;

  /// Notification « tâche démarrée » déjà montrée pour cette cascade — évite
  /// de re-sonner quand le broadcast stream_start arrive sur plusieurs surfaces.
  String? _lastTaskStartedCascade;
  DateTime? _lastTaskStartedAt;

  /// Notification « tâche terminée » déjà montrée pour cette cascade — évite
  /// de re-sonner quand le broadcast stream_end arrive sur plusieurs surfaces.
  String? _lastTaskDoneCascade;
  DateTime? _lastTaskDoneAt;

  /// Auto-annulation différée des notifications de tâche (C7/UX) : isolée par
  /// ID de notification pour éviter que le démarrage d'une tâche B n'écrase
  /// le timer d'auto-nettoyage d'une tâche A.
  final Map<int, Timer> _autoCancelTimers = {};

  bool _initialized = false;

  /// true après un init() réussi (plugin disponible). En test headless le
  /// registrant de plugin est absent → init échoue et les notifications sont
  /// silencieusement désactivées.
  bool get initialized => _initialized;

  /// Contrôle global des notifications (toggle « Notifications Push » dans
  /// les réglages). Désactivé → toutes les notify* sont des no-op.
  bool _enabled = true;

  /// Active/désactive toutes les notifications locales.
  void setEnabled(bool enabled) => _enabled = enabled;

  bool get isEnabled => _enabled;

  /// ID stable de la notification « perte/rétablissement de connexion » :
  /// le rétablissement remplace la perte (même id) au lieu d'empiler.
  static const int _connectionNotificationId = 0x41C0EE; // 'CONNECT'

  Future<void> init() async {
    if (_initialized) return;

    final plugin = FlutterLocalNotificationsPlugin();
    _plugin = plugin;

    try {
      const android = AndroidInitializationSettings('@drawable/ic_service_notification');
      const ios = DarwinInitializationSettings(
        requestAlertPermission: true,
        requestBadgePermission: true,
        requestSoundPermission: true,
      );
      const settings = InitializationSettings(android: android, iOS: ios);
      await plugin.initialize(settings);

      // Sur les environnements sans registrant de plugin (flutter test,
      // headless), resolvePlatformSpecificImplementation renvoie null :
      // on désactive les notifications sans planter. Sur Android/iOS réel,
      // le registrant Dart est toujours présent.
      // ponytail: plafond = les tests ne vérifient pas la vraie chaîne de
      // notification ; chemin d'upgrade = fake platform dans widget_test.dart
      // (FlutterLocalNotificationsPlatform.instance = …) si besoin plus tard.
      final androidImpl = plugin
          .resolvePlatformSpecificImplementation<
              AndroidFlutterLocalNotificationsPlugin>();
      if (androidImpl != null) {
        await androidImpl.requestNotificationsPermission();
      }

      // B2 — tap-to-deep-link : chaque notification porte un payload
      // `approval:<cascadeId>` / `task:<cascadeId>`. Le tap (app en
      // arrière-plan ou tuée) est publié sur [taps] ; l'UI navigue vers la
      // session et ré-ouvre l'approbation via get_pending_approval.
      await plugin.initialize(
        settings,
        onDidReceiveNotificationResponse: _handleTap,
      );
      _initialized = true;
    } catch (e) {
      _plugin = null;
      debugPrint('[Notifier] notifications indisponibles: $e');
    }
  }

  /// Payload d'une notification : `approval:<cascadeId>` ou `task:<cascadeId>`.
  static String payloadForApproval(String cascadeId) => 'approval:$cascadeId';
  static String payloadForTask(String cascadeId) => 'task:$cascadeId';

  /// Décode le payload et publie la cible de navigation sur [taps].
  /// Hors try/catch : tout échec (plugin indisponible en test headless) est
  /// déjà avalé par init() — ici on ne fait que notifier les écouteurs.
  ///
  /// Phase 3 : les actions inline Android (`allow`/`deny`) arrivent ici aussi
  /// (response.actionId != null). On publie `action` dans le payload — l'UI
  /// existante l'ignore (deep-link tap) ; la nouvelle écoute actionnelle
  /// (chat_stream) la consomme pour soumettre directement.
  void _handleTap(NotificationResponse response) {
    final payload = response.payload ?? '';
    if (!payload.contains(':')) return;
    final kind = payload.substring(0, payload.indexOf(':'));
    final cascadeId = payload.substring(payload.indexOf(':') + 1);
    if (cascadeId.isEmpty || cascadeId == 'null') return;
    if (kind != 'approval' && kind != 'task') return;
    final action = response.actionId;
    if (action == null) {
      _tapController.add({'kind': kind, 'cascadeId': cascadeId});
      debugPrint('[Notifier] tap -> $kind $cascadeId');
    } else {
      _tapController.add({
        'kind': kind,
        'cascadeId': cascadeId,
        'action': action,
      });
      debugPrint('[Notifier] action -> $kind $cascadeId $action');
    }
  }

  /// Notifie une demande d'approbation — dédupliquée par [callId] avec un
  /// délai de grâce de 10 s (le broadcast multi-surface envoie le même
  /// événement à tous les clients connectés).
  Future<void> notifyApprovalRequired({
    required String callId,
    required String cascadeId,
    required String toolName,
    required String command,
  }) async {
    final now = DateTime.now();
    if (callId == _lastCallId &&
        _lastShownAt != null &&
        now.difference(_lastShownAt!) < const Duration(seconds: 10)) {
      return;
    }
    _lastCallId = callId;
    _lastShownAt = now;

    if (!_initialized || !_enabled) return;
    final plugin = _plugin;
    if (plugin == null) return;

    // C7 : permission plein écran (Android 14+). Sur les versions
    // antérieures canUseFullScreenIntent renvoie true sans dialog — l'appel
    // est donc un no-op propre. Le tap sur la notification full-screen est
    // délivré par le même callback onDidReceiveNotificationResponse que le
    // tap normal : pas de chemin de code supplémentaire côté UI.
    final androidImpl = plugin.resolvePlatformSpecificImplementation<
        AndroidFlutterLocalNotificationsPlugin>();
    if (androidImpl != null) {
      await androidImpl.requestFullScreenIntentPermission();
    }

    // Phase 3 — actions inline : « Autoriser / Refuser » directement dans la
    // notification (Android). L'utilisateur n'a pas besoin d'ouvrir l'app :
    // l'action renvoie actionId=allow|deny dans le même callback que le tap.
    // Le payload reste `approval:<cascadeId>` — l'UI re-fetch le contexte
    // (get_pending_approval) avant de soumettre, comme pour le deep-link.
    final details = NotificationDetails(
      android: AndroidNotificationDetails(
        'approval_required',
        'Approbations',
        channelDescription: 'Demandes d\'approbation de commandes distantes',
        importance: Importance.max,
        priority: Priority.high,
        category: AndroidNotificationCategory.call,
        visibility: NotificationVisibility.public,
        playSound: true,
        enableVibration: true,
        icon: 'ic_service_notification',
        color: const Color(0xFF3186FF),
        largeIcon: const DrawableResourceAndroidBitmap('@mipmap/launcher_icon'),
        // C7 : réveille l'écran verrouillé / l'app en arrière-plan avec
        // l'activité principale (le plugin l'utilise pour le content intent).
        // La notification « vole » l'écran — l'utilisateur approuve ou refuse
        // directement, sans devoir déverrouiller ni ouvrir l'app.
        fullScreenIntent: true,
        actions: <AndroidNotificationAction>[
          const AndroidNotificationAction('allow', 'Autoriser'),
          const AndroidNotificationAction('deny', 'Refuser'),
        ],
      ),
      iOS: const DarwinNotificationDetails(
        presentAlert: true,
        presentBadge: true,
        presentSound: true,
      ),
    );

    await plugin.show(
      // Phase 3 — dédup par cascade : deux demandes successives dans la même
      // cascade remplacent la notification précédente au lieu d'empiler.
      // cancelApproval(callId) reste cohérent : il calcule callId.hashCode,
      // identique au tag de la dernière demande de cette cascade (un callId
      // n'est jamais réutilisé).
      cascadeId.hashCode,
      'Approbation requise — $toolName',
      command.length > 120 ? '${command.substring(0, 120)}…' : command,
      details,
      payload: payloadForApproval(cascadeId),
    );
    debugPrint('[Notifier] approval notification -> $callId ($toolName)');
  }

  /// Notifie le démarrage d'une tâche (stream_start / scheduled_task_event).
  /// Discrète : canal d'importance par défaut, auto-annulée après 5 s.
  /// Dédupliquée par cascade sur 30 s (même pattern que [notifyTaskEnded]).
  Future<void> notifyTaskStarted({
    required String cascadeId,
    required String prompt,
  }) async {
    if (!_initialized || !_enabled) return;
    final now = DateTime.now();
    if (cascadeId == _lastTaskStartedCascade &&
        _lastTaskStartedAt != null &&
        now.difference(_lastTaskStartedAt!) < const Duration(seconds: 30)) {
      return;
    }
    _lastTaskStartedCascade = cascadeId;
    _lastTaskStartedAt = now;

    const androidDetails = AndroidNotificationDetails(
      'task_done',
      'Tâches distantes',
      channelDescription: 'Démarrage des tâches exécutées sur le PC hôte',
      importance: Importance.defaultImportance,
      priority: Priority.defaultPriority,
      visibility: NotificationVisibility.public,
      playSound: true,
      enableVibration: true,
      icon: 'ic_service_notification',
      color: Color(0xFF00B95C),
      largeIcon: DrawableResourceAndroidBitmap('@mipmap/launcher_icon'),
    );
    const iosDetails = DarwinNotificationDetails(
      presentAlert: true,
      presentBadge: true,
      presentSound: true,
    );
    final details = NotificationDetails(android: androidDetails, iOS: iosDetails);

    final plugin = _plugin;
    if (plugin == null) return;

    await plugin.show(
      cascadeId.hashCode,
      '🚀 Tâche démarrée',
      prompt.length > 120 ? '${prompt.substring(0, 120)}…' : prompt,
      details,
      payload: payloadForTask(cascadeId),
    );
    debugPrint('[Notifier] task started notification -> $cascadeId');

    // Auto-annulation différée (5 s) : c'est un démarrage, pas un événement
    // critique — la notification ne doit pas s'accumuler dans le tiroir.
    final notifId = cascadeId.hashCode;
    _autoCancelTimers[notifId]?.cancel();
    _autoCancelTimers[notifId] = Timer(const Duration(seconds: 5), () {
      plugin.cancel(notifId);
      _autoCancelTimers.remove(notifId);
    });
  }

  /// Notifie la fin d'une tâche (stream_end) : terminée, erreur ou action
  /// requise. Dédupliquée par cascade sur 30 s.
  Future<void> notifyTaskEnded({
    required String cascadeId,
    required String outcome, // 'done' | 'error' | 'approval'
    required String message,
  }) async {
    if (!_initialized || !_enabled) return;
    final now = DateTime.now();
    if (cascadeId == _lastTaskDoneCascade &&
        _lastTaskDoneAt != null &&
        now.difference(_lastTaskDoneAt!) < const Duration(seconds: 30)) {
      return;
    }
    _lastTaskDoneCascade = cascadeId;
    _lastTaskDoneAt = now;

    final (title, body, channelId) = switch (outcome) {
      'error' => (
          '⚠ Tâche interrompue',
          message.isEmpty ? 'Une erreur est survenue sur le PC hôte' : message,
          'task_errors',
        ),
      'approval' => (
          '✋ Action requise',
          message.isEmpty ? 'L\'agent attend votre approbation' : message,
          'approval_required',
        ),
      _ => (
          '✅ Tâche terminée',
          message.isEmpty ? 'L\'agent a fini de travailler' : message,
          'task_done',
        ),
    };

    const androidDetails = AndroidNotificationDetails(
      'task_done',
      'Tâches distantes',
      channelDescription: 'Fin des tâches exécutées sur le PC hôte',
      importance: Importance.defaultImportance,
      priority: Priority.defaultPriority,
      visibility: NotificationVisibility.public,
      playSound: true,
      enableVibration: true,
      icon: 'ic_service_notification',
      color: Color(0xFF00B95C),
      largeIcon: DrawableResourceAndroidBitmap('@mipmap/launcher_icon'),
    );
    const errorDetails = AndroidNotificationDetails(
      'task_errors',
      'Erreurs de tâche',
      channelDescription: 'Erreurs des tâches exécutées sur le PC hôte',
      importance: Importance.high,
      priority: Priority.high,
      playSound: true,
      enableVibration: true,
      icon: 'ic_service_notification',
      color: Color(0xFFFF5252),
      largeIcon: DrawableResourceAndroidBitmap('@mipmap/launcher_icon'),
    );
    const approvalDetails = AndroidNotificationDetails(
      'approval_required',
      'Approbations',
      channelDescription: 'Demandes d\'approbation de commandes distantes',
      importance: Importance.max,
      priority: Priority.high,
      category: AndroidNotificationCategory.call,
      visibility: NotificationVisibility.public,
      playSound: true,
      enableVibration: true,
      icon: 'ic_service_notification',
      color: Color(0xFF3186FF),
      largeIcon: DrawableResourceAndroidBitmap('@mipmap/launcher_icon'),
    );

    final android = switch (channelId) {
      'task_errors' => errorDetails,
      'approval_required' => approvalDetails,
      _ => androidDetails,
    };
    const iosDetails = DarwinNotificationDetails(
      presentAlert: true,
      presentBadge: true,
      presentSound: true,
    );
    final details = NotificationDetails(android: android, iOS: iosDetails);

    final plugin = _plugin;
    if (plugin == null) return;

    await plugin.show(
      cascadeId.hashCode,
      title,
      body.length > 120 ? '${body.substring(0, 120)}…' : body,
      details,
      payload: payloadForTask(cascadeId),
    );
    debugPrint('[Notifier] task notification -> $cascadeId ($outcome)');

    final notifId = cascadeId.hashCode;
    _autoCancelTimers[notifId]?.cancel();
    _autoCancelTimers[notifId] = Timer(const Duration(seconds: 5), () {
      plugin.cancel(notifId);
      _autoCancelTimers.remove(notifId);
    });
  }

  /// Notifie la perte de connexion au daemon (l'utilisateur n'est peut-être
  /// pas sur l'app). Dédupliquée : on ne sonne qu'une fois par coupure.
  Future<void> notifyConnectionLost() async {
    if (!_initialized || !_enabled) return;

    const androidDetails = AndroidNotificationDetails(
      'connection_events',
      'Connexion au PC hôte',
      channelDescription: 'Perte et rétablissement de la connexion au daemon',
      importance: Importance.high,
      priority: Priority.high,
      visibility: NotificationVisibility.public,
      icon: 'ic_service_notification',
      color: Color(0xFFFF5252),
      largeIcon: DrawableResourceAndroidBitmap('@mipmap/launcher_icon'),
    );
    const iosDetails = DarwinNotificationDetails(
      presentAlert: true,
      presentBadge: true,
      presentSound: true,
    );
    final details = NotificationDetails(android: androidDetails, iOS: iosDetails);

    final plugin = _plugin;
    if (plugin == null) return;

    await plugin.show(
      _connectionNotificationId,
      'Connexion perdue',
      "L'application se reconnecte automatiquement au PC hôte…",
      details,
    );
    debugPrint('[Notifier] connection lost notification');
  }

  /// Notifie le rétablissement de la connexion (remplace la notification
  /// « Connexion perdue » par un état rétabli).
  Future<void> notifyConnectionRestored() async {
    if (!_initialized || !_enabled) return;

    const androidDetails = AndroidNotificationDetails(
      'connection_events',
      'Connexion au PC hôte',
      channelDescription: 'Perte et rétablissement de la connexion au daemon',
      importance: Importance.defaultImportance,
      priority: Priority.defaultPriority,
      visibility: NotificationVisibility.public,
      icon: 'ic_service_notification',
      color: Color(0xFF00B95C),
      largeIcon: DrawableResourceAndroidBitmap('@mipmap/launcher_icon'),
    );
    const iosDetails = DarwinNotificationDetails(
      presentAlert: true,
      presentBadge: true,
      presentSound: true,
    );
    final details = NotificationDetails(android: androidDetails, iOS: iosDetails);

    final plugin = _plugin;
    if (plugin == null) return;

    await plugin.show(
      _connectionNotificationId,
      'Connexion rétablie',
      'Vous êtes de nouveau connecté au PC hôte.',
      details,
    );
    debugPrint('[Notifier] connection restored notification');
  }

  /// Notifie l'utilisateur lorsqu'une question interactive (AskQuestion / QCM) requiert son choix.
  Future<void> notifyQuestionRequired({
    required String cascadeId,
    required String question,
  }) async {
    if (!_initialized || !_enabled) return;

    const androidDetails = AndroidNotificationDetails(
      'approval_required',
      'Questions de l\'Agent',
      channelDescription: 'Questions et choix interactifs posés par l\'agent',
      importance: Importance.max,
      priority: Priority.high,
      category: AndroidNotificationCategory.call,
      visibility: NotificationVisibility.public,
      playSound: true,
      enableVibration: true,
      icon: 'ic_service_notification',
      color: Color(0xFFA855F7),
      largeIcon: DrawableResourceAndroidBitmap('@mipmap/launcher_icon'),
    );
    const iosDetails = DarwinNotificationDetails(
      presentAlert: true,
      presentBadge: true,
      presentSound: true,
    );
    final details = const NotificationDetails(android: androidDetails, iOS: iosDetails);

    final plugin = _plugin;
    if (plugin == null) return;

    await plugin.show(
      ('question_$cascadeId').hashCode,
      '❓ Question de l\'Agent',
      question.length > 120 ? '${question.substring(0, 120)}…' : question,
      details,
      payload: payloadForApproval(cascadeId),
    );
    debugPrint('[Notifier] question notification -> $cascadeId');
  }

  /// Annule la notification (l'utilisateur a répondu sur une autre surface).
  Future<void> cancelApproval(String callId) async {
    if (!_initialized) return;
    final plugin = _plugin;
    if (plugin == null) return;
    await plugin.cancel(callId.hashCode);
  }

  /// Annule la notification de fin de tâche d'une cascade.
  Future<void> cancelTask(String cascadeId) async {
    if (!_initialized) return;
    final plugin = _plugin;
    if (plugin == null) return;
    await plugin.cancel(cascadeId.hashCode);
  }

  /// Annule la notification d'approbation d'une cascade (Phase 3 — l'id de la
  /// notification est désormais `cascadeId.hashCode`, pas `callId.hashCode`).
  /// Équivalent de [cancelApproval] quand on ne connaît que la cascade.
  Future<void> cancelApprovalByCascadeId(String cascadeId) async {
    if (!_initialized) return;
    final plugin = _plugin;
    if (plugin == null) return;
    await plugin.cancel(cascadeId.hashCode);
  }
}
