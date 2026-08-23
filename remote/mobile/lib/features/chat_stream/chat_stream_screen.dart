import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../../core/network/websocket_client.dart';
import '../../core/notifications/approval_notifier.dart';
import '../../core/protocol/daemon_api.dart';
import '../../core/protocol/markdown_renderer.dart';
import '../../core/protocol/messages.dart';
import '../../core/protocol/stream_parser.dart';
import '../../widgets/ask_question_choice_card.dart';
import '../../widgets/chat_input_bar.dart';
import '../../widgets/connection_banner.dart';
import '../../widgets/markdown_bubble.dart';
import '../../widgets/tool_approval_card.dart';
import '../../widgets/session_top_tabs.dart';
import '../../widgets/artifact_cards.dart';
import '../../widgets/side_question_card.dart';
import '../../widgets/background_tasks_bar.dart';
import '../../widgets/background_task_output_sheet.dart';
import '../../widgets/app_toast.dart';
import '../../widgets/unified_diff_viewer.dart';
import '../../widgets/artifact_viewer_modal.dart';
import '../../widgets/agent_error_card.dart';
import '../../widgets/project_selector_bottom_sheet.dart';
import '../../widgets/session_breadcrumb.dart';
import 'widgets/execution_progress_view.dart';
import 'widgets/overview_panel_view.dart';
import 'widgets/session_review_view.dart';
import 'widgets/queued_messages_card.dart';
import 'widgets/revert_step_preview_dialog.dart';
import '../../services/offline_outbox_store.dart';
import '../../services/session_history_cache_store.dart';
import '../../widgets/skeleton_loader.dart';
import '../subagents/subagents_tree_sheet.dart';
import '../subagents/models/subagent_item.dart';
import '../subagents/widgets/subagent_tree_card.dart';
import '../subagents/widgets/subagent_detail_modal.dart';
import '../../widgets/zenithal_canvas.dart';
import '../../widgets/status_dot_badge.dart';
import '../../widgets/bouncing_tap.dart';
import '../../widgets/app_notification_banner.dart';
import '../../widgets/antigravity_logo.dart';
import 'models/banner_notification.dart';
import '../settings/models_settings_section.dart';
import 'package:mobile/theme/app_colors.dart';

class ChatStreamScreen extends StatefulWidget {
  final DaemonApi? api;
  final String activeSessionId;
  final String activeProjectName;
  final String? activeSessionTitle;
  final bool isConnected;

  /// Client WebSocket partagé (null en tests/aperçu) — fournit l'état de
  /// connexion en temps réel (statut, tentative, compte à rebours) au banner.
  final DaemonWebSocketClient? wsClient;

  /// Notifie le parent (main.dart) du changement d'état de streaming pour
  /// une session spécifique afin de mettre à jour son statut dans la barre latérale.
  final void Function(String sessionId, bool isStreaming)? onStreamingSessionChanged;

  /// Notifie le parent (main.dart) du changement d'état de streaming global.
  final ValueChanged<bool>? onStreamingStateChanged;

  /// Crée une nouvelle conversation (bouton « + » des tabs). Laissé au parent
  /// (main.dart) : il connaît la liste des sessions et le workspace actif.
  final VoidCallback? onNewConversation;

  /// Callback pour ouvrir le drawer des sessions depuis le breadcrumb
  final VoidCallback? onOpenSessionsDrawer;

  /// Workspace racine pour la détection VCS et fichiers modifiés.
  final String? workspacePath;

  /// Liste des projets officiels disponibles
  final List<ProjectItem>? projects;

  /// Callback de changement de projet workspace
  final void Function(ProjectItem project)? onSelectProject;

  const ChatStreamScreen({
    super.key,
    required this.api,
    required this.activeSessionId,
    required this.activeProjectName,
    this.activeSessionTitle,
    this.workspacePath,
    this.projects,
    this.onSelectProject,
    this.isConnected = true,
    this.wsClient,
    this.onStreamingSessionChanged,
    this.onStreamingStateChanged,
    this.onNewConversation,
    this.onOpenSessionsDrawer,
  });

  @override
  State<ChatStreamScreen> createState() => _ChatStreamScreenState();
}

class _ChatStreamScreenState extends State<ChatStreamScreen>
    with WidgetsBindingObserver {
  // Bug #9 : messages sauvegardés par session pour ne pas les perdre lors d'un
  // changement d'onglet pendant un stream actif.
  // ponytail: Map simple, pas de provider — l'historique n'est pas persisté sur
  // disque (session restart repart de zéro, ce qui est le comportement voulu).
  final Map<String, List<ChatMessage>> _sessionMessages = {};
  final Map<String, List<Map<String, dynamic>>> _sessionMessageQueues = {};

  List<ChatMessage> get _messages {
    return _sessionMessages.putIfAbsent(widget.activeSessionId, () => []);
  }

  // P6 : brouillons persistés par session — SharedPreferences pour survivre
  // au switch de session/onglet ET au redémarrage de l'app.
  // ponytail: getter/setter synchrones sur cache mémoire + écriture fire-and-forget
  // (même schéma que P4 pinning). Pas de debounce : chaque setDraft écrit ~2-3x
  // par seconde au pire, SharedPreferences supporte très bien ce débit.
  static const String _draftPrefsPrefix = 'session_draft_';
  static final Map<String, String> _draftCache = {};
  String get currentDraft => _draftCache[widget.activeSessionId] ?? '';
  void setDraft(String draft) {
    _draftCache[widget.activeSessionId] = draft;
    SharedPreferences.getInstance().then((prefs) => prefs.setString(
        '$_draftPrefsPrefix${widget.activeSessionId}', draft));
  }

  // File d'attente des approbations : isolée par session
  final Map<String, List<ToolApprovalRequest>> _sessionApprovals = {};
  final Map<String, int> _sessionApprovalIndices = {};

  // Questions interactives à choix multiples (AskQuestion) : isolée par session
  final Map<String, List<AskQuestionChoiceRequest>> _sessionQuestions = {};

  // callIds dont le daemon a broadcasté approval_expired : la carte reste
  // affichée (pourquoi elle a disparu) mais passe en lecture seule.
  final Set<String> _expiredCallIds = {};

  List<AskQuestionChoiceRequest> get _currentSessionQuestions =>
      _sessionQuestions.putIfAbsent(widget.activeSessionId, () => []);

  List<ToolApprovalRequest> get _currentSessionApprovals =>
      _sessionApprovals.putIfAbsent(widget.activeSessionId, () => []);

  int get _approvalIndex =>
      _sessionApprovalIndices[widget.activeSessionId] ?? -1;
  set _approvalIndex(int idx) =>
      _sessionApprovalIndices[widget.activeSessionId] = idx;

  ToolApprovalRequest? get _currentApproval {
    final list = _currentSessionApprovals;
    if (list.isEmpty) return null;
    final idx = _approvalIndex;
    if (idx < 0 || idx >= list.length) {
      return list.first;
    }
    return list[idx];
  }

  StreamSubscription<Map<String, dynamic>>? _streamSub;
  StreamSubscription<Map<String, dynamic>>? _tapSub;
  int _messageCounter = 0;

  static const _stillWorkingDelay = Duration(seconds: 15);
  final Set<String> _pendingApprovalCallIds = {};
  final Set<String> _processedCallIds = {};
  // Les sets de callIds utilisés pour dédupliquer les approvals poussées
  // par le daemon croissent sans borne sur une session longue. On les borne
  // (les callIds très anciens ne reviennent plus : le daemon ne rejoue que
  // les étapes récentes au sync_catchup).
  static const int _maxTrackedCallIds = 500;

  void _rememberProcessedCall(String callId) {
    _processedCallIds.add(callId);
    if (_processedCallIds.length > _maxTrackedCallIds) {
      _processedCallIds.remove(_processedCallIds.first);
    }
  }

  void _rememberExpiredCall(String callId) {
    _expiredCallIds.add(callId);
    if (_expiredCallIds.length > _maxTrackedCallIds) {
      _expiredCallIds.remove(_expiredCallIds.first);
    }
  }


  Timer? _stillWorkingTimer;
  final List<Timer> _settleTimers = [];
  
  // Streaming multi-session : ensemble des sessions actuellement en train de streamer
  final Set<String> _activeStreamingSessions = {};
  int get _activeStreamCount => _activeStreamingSessions.length;
  bool get _hasCurrentActiveStream => _activeStreamingSessions.contains(widget.activeSessionId);
  
  bool _showStillWorking = false;
  final Map<String, Map<String, dynamic>> _sessionLastStreamEnds = {};
  final Map<String, String> _externalThoughts = {};
  final Map<String, String> _streamRequestToMessageId = {};

  Timer? _throttleTimer;
  bool _needsStateUpdate = false;
  static const _throttleDuration = Duration(milliseconds: 25);

  // Bug persistance pensées : état d'expansion stocké ici par message ID
  // pour survivre aux switches de session et aux rebuilds de la liste.
  // ponytail: Set suffit (expandé = dans le Set, replié = absent).
  final Set<String> _expandedThoughts = {};

  // Auto-scroll pendant le streaming (audit UX P1-6).
  final ScrollController _scrollController = ScrollController();
  // ignore: prefer_final_fields
  bool _isInitialScrollSettling = true;

  /// Persistance statique de la position de défilement par session (survit aux
  /// changements d'écrans, d'onglets et aux switches de session).
  static final Map<String, double> _globalSessionScrollOffsets = {};
  static final Map<String, bool> _globalSessionUserScrolled = {};

  // Bouton flottant « retour en bas » (P1) : visible quand l'utilisateur
  // scrolle loin du bas pendant un stream. Compte les nouveaux messages
  // arrivés pendant qu'il lit l'historique, et se cache dès qu'il revient
  // près du bas (ou tape le bouton).
  bool _showJumpToBottom = false;
  int _hiddenNewCount = 0;
  bool _userScrollLocked = false;

  // ── Session Top Tabs & Artifact state (isolé par session) ───────────
  final Map<String, SessionTabType> _sessionTabs = {};
  SessionTabType get _currentTab => _sessionTabs[widget.activeSessionId] ?? SessionTabType.chat;
  set _currentTab(SessionTabType tab) => _sessionTabs[widget.activeSessionId] = tab;

  final Map<String, Set<String>> _sessionModifiedFiles = {};
  final Map<String, Set<String>> _turnModifiedFiles = {};
  final Map<String, List<SessionModifiedFile>> _sessionModifiedFileList = {};
  final Map<String, List<String>> _sessionArtifacts = {};
  final Map<String, int> _sessionSubagentCounts = {};
  final Map<String, List<SubagentItem>> _sessionSubagents = {};
  final Map<String, String?> _sessionActiveArtifacts = {};
  final Map<String, String?> _sessionPlanTexts = {};
  bool _isVcsLoading = false;
  final Set<String> _loadingHistorySessions = {};

  Set<String> get _modifiedFiles => _sessionModifiedFiles.putIfAbsent(widget.activeSessionId, () => {});
  List<SessionModifiedFile> get _modifiedFileList => _sessionModifiedFileList.putIfAbsent(widget.activeSessionId, () => []);
  List<String> get _artifacts => _sessionArtifacts.putIfAbsent(widget.activeSessionId, () => []);
  int get _subagentsCount => _sessionSubagentCounts[widget.activeSessionId] ?? _subagents.length;
  List<SubagentItem> get _subagents => _sessionSubagents.putIfAbsent(widget.activeSessionId, () => []);
  String? get _activeArtifact => _sessionActiveArtifacts[widget.activeSessionId];
  set _activeArtifact(String? art) => _sessionActiveArtifacts[widget.activeSessionId] = art;
  String? get _latestPlanText => _sessionPlanTexts[widget.activeSessionId];

  List<SessionTabType> get _swipeableTabs => [
        SessionTabType.chat,
        SessionTabType.review,
        SessionTabType.overview,
        if (_latestPlanText != null) SessionTabType.plan,
        if (_hasCurrentActiveStream) SessionTabType.tasks,
      ];

  // ── Side Question (/btw) & Background Tasks state ───────────────────
  final Map<String, String?> _sessionSideQuestions = {};
  final Map<String, String?> _sessionSideQuestionAnswers = {};
  final Map<String, bool> _sessionSideQuestionLoadings = {};

  String? get _sideQuestion => _sessionSideQuestions[widget.activeSessionId];
  set _sideQuestion(String? q) => _sessionSideQuestions[widget.activeSessionId] = q;

  String? get _sideQuestionAnswer => _sessionSideQuestionAnswers[widget.activeSessionId];
  set _sideQuestionAnswer(String? a) => _sessionSideQuestionAnswers[widget.activeSessionId] = a;

  bool get _isSideQuestionLoading => _sessionSideQuestionLoadings[widget.activeSessionId] ?? false;
  set _isSideQuestionLoading(bool l) => _sessionSideQuestionLoadings[widget.activeSessionId] = l;
  Timer? _sideQuestionTimer;
  Timer? _loadOlderTimer;

  final List<String> _runningBackgroundTasks = [];
  bool _isFullscreen = false;
  bool _isHeaderVisible = true;
  bool _isSearching = false;
  final TextEditingController _searchController = TextEditingController();
  List<int> _searchMatches = [];
  int _currentSearchMatchIndex = 0;

  void _toggleSearch() {
    HapticFeedback.selectionClick();
    setState(() {
      _isSearching = !_isSearching;
      if (!_isSearching) {
        _searchController.clear();
        _searchMatches.clear();
        _currentSearchMatchIndex = 0;
      }
    });
  }

  /// Debounce de la recherche : le scan des textes complets des messages
  /// tourne sur l'isolate UI — sans debounce, chaque frappe rebuild la page.
  Timer? _searchDebounce;

  /// Abonnements stream des prompts envoyés : suivis pour être annulés au
  /// dispose (sinon un stream orphelin continue de parser et de muter
  /// `_sessionMessages` jusqu'au stream_end après fermeture de l'écran).
  final List<StreamSubscription<Map<String, dynamic>>> _promptStreamSubs = [];

  void _onSearchQueryChanged(String query) {
    _searchDebounce?.cancel();
    _searchDebounce = Timer(const Duration(milliseconds: 150), () {
      if (!mounted) return;
      final q = query.trim().toLowerCase();
      final msgs = _sessionMessages[widget.activeSessionId] ?? [];
      if (q.isEmpty) {
        setState(() {
          _searchMatches = [];
          _currentSearchMatchIndex = 0;
        });
        return;
      }
      final matches = <int>[];
      for (var i = 0; i < msgs.length; i++) {
        final m = msgs[i];
        if (m.text.toLowerCase().contains(q) || m.sender.toLowerCase().contains(q)) {
          matches.add(i);
        }
      }
      setState(() {
        _searchMatches = matches;
        _currentSearchMatchIndex = matches.isNotEmpty ? matches.length - 1 : 0;
      });
      _jumpToSearchMatch();
    });
  }

  void _jumpToSearchMatch() {
    if (_searchMatches.isEmpty || !_scrollController.hasClients) return;
    final msgs = _sessionMessages[widget.activeSessionId] ?? [];
    if (msgs.isEmpty) return;
    final targetIndex = _searchMatches[_currentSearchMatchIndex];
    final fraction = (targetIndex / (msgs.isNotEmpty ? msgs.length : 1)).clamp(0.0, 1.0);
    final maxScroll = _scrollController.position.maxScrollExtent;
    _scrollController.animateTo(
      fraction * maxScroll,
      duration: const Duration(milliseconds: 300),
      curve: Curves.easeOutCubic,
    );
    HapticFeedback.selectionClick();
  }

  void _nextSearchMatch() {
    if (_searchMatches.isEmpty) return;
    setState(() {
      _currentSearchMatchIndex = (_currentSearchMatchIndex + 1) % _searchMatches.length;
    });
    _jumpToSearchMatch();
  }

  void _prevSearchMatch() {
    if (_searchMatches.isEmpty) return;
    setState(() {
      _currentSearchMatchIndex = (_currentSearchMatchIndex - 1 + _searchMatches.length) % _searchMatches.length;
    });
    _jumpToSearchMatch();
  }

  void _closeSearch() {
    HapticFeedback.selectionClick();
    setState(() {
      _isSearching = false;
      _searchController.clear();
      _searchMatches.clear();
      _currentSearchMatchIndex = 0;
    });
  }

  final Map<String, StringBuffer> _taskOutputs = {};
  final Map<String, String> _taskStatuses = {};
  final Map<String, StreamController<String>> _taskOutputControllers = {};
  final Map<String, String> _taskCommandToId = {};
  final Map<String, String> _taskIdToCommand = {};
  final Map<String, DateTime> _streamStartTimes = {};

  // P3 : borne l'état des tâches d'arrière-plan conservé en mémoire (sortie
  // cumulée, mappings cmd↔id, statuts). Au-delà, les plus anciennes sont
  // élaguées — sauf celles encore en cours.
  static const int _maxTrackedTasks = 40;

  void _closeTaskController(String key) {
    final c = _taskOutputControllers.remove(key);
    if (c != null && !c.isClosed) c.close();
  }

  void _pruneTaskState() {
    void pruneMap<K, V>(Map<K, V> m) {
      while (m.length > _maxTrackedTasks) {
        final oldest = m.keys.first;
        if (oldest is String && _runningBackgroundTasks.contains(oldest)) {
          // encore active : on déplace en fin pour ne pas bloquer l'élagage
          final v = m.remove(oldest);
          if (v != null) m[oldest] = v;
          break;
        }
        m.remove(oldest);
      }
    }

    pruneMap(_taskOutputs);
    pruneMap(_taskStatuses);
    pruneMap(_taskCommandToId);
    pruneMap(_taskIdToCommand);
    while (_taskOutputControllers.length > _maxTrackedTasks) {
      _closeTaskController(_taskOutputControllers.keys.first);
    }
  }

  String _computeWorkedDuration(DateTime? startTime) {
    if (startTime == null) return 'Worked for 1s';
    final elapsed = DateTime.now().difference(startTime);
    final totalSecs = elapsed.inSeconds > 0 ? elapsed.inSeconds : 1;
    final mins = totalSecs ~/ 60;
    final secs = totalSecs % 60;
    if (mins > 0) {
      return secs > 0 ? 'Worked for ${mins}m ${secs}s' : 'Worked for ${mins}m';
    }
    return 'Worked for ${secs}s';
  }

  void _openTaskOutputSheet(String taskNameOrId) {
    final realTaskId = _taskCommandToId[taskNameOrId] ?? taskNameOrId;
    final realCommand = _taskIdToCommand[taskNameOrId] ??
        (_taskIdToCommand[realTaskId] ?? taskNameOrId);

    final initialOut = (_taskOutputs[taskNameOrId]?.isNotEmpty == true)
        ? _taskOutputs[taskNameOrId]!.toString()
        : ((_taskOutputs[realTaskId]?.isNotEmpty == true)
            ? _taskOutputs[realTaskId]!.toString()
            : (_taskOutputs[realCommand]?.toString() ?? ''));
    final status = _taskStatuses[taskNameOrId] ??
        _taskStatuses[realTaskId] ??
        _taskStatuses[realCommand] ??
        'running';
    final ctrl = _taskOutputControllers.putIfAbsent(
      realTaskId,
      () => StreamController<String>.broadcast(),
    );

    BackgroundTaskOutputSheet.show(
      context,
      taskId: realTaskId,
      command: realCommand,
      initialOutput: initialOut,
      status: status,
      outputStream: ctrl.stream,
      onStop: () => _handleStopBackgroundTask(taskNameOrId),
      api: widget.api,
      cascadeId: widget.activeSessionId,
    );
  }

  void _handleStopBackgroundTask(String taskNameOrId) {
    final realTaskId = _taskCommandToId[taskNameOrId] ?? taskNameOrId;
    widget.api?.killRunningTask(realTaskId);
    setState(() {
      _runningBackgroundTasks.remove(taskNameOrId);
      _runningBackgroundTasks.remove(realTaskId);
      _taskStatuses[taskNameOrId] = 'killed';
      _taskStatuses[realTaskId] = 'killed';
    });
  }

  Future<void> _refreshRunningTasks() async {
    if (widget.api == null) return;
    try {
      final tasks = await widget.api!.listRunningTasks(
        cascadeId: widget.activeSessionId,
      );
      if (mounted) {
        final active = <String>[];
        for (final t in tasks) {
          final id = t['id']?.toString() ?? '';
          final cmd = t['command']?.toString() ?? id;
          final status = t['status']?.toString() ?? 'running';
          if (id.isNotEmpty) {
            _taskCommandToId[cmd] = id;
            _taskIdToCommand[id] = cmd;
          }
          if (status == 'running' && cmd.isNotEmpty) {
            active.add(cmd);
            _taskStatuses[cmd] = 'running';
            _taskStatuses[id] = 'running';
          }
        }
        if (active.length != _runningBackgroundTasks.length || !active.every((e) => _runningBackgroundTasks.contains(e))) {
          setState(() {
            _runningBackgroundTasks.clear();
            _runningBackgroundTasks.addAll(active);
          });
        }
      }
    } catch (_) {}
  }

  // ── Sync & Catch-up status ─────────────────────────────────────────
  bool _isSyncing = false;
  Timer? _syncTimer;

  // ── Quota temps réel (P8) ───────────────────────────────────────────
  Map<String, dynamic>? _quotaSummary;
  Timer? _quotaTimer;

  // ── Unified Notification Banners ──────────────────────────────────────────
  final GlobalKey<ChatInputBarState> _chatInputKey = GlobalKey<ChatInputBarState>();
  final Map<String, BannerNotificationData> _activeBanners = {};
  final Set<String> _dismissedBannerIds = {};

  BannerNotificationData? get _topActiveBanner {
    final available = _activeBanners.values
        .where((b) => !_dismissedBannerIds.contains(b.id))
        .toList();
    if (available.isEmpty) return null;
    available.sort((a, b) => a.priority.compareTo(b.priority));
    return available.first;
  }

  void _dismissBanner(String bannerId) {
    if (mounted) {
      setState(() {
        _dismissedBannerIds.add(bannerId);
      });
    }
  }

  String _resolveModelLabel(dynamic rawModel) {
    final str = rawModel != null ? rawModel.toString().trim() : '';
    if (str.isNotEmpty && str != 'Gemini 3.7 Flash') {
      return str;
    }
    final currentSelected = _chatInputKey.currentState?.selectedModel;
    if (currentSelected != null && currentSelected.isNotEmpty) {
      return currentSelected;
    }
    return str.isNotEmpty ? str : 'Gemini 3.7 Flash';
  }

  void _showModelSelector() {
    _chatInputKey.currentState?.openModelSelector();
  }

  void _showPlansOrLimitsSheet() {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      backgroundColor: Colors.transparent,
      builder: (ctx) => DraggableScrollableSheet(
        initialChildSize: 0.85,
        minChildSize: 0.5,
        maxChildSize: 0.95,
        builder: (_, scrollController) => SafeArea(
          top: false,
          child: Container(
            decoration: BoxDecoration(
              color: Theme.of(context).brightness == Brightness.dark
                  ? AppColors.surfaceRaised
                  : Theme.of(context).colorScheme.surface,
              borderRadius: const BorderRadius.vertical(top: Radius.circular(16)),
            ),
            child: ModelsSettingsSection(
              api: widget.api,
            ),
          ),
        ),
      ),
    );
  }

  // ── État de connexion live (alimenté par wsClient) ─────────────────────
  ConnectionStatus _status = ConnectionStatus.disconnected;
  int _attempt = 0;
  Duration _nextRetryIn = Duration.zero;
  bool _isManualDisconnect = false;
  bool _notifiedLost = false;
  // L'app est au premier plan : le banner suffit, pas besoin de notification
  // locale (qui vise l'écran verrouillé / l'app en arrière-plan).
  bool _appInForeground = true;

  // ── Fenêtre paginée de conversation (Reverse Chunked Pagination) ──
  // Principe : tous les messages sont en mémoire dans _messages (chargés une
  // seule fois depuis l'historique). On n'affiche que les N derniers
  // (_visibleCount). Quand l'utilisateur scrolle vers le haut jusqu'au bord,
  // on incrémente _visibleCount de _pageSize — ce qui révèle les N messages
  // précédents sans aucun appel réseau supplémentaire.
  // Temps de rendu initial = O(1) quel que soit le nombre total de messages.
  static const int _pageSize = 20;
  final Map<String, int> _visibleCounts = {};
  int get _visibleCount =>
      _visibleCounts.putIfAbsent(widget.activeSessionId, () => _pageSize);
  bool _isLoadingMoreOlder = false;

  List<ChatMessage> get _visibleMessages {
    final all = _messages;
    final count = _visibleCount;
    if (all.length <= count) return all;
    return all.sublist(all.length - count);
  }

  int get _hiddenOlderCount {
    final all = _messages;
    final count = _visibleCount;
    if (all.length <= count) return 0;
    return all.length - count;
  }

  void _onScroll() {
    if (!_scrollController.hasClients || _isInitialScrollSettling) return;
    final pos = _scrollController.position;
    final current = pos.pixels;
    final max = pos.maxScrollExtent;
    // P1 : bascule du bouton flottant — on ne setState que lors d'un
    // changement d'état (une fois par départ/retour, pas à chaque pixel).
    final nearBottom = (max - current) < 120;

    _globalSessionScrollOffsets[widget.activeSessionId] = current;
    _globalSessionUserScrolled[widget.activeSessionId] = !nearBottom;

    if (!nearBottom && !_userScrollLocked) {
      _userScrollLocked = true;
    } else if (nearBottom && _userScrollLocked) {
      _userScrollLocked = false;
    }
    if (nearBottom != _showJumpToBottom) {
      setState(() {
        _showJumpToBottom = !nearBottom;
        if (nearBottom) _hiddenNewCount = 0;
      });
    }

    // Auto-hide du header au défilement vers le bas pour maximiser l'espace de lecture
    if (pos.userScrollDirection == ScrollDirection.reverse && _isHeaderVisible && pos.pixels > 60) {
      setState(() => _isHeaderVisible = false);
    } else if (pos.userScrollDirection == ScrollDirection.forward && !_isHeaderVisible) {
      setState(() => _isHeaderVisible = true);
    }

    if (!_isLoadingMoreOlder && pos.pixels <= 80 && _hiddenOlderCount > 0 && pos.maxScrollExtent > 100) {
      _loadMoreOlderMessages();
    }
  }

  void _jumpToBottom() {
    HapticFeedback.lightImpact();
    _userScrollLocked = false;
    _globalSessionUserScrolled[widget.activeSessionId] = false;
    _globalSessionScrollOffsets.remove(widget.activeSessionId);
    if (_scrollController.hasClients) {
      _scrollController.animateTo(
        _scrollController.position.maxScrollExtent,
        duration: const Duration(milliseconds: 250),
        curve: Curves.easeOut,
      );
    }
    setState(() {
      _showJumpToBottom = false;
      _hiddenNewCount = 0;
    });
  }

  void _loadMoreOlderMessages() {
    if (_isLoadingMoreOlder || _hiddenOlderCount <= 0) return;
    setState(() {
      _isLoadingMoreOlder = true;
      final current = _visibleCounts[widget.activeSessionId] ?? _pageSize;
      _visibleCounts[widget.activeSessionId] = current + _pageSize;
    });
    _loadOlderTimer?.cancel();
    _loadOlderTimer = Timer(const Duration(milliseconds: 250), () {
      if (mounted) {
        setState(() {
          _isLoadingMoreOlder = false;
        });
      }
    });
  }

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _scrollController.addListener(_onScroll);
    _watchBroadcastStreams();
    _setupConnectionListeners();
    _watchNotificationTaps();
    // Sans wsClient (tests/aperçu), l'état vient de la prop isConnected.
    if (widget.wsClient == null) {
      _status = widget.isConnected
          ? ConnectionStatus.connected
          : ConnectionStatus.disconnected;
    }
    _loadHistoryIfEmpty();
    _fetchSubagentsForSession(widget.activeSessionId);
    _refreshQuotaSummary();
    _quotaTimer = Timer.periodic(const Duration(seconds: 60), (_) {
      if (mounted) _refreshQuotaSummary();
    });
    _loadPersistedDraft();
    _loadOfflineOutbox(widget.activeSessionId);
    _refreshRunningTasks();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) {
        _restoreOrScrollToBottom(widget.activeSessionId);
      }
    });
  }

  /// Recharge les messages en attente hors-ligne pour la session active
  Future<void> _loadOfflineOutbox(String sessionId) async {
    if (sessionId.isEmpty) return;
    final loaded = await OfflineOutboxStore.loadQueuedMessages(sessionId);
    if (loaded.isNotEmpty && mounted) {
      setState(() {
        _sessionMessageQueues[sessionId] = loaded;
      });
      _checkAndFlushOfflineOutbox();
    }
  }

  /// Expédie automatiquement les messages en attente dès reconnexion
  void _checkAndFlushOfflineOutbox() {
    final isConnected = (widget.wsClient?.status == ConnectionStatus.connected) ||
        (_status == ConnectionStatus.connected) ||
        widget.isConnected;
    if (!isConnected) return;

    for (final entry in _sessionMessageQueues.entries.toList()) {
      final sessionId = entry.key;
      final queue = entry.value;
      if (queue.isEmpty) continue;
      final isStreaming = _activeStreamingSessions.contains(sessionId);
      if (!isStreaming) {
        HapticFeedback.mediumImpact();
        final next = queue.removeAt(0);
        OfflineOutboxStore.saveQueuedMessages(sessionId, queue);
        final text = next['text'] as String? ?? '';
        if (text.isEmpty) continue;
        final modelUID = next['modelUID'] as String?;
        final modelEnum = next['modelEnum'] as int?;
        final buf = _sessionMessages.putIfAbsent(sessionId, () => []);
        setState(() {
          buf.add(ChatMessage(
            id: 'm${++_messageCounter}',
            sender: 'user',
            text: text,
            timestamp: _timestamp(),
          ));
        });
        _sendPromptToDaemon(text, targetSessionOverride: sessionId, modelUID: modelUID, modelEnum: modelEnum);
      }
    }
  }

  /// P6 : recharge le brouillon persisté de la session courante dans le cache
  /// mémoire (le widget ChatInputBar lit `currentDraft` à son initState).
  Future<void> _loadPersistedDraft() async {
    final prefs = await SharedPreferences.getInstance();
    if (!mounted || widget.activeSessionId.isEmpty) return;
    _draftCache[widget.activeSessionId] =
        prefs.getString('$_draftPrefsPrefix${widget.activeSessionId}') ?? '';
  }

  Future<void> _refreshQuotaSummary() async {
    final api = widget.api;
    if (api == null || !widget.isConnected) return;
    try {
      final q = await api.getUserQuotaSummary();
      if (mounted) {
        setState(() {
          _quotaSummary = q;
          final banner = BannerClassifier.classifyQuota(
            q,
            onDismiss: () => _dismissBanner('quota-exceeded-metric'),
            onSwitchModel: _showModelSelector,
            onSeePlans: _showPlansOrLimitsSheet,
          );
          if (banner != null) {
            _activeBanners[banner.id] = banner;
          } else {
            _activeBanners.remove('quota-exceeded-metric');
          }
        });
      }
    } catch (_) {}
  }

  void _scrollToBottomSettled({int maxAttempts = 4}) {
    if (!mounted) return;
    _isInitialScrollSettling = true;
    _userScrollLocked = false;
    _showJumpToBottom = false;
    _hiddenNewCount = 0;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted || !_scrollController.hasClients) {
        _isInitialScrollSettling = false;
        return;
      }
      _scrollController.jumpTo(_scrollController.position.maxScrollExtent);
      for (final t in _settleTimers) {
        t.cancel();
      }
      _settleTimers.clear();
      if (!mounted) return;
      if (maxAttempts > 1) {
        _settleTimers.add(Timer(const Duration(milliseconds: 60), () {
          if (!mounted || !_scrollController.hasClients) {
            _isInitialScrollSettling = false;
            return;
          }
          _scrollController.jumpTo(_scrollController.position.maxScrollExtent);
          if (maxAttempts > 2) {
            _settleTimers.add(Timer(const Duration(milliseconds: 150), () {
              if (!mounted || !_scrollController.hasClients) {
                _isInitialScrollSettling = false;
                return;
              }
              _scrollController.jumpTo(_scrollController.position.maxScrollExtent);
              if (maxAttempts > 3) {
                _settleTimers.add(Timer(const Duration(milliseconds: 250), () {
                  if (mounted && _scrollController.hasClients) {
                    _scrollController.jumpTo(_scrollController.position.maxScrollExtent);
                  }
                  _isInitialScrollSettling = false;
                }));
              } else {
                _isInitialScrollSettling = false;
              }
            }));
          } else {
            _isInitialScrollSettling = false;
          }
        }));
      } else {
        _isInitialScrollSettling = false;
      }
    });
  }

  /// Restaure la position de défilement persistée d'une session, ou défile
  /// tout en bas si la session est ouverte pour la première fois.
  void _restoreOrScrollToBottom(String sessionId) {
    if (!mounted) return;
    final savedOffset = _globalSessionScrollOffsets[sessionId];
    final isUserScrolled = _globalSessionUserScrolled[sessionId] == true;

    if (savedOffset != null && isUserScrolled) {
      _restoreScrollOffset(savedOffset);
    } else {
      _scrollToBottomSettled();
    }
  }

  void _restoreScrollOffset(double targetOffset, {int maxAttempts = 3}) {
    if (!mounted) return;
    _isInitialScrollSettling = true;
    _userScrollLocked = true;
    _showJumpToBottom = true;
    for (final t in _settleTimers) {
      t.cancel();
    }
    _settleTimers.clear();

    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted || !_scrollController.hasClients) {
        _isInitialScrollSettling = false;
        return;
      }
      final clamped = targetOffset.clamp(0.0, _scrollController.position.maxScrollExtent);
      _scrollController.jumpTo(clamped);
      if (maxAttempts > 1) {
        _settleTimers.add(Timer(const Duration(milliseconds: 60), () {
          if (mounted && _scrollController.hasClients) {
            final c = targetOffset.clamp(0.0, _scrollController.position.maxScrollExtent);
            _scrollController.jumpTo(c);
          }
          if (maxAttempts > 2) {
            _settleTimers.add(Timer(const Duration(milliseconds: 150), () {
              if (mounted && _scrollController.hasClients) {
                final c = targetOffset.clamp(0.0, _scrollController.position.maxScrollExtent);
                _scrollController.jumpTo(c);
              }
              _isInitialScrollSettling = false;
            }));
          } else {
            _isInitialScrollSettling = false;
          }
        }));
      } else {
        _isInitialScrollSettling = false;
      }
    });
  }

  void _loadHistoryIfEmpty([String? targetSessionId]) {
    final targetSession = targetSessionId ?? widget.activeSessionId;
    _loadSessionContextAndArtifacts(targetSession);
    _fetchVcsChanges();
    if (targetSession.isNotEmpty) {
      // 0ms instant cache display before API responds
      final buf = _sessionMessages.putIfAbsent(targetSession, () => []);
      if (buf.isEmpty) {
        final cached = SessionHistoryCacheStore.instance.getInMemory(targetSession);
        if (cached != null && cached.isNotEmpty) {
          buf.addAll(cached);
          if (targetSession == widget.activeSessionId) {
            _restoreOrScrollToBottom(targetSession);
          }
        } else {
          _loadingHistorySessions.add(targetSession);
          SessionHistoryCacheStore.instance.loadSessionHistory(targetSession).then((cachedList) {
            if (mounted && cachedList.isNotEmpty && (_sessionMessages[targetSession]?.isEmpty ?? true)) {
              setState(() {
                _sessionMessages.putIfAbsent(targetSession, () => []).addAll(cachedList);
              });
              if (targetSession == widget.activeSessionId) {
                _restoreOrScrollToBottom(targetSession);
              }
            }
          });
        }
      }

      widget.api?.getSessionHistory(targetSession).then((data) {
        _loadingHistorySessions.remove(targetSession);
        if (!mounted) return;
        final rawMessages = data['messages'] as List?;
        final parsed = <ChatMessage>[];
        if (rawMessages != null && rawMessages.isNotEmpty) {
          for (final m in rawMessages) {
            if (m is Map) {
              final map = Map<String, dynamic>.from(m);
              final msg = ChatMessage.fromJson(map);
              final isError = map['isError'] == true && msg.text.trim().isEmpty;
              parsed.add(isError ? msg.copyWith(isError: true) : msg);
            }
          }
        }

        final isStreaming = data['isStreaming'] == true;
        final isStreamingLive = _activeStreamingSessions.contains(targetSession);
        final activeReqId = data['activeRequestId']?.toString() ?? 'live';
        if (isStreaming && !parsed.any((m) => m.id == 'ext-$activeReqId' || m.isStreaming)) {
          parsed.add(ChatMessage(
            id: 'ext-$activeReqId',
            sender: 'assistant',
            text: '',
            timestamp: _timestamp(),
            isStreaming: true,
          ));
        }

        if (!isStreamingLive || !isStreaming) {
          if (parsed.isNotEmpty || buf.isEmpty) {
            buf
              ..clear()
              ..addAll(parsed);
            SessionHistoryCacheStore.instance.saveSessionHistory(targetSession, buf);
            for (final msg in buf.reversed) {
              if (msg.sender == 'assistant') {
                final txt = msg.text.toLowerCase();
                final thought = (msg.thought ?? '').toLowerCase();
                if (txt.contains('quota') || thought.contains('quota')) {
                  final banner = BannerClassifier.classifyError(
                    msg.text.isNotEmpty ? msg.text : (msg.thought ?? ''),
                    onDismiss: () => _dismissBanner('quota-exceeded'),
                    onSwitchModel: _showModelSelector,
                    onSeePlans: _showPlansOrLimitsSheet,
                  );
                  if (banner != null) {
                    _activeBanners[banner.id] = banner;
                  }
                  break;
                }
              }
            }
          }
          if (isStreaming) {
            _onStreamStarted(targetSession);
            // Catch up any in-flight live events from the daemon's StepRecovery buffer
            widget.api?.syncSession(cascadeId: targetSession, lastStepIndex: 0);
            if (data['hasPendingApproval'] == true) {
              widget.api?.getPendingApproval(targetSession);
            }
          } else {
            _onStreamEnded(targetSession);
            _refreshRunningTasks();
          }
          setState(() {});
          _restoreOrScrollToBottom(targetSession);
        }
      }).catchError((_) {
        _loadingHistorySessions.remove(targetSession);
        if (mounted) setState(() {});
      });
    }
  }

  Future<void> _loadSessionContextAndArtifacts([String? targetSessionId]) async {
    final targetSession = targetSessionId ?? widget.activeSessionId;
    final api = widget.api;
    if (targetSession.isEmpty || api == null) return;
    try {
      final res = await api.getContext(cascadeId: targetSession);
      final rawArts = res['artifacts'] as List<dynamic>? ?? [];
      final artNames = <String>[];
      for (final a in rawArts) {
        if (a is Map && a['name'] != null) {
          artNames.add(a['name'].toString());
        } else if (a is String) {
          artNames.add(a);
        }
      }
      final subCount = (res['subagentsCount'] as int?) ?? 0;
      final plan = res['plan']?.toString() ?? res['latestPlanText']?.toString();
      final rawModFiles = res['modifiedFiles'] as List<dynamic>? ?? [];
      final modFiles = <String>[];
      for (final f in rawModFiles) {
        if (f is String && f.isNotEmpty) {
          modFiles.add(f);
        } else if (f is Map && f['path'] != null) {
          modFiles.add(f['path'].toString());
        }
      }

      if (mounted) {
        if (artNames.isNotEmpty) {
          _sessionArtifacts[targetSession] = artNames;
        }
        _sessionSubagentCounts[targetSession] = subCount;
        if (plan != null && plan.isNotEmpty) {
          _sessionPlanTexts[targetSession] = plan;
        }
        final targetModFiles = _sessionModifiedFiles.putIfAbsent(targetSession, () => {});
        final targetModFileList = _sessionModifiedFileList.putIfAbsent(targetSession, () => []);
        for (final p in modFiles) {
          var clean = p.replaceAll('\\', '/');
          if (clean.startsWith('file:///')) clean = clean.substring(8);
          if (clean.startsWith('file://')) clean = clean.substring(7);
          if (!targetModFiles.contains(clean)) {
            targetModFiles.add(clean);
          }
          if (!targetModFileList.any((f) => f.path == clean)) {
            targetModFileList.add(SessionModifiedFile(path: clean, additions: 1, deletions: 0));
          }
        }
        _fetchSubagentsForSession(targetSession);
        if (widget.activeSessionId == targetSession) {
          setState(() {});
        }
      }
    } catch (_) {}
  }

  Future<void> _fetchSubagentsForSession(String targetSession) async {
    final api = widget.api;
    if (api == null || targetSession.isEmpty) return;
    try {
      final raw = await api.getSubagents(targetSession);
      if (!mounted) return;
      final parsed = raw.map((m) => SubagentItem.fromJson(m)).toList();
      setState(() {
        _sessionSubagents[targetSession] = parsed;
        _sessionSubagentCounts[targetSession] = parsed.length;
      });
    } catch (_) {}
  }

  /// B2 — tap-to-deep-link : quand l'utilisateur tape la notification locale
  /// « Approbation requise » (app en arrière-plan ou tuée), on re-fetch le
  /// contexte via get_pending_approval et on pousse la carte. Le daemon garde
  /// l'approbation même si le stream_delta d'origine a été perdu.
  ///
  /// Phase 3 — action inline : la notification porte des boutons
  /// « Autoriser / Refuser » (Android). Le même stream délivre alors
  /// `action: allow|deny` : on soumet la décision directement après le
  /// re-fetch du contexte, sans afficher la carte.
  void _watchNotificationTaps() {
    _tapSub?.cancel();
    _tapSub = ApprovalNotifier.instance.taps.listen((tap) {
      if (!mounted) return;
      final cascadeId = tap['cascadeId'] ?? '';
      if (tap['kind'] != 'approval' || cascadeId.isEmpty) return;
      if (cascadeId != widget.activeSessionId) {
        // La session concernée n'est pas celle affichée : on ne peut pas
        // re-router ici (l'écran chat est monté par main.dart). Le daemon a
        // déjà pushé approval_pending — il sera consommé quand l'utilisateur
        // ouvrira la session. On se contente d'afficher la carte si la
        // session affichée EST la bonne.
        return;
      }
      final action = tap['action'] as String?;
      if (action != null) {
        _submitApprovalFromNotification(action);
      } else {
        _pendingApprovalFromTap();
      }
    });
  }

  /// Phase 3 — action inline « Autoriser/Refuser » d'une notification :
  /// re-fetch le contexte en attente puis soumet la décision, comme si
  /// l'utilisateur avait tapé le bouton de la carte.
  Future<void> _submitApprovalFromNotification(String action) async {
    final api = widget.api;
    if (api == null) return;
    try {
      final info = await api.getPendingApproval(widget.activeSessionId);
      if (!mounted || info == null || info.isEmpty) return;
      await api.submitApproval(
        cascadeId: widget.activeSessionId,
        callId: info['callId'] as String? ?? '',
        allow: action == 'allow',
        trajectoryId: info['trajectoryId'] as String? ?? '',
        stepIndex: (info['stepIndex'] as num?)?.toInt() ?? -1,
        approvalType: info['approvalType'] as String? ?? 'approval',
        command: info['command'] as String? ?? '',
      );
      final callId = info['callId'] as String? ?? '';
      if (callId.isNotEmpty && mounted) {
        // Retire immédiatement la carte si elle est affichée (l'utilisateur
        // a répondu depuis la notification, pas depuis l'app).
        _rememberProcessedCall(callId);
        _removeApproval(callId);
      }
      // La réponse du daemon (approval_resolved / stream_delta) nettoiera la
      // carte si elle est affichée ; on annule la notification localement
      // pour un retour immédiat.
      ApprovalNotifier.instance.cancelApprovalByCascadeId(widget.activeSessionId);
      ApprovalNotifier.instance.cancelTask(widget.activeSessionId);
    } catch (_) {
      // Daemon injoignable ou approbation déjà résolue : silencieux — la
      // notification d'origine a pu être remplacée/annulée par le daemon.
    }
  }

  Future<void> _pendingApprovalFromTap() async {
    final api = widget.api;
    if (api == null) return;
    try {
      final info = await api.getPendingApproval(widget.activeSessionId);
      if (!mounted || info == null || info.isEmpty) return;
      _addApproval(ToolApprovalRequest(
        callId: info['callId'] as String? ?? '',
        toolName: info['approvalType'] as String? ?? 'run_command',
        command: info['command'] as String? ?? '',
        description: 'Tool execution requires your confirmation',
        cascadeId: widget.activeSessionId,
        trajectoryId: info['trajectoryId'] as String? ?? '',
        stepIndex: (info['stepIndex'] as num?)?.toInt() ?? -1,
        approvalType: info['approvalType'] as String? ?? 'approval',
      ), fromTap: true);
    } catch (_) {
      // Daemon injoignable ou pas d'approbation en attente : silencieux.
    }
  }

  void _setupConnectionListeners() {
    final client = widget.wsClient;
    if (client == null) return;

    setState(() {
      _status = client.status;
    });

    client.statusNotifier.addListener(_onConnectionStatusChanged);
    client.retryInfo.addListener(_onRetryInfoChanged);
  }

  void _onConnectionStatusChanged() {
    if (!mounted) return;
    final client = widget.wsClient;
    if (client == null) return;
    final newStatus = client.status;
    final manual = client.isManualDisconnect;

    if (_status == ConnectionStatus.connected &&
        newStatus != ConnectionStatus.connected &&
        !manual &&
        !_notifiedLost) {
      _notifiedLost = true;
      // Phase UX : notification locale quand la connexion au daemon est
      // perdue alors que l'utilisateur n'est PAS sur l'app (écran verrouillé
      // ou app en arrière-plan). Au premier plan, le banner suffit.
      if (!_appInForeground) {
        ApprovalNotifier.instance.notifyConnectionLost();
      }
    } else if (newStatus == ConnectionStatus.connected) {
      if (_notifiedLost) {
        // On était en panne : prévenir du retour à la normale (même id de
        // notification → remplace la « perdue »).
        ApprovalNotifier.instance.notifyConnectionRestored();
      }
      _notifiedLost = false;
      if (widget.activeSessionId.isNotEmpty) {
        _loadHistoryIfEmpty(widget.activeSessionId);
      }
      _refreshQuotaSummary();
      _checkAndFlushOfflineOutbox();
    }

    setState(() {
      _status = newStatus;
      _isManualDisconnect = manual;
    });
  }

  void _onRetryInfoChanged() {
    if (!mounted) return;
    final client = widget.wsClient;
    if (client == null) return;
    setState(() {
      _attempt = client.retryInfo.value.attempt;
      _nextRetryIn = client.retryInfo.value.nextRetryIn;
    });
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    // Track du premier plan pour ne notifier la perte de connexion que si
    // l'utilisateur ne regarde pas l'app (écran verrouillé / background).
    switch (state) {
      case AppLifecycleState.resumed:
        _appInForeground = true;
        break;
      case AppLifecycleState.inactive:
      case AppLifecycleState.hidden:
      case AppLifecycleState.paused:
      case AppLifecycleState.detached:
        _appInForeground = false;
        break;
    }
    // Garder le stream actif en arrière-plan pour ingérer les tokens et recevoir
    // les approbations/notifications même écran éteint. Le throttle 100ms
    // évite toute surconsommation CPU en fond.
    if (state == AppLifecycleState.resumed && mounted) {
      setState(() {});
      _restoreOrScrollToBottom(widget.activeSessionId);
    }
  }

  @override
  void didUpdateWidget(covariant ChatStreamScreen oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.activeSessionId != widget.activeSessionId) {
      if (_scrollController.hasClients) {
        _globalSessionScrollOffsets[oldWidget.activeSessionId] = _scrollController.position.pixels;
        _globalSessionUserScrolled[oldWidget.activeSessionId] = _userScrollLocked;
      }
      _sessionApprovalIndices.putIfAbsent(
        widget.activeSessionId,
        () => _currentSessionApprovals.isEmpty ? -1 : 0,
      );
      _visibleCounts.putIfAbsent(widget.activeSessionId, () => _pageSize);
      final isUserScrolled = _globalSessionUserScrolled[widget.activeSessionId] == true;
      _userScrollLocked = isUserScrolled;
      _showJumpToBottom = isUserScrolled;
      _hiddenNewCount = 0;
      if (!_activeStreamingSessions.contains(widget.activeSessionId)) {
        _stillWorkingTimer?.cancel();
        _stillWorkingTimer = null;
        if (_showStillWorking) {
          _showStillWorking = false;
        }
      }
      _loadHistoryIfEmpty();
      _fetchSubagentsForSession(widget.activeSessionId);
      _loadPersistedDraft();
      _loadOfflineOutbox(widget.activeSessionId);
      _refreshRunningTasks();
      _restoreOrScrollToBottom(widget.activeSessionId);
    }
    if (!oldWidget.isConnected && widget.isConnected) {
      _checkAndFlushOfflineOutbox();
    }
    if (oldWidget.api != widget.api) {
      // Reconnexion : réinitialiser l'état
      _activeStreamingSessions.clear();
      _stillWorkingTimer?.cancel();
      if (mounted && _showStillWorking) setState(() => _showStillWorking = false);
      _watchBroadcastStreams();
      if (widget.isConnected) {
        _checkAndFlushOfflineOutbox();
      }
    }
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _scrollController.removeListener(_onScroll);
    _throttleTimer?.cancel();
    _searchDebounce?.cancel();
    for (final s in _promptStreamSubs) {
      s.cancel();
    }
    _promptStreamSubs.clear();
    _streamSub?.cancel();
    _tapSub?.cancel();
    _stillWorkingTimer?.cancel();
    _syncTimer?.cancel();
    _quotaTimer?.cancel();
    _sideQuestionTimer?.cancel();
    _loadOlderTimer?.cancel();
    for (final t in _settleTimers) {
      t.cancel();
    }
    _settleTimers.clear();
    // P3 (leak) : les broadcast controllers de sortie de tâche doivent être
    // fermés — sinon 2 controllers fuient par tâche d'arrière-plan.
    for (final c in _taskOutputControllers.values) {
      if (!c.isClosed) c.close();
    }
    _taskOutputControllers.clear();
    _scrollController.dispose();
    _searchController.dispose();
    final client = widget.wsClient;
    client?.statusNotifier.removeListener(_onConnectionStatusChanged);
    client?.retryInfo.removeListener(_onRetryInfoChanged);
    super.dispose();
  }

  String _timestamp() {
    final now = DateTime.now();
    return '${now.hour.toString().padLeft(2, '0')}:${now.minute.toString().padLeft(2, '0')}';
  }

  void _onStreamStarted(String sessionId) {
    _streamStartTimes[sessionId] = DateTime.now();
    _turnModifiedFiles[sessionId] = <String>{};
    final wasEmpty = _activeStreamingSessions.isEmpty;
    _activeStreamingSessions.add(sessionId);
    widget.onStreamingSessionChanged?.call(sessionId, true);
    if (wasEmpty) {
      widget.onStreamingStateChanged?.call(true);
    }
    if (sessionId == widget.activeSessionId) {
      _stillWorkingTimer?.cancel();
      _stillWorkingTimer = Timer(_stillWorkingDelay, () {
        if (mounted && _activeStreamingSessions.contains(widget.activeSessionId)) {
          setState(() => _showStillWorking = true);
        }
      });
    }
  }

  void _onStreamEnded(String sessionId) {
    _activeStreamingSessions.remove(sessionId);
    widget.onStreamingSessionChanged?.call(sessionId, false);
    if (_activeStreamingSessions.isEmpty) {
      widget.onStreamingStateChanged?.call(false);
    }
    if (!_activeStreamingSessions.contains(widget.activeSessionId)) {
      _stillWorkingTimer?.cancel();
      _stillWorkingTimer = null;
      if (_showStillWorking && mounted) {
        setState(() => _showStillWorking = false);
      }
    }
    if (sessionId == widget.activeSessionId) {
      HapticFeedback.lightImpact();
    }
    final queue = _sessionMessageQueues[sessionId] ?? [];
    final lastEnd = _sessionLastStreamEnds[sessionId];
    final outcome = lastEnd?['data']?['outcome'] as String? ?? 'done';
    final isSuccessOutcome = outcome == 'done' || outcome == 'completed' || outcome == 'success';
    if (isSuccessOutcome && queue.isNotEmpty) {
      final next = queue.removeAt(0);
      OfflineOutboxStore.saveQueuedMessages(sessionId, queue);
      final text = next['text'] as String;
      final modelUID = next['modelUID'] as String?;
      final modelEnum = next['modelEnum'] as int?;
      final buf = _sessionMessages.putIfAbsent(sessionId, () => []);
      setState(() {
        buf.add(ChatMessage(
          id: 'm${++_messageCounter}',
          sender: 'user',
          text: text,
          timestamp: _timestamp(),
        ));
      });
      _sendPromptToDaemon(text, targetSessionOverride: sessionId, modelUID: modelUID, modelEnum: modelEnum);
    } else {
      OfflineOutboxStore.saveQueuedMessages(sessionId, queue);
    }
  }

  void _handleStreamEnded(Map<String, dynamic> msg, [String? targetSessionId]) {
    final data = msg['data'];
    if (data is! Map<String, dynamic>) return;
    if (msg['data']?['hostActive'] == true) return;
    final outcome = data['outcome'] as String? ?? 'done';
    final cascadeId = targetSessionId ?? data['cascadeId'] as String? ?? widget.activeSessionId;
    if (outcome == 'done' || outcome == 'cancelled') {
      HapticFeedback.lightImpact();
    }

    // Si l'utilisateur est DÉJÀ dans la session active et au premier plan, NE PAS envoyer de notification.
    final isViewingThisSessionInForeground = _appInForeground && cascadeId == widget.activeSessionId;
    if (isViewingThisSessionInForeground) {
      return;
    }

    // Ne notifier QUE si tout le travail est TOTALEMENT terminé :
    // Pas de tâches d'arrière-plan en cours, pas de sous-agents actifs, pas d'approbations ou de questions en attente.
    final hasActiveBackgroundTasks = _runningBackgroundTasks.isNotEmpty ||
        _taskStatuses.values.any((st) => st == 'running');
    final hasSubagentsRunning = (_sessionSubagents[cascadeId] ?? []).any((sa) => sa.status.toLowerCase() == 'running');
    final isAwaitingUserAction = (_sessionApprovals[cascadeId]?.isNotEmpty ?? false) ||
        _sessionQuestions.containsKey(cascadeId);

    if (hasActiveBackgroundTasks || hasSubagentsRunning || isAwaitingUserAction) {
      // L'agent n'a pas fini son travail : on évite la fausse notification de fin
      return;
    }

    final message = (data['message'] ?? msg['message'] ?? 'Tâche terminée').toString();
    ApprovalNotifier.instance.notifyTaskEnded(
      cascadeId: cascadeId,
      outcome: outcome,
      message: message,
    );
  }


  void _addApproval(ToolApprovalRequest approval,
      {bool hostActive = false, bool fromTap = false}) {
    // Bug #7 : guard broadcast path — un même callId ne doit jamais re-afficher
    // sa carte après reconnexion si l'utilisateur l'a déjà traitée.
    if (_processedCallIds.contains(approval.callId)) return;
    final cascadeId = approval.cascadeId.isNotEmpty ? approval.cascadeId : widget.activeSessionId;
    final list = _sessionApprovals.putIfAbsent(cascadeId, () => []);
    if (list.any((a) => a.callId == approval.callId)) return;
    _expiredCallIds.remove(approval.callId);
    if ((_sessionApprovalIndices[cascadeId] == null || _sessionApprovalIndices[cascadeId]! < 0) && cascadeId == widget.activeSessionId) {
      HapticFeedback.mediumImpact();
    }
    setState(() {
      final wasEmpty = list.isEmpty;
      list.add(approval);
      // UX P0-1 : une 2ᵉ approbation ne « vole » pas la carte affichée —
      // l'index reste sur la demande en cours (la nouvelle se rejoint via ▶).
      if (wasEmpty) _sessionApprovalIndices[cascadeId] = 0;
      _pendingApprovalCallIds.add(approval.callId);
      final fp = approval.filePath;
      if (fp != null && fp.isNotEmpty) {
        final modFiles = _sessionModifiedFiles.putIfAbsent(cascadeId, () => {});
        final modFileList = _sessionModifiedFileList.putIfAbsent(cascadeId, () => []);
        modFiles.add(fp);
        if (!modFileList.any((f) => f.path == fp)) {
          modFileList.add(SessionModifiedFile(
            path: fp,
            additions: 1,
            deletions: 0,
          ));
        }
      }
    });
    if (!hostActive && !fromTap && ApprovalNotifier.instance.initialized) {
      ApprovalNotifier.instance.notifyApprovalRequired(
        callId: approval.callId,
        cascadeId: cascadeId,
        toolName: approval.toolName,
        command: approval.command,
      );
    }
  }

  void _removeApproval(String callId, [String? targetSessionId]) {
    setState(() {
      _sessionApprovals.forEach((cid, list) {
        final i = list.indexWhere((a) => a.callId == callId);
        if (i >= 0) {
          list.removeAt(i);
          // L'index reste sur la demande qui suit celle retirée (ou la dernière
          // restante) : la carte visible bascule proprement et le compteur
          // « x/total » reflète la pile restante.
          _sessionApprovalIndices[cid] = list.isEmpty
              ? -1
              : math.min(i, list.length - 1);
        }
      });
      _pendingApprovalCallIds.remove(callId);
    });
    ApprovalNotifier.instance.cancelApproval(callId);
  }

  void _addQuestion(AskQuestionChoiceRequest q) {
    final cascadeId = q.cascadeId.isNotEmpty ? q.cascadeId : widget.activeSessionId;
    final list = _sessionQuestions.putIfAbsent(cascadeId, () => []);
    if (list.any((item) => item.requestId == q.requestId)) return;
    if (cascadeId == widget.activeSessionId) {
      HapticFeedback.mediumImpact();
    }
    setState(() {
      list.add(q);
    });
    ApprovalNotifier.instance.notifyQuestionRequired(
      cascadeId: cascadeId,
      question: q.question,
    );
  }

  void _removeQuestion(String requestId) {
    setState(() {
      _sessionQuestions.forEach((cid, list) {
        list.removeWhere((item) => item.requestId == requestId);
      });
    });
    ApprovalNotifier.instance.cancelApproval(requestId);
  }

  void _handleQuestionSubmit(
    AskQuestionChoiceRequest q,
    List<String> selectedAnswers,
    String? customAnswer,
  ) async {
    try {
      final targetCascadeId = q.cascadeId.isNotEmpty
          ? q.cascadeId
          : (widget.activeSessionId.isNotEmpty
              ? widget.activeSessionId
              : 'cascade-${DateTime.now().millisecondsSinceEpoch}');
      await widget.api?.submitQuestionResponse(
        cascadeId: targetCascadeId,
        trajectoryId: q.trajectoryId.isNotEmpty ? q.trajectoryId : null,
        stepIndex: q.stepIndex >= 0 ? q.stepIndex : null,
        selectedAnswers: selectedAnswers,
        customAnswer: customAnswer,
      );
      _removeQuestion(q.requestId);
    } catch (_) {
    }
  }

  void _watchBroadcastStreams() {
    _streamSub?.cancel();
    _streamSub = widget.api?.events.listen((msg) {
      final type = msg['type'] as String?;
      final isBroadcast = msg['broadcast'] == true ||
          type == 'stream_delta' ||
          type == 'stream_start' ||
          type == 'stream_end' ||
          type == 'approval_pending' ||
          type == 'approval_required' ||
          type == 'question_pending' ||
          type == 'question_required' ||
          type == 'approval_resolved' ||
          type == 'approval_expired' ||
          type == 'session_status_update' ||
          type == 'quota_update' ||
          type == 'sessions_updated' ||
          type == 'cascade_reverted';
      if (!isBroadcast || !mounted) return;
      final requestId = msg['requestId'] as String? ?? '';
      String? sessionId = (msg['cascadeId'] ?? msg['data']?['cascadeId']) as String?;
      if (sessionId == null || sessionId.isEmpty) {
        final data = msg['data'];
        if (data is Map) {
          final events = data['events'];
          if (events is List && events.isNotEmpty && events.first is Map) {
            sessionId = events.first['cascadeId'] as String?;
          }
        }
      }

      if (type == 'cascade_reverted') {
        final cascId = (msg['cascadeId'] ?? msg['data']?['cascadeId'])?.toString() ?? widget.activeSessionId;
        if (mounted && cascId.isNotEmpty) {
          SessionHistoryCacheStore.instance.saveSessionHistory(cascId, const []);
          _loadHistoryIfEmpty(cascId);
          _fetchVcsChanges();
          _refreshRunningTasks();
          if (cascId == widget.activeSessionId) {
            ScaffoldMessenger.of(context).showSnackBar(
              const SnackBar(
                content: Text('Modifications annulées jusqu\'à cette étape'),
                duration: Duration(seconds: 2),
              ),
            );
          }
        }
        return;
      }

      if (type == 'quota_update') {
        final data = msg['data'] as Map<String, dynamic>?;
        if (data != null && data.isNotEmpty && mounted) {
          setState(() {
            _quotaSummary = data;
            final banner = BannerClassifier.classifyQuota(
              data,
              onDismiss: () => _dismissBanner('quota-exceeded-metric'),
              onSwitchModel: _showModelSelector,
              onSeePlans: _showPlansOrLimitsSheet,
            );
            if (banner != null) {
              _activeBanners[banner.id] = banner;
            } else {
              _activeBanners.remove('quota-exceeded-metric');
            }
          });
        }
        return;
      }

      if (type == 'sessions_updated') {
        if (mounted && widget.activeSessionId.isNotEmpty) {
          _loadHistoryIfEmpty(widget.activeSessionId);
        }
        return;
      }

      if (type == 'task_started') {
        final data = msg['data'] as Map<String, dynamic>? ?? {};
        final eventCascadeId = data['cascadeId'] as String? ?? msg['cascadeId'] as String? ?? '';
        if (eventCascadeId.isNotEmpty && eventCascadeId != widget.activeSessionId) {
          return;
        }
        final cmd = data['command'] as String? ?? data['id'] as String? ?? 'Task';
        final taskId = data['id'] as String? ?? cmd;
        if (taskId.isNotEmpty && cmd.isNotEmpty) {
          _taskCommandToId[cmd] = taskId;
          _taskIdToCommand[taskId] = cmd;
        }
        if (!_runningBackgroundTasks.contains(cmd)) {
          setState(() {
            _runningBackgroundTasks.add(cmd);
            _taskStatuses[cmd] = 'running';
            _taskStatuses[taskId] = 'running';
            _taskOutputs.putIfAbsent(cmd, () => StringBuffer());
            _taskOutputs.putIfAbsent(taskId, () => StringBuffer());
          });
          _pruneTaskState();
        }
        return;
      } else if (type == 'task_output') {
        final data = msg['data'] as Map<String, dynamic>? ?? {};
        final eventCascadeId = data['cascadeId'] as String? ?? msg['cascadeId'] as String? ?? '';
        if (eventCascadeId.isNotEmpty && eventCascadeId != widget.activeSessionId) {
          return;
        }
        final cmd = data['command'] as String? ?? data['id'] as String? ?? '';
        final taskId = data['id'] as String? ?? cmd;
        final delta = data['delta'] as String? ?? '';
        if (delta.isNotEmpty) {
          _taskOutputs[cmd]?.write(delta);
          _taskOutputs[taskId]?.write(delta);
          _taskOutputControllers[cmd]?.add(delta);
          _taskOutputControllers[taskId]?.add(delta);
        }
        return;
      } else if (type == 'task_ended') {
        final data = msg['data'] as Map<String, dynamic>? ?? {};
        final eventCascadeId = data['cascadeId'] as String? ?? msg['cascadeId'] as String? ?? '';
        if (eventCascadeId.isNotEmpty && eventCascadeId != widget.activeSessionId) {
          return;
        }
        final cmd = data['command'] as String? ?? data['id'] as String? ?? '';
        final taskId = data['id'] as String? ?? cmd;
        final status = data['status'] as String? ?? 'completed';
        setState(() {
          _runningBackgroundTasks.remove(cmd);
          _runningBackgroundTasks.remove(taskId);
          _runningBackgroundTasks.removeWhere((t) =>
              (cmd.isNotEmpty && t == cmd) ||
              (taskId.isNotEmpty && t == taskId) ||
              (cmd.isNotEmpty && t.contains(cmd)) ||
              (taskId.isNotEmpty && t.contains(taskId)));
          _taskStatuses[cmd] = status;
          _taskStatuses[taskId] = status;
          // P3 (leak) : tâche terminée → fermer ses controllers (plus aucun
          // delta n'arrivera ; la vue détail relit le snapshot StringBuffer).
          _closeTaskController(cmd);
          _closeTaskController(taskId);
        });
        _refreshRunningTasks();

        // Si toutes les tâches d'arrière-plan sont terminées, que le stream est inactif,
        // et que l'utilisateur N'EST PAS sur cette session au premier plan, notifier la fin définitive.
        final targetCId = eventCascadeId.isNotEmpty ? eventCascadeId : widget.activeSessionId;
        final isViewingThisSessionInForeground = _appInForeground && targetCId == widget.activeSessionId;
        if (!isViewingThisSessionInForeground &&
            _runningBackgroundTasks.isEmpty &&
            !_hasCurrentActiveStream &&
            !(_sessionApprovals[targetCId]?.isNotEmpty ?? false) &&
            !_sessionQuestions.containsKey(targetCId)) {
          ApprovalNotifier.instance.notifyTaskEnded(
            cascadeId: targetCId,
            outcome: status == 'error' ? 'error' : 'done',
            message: cmd.isNotEmpty ? 'Tâche terminée : $cmd' : 'Travail terminé',
          );
        }
        return;
      }

      // Règle fondamentale : un événement sans cascadeId explicite ne doit JAMAIS
      // être attribué à la session affichée par défaut.
      if (sessionId == null || sessionId.isEmpty) {
        return;
      }

      final targetSessionId = sessionId;

      // Bug tâches arrière-plan : si l'évènement concerne une autre session,
      // on le bufferise dans _sessionMessages[targetSessionId] au lieu de le jeter.
      final thKey = '${targetSessionId}_$requestId';
      final isActiveSession = targetSessionId == widget.activeSessionId;
      final buf = _sessionMessages.putIfAbsent(targetSessionId, () => []);

      if (type == 'stream_start') {
        _onStreamStarted(targetSessionId);
        if (isActiveSession && _showJumpToBottom) _hiddenNewCount++;

        final userPrompt = msg['data']?['userPrompt']?.toString() ?? '';
        if (userPrompt.isNotEmpty) {
          final alreadyPresent = buf.isNotEmpty &&
              buf.last.sender == 'user' &&
              (buf.last.id == 'user-ext-$requestId' || buf.last.text.trim() == userPrompt.trim());
          if (!alreadyPresent) {
            buf.add(ChatMessage(
              id: 'user-ext-$requestId',
              sender: 'user',
              text: userPrompt,
              timestamp: _timestamp(),
            ));
          }
        }

        final msgId = 'ext-$requestId';
        _streamRequestToMessageId[thKey] = msgId;
        final resolvedModel = _resolveModelLabel(msg['data']?['model']);
        final existingIdx = buf.indexWhere((m) => m.id == msgId);
        if (existingIdx >= 0) {
          buf[existingIdx] = buf[existingIdx].copyWith(
            isStreaming: true,
            modelLabel: resolvedModel,
          );
        } else if (buf.isNotEmpty && buf.last.isStreaming && buf.last.sender == 'assistant') {
          _streamRequestToMessageId[thKey] = buf.last.id;
        } else {
          buf.add(ChatMessage(
            id: msgId,
            sender: 'assistant',
            text: '',
            timestamp: _timestamp(),
            isStreaming: true,
            modelLabel: resolvedModel,
          ));
        }
        if (isActiveSession && mounted) {
          setState(() {});
          _scrollToBottom();
        }
      } else if (type == 'sync_catchup') {
        setState(() => _isSyncing = true);
        _syncTimer?.cancel();
        _syncTimer = Timer(const Duration(milliseconds: 1200), () {
          if (mounted) setState(() => _isSyncing = false);
        });
        final data = msg['data'] as Map<String, dynamic>? ?? const {};
        final missedEvents = data['missedEvents'] as List<dynamic>? ?? const [];
        if (missedEvents.isNotEmpty) {
          for (final rawEv in missedEvents) {
            if (rawEv is Map) {
              final evMap = rawEv.cast<String, dynamic>();
              final reqId = evMap['requestId'] as String? ?? '';
              final textDelta = StreamDeltaParser.textOf(evMap);
              final key = '${targetSessionId}_$reqId';
              final idx = buf.indexWhere((m) =>
                  m.id == 'ext-$reqId' ||
                  m.id == _streamRequestToMessageId[key] ||
                  (m.isStreaming && m.sender == 'assistant'));
              if (idx >= 0) {
                final cur = buf[idx];
                final newText = textDelta.isNotEmpty ? cur.text + textDelta : cur.text;
                buf[idx] = cur.copyWith(text: newText);
              }
            }
          }
          if (isActiveSession) {
            _scheduleThrottledUpdate();
          }
        }
        final pending = (data['pendingMessages'] as List<dynamic>? ?? const [])
            .whereType<Map>()
            .map((e) => e.cast<String, dynamic>())
            .toList();
        if (pending.isNotEmpty) {
          for (final p in pending) {
            final reqId = p['requestId'] as String? ?? '';
            if (reqId.isEmpty) continue;
            final id = 'pending-$reqId';
            if (buf.any((m) => m.id == id)) continue;
            buf.add(ChatMessage(
              id: id,
              sender: 'user',
              text: p['prompt']?.toString() ?? '',
              timestamp: _timestamp(),
              isQueued: true,
            ));
          }
          if (isActiveSession && mounted) {
            setState(() {});
          }
        }
      } else if (type == 'stream_delta') {
        final userInput = StreamDeltaParser.userInputOf(msg);
        if (userInput.isNotEmpty) {
          final queuedIdx = buf.indexWhere((m) => m.sender == 'user' && m.text.trim() == userInput.trim() && m.isQueued);
          if (queuedIdx >= 0) {
            buf[queuedIdx] = buf[queuedIdx].copyWith(isQueued: false);
          } else {
            final targetId = _streamRequestToMessageId[thKey] ?? 'ext-$requestId';
            final assistantIdx = buf.indexWhere((m) => m.id == targetId || (m.isStreaming && m.sender == 'assistant'));
            final hasImmediateUserMsg = assistantIdx > 0 &&
                buf[assistantIdx - 1].sender == 'user' &&
                (buf[assistantIdx - 1].id == 'user-ext-$requestId' || buf[assistantIdx - 1].text.trim() == userInput.trim());
            if (!hasImmediateUserMsg) {
              final userMsg = ChatMessage(
                id: 'user-ext-$requestId',
                sender: 'user',
                text: userInput,
                timestamp: _timestamp(),
              );
              final targetId = _streamRequestToMessageId[thKey] ?? 'ext-$requestId';
              final assistantIdx = buf.indexWhere((m) => m.id == targetId || (m.isStreaming && m.sender == 'assistant'));
              if (assistantIdx >= 0) {
                buf.insert(assistantIdx, userMsg);
              } else {
                buf.add(userMsg);
              }
            }
          }
        }
        final textDelta = StreamDeltaParser.textOf(msg);
        final thoughtDelta = StreamDeltaParser.thinkingOf(msg);
        final errorDelta = StreamDeltaParser.errorOf(msg);
        final approval = StreamDeltaParser.approvalOf(msg);
        final deltaFiles = StreamDeltaParser.fileChangesOf(msg);
        if (deltaFiles.isNotEmpty) {
          final tFiles = _turnModifiedFiles.putIfAbsent(targetSessionId, () => {});
          tFiles.addAll(deltaFiles);
        }

        final targetId = _streamRequestToMessageId[thKey] ?? 'ext-$requestId';
        var idx = buf.indexWhere((m) => m.id == targetId);
        if (idx < 0) {
          final lastStreamingIdx = buf.lastIndexWhere((m) => m.isStreaming);
          if (lastStreamingIdx >= 0) {
            idx = lastStreamingIdx;
            _streamRequestToMessageId[thKey] = buf[idx].id;
          } else {
            _onStreamStarted(targetSessionId);
            final msgId = targetId;
            _streamRequestToMessageId[thKey] = msgId;
            final resolvedChunkModel = _resolveModelLabel(msg['data']?['model']);
            buf.add(ChatMessage(
              id: msgId,
              sender: 'assistant',
              text: '',
              timestamp: _timestamp(),
              isStreaming: true,
              modelLabel: resolvedChunkModel,
            ));
            idx = buf.length - 1;
          }
        }
        if (idx >= 0) {
          final current = buf[idx];
          if (thoughtDelta.isNotEmpty) {
            final prev = _externalThoughts[thKey] ?? '';
            _externalThoughts[thKey] = prev.isEmpty
                ? thoughtDelta
                : (prev.endsWith('\n') ? '$prev$thoughtDelta' : '$prev\n$thoughtDelta');
          }
          final newText = textDelta.isNotEmpty ? current.text + textDelta : current.text;
          final newThought = (_externalThoughts[thKey] != null && _externalThoughts[thKey]!.isNotEmpty)
              ? _externalThoughts[thKey]!.trim()
              : current.thought;

          // Mise à jour de la séquence ordonnée de segments chronologiques
          final List<ChatSegment> updatedSegments = List.of(current.segments);
          if (thoughtDelta.isNotEmpty) {
            if (updatedSegments.isNotEmpty && updatedSegments.last.type == ChatSegmentType.thought) {
              final last = updatedSegments.last;
              final newContent = last.content.isEmpty
                  ? thoughtDelta
                  : (last.content.endsWith('\n') ? '${last.content}$thoughtDelta' : '${last.content}\n$thoughtDelta');
              updatedSegments[updatedSegments.length - 1] = last.copyWith(content: newContent, isRunning: true);
            } else {
              updatedSegments.add(ChatSegment(
                type: ChatSegmentType.thought,
                content: thoughtDelta,
                isRunning: true,
              ));
            }
          }
          if (textDelta.isNotEmpty) {
            // Si le dernier segment était une pensée en cours, on la marque terminée
            if (updatedSegments.isNotEmpty && updatedSegments.last.type == ChatSegmentType.thought && updatedSegments.last.isRunning) {
              final last = updatedSegments.last;
              updatedSegments[updatedSegments.length - 1] = last.copyWith(isRunning: false);
            }
            if (updatedSegments.isNotEmpty && updatedSegments.last.type == ChatSegmentType.text) {
              final last = updatedSegments.last;
              updatedSegments[updatedSegments.length - 1] = last.copyWith(content: last.content + textDelta);
            } else {
              updatedSegments.add(ChatSegment(
                type: ChatSegmentType.text,
                content: textDelta,
              ));
            }
          }
          if (errorDelta.isNotEmpty) {
            if (updatedSegments.isNotEmpty && updatedSegments.last.type == ChatSegmentType.thought && updatedSegments.last.isRunning) {
              final last = updatedSegments.last;
              updatedSegments[updatedSegments.length - 1] = last.copyWith(isRunning: false);
            }
            updatedSegments.add(ChatSegment(
              type: ChatSegmentType.error,
              content: errorDelta,
            ));
          }

          buf[idx] = current.copyWith(
            text: newText,
            thought: newThought,
            segments: updatedSegments,
            isStreaming: true,
          );
        }
        if (approval != null) {
          final hostActive = msg['data']?['hostActive'] == true;
          _addApproval(
            ToolApprovalRequest(
              callId: approval.callId,
              toolName: approval.tool,
              command: approval.command,
              description: 'Tool execution requires your confirmation',
              cascadeId: approval.cascadeId.isNotEmpty ? approval.cascadeId : targetSessionId,
              trajectoryId: approval.trajectoryId,
              stepIndex: approval.stepIndex,
              approvalType: approval.approvalType,
            ),
            hostActive: hostActive,
          );
        }

        final question = StreamDeltaParser.questionOf(msg);
        if (question != null) {
          _addQuestion(question);
        }

        if (isActiveSession && mounted) {
          _scheduleThrottledUpdate();
        }
      } else if (type == 'stream_end') {
        final startTime = _streamStartTimes[targetSessionId];
        _sessionLastStreamEnds[targetSessionId] = msg;
        _onStreamEnded(targetSessionId);
        _handleStreamEnded(msg, targetSessionId);
        _streamStartTimes.remove(targetSessionId);
        final targetId = _streamRequestToMessageId[thKey] ?? 'ext-$requestId';
        final idx = buf.indexWhere((m) => m.id == targetId);

        // Stamp the completed assistant message with THIS TURN's file changes.
        final turnFiles = (_turnModifiedFiles[targetSessionId] ?? {}).toList();
        final modFileList = _sessionModifiedFileList[targetSessionId] ?? [];
        final totalAdded = modFileList.where((f) => turnFiles.contains(f.path)).fold(0, (s, f) => s + f.additions);
        final totalRemoved = modFileList.where((f) => turnFiles.contains(f.path)).fold(0, (s, f) => s + f.deletions);

        final workedDurationStr = _computeWorkedDuration(startTime);
        final currentThought = (_externalThoughts[thKey] != null && _externalThoughts[thKey]!.isNotEmpty)
            ? _externalThoughts[thKey]!.trim()
            : ((idx >= 0 ? buf[idx].thought?.trim() : null) ?? '');

        String finalThought;
        if (currentThought.trim().isEmpty) {
          finalThought = workedDurationStr;
        } else if (!currentThought.startsWith('Worked for') &&
            !currentThought.startsWith('Thought for') &&
            !currentThought.startsWith('Thinking for') &&
            !currentThought.startsWith('Working')) {
          finalThought = '$workedDurationStr\n$currentThought';
        } else {
          finalThought = currentThought;
        }

        final targetMsg = idx >= 0
            ? buf[idx]
            : (buf.lastIndexWhere((m) => m.isStreaming) >= 0
                ? buf[buf.lastIndexWhere((m) => m.isStreaming)]
                : null);

        List<ChatSegment> finalizedSegments = [];
        if (targetMsg != null && targetMsg.segments.isNotEmpty) {
          finalizedSegments = targetMsg.segments.map((s) => s.copyWith(isRunning: false)).toList();
          if (finalizedSegments.isNotEmpty && finalizedSegments.first.type == ChatSegmentType.thought) {
            final firstThought = finalizedSegments.first.content.trim();
            if (!firstThought.startsWith('Worked for') &&
                !firstThought.startsWith('Thought for') &&
                !firstThought.startsWith('Thinking for') &&
                !firstThought.startsWith('Working')) {
              finalizedSegments[0] = finalizedSegments[0].copyWith(
                content: '$workedDurationStr\n${finalizedSegments[0].content}',
              );
            }
          }
        }

        if (idx >= 0) {
          buf[idx] = buf[idx].copyWith(
            isStreaming: false,
            thought: finalThought,
            segments: finalizedSegments.isNotEmpty ? finalizedSegments : buf[idx].segments,
            filesChanged: turnFiles.isNotEmpty ? turnFiles : null,
            additions: turnFiles.isNotEmpty ? totalAdded : null,
            deletions: turnFiles.isNotEmpty ? totalRemoved : null,
          );
        } else {
          final lastStreamingIdx = buf.lastIndexWhere((m) => m.isStreaming);
          if (lastStreamingIdx >= 0) {
            buf[lastStreamingIdx] = buf[lastStreamingIdx].copyWith(
              isStreaming: false,
              thought: finalThought,
              segments: finalizedSegments.isNotEmpty ? finalizedSegments : buf[lastStreamingIdx].segments,
              filesChanged: turnFiles.isNotEmpty ? turnFiles : null,
              additions: turnFiles.isNotEmpty ? totalAdded : null,
              deletions: turnFiles.isNotEmpty ? totalRemoved : null,
            );
          }
        }
        _externalThoughts.remove(thKey);
        _streamRequestToMessageId.remove(thKey);
        SessionHistoryCacheStore.instance.saveSessionHistory(targetSessionId, buf);
        _refreshRunningTasks();
        _fetchVcsChanges(targetSessionId);

        if (isActiveSession && mounted) {
          setState(() {});
          if (!_userScrollLocked) {
            _scrollToBottomSettled();
          }
        }
      } else if (type == 'session_status_update') {
        final data = msg['data'] as Map<String, dynamic>? ?? const {};
        final status = (data['status'] ?? '').toString().toUpperCase();
        final cascadeId = (msg['cascadeId'] ?? data['cascadeId'] ?? '').toString();
        if (cascadeId.isNotEmpty) {
          if (status.contains('RUNNING') || status.contains('BUSY')) {
            _onStreamStarted(cascadeId);
          } else if (status.contains('IDLE') || status.contains('READY') || status.contains('DONE')) {
            _onStreamEnded(cascadeId);
            _refreshRunningTasks();
          }
          if (mounted && cascadeId == widget.activeSessionId) {
            setState(() {});
          }
        }
      } else if (type == 'approval_pending' || type == 'approval_required') {
        final data = msg['data'] as Map<String, dynamic>? ?? const {};
        final approval = StreamDeltaParser.parseApprovalMap(data, cascadeId: (msg['cascadeId'] ?? data['cascadeId']) as String? ?? targetSessionId);
        if (approval != null) {
          final hostActive = data['hostActive'] == true;
          _addApproval(
            ToolApprovalRequest(
              callId: approval.callId,
              toolName: approval.tool,
              command: approval.command,
              description: 'Tool execution requires your confirmation',
              cascadeId: approval.cascadeId.isNotEmpty ? approval.cascadeId : targetSessionId,
              trajectoryId: approval.trajectoryId,
              stepIndex: approval.stepIndex,
              approvalType: approval.approvalType,
            ),
            hostActive: hostActive,
          );
        }
      } else if (type == 'question_pending' || type == 'question_required') {
        final data = msg['data'] as Map<String, dynamic>? ?? const {};
        final q = StreamDeltaParser.parseQuestionMap(data, cascadeId: (msg['cascadeId'] ?? data['cascadeId']) as String? ?? targetSessionId);
        if (q != null) {
          _addQuestion(q);
        }
      } else if (type == 'approval_expired') {
        final data = msg['data'] as Map<String, dynamic>? ?? const {};
        final callId = data['callId'] as String? ??
            data['approvalId'] as String? ??
            '';
        final cascadeId = (msg['cascadeId'] ?? data['cascadeId']) as String? ?? '';
        if (callId.isNotEmpty && _pendingApprovalCallIds.contains(callId)) {
          setState(() => _rememberExpiredCall(callId));
          _pendingApprovalCallIds.remove(callId);
          ApprovalNotifier.instance.cancelApproval(callId);
        } else if (cascadeId.isNotEmpty) {
          ApprovalNotifier.instance
              .cancelApprovalByCascadeId(cascadeId);
        }
      } else if (type == 'approval_resolved') {
        final data = msg['data'] as Map<String, dynamic>? ?? const {};
        final callId = data['callId'] as String? ?? '';
        final cascadeId = (msg['cascadeId'] ?? data['cascadeId']) as String? ?? '';
        if (callId.isNotEmpty && _pendingApprovalCallIds.contains(callId)) {
          _removeApproval(callId, cascadeId);
        } else if (cascadeId.isNotEmpty) {
          setState(() {
            final list = _sessionApprovals[cascadeId];
            if (list != null) {
              list.clear();
              _sessionApprovalIndices[cascadeId] = -1;
            }
          });
          ApprovalNotifier.instance.cancelApprovalByCascadeId(cascadeId);
        }
      } else if (type == 'stream_error' || type == 'error') {
        final errText = msg['error']?.toString() ??
            msg['data']?['error']?.toString() ??
            msg['message']?.toString() ??
            'Une erreur est survenue lors de l\'exécution du flux.';
        final targetId = _streamRequestToMessageId[thKey] ?? 'ext-$requestId';
        final idx = buf.indexWhere((m) => m.id == targetId);
        if (idx >= 0) {
          buf[idx] = buf[idx].copyWith(
            isStreaming: false,
            isError: true,
            text: buf[idx].text.isEmpty ? errText : '${buf[idx].text}\n\n$errText',
          );
        } else {
          final lastStreamingIdx = buf.lastIndexWhere((m) => m.isStreaming);
          if (lastStreamingIdx >= 0) {
            buf[lastStreamingIdx] = buf[lastStreamingIdx].copyWith(
              isStreaming: false,
              isError: true,
              text: buf[lastStreamingIdx].text.isEmpty ? errText : '${buf[lastStreamingIdx].text}\n\n$errText',
            );
          } else {
            buf.add(ChatMessage(
              id: 'err-${DateTime.now().millisecondsSinceEpoch}',
              sender: 'assistant',
              text: errText,
              timestamp: _timestamp(),
              isError: true,
            ));
          }
        }
        _onStreamEnded(targetSessionId);
        _externalThoughts.remove(thKey);
        _streamRequestToMessageId.remove(thKey);
        SessionHistoryCacheStore.instance.saveSessionHistory(targetSessionId, buf);
        if (isActiveSession && mounted) {
          setState(() {});
        }
      }
    });
  }

  void _handleSendMessage(
    String text, {
    bool queued = false,
    String? modelUID,
    int? modelEnum,
    List<String>? images,
    String? base64Data,
    String? fileName,
    List<Map<String, dynamic>>? media,
  }) {
    if (text.trim().startsWith('/btw ') || text.trim().startsWith('/btw')) {
      final sideQ = text.trim().substring(4).trim();
      setState(() {
        _sideQuestion = sideQ.isNotEmpty ? sideQ : 'Question parallèle';
        _isSideQuestionLoading = true;
        _sideQuestionAnswer = null;
      });
      _sideQuestionTimer?.cancel();
      _sideQuestionTimer = Timer(const Duration(milliseconds: 1200), () {
        if (mounted) {
          setState(() {
            _isSideQuestionLoading = false;
            _sideQuestionAnswer = 'Réponse à la question : "$sideQ" prise en compte dans le contexte.';
          });
        }
      });
      return;
    }

    final targetSession = widget.activeSessionId;
    final isStreaming = _activeStreamingSessions.contains(targetSession);
    final isOffline = !widget.isConnected || widget.api == null;

    String displayText = text;
    if (!displayText.contains('![') && !displayText.contains('[Image:') && !displayText.contains('[Fichier:')) {
      final imgBuf = StringBuffer();
      if (base64Data != null && base64Data.isNotEmpty) {
        final uri = base64Data.startsWith('data:') ? base64Data : 'data:image/png;base64,$base64Data';
        final name = fileName != null && fileName.isNotEmpty ? fileName : 'image.png';
        imgBuf.writeln('![$name]($uri)');
      }
      if (images != null && images.isNotEmpty) {
        for (var i = 0; i < images.length; i++) {
          final img = images[i];
          final uri = img.startsWith('data:') ? img : 'data:image/png;base64,$img';
          imgBuf.writeln('![image_$i.png]($uri)');
        }
      }
      if (media != null && media.isNotEmpty) {
        for (final m in media) {
          final uri = m['uri'] as String? ?? (m['base64Data'] != null ? 'data:${m['mimeType'] ?? "image/png"};base64,${m['base64Data']}' : '');
          final name = m['name'] as String? ?? m['description'] as String? ?? 'image.png';
          if (uri.isNotEmpty) {
            imgBuf.writeln('![$name]($uri)');
          }
        }
      }
      if (imgBuf.isNotEmpty) {
        if (displayText.isNotEmpty) imgBuf.writeln();
        imgBuf.write(displayText);
        displayText = imgBuf.toString().trim();
      }
    }

    if (queued || isStreaming || isOffline) {
      final queue = _sessionMessageQueues.putIfAbsent(targetSession, () => []);
      setState(() {
        queue.add({
          'text': displayText,
          'activeSessionId': targetSession,
          'modelUID': modelUID,
          'modelEnum': modelEnum,
          if (images != null) 'images': images,
          if (base64Data != null) 'base64Data': base64Data,
          if (fileName != null) 'fileName': fileName,
          if (media != null) 'media': media,
          'timestamp': DateTime.now().millisecondsSinceEpoch,
        });
      });
      OfflineOutboxStore.saveQueuedMessages(targetSession, queue);
      return;
    }

    final buf = _sessionMessages.putIfAbsent(targetSession, () => []);
    setState(() {
      buf.add(ChatMessage(
        id: 'm${++_messageCounter}',
        sender: 'user',
        text: displayText,
        timestamp: _timestamp(),
      ));
    });

    final api = widget.api;
    if (api == null) return;

    _sendPromptToDaemon(
      text,
      targetSessionOverride: targetSession,
      modelUID: modelUID,
      modelEnum: modelEnum,
      images: images,
      base64Data: base64Data,
      fileName: fileName,
      media: media,
    );
  }

  void _handleQueueSendNow(int index) {
    final queue = _sessionMessageQueues[widget.activeSessionId];
    if (queue == null || index < 0 || index >= queue.length) return;
    final item = queue.removeAt(index);
    OfflineOutboxStore.saveQueuedMessages(widget.activeSessionId, queue);
    final text = item['text'] as String? ?? '';
    final modelUID = item['modelUID'] as String?;
    final modelEnum = item['modelEnum'] as int?;
    final images = (item['images'] is List)
        ? (item['images'] as List).map((e) => '$e').toList()
        : null;
    final base64Data = item['base64Data'] as String?;
    final fileName = item['fileName'] as String?;
    final media = (item['media'] is List)
        ? (item['media'] as List).whereType<Map<String, dynamic>>().toList()
        : null;
    final targetSession = widget.activeSessionId;

    final buf = _sessionMessages.putIfAbsent(targetSession, () => []);
    setState(() {
      buf.add(ChatMessage(
        id: 'm${++_messageCounter}',
        sender: 'user',
        text: text,
        timestamp: _timestamp(),
      ));
    });
    _sendPromptToDaemon(
      text,
      targetSessionOverride: targetSession,
      modelUID: modelUID,
      modelEnum: modelEnum,
      images: images,
      base64Data: base64Data,
      fileName: fileName,
      media: media,
    );
  }

  void _handleQueueEdit(int index) {
    final queue = _sessionMessageQueues[widget.activeSessionId];
    if (queue == null || index < 0 || index >= queue.length) return;
    final item = queue.removeAt(index);
    OfflineOutboxStore.saveQueuedMessages(widget.activeSessionId, queue);
    final text = item['text'] as String? ?? '';
    setState(() {
      setDraft(text);
    });
  }

  void _handleQueueDelete(int index) {
    final queue = _sessionMessageQueues[widget.activeSessionId];
    if (queue == null || index < 0 || index >= queue.length) return;
    setState(() {
      queue.removeAt(index);
    });
    OfflineOutboxStore.saveQueuedMessages(widget.activeSessionId, queue);
  }

  void _sendPromptToDaemon(
    String text, {
    String? targetSessionOverride,
    String? modelUID,
    int? modelEnum,
    List<String>? images,
    String? base64Data,
    String? fileName,
    List<Map<String, dynamic>>? media,
  }) {
    final api = widget.api;
    if (api == null) return;

    final targetSession = targetSessionOverride ?? widget.activeSessionId;
    final assistantId = 'a${++_messageCounter}';
    _sessionLastStreamEnds.remove(targetSession);
    final modelLabel = _resolveModelLabel(modelUID);

    final buf = _sessionMessages.putIfAbsent(targetSession, () => []);
    setState(() {
      buf.add(ChatMessage(
        id: assistantId,
        sender: 'assistant',
        text: '',
        timestamp: _timestamp(),
        isStreaming: true,
        modelLabel: modelLabel,
      ));
      _activeStreamingSessions.add(targetSession);
    });
    if (targetSession == widget.activeSessionId) {
      _globalSessionUserScrolled[targetSession] = false;
      _globalSessionScrollOffsets.remove(targetSession);
      _userScrollLocked = false;
      _showJumpToBottom = false;
      _hiddenNewCount = 0;
      _scrollToBottomSettled();
    }

    var thoughtBuffer = StringBuffer();
    _onStreamStarted(targetSession);
    final promptSub = api.sendPrompt(
      targetSession,
      text,
      base64Data: base64Data,
      fileName: fileName,
      images: images,
      modelUID: modelUID,
      modelEnum: modelEnum,
      media: media,
    ).listen(
      (msg) {
        if (msg['type'] == 'stream_end') {
          _sessionLastStreamEnds[targetSession] = msg;
        }
        final textDelta = StreamDeltaParser.textOf(msg);
        final thoughtDelta = StreamDeltaParser.thinkingOf(msg);
        final approval = StreamDeltaParser.approvalOf(msg);
        if (!mounted) return;

        if (textDelta.isNotEmpty || thoughtDelta.isNotEmpty) {
          final idx = buf.indexWhere((m) => m.id == assistantId);
          if (idx >= 0) {
            final current = buf[idx];
            if (thoughtDelta.isNotEmpty) {
              if (thoughtBuffer.isNotEmpty && !thoughtBuffer.toString().endsWith('\n')) {
                thoughtBuffer.writeln();
              }
              thoughtBuffer.writeln(thoughtDelta.trim());
            }
            buf[idx] = current.copyWith(
              text: current.text + textDelta,
              thought: thoughtBuffer.isNotEmpty
                  ? thoughtBuffer.toString().trim()
                  : current.thought,
            );
          }
        }
        if (approval != null) {
          final hostActive = msg['data']?['hostActive'] == true;
          _addApproval(
            ToolApprovalRequest(
              callId: approval.callId,
              toolName: approval.tool,
              command: approval.command,
              description: 'Tool execution requires your confirmation',
              cascadeId: approval.cascadeId.isNotEmpty ? approval.cascadeId : targetSession,
              trajectoryId: approval.trajectoryId,
              stepIndex: approval.stepIndex,
              approvalType: approval.approvalType,
            ),
            hostActive: hostActive,
          );
        }

        if (mounted && widget.activeSessionId == targetSession) {
          _scheduleThrottledUpdate();
        }
      },
      onDone: () {
        if (!mounted) return;
        final localEnd = _sessionLastStreamEnds[targetSession];
        _onStreamEnded(targetSession);
        _handleStreamEnded(localEnd ?? const {}, targetSession);
        setState(() {
          final idx = buf.indexWhere((m) => m.id == assistantId);
          if (idx >= 0) {
            final localData = localEnd?['data'];
            String? error = localEnd?['error'] as String? ??
                (localData is Map
                    ? (localData['outcome'] == 'error'
                        ? localData['message'] as String? ?? 'Erreur'
                        : null)
                    : null);
            final currentMsg = buf[idx];
            final fullText = currentMsg.text;
            final fullThought = currentMsg.thought ?? '';
            final candidateError = error ??
                (fullText.toLowerCase().contains('quota')
                    ? fullText
                    : (fullThought.toLowerCase().contains('quota') ? fullThought : null));

            if (candidateError != null) {
              final banner = BannerClassifier.classifyError(
                candidateError,
                onDismiss: () => _dismissBanner('quota-exceeded'),
                onSwitchModel: _showModelSelector,
                onSeePlans: _showPlansOrLimitsSheet,
              );
              if (banner != null) {
                _activeBanners[banner.id] = banner;
                _dismissedBannerIds.remove(banner.id);
              }
              _refreshQuotaSummary();
            }
            final isQuotaErr = candidateError != null && candidateError.toLowerCase().contains('quota');
            if (error != null && (error.contains('MODEL_CAPACITY_EXHAUSTED') || error.contains('No capacity available') || error.contains('503'))) {
              error = '⚠️ Capacité du modèle saturée sur les serveurs (HTTP 503 / MODEL_CAPACITY_EXHAUSTED).\nVeuillez basculer vers Gemini 3.7 Flash, Claude ou un modèle custom via le sélecteur ci-dessous.';
            }
            buf[idx] = buf[idx].copyWith(
              isStreaming: false,
              isError: error != null || isQuotaErr,
              text: error != null
                  ? (buf[idx].text.isEmpty ? error : buf[idx].text)
                  : buf[idx].text,
            );
          }
        });
      },
      onError: (err) {
        if (!mounted) return;
        _onStreamEnded(targetSession);
        setState(() {
          final idx = buf.indexWhere((m) => m.id == assistantId);
          final errorText = 'Erreur: $err';
          final banner = BannerClassifier.classifyError(
            errorText,
            onDismiss: () => _dismissBanner('quota-exceeded'),
            onSwitchModel: _showModelSelector,
            onSeePlans: _showPlansOrLimitsSheet,
          );
          if (banner != null) {
            _activeBanners[banner.id] = banner;
            _dismissedBannerIds.remove(banner.id);
          }
          if (idx >= 0) {
            buf[idx] = buf[idx].copyWith(
              isStreaming: false,
              isError: true,
              text: errorText,
            );
          }
        });
      },
    );
    _promptStreamSubs.add(promptSub);
  }

  void _handleRetryTaskDirectly(ChatMessage errorMsg) {
    final targetSession = widget.activeSessionId;
    final buf = _sessionMessages[targetSession] ?? _messages;
    String lastUserPrompt = '';
    for (int i = buf.length - 1; i >= 0; i--) {
      if (buf[i].sender == 'user' && buf[i].text.trim().isNotEmpty) {
        lastUserPrompt = buf[i].text.trim();
        break;
      }
    }
    if (lastUserPrompt.isEmpty) {
      lastUserPrompt = 'Reprendre la tâche';
    }

    setState(() {
      buf.removeWhere((m) => m.id == errorMsg.id);
    });

    AppToast.show(
      context,
      message: 'Reprise directe de la tâche...',
      icon: Icons.refresh_rounded,
      type: ToastType.info,
    );

    _handleSendMessage(
      lastUserPrompt,
    );
  }

  void _handleToolDecision(ToolDecision decision,
      {ApprovalScope scope = ApprovalScope.once, String denyReason = ''}) {
    final approval = _currentApproval;
    if (approval == null) return;

    // Scénarios Extrêmes (1 & 7) : On marque cet appel comme traité pour ne plus jamais
    // ré-afficher cette carte si le serveur rejoue le message après une perte de connexion.
    _rememberProcessedCall(approval.callId);

    if (_expiredCallIds.contains(approval.callId)) {
      // La carte affichait déjà l'état expiré : on nettoie juste l'état.
      _removeApproval(approval.callId);
      return;
    }
    _removeApproval(approval.callId);
    widget.api?.submitApproval(
      cascadeId: approval.cascadeId.isEmpty
          ? widget.activeSessionId
          : approval.cascadeId,
      callId: approval.callId,
      allow: decision == ToolDecision.allow,
      trajectoryId: approval.trajectoryId,
      stepIndex: approval.stepIndex,
      approvalType: approval.approvalType,
      command: approval.command,
      scope: scope,
      denyReason: denyReason,
    ).catchError((_) => <String, dynamic>{});
  }

  /// Mises à jour de streaming à échéance uniquement (trailing) : au plus
  /// un rebuild de page par [_throttleDuration]. Avant : leading + trailing
  /// permettait jusqu'à ~80 setState/s de l'écran complet sous un flux de
  /// deltas rapide, annulant le batch de DaemonApi.
  void _scheduleThrottledUpdate() {
    _needsStateUpdate = true;
    if (_throttleTimer?.isActive ?? false) return;

    _throttleTimer = Timer(_throttleDuration, () {
      _throttleTimer = null;
      if (_needsStateUpdate && mounted) {
        _needsStateUpdate = false;
        _trimInMemoryMessages();
        setState(() {});
        _scrollToBottom();
      }
    });
  }

  // P3 (mémoire) : bornes l'historique conservé en RAM. Chaque session
  // ouverte garde jusqu'à [_maxInMemoryMessages] messages (au-delà de la
  // fenêtre paginée réellement consultable), et au plus
  // [_maxInMemorySessions] sessions restent bufferisées — les plus anciennes
  // (hors session active) sont libérées ; un retour dessus recharge depuis
  // SessionHistoryCacheStore / le daemon.
  static const int _maxInMemoryMessages = 1000;
  static const int _maxInMemorySessions = 20;

  void _trimInMemoryMessages() {
    if (_sessionMessages.isEmpty) return;
    for (final entry in _sessionMessages.entries) {
      final list = entry.value;
      if (list.length > _maxInMemoryMessages) {
        list.removeRange(0, list.length - _maxInMemoryMessages);
        final visible = _visibleCounts[entry.key];
        if (visible != null && visible > list.length) {
          _visibleCounts[entry.key] = list.length;
        }
      }
    }
    while (_sessionMessages.length > _maxInMemorySessions) {
      final oldest = _sessionMessages.keys
          .firstWhere((k) => k != widget.activeSessionId, orElse: () => '');
      if (oldest.isEmpty) break;
      _sessionMessages.remove(oldest);
      _visibleCounts.remove(oldest);
    }
  }

  void _scrollToBottom() {
    if (!mounted || !_scrollController.hasClients) return;
    final maxScroll = _scrollController.position.maxScrollExtent;
    final currentScroll = _scrollController.position.pixels;
    final nearBottom = (maxScroll - currentScroll) < 120;

    if (nearBottom && !_userScrollLocked) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted && _scrollController.hasClients && !_userScrollLocked) {
          _scrollController.jumpTo(_scrollController.position.maxScrollExtent);
        }
      });
    } else {
      if (!_showJumpToBottom || _hiddenNewCount == 0) {
        setState(() {
          _showJumpToBottom = true;
          _hiddenNewCount++;
        });
      } else {
        _hiddenNewCount++;
      }
    }
  }

  Widget _buildReminderBanners() {
    final children = <Widget>[];
    if (_showStillWorking) {
      children.add(const _ReminderBanner(
        icon: Icons.hourglass_top_outlined,
        message: 'La tâche tourne toujours — suivez la depuis le téléphone',
      ));
    }
    final pendingApprovals = _pendingApprovalCallIds.length;
    if (pendingApprovals >= 2) {
      children.add(const _ReminderBanner(
        icon: Icons.pan_tool_alt_outlined,
        message: 'Approuvez les appels d\'outils depuis le téléphone',
      ));
    }
    if (children.isEmpty) return const SizedBox.shrink();
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        for (final banner in children) ...[banner, const SizedBox(height: 8)],
        const SizedBox(height: 4),
      ],
    );
  }

  /// Carte d'approbation épinglée au-dessus de la barre de saisie (audit UX
  /// P0-2) : toujours visible, même en fin de longue conversation. Navigable
  /// ◀ ▶ quand plusieurs demandes sont empilées.
  Widget _buildApprovalArea() {
    final questions = _currentSessionQuestions;
    if (questions.isNotEmpty) {
      final q = questions.first;
      return Padding(
        padding: const EdgeInsets.fromLTRB(16, 8, 16, 0),
        child: AskQuestionChoiceCard(
          request: q,
          onSubmit: (selected, custom) =>
              _handleQuestionSubmit(q, selected, custom),
        ),
      );
    }

    final approval = _currentApproval;
    if (approval == null) return const SizedBox.shrink();
    final total = _currentSessionApprovals.length;
    final expired = _expiredCallIds.contains(approval.callId);

    return Padding(
      padding: const EdgeInsets.fromLTRB(14, 0, 14, 0),
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxHeight: 280),
        child: SingleChildScrollView(
          physics: const ClampingScrollPhysics(),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Row(
                children: [
                  if (total > 1)
                    IconButton(
                      key: const Key('approval-prev'),
                      constraints: const BoxConstraints(minWidth: 20, minHeight: 20),
                      padding: EdgeInsets.zero,
                      visualDensity: VisualDensity.compact,
                      icon: const Icon(Icons.chevron_left, size: 16),
                      tooltip: 'Approbation précédente',
                      onPressed: () => setState(() {
                        _approvalIndex =
                            (_approvalIndex - 1 + total) % total;
                      }),
                    ),
                  Text(
                    'Approbation ${_approvalIndex + 1}/$total',
                    style: TextStyle(
                      fontSize: 10,
                      fontWeight: FontWeight.w600,
                      color: Theme.of(context).colorScheme.onSurfaceVariant,
                    ),
                  ),
                  if (total > 1)
                    IconButton(
                      key: const Key('approval-next'),
                      constraints: const BoxConstraints(minWidth: 20, minHeight: 20),
                      padding: EdgeInsets.zero,
                      visualDensity: VisualDensity.compact,
                      icon: const Icon(Icons.chevron_right, size: 16),
                      tooltip: 'Approbation suivante',
                      onPressed: () => setState(() {
                        _approvalIndex = (_approvalIndex + 1) % total;
                      }),
                    ),
                  const Spacer(),
                  IconButton(
                    key: const Key('approval-dismiss'),
                    constraints: const BoxConstraints(minWidth: 20, minHeight: 20),
                    padding: EdgeInsets.zero,
                    visualDensity: VisualDensity.compact,
                    icon: const Icon(Icons.close, size: 14),
                    tooltip: 'Fermer cette approbation',
                    onPressed: () => _removeApproval(approval.callId),
                  ),
                ],
              ),
              TweenAnimationBuilder<double>(
                key: ValueKey('approval-${approval.callId}'),
                duration: const Duration(milliseconds: 300),
                curve: Curves.easeOutQuart,
                tween: Tween(begin: 0.0, end: 1.0),
                builder: (context, value, child) => Opacity(
                  opacity: value,
                  child: Transform.translate(
                    offset: Offset(0, 8 * (1 - value)),
                    child: child,
                  ),
                ),
                child: ToolApprovalCard(
                  request: approval,
                  onDecision: _handleToolDecision,
                  isExpired: expired,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildSyncStatusBadge(ColorScheme scheme) {
    int pendingCount = 0;
    try {
      pendingCount = widget.api?.outbox?.pendingCount ?? 0;
    } catch (_) {}
    if (!_isSyncing && pendingCount == 0) return const SizedBox.shrink();

    if (_isSyncing) {
      return Container(
        margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
        child: StatusDotBadge(
          label: 'Rattrapage des messages…',
          color: scheme.primary,
          isPulsing: true,
        ),
      );
    }

    return Container(
      margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
      child: StatusDotBadge(
        label: '$pendingCount message${pendingCount > 1 ? 's' : ''} en attente',
        color: const Color(0xFFD29922),
      ),
    );
  }

  /// Badge de quotas temps réel (P8).
  Widget _buildQuotaBadge(ColorScheme scheme) {
    if (_quotaSummary == null) return const SizedBox.shrink();
    final gRaw = _quotaSummary?['weeklyPercent'] ?? _quotaSummary?['geminiQuotaPercent'];
    final cRaw = _quotaSummary?['weeklyPercentClaude'] ?? _quotaSummary?['claudeQuotaPercent'];
    final gVal = gRaw is num ? gRaw.round() : null;
    final cVal = cRaw is num ? cRaw.round() : null;
    if (gVal == null && cVal == null) return const SizedBox.shrink();

    return Container(
      margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 1),
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1.5),
      decoration: BoxDecoration(
        color: scheme.surfaceContainerHighest.withValues(alpha: 0.6),
        borderRadius: BorderRadius.circular(AppRadius.pill),
        border: Border.all(color: scheme.outlineVariant.withValues(alpha: 0.4)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(Icons.speed_outlined, size: 11, color: scheme.onSurfaceVariant),
          const SizedBox(width: 4),
          if (gVal != null)
            Text(
              'Gemini: $gVal%',
              style: TextStyle(fontSize: 10, fontWeight: FontWeight.w500, color: gVal > 85 ? scheme.error : scheme.onSurfaceVariant),
            ),
          if (gVal != null && cVal != null)
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 4),
              child: Text('•', style: TextStyle(fontSize: 10, color: scheme.onSurfaceVariant)),
            ),
          if (cVal != null)
            Text(
              'Claude: $cVal%',
              style: TextStyle(fontSize: 10, fontWeight: FontWeight.w500, color: cVal > 85 ? scheme.error : scheme.onSurfaceVariant),
            ),
        ],
      ),
    );
  }

  void _showProjectSelector(BuildContext context) {
    final projs = List<ProjectItem>.from(widget.projects ?? []);
    if (projs.isEmpty) return;
    ProjectSelectorBottomSheet.show(
      context,
      projects: projs,
      activeProjectPath: widget.workspacePath ?? '',
      onSelectProject: (p) => widget.onSelectProject?.call(p),
    );
  }

  Future<void> _handleRevertStep(ChatMessage message) async {
    final api = widget.api;
    if (api == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Rollback impossible en mode hors ligne.')),
      );
      return;
    }

    final targetSession = widget.activeSessionId;
    if (targetSession.isEmpty) return;

    // Détermine le stepIndex
    int stepIndex = message.stepIndex ?? -1;
    if (stepIndex < 0) {
      final buf = _sessionMessages[targetSession] ?? [];
      final idx = buf.indexOf(message);
      stepIndex = idx >= 0 ? idx : 0;
    }

    final reverted = await RevertStepPreviewDialog.show(
      context,
      api: api,
      cascadeId: targetSession,
      stepIndex: stepIndex,
      stepDescription: message.text,
    );

    if (reverted == true && mounted) {
      HapticFeedback.mediumImpact();

      // 1. Restaure le texte du message dans l'input de saisie pour réédition
      _chatInputKey.currentState?.setText(message.text);

      // 2. Annule et fait disparaître immédiatement le message x et tous ses descendants
      final buf = _sessionMessages[targetSession];
      if (buf != null) {
        final idx = buf.indexOf(message);
        if (idx >= 0) {
          buf.removeRange(idx, buf.length);
        } else if (stepIndex >= 0) {
          buf.removeWhere((m) => (m.stepIndex != null && m.stepIndex! >= stepIndex));
        }
      }
      setState(() {});

      // 3. Vide le cache persistant et recharge l'état propre jusqu'à l'étape x - 1
      SessionHistoryCacheStore.instance.saveSessionHistory(targetSession, const []);
      _loadHistoryIfEmpty(targetSession);
      _fetchVcsChanges();
      _refreshRunningTasks();
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Modifications annulées. Message restauré dans la zone de saisie.'),
          duration: Duration(seconds: 2),
        ),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final viewInsets = MediaQuery.of(context).viewInsets;
    final rawInsetsBottom = View.of(context).viewInsets.bottom / MediaQuery.of(context).devicePixelRatio;
    final hasKeyboard = viewInsets.bottom > 50 || rawInsetsBottom > 50;

    Widget connectivityBanner = AnimatedSize(
      duration: const Duration(milliseconds: 300),
      curve: Curves.easeOutQuart,
      child: ConnectionBanner(
        status: _status,
        attempt: _attempt,
        nextRetryIn: _nextRetryIn,
        isManualDisconnect: _isManualDisconnect,
        onRetry: widget.wsClient?.retryNow,
      ),
    );

    // Source unique de vérité pour l'état connecté de la barre de saisie :
    // le banner et l'input partagent le même statut (audit UX P2-12).
    final isConnected = widget.wsClient == null
        ? widget.isConnected
        : _status == ConnectionStatus.connected;

    final breadcrumb = SessionBreadcrumb(
      projectName: widget.activeProjectName,
      sessionTitle: widget.activeSessionTitle ?? '',
      projects: widget.projects,
      onSelectProject: (widget.projects != null && widget.projects!.length > 1)
          ? () => _showProjectSelector(context)
          : null,
      onSelectSession: () {
        if (widget.onOpenSessionsDrawer != null) {
          widget.onOpenSessionsDrawer!();
        } else {
          Scaffold.maybeOf(context)?.openDrawer();
        }
      },
      isFullscreen: _isFullscreen,
      onToggleFullscreen: () {
        HapticFeedback.selectionClick();
        setState(() {
          _isFullscreen = !_isFullscreen;
        });
      },
      onToggleSearch: _toggleSearch,
      isSearching: _isSearching,
      isStreaming: _hasCurrentActiveStream,
      hasRunningTasks: _runningBackgroundTasks.isNotEmpty,
      hasWaitingApproval: _currentSessionApprovals.isNotEmpty,
      isError: false,
    );

    return ZenithalCanvas(
      child: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 920),
          child: Column(
            children: [
              connectivityBanner,
          if (!hasKeyboard && (_isHeaderVisible || _isFullscreen)) breadcrumb,
          AnimatedSize(
            duration: const Duration(milliseconds: 180),
            curve: Curves.easeOutCubic,
            child: _isSearching
                ? _ChatSearchBar(
                    controller: _searchController,
                    matchCount: _searchMatches.length,
                    currentIndex: _currentSearchMatchIndex,
                    onQueryChanged: _onSearchQueryChanged,
                    onNext: _nextSearchMatch,
                    onPrev: _prevSearchMatch,
                    onClose: _closeSearch,
                  )
                : const SizedBox.shrink(),
          ),
          if (!_isFullscreen && _isHeaderVisible) ...[
            SessionTopTabs(
              activeTab: _currentTab,
              onTabChanged: (tab) {
                setState(() {
                  _activeArtifact = null;
                  _currentTab = tab;
                });
                if (tab == SessionTabType.review) {
                  _fetchVcsChanges();
                }
              },
              filesChangedCount: _modifiedFiles.length,
              hasPlan: _latestPlanText != null,
              hasTasks: false,
              runningTasksCount: _activeStreamCount,
              artifactTabs: _artifacts,
              activeArtifact: _activeArtifact,
              onOpenArtifact: (art) => setState(() {
                _activeArtifact = art;
              }),
              onNewTab: () {
                final projs = widget.projects ?? [];
                if (projs.length > 1) {
                  _showProjectSelector(context);
                } else {
                  widget.onNewConversation?.call();
                }
              },
            ),
            if (!hasKeyboard) ...[
              _buildSyncStatusBadge(scheme),
              _buildQuotaBadge(scheme),
            ],
          ],
          Expanded(
            child: Stack(
              children: [
                Positioned.fill(
                  // P6 : swipe horizontal gauche/droite pour changer d'onglet.
                  child: GestureDetector(
                    behavior: HitTestBehavior.opaque,
                    onHorizontalDragEnd: (details) {
                      if (_activeArtifact != null) return; // onglet artefact : pas de swipe
                      final tabs = _swipeableTabs;
                      if (tabs.length < 2) return;
                      final idx = tabs.indexOf(_currentTab);
                      if (idx < 0) return;
                      final velocity = details.primaryVelocity ?? 0;
                      final next = velocity < -200
                          ? idx + 1
                          : velocity > 200
                              ? idx - 1
                              : -1;
                      if (next < 0 || next >= tabs.length) return;
                      final nextTab = tabs[next];
                      setState(() {
                        _activeArtifact = null;
                        _currentTab = nextTab;
                      });
                      if (nextTab == SessionTabType.review) {
                        _fetchVcsChanges();
                      }
                    },
                    child: _buildActiveTabContent(scheme, isConnected),
                  ),
                ),
                // P1 : bouton flottant « retour en bas » — uniquement sur
                // l'onglet chat, quand l'utilisateur s'est éloigné du bas.
                if (_showJumpToBottom &&
                    _activeArtifact == null &&
                    _currentTab == SessionTabType.chat)
                  Positioned(
                    right: 16,
                    bottom: 12,
                    child: _JumpToBottomButton(
                      count: _hiddenNewCount,
                      onTap: _jumpToBottom,
                    ),
                  ),
              ],
            ),
          ),
          _buildApprovalArea(),
          if (_sideQuestion != null ||
              _runningBackgroundTasks.isNotEmpty ||
              _subagents.isNotEmpty ||
              (_sessionMessageQueues[widget.activeSessionId]?.isNotEmpty ?? false) ||
              _topActiveBanner != null)
            Flexible(
              flex: 0,
              child: ConstrainedBox(
                constraints: BoxConstraints(maxHeight: hasKeyboard ? 110 : 200),
                child: SingleChildScrollView(
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      if (_sideQuestion != null)
                        SideQuestionCard(
                          question: _sideQuestion!,
                          answer: _sideQuestionAnswer,
                          isLoading: _isSideQuestionLoading,
                          onClose: () => setState(() {
                            _sideQuestion = null;
                            _sideQuestionAnswer = null;
                          }),
                        ),
                      if (_runningBackgroundTasks.isNotEmpty)
                        BackgroundTasksBar(
                          runningTasks: _runningBackgroundTasks,
                          onTapTask: _openTaskOutputSheet,
                          onStopTask: _handleStopBackgroundTask,
                          onViewTasks: () {
                            if (_runningBackgroundTasks.isNotEmpty) {
                              _openTaskOutputSheet(_runningBackgroundTasks.first);
                            }
                          },
                        ),
                      if (_subagents.isNotEmpty)
                        SubagentTreeCard(
                          subagents: _subagents,
                          projectName: widget.activeProjectName,
                          sessionTitle: widget.activeSessionTitle,
                          onOpenFullTree: () {
                            SubagentsTreeSheet.show(
                              context,
                              api: widget.api,
                              cascadeId: widget.activeSessionId,
                              sessionTitle: widget.activeSessionTitle,
                            );
                          },
                          onSelectSubagent: (sub) {
                            SubagentDetailModal.show(
                              context,
                              agent: sub,
                              api: widget.api,
                              cascadeId: widget.activeSessionId,
                              projectName: widget.activeProjectName,
                              sessionTitle: widget.activeSessionTitle,
                              onKill: () => _fetchSubagentsForSession(widget.activeSessionId),
                            );
                          },
                        ),
                      if ((_sessionMessageQueues[widget.activeSessionId]?.isNotEmpty ?? false))
                        QueuedMessagesCard(
                          queuedMessages: _sessionMessageQueues[widget.activeSessionId]!,
                          onSendNow: _handleQueueSendNow,
                          onEdit: _handleQueueEdit,
                          onDelete: _handleQueueDelete,
                        ),
                      if (_topActiveBanner != null)
                        AppNotificationBanner(
                          data: _topActiveBanner!,
                          isCompact: hasKeyboard,
                        ),
                    ],
                  ),
                ),
              ),
            ),
          ChatInputBar(
            key: _chatInputKey,
            onSend: _handleSendMessage,
            isConnected: isConnected,
            hasActiveStream: _hasCurrentActiveStream,
            onStop: _handleStopGeneration,
            api: widget.api,
            cascadeId: widget.activeSessionId,
            initialText: currentDraft,
            onDraftChanged: setDraft,
            hasPlan: _latestPlanText != null,
            onProceedPlan: () => _handleSendMessage('proceed'),
            onRunTests: () => _handleSendMessage('Exécute les tests unitaires du projet'),
            onViewDiff: () => setState(() => _currentTab = SessionTabType.review),
          ),
        ],
      ),
    ),
  ),
);
  }

  void _handleStopGeneration() {
    final targetSession = widget.activeSessionId;
    HapticFeedback.mediumImpact();
    widget.api?.stopGeneration(cascadeId: targetSession);
    setState(() {
      _activeStreamingSessions.remove(targetSession);
      _runningBackgroundTasks.clear();
      _showStillWorking = false;
      _stillWorkingTimer?.cancel();
      _stillWorkingTimer = null;
      final buf = _sessionMessages[targetSession];
      if (buf != null) {
        for (int i = 0; i < buf.length; i++) {
          if (buf[i].isStreaming) {
            buf[i] = buf[i].copyWith(isStreaming: false);
          }
        }
      }
    });
    widget.onStreamingSessionChanged?.call(targetSession, false);
    if (_activeStreamingSessions.isEmpty) {
      widget.onStreamingStateChanged?.call(false);
    }
    _refreshRunningTasks();
  }

  Widget _buildActiveTabContent(ColorScheme scheme, bool isConnected) {
    if (_activeArtifact != null) {
      return _buildArtifactTabContent(_activeArtifact!);
    }

    switch (_currentTab) {
      case SessionTabType.overview:
        return OverviewPanelView(
          isLoading: _loadingHistorySessions.contains(widget.activeSessionId) || _isVcsLoading,
          sessionTitle: widget.activeProjectName.isNotEmpty ? widget.activeProjectName : 'Session',
          workspacePath: widget.activeProjectName,
          modifiedFiles: _modifiedFiles.toList(),
          artifacts: _artifacts,
          subagentsCount: _subagentsCount,
          backgroundTasks: _runningBackgroundTasks,
          onOpenReview: () => setState(() {
            _activeArtifact = null;
            _currentTab = SessionTabType.review;
          }),
          onOpenPlan: () => setState(() {
            _activeArtifact = null;
            _currentTab = SessionTabType.plan;
          }),
          onOpenSubagents: () {
            SubagentsTreeSheet.show(
              context,
              api: widget.api,
              cascadeId: widget.activeSessionId,
            );
          },
        );
      case SessionTabType.review:
        return _buildReviewTabContent();
      case SessionTabType.plan:
        return _buildPlanTabContent();
      case SessionTabType.tasks:
        return _buildTasksTabContent();
      case SessionTabType.chat:
        final visibleList = _visibleMessages;
        final hiddenCount = _hiddenOlderCount;
        final isDark = Theme.of(context).brightness == Brightness.dark;
        final scheme = Theme.of(context).colorScheme;

        if (visibleList.isEmpty && _currentApproval == null && _currentSessionQuestions.isEmpty) {
          if (_loadingHistorySessions.contains(widget.activeSessionId)) {
            return SkeletonLoader(
              child: ListView(
                padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 16),
                physics: const NeverScrollableScrollPhysics(),
                children: const [
                  SkeletonChatMessage(isUser: true),
                  SizedBox(height: 12),
                  SkeletonChatMessage(isUser: false),
                  SizedBox(height: 12),
                  SkeletonChatMessage(isUser: true),
                ],
              ),
            );
          }
          return Center(
            child: SingleChildScrollView(
              padding: const EdgeInsets.symmetric(horizontal: 16),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  _WelcomeEmptyState(
                    projectName: widget.activeProjectName,
                    onSuggestionTap: (text) => _handleSendMessage(text, queued: false),
                    onSelectProject: (widget.projects != null && widget.projects!.length > 1)
                        ? () => _showProjectSelector(context)
                        : null,
                  ),
                  const SizedBox(height: 32),
                ],
              ),
            ),
          );
        }

        final headerWidgets = <Widget>[
          if (hiddenCount > 0)
            Padding(
              padding: const EdgeInsets.only(bottom: 12),
              child: Center(
                child: Material(
                  color: Colors.transparent,
                  child: InkWell(
                    onTap: _loadMoreOlderMessages,
                    borderRadius: BorderRadius.circular(AppRadius.pill),
                    child: Container(
                      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 6),
                      decoration: BoxDecoration(
                        color: isDark ? AppColors.surfaceInput : scheme.surfaceContainerHigh,
                        borderRadius: BorderRadius.circular(AppRadius.pill),
                        border: Border.all(
                          color: isDark ? AppColors.borderSubtle : scheme.outlineVariant,
                          width: 1,
                        ),
                      ),
                      child: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          const Icon(
                            Icons.history_rounded,
                            size: 14,
                            color: AppColors.accentBlue,
                          ),
                          const SizedBox(width: 6),
                          Text(
                            'Charger les $hiddenCount messages précédents',
                            style: const TextStyle(
                              fontSize: 11.5,
                              color: AppColors.accentBlue,
                              fontWeight: FontWeight.w500,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                ),
              ),
            ),
          _buildReminderBanners(),
        ];

        final totalCount = headerWidgets.length + visibleList.length;

        return Scrollbar(
          controller: _scrollController,
          thumbVisibility: false,
          child: RefreshIndicator(
            onRefresh: () async {
              if (widget.activeSessionId.isNotEmpty) {
                _loadHistoryIfEmpty(widget.activeSessionId);
              }
              await Future.delayed(const Duration(milliseconds: 300));
            },
            child: ListView.builder(
              key: PageStorageKey('chat_list_${widget.activeSessionId}'),
              controller: _scrollController,
              physics: const AlwaysScrollableScrollPhysics(parent: BouncingScrollPhysics()),
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
              itemCount: totalCount,
              itemBuilder: (ctx, index) {
              if (index < headerWidgets.length) {
                return headerWidgets[index];
              }

              final msgIndex = index - headerWidgets.length;
              final msg = visibleList[msgIndex];
              final isLatest = msgIndex == visibleList.length - 1;

              final bubbleWidget = _MessageBubble(
                key: ValueKey('msg_${msg.id}'),
                message: msg,
                api: widget.api,
                workspacePath: widget.activeProjectName,
                onLocalFile: _openLocalFile,
                onOpenArtifact: _openArtifactByName,
                isThoughtExpanded: _expandedThoughts.contains(msg.id),
                onToggleThought: () => setState(() {
                  if (_expandedThoughts.contains(msg.id)) {
                    _expandedThoughts.remove(msg.id);
                  } else {
                    _expandedThoughts.add(msg.id);
                  }
                }),
                onProceedPlan: () => _handleSendMessage('Proceed', queued: false),
                onViewPlan: () => setState(() => _currentTab = SessionTabType.plan),
                onViewReview: () => setState(() => _currentTab = SessionTabType.review),
                onOpenFile: (file) {
                  final fileName = file.split(_mediaSlashSplitRe).last;
                  final matching = _modifiedFileList
                      .where((f) => _pathsMatch(f.path, file))
                      .firstOrNull;
                  _openUnifiedDiffViewer(
                    filePath: file,
                    fileName: fileName,
                    diffContent: matching?.diffContent,
                  );
                },
                onStop: _handleStopGeneration,
                onSwitchModel: _showModelSelector,
                onEditPrompt: (text) => _chatInputKey.currentState?.setText(text),
                onRevertStep: _handleRevertStep,
                onRetryTask: () => _handleRetryTaskDirectly(msg),
                onResend: (m) {
                  final reqId = m.id.startsWith('pending-')
                      ? m.id.substring('pending-'.length)
                      : '';
                  if (reqId.isEmpty) return;
                  widget.api?.resendPending({'requestId': reqId});
                  setState(() {
                    _messages.removeWhere((item) => item.id == m.id);
                  });
                  AppToast.show(
                    context,
                    message: 'Prompt retransmis au daemon',
                    icon: Icons.send_outlined,
                    type: ToastType.success,
                  );
                },
              );

              final semanticBubble = Semantics(
                customSemanticsActions: {
                  const CustomSemanticsAction(label: 'Citer ce message'): () {
                    HapticFeedback.mediumImpact();
                    _chatInputKey.currentState?.insertQuote(msg.text);
                    AppToast.show(
                      context,
                      message: 'Message cité dans la barre de saisie',
                      icon: Icons.format_quote_rounded,
                      type: ToastType.info,
                    );
                  },
                  const CustomSemanticsAction(label: 'Copier le texte'): () {
                    HapticFeedback.lightImpact();
                    Clipboard.setData(ClipboardData(text: msg.text));
                    AppToast.show(
                      context,
                      message: 'Message copié dans le presse-papiers',
                      icon: Icons.copy_outlined,
                      type: ToastType.success,
                    );
                  },
                },
                child: bubbleWidget,
              );

              // Wrap individual bubbles in RepaintBoundary for 60/120fps streaming isolation
              final isolatedBubble = RepaintBoundary(child: semanticBubble);

              // N'anime l'entrée que pour le dernier message en cours et uniquement si Reduce Motion est inactif
              if (isLatest && ctx.shouldAnimate) {
                return Padding(
                  padding: const EdgeInsets.only(bottom: 16),
                  child: TweenAnimationBuilder<double>(
                    key: ValueKey(msg.id),
                    duration: AppMotion.slow,
                    curve: AppMotion.easeOut,
                    tween: Tween(begin: 0.0, end: 1.0),
                    builder: (context, value, child) {
                      return Opacity(
                        opacity: value,
                        child: Transform.translate(
                          offset: Offset(0, 8 * (1 - value)),
                          child: child,
                        ),
                      );
                    },
                    child: isolatedBubble,
                  ),
                );
              }

              // Clé stable par message : sans elle, une insertion au milieu
              // de la liste réassocie l'état (cache markdown, animations)
              // aux mauvais éléments lors des insertions/retraits.
              return Padding(
                key: ValueKey('msg_${msg.id}'),
                padding: const EdgeInsets.only(bottom: 16),
                child: isolatedBubble,
              );
            },
          ),
        ),
      );
    }
  }



  Future<void> _fetchVcsChanges([String? forSessionId]) async {
    final api = widget.api;
    if (api == null) return;
    final targetSession = forSessionId ?? widget.activeSessionId;
    if (targetSession.isEmpty) {
      if (mounted) {
        setState(() {
          _modifiedFileList.clear();
          _modifiedFiles.clear();
          _isVcsLoading = false;
        });
      }
      return;
    }

    if (_modifiedFileList.isEmpty && mounted && targetSession == widget.activeSessionId) {
      setState(() => _isVcsLoading = true);
    }

    try {
      final ws = widget.workspacePath?.isNotEmpty == true
          ? widget.workspacePath
          : (widget.activeProjectName.isNotEmpty ? widget.activeProjectName : null);

      final ctx = await api.getContext(
        cascadeId: targetSession,
        workspacePath: ws,
      );
      final ctxFiles = ctx['modifiedFiles'];
      final list = <SessionModifiedFile>[];
      final targetModFiles = _sessionModifiedFiles.putIfAbsent(targetSession, () => {});

      if (ctxFiles is List && ctxFiles.isNotEmpty) {
        for (final item in ctxFiles) {
          if (item is! String || item.isEmpty) continue;
          var clean = item.replaceAll('\\', '/');
          if (clean.startsWith('file:///')) clean = clean.substring(8);
          if (clean.startsWith('file://')) clean = clean.substring(7);
          if (!targetModFiles.contains(clean)) targetModFiles.add(clean);
          if (!list.any((f) => f.path == clean)) {
            list.add(SessionModifiedFile(path: clean, additions: 1, deletions: 0));
          }
        }
      }

      // Enrichir avec les diffs réels et comptes d'additions / suppressions (getTurnDiff)
      try {
        final diffRes = await api.getTurnDiff(cascadeId: targetSession);
        final fileDiffs = diffRes['fileDiffs'];
        if (fileDiffs is List) {
          for (final fd in fileDiffs) {
            if (fd is Map) {
              final p = (fd['path'] as String? ?? '').replaceAll('\\', '/');
              final d = fd['diff'];
              if (d is Map) {
                final orig = d['originalContents'] as String? ?? '';
                final mod = d['modifiedContents'] as String? ?? '';
                final adds = d['additions'] as int? ?? (d['totalAdditions'] as int? ?? 0);
                final dels = d['deletions'] as int? ?? (d['totalDeletions'] as int? ?? 0);
                final fileDiff = _buildUnifiedDiffFromStrings(p.split('/').last, orig, mod);
                final idx = list.indexWhere((f) => _pathsMatch(f.path, p));
                if (idx >= 0) {
                  list[idx] = SessionModifiedFile(
                    path: list[idx].path,
                    additions: adds > 0 ? adds : list[idx].additions,
                    deletions: dels > 0 ? dels : list[idx].deletions,
                    diffContent: fileDiff.isNotEmpty ? fileDiff : list[idx].diffContent,
                  );
                } else if (p.isNotEmpty) {
                  targetModFiles.add(p);
                  list.add(SessionModifiedFile(
                    path: p,
                    additions: adds > 0 ? adds : 1,
                    deletions: dels,
                    diffContent: fileDiff.isNotEmpty ? fileDiff : null,
                  ));
                }
              }
            }
          }
        }
      } catch (_) {}

      _sessionModifiedFileList[targetSession] = list;

      if (mounted && targetSession == widget.activeSessionId) {
        setState(() {
          _modifiedFileList
            ..clear()
            ..addAll(list);
        });
      }
    } catch (_) {} finally {
      if (mounted && _isVcsLoading && targetSession == widget.activeSessionId) {
        setState(() => _isVcsLoading = false);
      }
    }
  }

  Widget _buildReviewTabContent() {
    return SessionReviewView(
      isLoading: _isVcsLoading,
      files: _modifiedFileList.isNotEmpty
          ? _modifiedFileList
          : _modifiedFiles
              .map((p) => SessionModifiedFile(
                    path: p,
                    additions: 1,
                    deletions: 0,
                  ))
              .toList(),
      onOpenFileDiff: (file) {
        _openUnifiedDiffViewer(
          filePath: file.path,
          fileName: file.fileName,
          diffContent: file.diffContent,
        );
      },
      onSplitDiffView: () {
        final firstPath = _modifiedFiles.firstOrNull;
        final firstName = firstPath?.split(_mediaSlashSplitRe).last;
        _openUnifiedDiffViewer(
          filePath: firstPath,
          fileName: firstName,
        );
      },
      onExpandAll: () {
        final firstPath = _modifiedFiles.firstOrNull;
        final firstName = firstPath?.split(_mediaSlashSplitRe).last;
        _openUnifiedDiffViewer(
          filePath: firstPath,
          fileName: firstName,
        );
      },
    );
  }

  Widget _buildArtifactTabContent(String artifactName) {
    return _ArtifactTabContent(
      api: widget.api,
      artifactName: artifactName,
      activeSessionId: widget.activeSessionId,
      onOpenPlan: () => setState(() {
        _activeArtifact = null;
        _currentTab = SessionTabType.plan;
      }),
    );
  }

  bool _pathsMatch(String a, String b) {
    if (a.isEmpty || b.isEmpty) return false;
    final cleanA = a.replaceAll('\\', '/').toLowerCase();
    final cleanB = b.replaceAll('\\', '/').toLowerCase();
    if (cleanA == cleanB) return true;
    if (cleanA.endsWith('/$cleanB') || cleanB.endsWith('/$cleanA')) return true;
    final nameA = cleanA.split('/').last;
    final nameB = cleanB.split('/').last;
    return nameA.isNotEmpty && nameA == nameB;
  }

  String _buildUnifiedDiffFromStrings(String path, String orig, String mod, {int contextLines = 3}) {
    final cleanOrig = orig.replaceAll('\r\n', '\n').replaceAll('\r', '\n');
    final cleanMod = mod.replaceAll('\r\n', '\n').replaceAll('\r', '\n');
    if (cleanOrig == cleanMod) {
      return '';
    }

    final a = cleanOrig.isEmpty ? <String>[] : cleanOrig.split('\n');
    final b = cleanMod.isEmpty ? <String>[] : cleanMod.split('\n');

    if (a.isEmpty) {
      final buf = StringBuffer();
      buf.writeln('--- /dev/null');
      buf.writeln('+++ b/$path');
      buf.writeln('@@ -0,0 +1,${b.length} @@');
      for (final l in b) {
        buf.writeln('+$l');
      }
      return buf.toString();
    }

    if (b.isEmpty) {
      final buf = StringBuffer();
      buf.writeln('--- a/$path');
      buf.writeln('+++ /dev/null');
      buf.writeln('@@ -1,${a.length} +0,0 @@');
      for (final l in a) {
        buf.writeln('-$l');
      }
      return buf.toString();
    }

    // Dynamic programming LCS sur la section modifiée (après élimination des préfixes/suffixes communs)
    int start = 0;
    while (start < a.length && start < b.length && a[start] == b[start]) {
      start++;
    }

    int endA = a.length - 1;
    int endB = b.length - 1;
    while (endA >= start && endB >= start && a[endA] == b[endB]) {
      endA--;
      endB--;
    }

    final subA = a.sublist(start, endA + 1);
    final subB = b.sublist(start, endB + 1);
    final n = subA.length;
    final m = subB.length;

    final dp = List.generate(n + 1, (_) => List.filled(m + 1, 0));
    for (int i = 0; i < n; i++) {
      for (int j = 0; j < m; j++) {
        if (subA[i] == subB[j]) {
          dp[i + 1][j + 1] = dp[i][j] + 1;
        } else {
          dp[i + 1][j + 1] = dp[i + 1][j] > dp[i][j + 1] ? dp[i + 1][j] : dp[i][j + 1];
        }
      }
    }

    int i = n;
    int j = m;
    final middleOps = <_UnifiedDiffOp>[];
    while (i > 0 || j > 0) {
      if (i > 0 && j > 0 && subA[i - 1] == subB[j - 1]) {
        middleOps.add(_UnifiedDiffOp(_UnifiedDiffOpType.equal, subA[i - 1]));
        i--;
        j--;
      } else if (j > 0 && (i == 0 || dp[i][j - 1] >= dp[i - 1][j])) {
        middleOps.add(_UnifiedDiffOp(_UnifiedDiffOpType.insert, subB[j - 1]));
        j--;
      } else {
        middleOps.add(_UnifiedDiffOp(_UnifiedDiffOpType.delete, subA[i - 1]));
        i--;
      }
    }

    final allOps = <_UnifiedDiffOp>[];
    for (int k = 0; k < start; k++) {
      allOps.add(_UnifiedDiffOp(_UnifiedDiffOpType.equal, a[k]));
    }
    allOps.addAll(middleOps.reversed);
    for (int k = endA + 1; k < a.length; k++) {
      allOps.add(_UnifiedDiffOp(_UnifiedDiffOpType.equal, a[k]));
    }

    final changeIndices = <int>[];
    for (int idx = 0; idx < allOps.length; idx++) {
      if (allOps[idx].type != _UnifiedDiffOpType.equal) {
        changeIndices.add(idx);
      }
    }

    if (changeIndices.isEmpty) {
      return '';
    }

    final hunkRanges = <List<int>>[];
    int rangeStart = changeIndices.first;
    int rangeEnd = changeIndices.first;

    for (int c = 1; c < changeIndices.length; c++) {
      final idx = changeIndices[c];
      if (idx - rangeEnd <= 2 * contextLines) {
        rangeEnd = idx;
      } else {
        hunkRanges.add([rangeStart, rangeEnd]);
        rangeStart = idx;
        rangeEnd = idx;
      }
    }
    hunkRanges.add([rangeStart, rangeEnd]);

    final oldLineNums = List<int>.filled(allOps.length + 1, 1);
    final newLineNums = List<int>.filled(allOps.length + 1, 1);
    int curOld = 1;
    int curNew = 1;
    for (int idx = 0; idx < allOps.length; idx++) {
      oldLineNums[idx] = curOld;
      newLineNums[idx] = curNew;
      final op = allOps[idx];
      if (op.type == _UnifiedDiffOpType.equal) {
        curOld++;
        curNew++;
      } else if (op.type == _UnifiedDiffOpType.delete) {
        curOld++;
      } else if (op.type == _UnifiedDiffOpType.insert) {
        curNew++;
      }
    }
    oldLineNums[allOps.length] = curOld;
    newLineNums[allOps.length] = curNew;

    final buf = StringBuffer();
    buf.writeln('--- a/$path');
    buf.writeln('+++ b/$path');

    for (final hr in hunkRanges) {
      final hStart = (hr[0] - contextLines).clamp(0, allOps.length);
      final hEnd = (hr[1] + contextLines + 1).clamp(0, allOps.length);

      final hunkOps = allOps.sublist(hStart, hEnd);
      int oldLinesCount = 0;
      int newLinesCount = 0;
      for (final op in hunkOps) {
        if (op.type == _UnifiedDiffOpType.equal) {
          oldLinesCount++;
          newLinesCount++;
        } else if (op.type == _UnifiedDiffOpType.delete) {
          oldLinesCount++;
        } else if (op.type == _UnifiedDiffOpType.insert) {
          newLinesCount++;
        }
      }

      final oldStartLine = oldLineNums[hStart];
      final newStartLine = newLineNums[hStart];

      buf.writeln('@@ -$oldStartLine,$oldLinesCount +$newStartLine,$newLinesCount @@');
      for (final op in hunkOps) {
        if (op.type == _UnifiedDiffOpType.equal) {
          buf.writeln(' ${op.line}');
        } else if (op.type == _UnifiedDiffOpType.delete) {
          buf.writeln('-${op.line}');
        } else if (op.type == _UnifiedDiffOpType.insert) {
          buf.writeln('+${op.line}');
        }
      }
    }

    return buf.toString();
  }

  Future<void> _openUnifiedDiffViewer({
    String? filePath,
    String? fileName,
    String? diffContent,
  }) async {
    final effectivePath = filePath ?? fileName;
    final effectiveName = fileName ?? (effectivePath != null ? effectivePath.split('/').last.split('\\').last : 'Code Changes');
    String diff = diffContent ?? '';

    // 1. Tenter la récupération via get_turn_diff du daemon
    if (diff.isEmpty && widget.api != null && widget.activeSessionId.isNotEmpty) {
      try {
        final res = await widget.api!.getTurnDiff(cascadeId: widget.activeSessionId);
        final fileDiffs = res['fileDiffs'];
        if (fileDiffs is List) {
          for (final fd in fileDiffs) {
            if (fd is Map) {
              final p = (fd['path'] as String? ?? '').replaceAll('\\', '/');
              final target = (effectivePath ?? '').replaceAll('\\', '/');
              if (_pathsMatch(p, target)) {
                final d = fd['diff'];
                if (d is Map) {
                  final orig = d['originalContents'] as String? ?? '';
                  final mod = d['modifiedContents'] as String? ?? '';
                  if (orig.isNotEmpty || mod.isNotEmpty) {
                    diff = _buildUnifiedDiffFromStrings(effectiveName, orig, mod);
                    break;
                  }
                }
              }
            }
          }
        }
      } catch (_) {}
    }

    if (!mounted) return;
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      backgroundColor: Colors.transparent,
      builder: (ctx) => FractionallySizedBox(
        heightFactor: 0.90,
        child: UnifiedDiffViewer(
          diffContent: diff,
          fileName: effectiveName,
          filePath: effectivePath,
          onClose: () => Navigator.of(ctx).pop(),
          onSendReview: (comments) {
            Navigator.of(ctx).pop();
            _handleSendMessage('Revue de code sur $effectiveName :\n$comments', queued: false);
          },
        ),
      ),
    );
  }

  /// P5 : tap sur un lien markdown file:/// (ex. implémentation_plan.md)
  /// → lit le fichier via le RPC officiel ReadFile du LS (le daemon gère
  /// l'URI file:/// telle quelle) et l'affiche dans ArtifactViewerModal.
  /// Ponytail : pas de workspacePath — les liens IDE sont des chemins
  /// absolus hôte, la voie RPC les accepte directement.
  void _openLocalFile(String filePath) {
    debugPrint("Tentative d'ouverture de fichier: $filePath");
    final api = widget.api;
    if (api == null) return;
    final name = filePath.split('/').last.split('\\').last;
    final norm = filePath.replaceAll(r'\', '/').toLowerCase();
    final isPlan = norm.contains('implementation_plan') || norm.endsWith('plan.md');
    ArtifactViewerModal.show(
      context,
      api: api,
      artifactPath: filePath,
      artifactName: name.isEmpty ? 'fichier' : name,
      cascadeId: widget.activeSessionId,
      workspacePath: widget.workspacePath,
      requestFeedback: isPlan,
      onProceed: () => _handleSendMessage('proceed', queued: false),
      onRequestFeedback: () => _handleSendMessage('Je valide le plan d\'implémentation, continue.', queued: false),
    );
  }

  void _openArtifactByName(String artifactName) {
    final api = widget.api;
    if (api == null) return;
    final cleanName = artifactName.trim();
    final isPlan = cleanName.toLowerCase().contains('plan');
    final fileName = isPlan && !cleanName.toLowerCase().endsWith('.md')
        ? 'implementation_plan.md'
        : cleanName;
    ArtifactViewerModal.show(
      context,
      api: api,
      artifactPath: fileName,
      artifactName: cleanName.isNotEmpty ? cleanName : 'Implementation Plan',
      cascadeId: widget.activeSessionId,
      workspacePath: widget.workspacePath,
      requestFeedback: isPlan,
      onProceed: () => _handleSendMessage('proceed', queued: false),
      onRequestFeedback: () => _handleSendMessage('Je valide le plan d\'implémentation, continue.', queued: false),
    );
  }

  Widget _buildPlanTabContent() {
    final scheme = Theme.of(context).colorScheme;
    final isDark = Theme.of(context).brightness == Brightness.dark;

    if (_latestPlanText == null || _latestPlanText!.isEmpty) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(Icons.architecture_rounded, size: 36, color: scheme.onSurfaceVariant),
              const SizedBox(height: 12),
              Text(
                'Aucun plan actif',
                style: TextStyle(fontSize: 14, fontWeight: FontWeight.w600, color: scheme.onSurface),
              ),
              const SizedBox(height: 6),
              Text(
                'Les plans d\'implémentation générés par l\'agent apparaîtront ici.',
                textAlign: TextAlign.center,
                style: TextStyle(fontSize: 12, color: scheme.onSurfaceVariant),
              ),
            ],
          ),
        ),
      );
    }

    return ListView(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
      children: [
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
          decoration: BoxDecoration(
            color: isDark ? AppColors.surfaceRaised : scheme.surfaceContainer,
            borderRadius: BorderRadius.circular(AppRadius.md),
            border: Border.all(color: isDark ? AppColors.borderSubtle : scheme.outlineVariant),
          ),
          child: Row(
            children: [
              Icon(Icons.description_outlined, size: 16, color: scheme.primary),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  'Implementation Plan',
                  style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: scheme.onSurface),
                ),
              ),
              GestureDetector(
                onTap: () => _handleSendMessage('Proceed', queued: false),
                child: Container(
                  padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
                  decoration: BoxDecoration(
                    color: scheme.primary,
                    borderRadius: BorderRadius.circular(AppRadius.sm),
                  ),
                  child: const Text(
                    'Proceed ⌘↵',
                    style: TextStyle(fontSize: 11, fontWeight: FontWeight.w600, color: AppColors.onAccent),
                  ),
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: 12),
        MarkdownBubble(
          text: _latestPlanText!,
          api: widget.api,
          workspacePath: widget.activeProjectName,
          onLocalFile: _openLocalFile,
        ),
      ],
    );
  }

  Widget _buildTasksTabContent() {
    final scheme = Theme.of(context).colorScheme;
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.checklist_rtl_outlined, size: 36, color: scheme.onSurfaceVariant),
            const SizedBox(height: 12),
            Text(
              'Suivi des tâches',
              style: TextStyle(fontSize: 14, fontWeight: FontWeight.w600, color: scheme.onSurface),
            ),
            const SizedBox(height: 6),
            const Text(
              'Les tâches et sous-tâches de la session s\'afficheront ici.',
              textAlign: TextAlign.center,
              style: TextStyle(fontSize: 12, color: AppColors.inkMuted),
            ),
          ],
        ),
      ),
    );
  }
}

class _ReminderBanner extends StatelessWidget {
  final IconData icon;
  final String message;

  const _ReminderBanner({required this.icon, required this.message});

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      decoration: BoxDecoration(
        color: scheme.primaryContainer.withValues(alpha: 0.4),
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: scheme.primary.withValues(alpha: 0.25)),
      ),
      child: Row(
        children: [
          Icon(icon, size: 15, color: scheme.primary),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              message,
              style: TextStyle(fontSize: 12, fontWeight: FontWeight.w500, color: scheme.onPrimaryContainer),
            ),
          ),
        ],
      ),
    );
  }
}

class _UserMessageBubble extends StatefulWidget {
  final ChatMessage message;
  final DaemonApi? api;
  final String workspacePath;
  final LocalFileTap? onLocalFile;
  final ValueChanged<String>? onEditPrompt;
  final ValueChanged<ChatMessage>? onRevertStep;

  const _UserMessageBubble({
    required this.message,
    this.api,
    this.workspacePath = '',
    this.onLocalFile,
    this.onEditPrompt,
    this.onRevertStep,
  });

  @override
  State<_UserMessageBubble> createState() => _UserMessageBubbleState();
}

class _UserMessageBubbleState extends State<_UserMessageBubble> {
  bool _isExpanded = false;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final parsed = _extractMediaAndCleanText(widget.message.text);
    final hasMedia = parsed.media.isNotEmpty;
    final cleanText = parsed.cleanText;

    final effectiveText = cleanText.isNotEmpty
        ? cleanText
        : (hasMedia ? '' : widget.message.text);

    // Détection si le message est long (> 4 sauts de ligne ou texte long > 220 caractères)
    final lines = effectiveText.split('\n');
    final isLong = lines.length > 4 || effectiveText.length > 220;

    final String displayText;
    if (isLong && !_isExpanded) {
      if (lines.length > 4) {
        displayText = lines.take(4).join('\n');
      } else {
        displayText = effectiveText.length > 220 ? '${effectiveText.substring(0, 220)}...' : effectiveText;
      }
    } else {
      displayText = effectiveText;
    }

    return RepaintBoundary(
      child: GestureDetector(
        onDoubleTap: widget.onEditPrompt != null ? () => widget.onEditPrompt!(widget.message.text) : null,
        onLongPress: () {
          HapticFeedback.lightImpact();
          Clipboard.setData(ClipboardData(text: widget.message.text));
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(
              content: Text('Prompt copié dans le presse-papiers'),
              duration: Duration(seconds: 1),
            ),
          );
        },
        child: Container(
          margin: const EdgeInsets.only(bottom: 16),
          width: double.infinity,
          clipBehavior: Clip.antiAlias,
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
          decoration: BoxDecoration(
            color: isDark ? AppColors.surfaceRaised : scheme.surfaceContainerLow,
            borderRadius: BorderRadius.only(
              topLeft: Radius.circular(AppRadius.lg),
              bottomLeft: Radius.circular(AppRadius.lg),
              bottomRight: Radius.circular(AppRadius.xs),
              topRight: Radius.circular(AppRadius.lg),
            ),
            border: Border(
              left: BorderSide(
                color: isDark ? AppColors.accentBlue.withValues(alpha: 0.3) : scheme.primary.withValues(alpha: 0.3),
                width: 3,
              ),
            ),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              if (hasMedia) ...[
                _MediaGalleryRow(
                  media: parsed.media,
                  api: widget.api,
                  workspacePath: widget.workspacePath,
                  onLocalFile: widget.onLocalFile,
                ),
                if (effectiveText.isNotEmpty) const SizedBox(height: 10),
              ],
              if (effectiveText.isNotEmpty) ...[
                AnimatedSize(
                  duration: const Duration(milliseconds: 240),
                  curve: Curves.easeOutCubic,
                  alignment: Alignment.topCenter,
                  child: MarkdownBubble(
                    key: ValueKey('user-md-${widget.message.id}-$_isExpanded'),
                    text: displayText,
                    isStreaming: false,
                    api: widget.api,
                    workspacePath: widget.workspacePath,
                    onLocalFile: widget.onLocalFile,
                  ),
                ),
                if (isLong) ...[
                  const SizedBox(height: 8),
                  InkWell(
                    onTap: () {
                      HapticFeedback.selectionClick();
                      setState(() => _isExpanded = !_isExpanded);
                    },
                    borderRadius: BorderRadius.circular(AppRadius.pill),
                    child: Container(
                      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4.5),
                      decoration: BoxDecoration(
                        color: isDark
                            ? const Color(0xFF22242B)
                            : scheme.surfaceContainerHighest.withValues(alpha: 0.8),
                        borderRadius: BorderRadius.circular(AppRadius.pill),
                        border: Border.all(
                          color: isDark
                              ? const Color(0xFF323640)
                              : scheme.outlineVariant.withValues(alpha: 0.6),
                          width: 0.8,
                        ),
                      ),
                      child: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Icon(
                            _isExpanded ? Icons.keyboard_arrow_up_rounded : Icons.keyboard_arrow_down_rounded,
                            size: 15,
                            color: isDark ? AppColors.accentBlue : scheme.primary,
                          ),
                          const SizedBox(width: 4),
                          Text(
                            _isExpanded
                                ? 'Réduire'
                                : 'Afficher tout (${lines.length > 4 ? '+${lines.length - 4} lignes' : 'déplier'})',
                            style: TextStyle(
                              fontSize: 11,
                              fontWeight: FontWeight.w600,
                              color: isDark ? AppColors.accentBlue : scheme.primary,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                ],
              ],
              const SizedBox(height: 6),
              Row(
                mainAxisAlignment: MainAxisAlignment.end,
                children: [
                  if (widget.message.timestamp.isNotEmpty)
                    Text(
                      widget.message.timestamp,
                      style: TextStyle(
                        fontSize: 11,
                        color: isDark ? AppColors.inkMuted : scheme.outline,
                        fontWeight: FontWeight.w400,
                      ),
                    ),
                  const SizedBox(width: 8),
                  // Bouton Copier
                  Tooltip(
                    message: 'Copier le message',
                    child: Material(
                      color: Colors.transparent,
                      child: InkWell(
                        onTap: () {
                          HapticFeedback.lightImpact();
                          Clipboard.setData(ClipboardData(text: widget.message.text));
                          ScaffoldMessenger.of(context).showSnackBar(
                            const SnackBar(
                              content: Text('Prompt copié dans le presse-papiers'),
                              duration: Duration(seconds: 1),
                            ),
                          );
                        },
                        borderRadius: BorderRadius.circular(6),
                        hoverColor: (isDark ? AppColors.accentBlue : scheme.primary).withValues(alpha: 0.08),
                        child: Padding(
                          padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 4),
                          child: Icon(
                            Icons.copy_rounded,
                            size: 14.5,
                            color: isDark ? AppColors.inkMuted : scheme.onSurfaceVariant,
                          ),
                        ),
                      ),
                    ),
                  ),
                  if (widget.onRevertStep != null) ...[
                    const SizedBox(width: 4),
                    // Bouton Revert / Undo changes up to this point
                    Tooltip(
                      message: 'Undo changes up to this point',
                      child: Material(
                        color: Colors.transparent,
                        child: InkWell(
                          onTap: () {
                            HapticFeedback.lightImpact();
                            widget.onRevertStep!(widget.message);
                          },
                          borderRadius: BorderRadius.circular(6),
                          hoverColor: const Color(0xFFD97706).withValues(alpha: 0.1),
                          child: Padding(
                            padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 4),
                            child: Icon(
                              Icons.undo_rounded,
                              size: 15.5,
                              color: isDark ? AppColors.inkMuted : scheme.onSurfaceVariant,
                            ),
                          ),
                        ),
                      ),
                    ),
                  ],
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _MessageBubble extends StatelessWidget {
  final ChatMessage message;

  /// P3 : API daemon pour le bouton « Exécuter » des blocs shell.
  final DaemonApi? api;

  /// P3 : chemin du workspace hôte pour créer le PTY du terminal.
  final String workspacePath;
  final bool isThoughtExpanded;
  final VoidCallback? onToggleThought;
  final VoidCallback? onProceedPlan;
  final VoidCallback? onViewPlan;
  final VoidCallback? onViewReview;
  final VoidCallback? onStop;
  final ValueChanged<ChatMessage>? onResend;
  final VoidCallback? onSwitchModel;
  final ValueChanged<String>? onEditPrompt;
  final ValueChanged<String>? onOpenFile;

  /// P5 : tap sur un lien markdown file:/// → ouvre le fichier distant.
  final LocalFileTap? onLocalFile;
  final ValueChanged<String>? onOpenArtifact;
  final ValueChanged<ChatMessage>? onRevertStep;
  final VoidCallback? onRetryTask;

  const _MessageBubble({
    super.key,
    required this.message,
    this.api,
    this.workspacePath = '',
    this.onLocalFile,
    this.onOpenArtifact,
    this.isThoughtExpanded = false,
    this.onToggleThought,
    this.onProceedPlan,
    this.onViewPlan,
    this.onViewReview,
    this.onStop,
    this.onResend,
    this.onSwitchModel,
    this.onEditPrompt,
    this.onOpenFile,
    this.onRevertStep,
    this.onRetryTask,
  });

  @override
  Widget build(BuildContext context) {
    final isUser = message.sender == 'user';
    final scheme = Theme.of(context).colorScheme;
    final isDark = Theme.of(context).brightness == Brightness.dark;

    if (isUser) {
      return _UserMessageBubble(
        message: message,
        api: api,
        workspacePath: workspacePath,
        onLocalFile: onLocalFile,
        onEditPrompt: onEditPrompt,
        onRevertStep: onRevertStep,
      );
    }

    final isError = message.isError;
    final hasContent = message.text.trim().isNotEmpty;
    final hasThought = message.thought != null && message.thought!.trim().isNotEmpty;

    if (!hasContent && !hasThought && !isError && !message.isStreaming) {
      return const SizedBox.shrink();
    }

    // isCompact = thought-only message (no body text, no error, not streaming)
    // → hide timestamp/action row, tighten margin
    final isCompact = !hasContent && !isError && !message.isStreaming;

    return RepaintBoundary(
      child: Container(
        margin: EdgeInsets.only(bottom: isCompact ? 6 : 16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Padding(
              padding: const EdgeInsets.only(bottom: 6),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  AntigravityLogo.avatar(radius: 8, showGlow: true),
                  const SizedBox(width: 6),
                  if (message.modelLabel != null && message.modelLabel!.isNotEmpty)
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2.5),
                      decoration: BoxDecoration(
                        gradient: AppGradients.cardCool(isDark: isDark),
                        borderRadius: BorderRadius.circular(AppRadius.pill),
                        border: Border.all(
                          color: const Color(0xFF3186FF).withValues(alpha: isDark ? 0.35 : 0.25),
                          width: 0.8,
                        ),
                      ),
                      child: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Icon(
                            Icons.auto_awesome,
                            size: 11,
                            color: scheme.primary,
                          ),
                          const SizedBox(width: 4),
                          Text(
                            message.modelLabel!,
                            style: TextStyle(
                              fontSize: 10,
                              fontFamily: 'monospace',
                              fontWeight: FontWeight.w600,
                              color: isDark ? AppColors.inkPrimary : scheme.primary,
                            ),
                          ),
                        ],
                      ),
                    ),
                ],
              ),
            ),
            if (isError)
              Container(
                width: double.infinity,
                padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
                decoration: BoxDecoration(
                  color: isDark ? const Color(0xFF1E1214) : scheme.errorContainer.withValues(alpha: 0.25),
                  borderRadius: BorderRadius.circular(8),
                  border: Border.all(
                    color: isDark ? const Color(0xFF5C1D24) : scheme.error.withValues(alpha: 0.4),
                    width: 0.8,
                  ),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Icon(
                          Icons.error_outline,
                          size: 16,
                          color: isDark ? AppColors.danger : scheme.error,
                        ),
                        const SizedBox(width: 8),
                        Expanded(
                          child: Builder(
                            builder: (context) {
                              final rawText = message.text;
                              final errorIdMatch = RegExp(
                                r'Error\s*ID:\s*([0-9a-fA-F\-]+)',
                                caseSensitive: false,
                              ).firstMatch(rawText);
                              final errorId = errorIdMatch?.group(1);
                              final mainText = errorId != null
                                  ? rawText.replaceAll(RegExp(r'\s*Error\s*ID:\s*[0-9a-fA-F\-]+', caseSensitive: false), '').trim()
                                  : rawText;

                              return Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                mainAxisSize: MainAxisSize.min,
                                children: [
                                  SelectableText(
                                    mainText,
                                    style: TextStyle(
                                      fontSize: 12.5,
                                      height: 1.4,
                                      color: isDark ? const Color(0xFFFCA5A5) : scheme.onErrorContainer,
                                      fontWeight: FontWeight.w500,
                                    ),
                                  ),
                                  if (errorId != null && errorId.isNotEmpty) ...[
                                    const SizedBox(height: 6),
                                    InkWell(
                                      onTap: () {
                                        Clipboard.setData(ClipboardData(text: errorId));
                                        HapticFeedback.lightImpact();
                                      },
                                      borderRadius: BorderRadius.circular(4),
                                      child: Padding(
                                        padding: const EdgeInsets.symmetric(vertical: 2),
                                        child: Row(
                                          mainAxisSize: MainAxisSize.min,
                                          children: [
                                            Icon(
                                              Icons.copy_rounded,
                                              size: 11,
                                              color: isDark ? const Color(0xFF9E9E9E) : scheme.onSurfaceVariant,
                                            ),
                                            const SizedBox(width: 4),
                                            Text(
                                              'Error ID: $errorId',
                                              style: TextStyle(
                                                fontSize: 11,
                                                fontFamily: 'monospace',
                                                color: isDark ? const Color(0xFF9E9E9E) : scheme.onSurfaceVariant,
                                              ),
                                            ),
                                          ],
                                        ),
                                      ),
                                    ),
                                  ],
                                ],
                              );
                            },
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 10),
                    Row(
                      mainAxisAlignment: MainAxisAlignment.end,
                      children: [
                        if (onRetryTask != null) ...[
                          InkWell(
                            onTap: () {
                              HapticFeedback.lightImpact();
                              onRetryTask?.call();
                            },
                            borderRadius: BorderRadius.circular(6),
                            child: Container(
                              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
                              decoration: BoxDecoration(
                                color: isDark ? const Color(0xFF2B3340) : scheme.surfaceContainerHighest,
                                borderRadius: BorderRadius.circular(6),
                                border: Border.all(
                                  color: isDark ? const Color(0xFF404B5E) : scheme.outlineVariant,
                                  width: 1,
                                ),
                              ),
                              child: Row(
                                mainAxisSize: MainAxisSize.min,
                                children: [
                                  Icon(
                                    Icons.refresh_rounded,
                                    size: 13,
                                    color: isDark ? const Color(0xFFE2E8F0) : scheme.onSurface,
                                  ),
                                  const SizedBox(width: 4),
                                  Text(
                                    'Réessayer',
                                    style: TextStyle(
                                      fontSize: 11,
                                      fontWeight: FontWeight.w600,
                                      color: isDark ? const Color(0xFFE2E8F0) : scheme.onSurface,
                                    ),
                                  ),
                                ],
                              ),
                            ),
                          ),
                          const SizedBox(width: 8),
                        ],
                        if (onSwitchModel != null &&
                            (message.text.toLowerCase().contains('quota') ||
                                message.text.toLowerCase().contains('capacity') ||
                                message.text.toLowerCase().contains('503') ||
                                message.text.toLowerCase().contains('401') ||
                                message.text.toLowerCase().contains('invalid_api_key'))) ...[
                          InkWell(
                            onTap: () {
                              HapticFeedback.lightImpact();
                              onSwitchModel?.call();
                            },
                            borderRadius: BorderRadius.circular(6),
                            child: Container(
                              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
                              decoration: BoxDecoration(
                                color: AppColors.accentBlue,
                                borderRadius: BorderRadius.circular(6),
                              ),
                              child: const Row(
                                mainAxisSize: MainAxisSize.min,
                                children: [
                                  Icon(Icons.swap_horiz_rounded, size: 13, color: Colors.white),
                                  SizedBox(width: 4),
                                  Text(
                                    'Changer de modèle',
                                    style: TextStyle(
                                      fontSize: 11,
                                      fontWeight: FontWeight.w600,
                                      color: Colors.white,
                                    ),
                                  ),
                                ],
                              ),
                            ),
                          ),
                        ],
                      ],
                    ),
                  ],
                ),
              )
            else if (message.segments.isNotEmpty) ...[
              for (int segIdx = 0; segIdx < message.segments.length; segIdx++) ...[
                if (message.segments[segIdx].type == ChatSegmentType.thought &&
                    message.segments[segIdx].content.trim().isNotEmpty) ...[
                  ExecutionProgressView(
                    messageId: '${message.id}-$segIdx',
                    thoughtText: message.segments[segIdx].content,
                    isStreaming: message.isStreaming &&
                        (segIdx == message.segments.length - 1 || message.segments[segIdx].isRunning),
                    modelLabel: message.modelLabel,
                    initiallyExpanded: isThoughtExpanded,
                    onToggleExpand: onToggleThought,
                    onOpenArtifact: onOpenArtifact,
                  ),
                ] else if (message.segments[segIdx].type == ChatSegmentType.text &&
                    message.segments[segIdx].content.trim().isNotEmpty) ...[
                  MarkdownBubble(
                    text: message.segments[segIdx].content,
                    isStreaming: message.isStreaming && (segIdx == message.segments.length - 1),
                    api: api,
                    workspacePath: workspacePath,
                    onLocalFile: onLocalFile,
                  ),
                ] else if (message.segments[segIdx].type == ChatSegmentType.error &&
                    message.segments[segIdx].content.trim().isNotEmpty) ...[
                  AgentErrorCard(
                    errorText: message.segments[segIdx].content,
                    title: message.segments[segIdx].title,
                    onRetry: onRetryTask,
                  ),
                ],
              ],
              if (!message.isStreaming &&
                  (message.text.contains('Implementation Plan') ||
                      message.text.contains('implementation_plan.md') ||
                      message.text.contains('# Plan')))
                ImplementationPlanCard(
                  summary: 'Le plan d\'implémentation est prêt. Vous pouvez l\'examiner ou approuver directement.',
                  onProceed: onProceedPlan ?? () {},
                  onViewPlan: onViewPlan ?? () {},
                ),
              if (!message.isStreaming &&
                  (message.text.contains('walkthrough.md') ||
                      message.text.contains('Walkthrough') ||
                      message.text.contains('# Walkthrough')))
                WalkthroughCard(
                  onViewWalkthrough: () {
                    onOpenArtifact?.call('walkthrough.md');
                  },
                ),
              if (!message.isStreaming && message.filesChanged.isNotEmpty)
                Padding(
                  padding: const EdgeInsets.only(top: 6),
                  child: FilesChangedCard(
                    files: message.filesChanged,
                    additions: message.additions,
                    deletions: message.deletions,
                    onReview: onViewReview ?? () {},
                    onOpenFile: onOpenFile,
                  ),
                ),
            ] else ...[
              if (hasThought || message.isStreaming) ...[
                ExecutionProgressView(
                  messageId: message.id,
                  thoughtText: message.thought,
                  isStreaming: message.isStreaming,
                  modelLabel: message.modelLabel,
                  initiallyExpanded: isThoughtExpanded,
                  onToggleExpand: onToggleThought,
                  onOpenArtifact: onOpenArtifact,
                ),
              ],
              if (hasContent || (message.isStreaming && message.text.isNotEmpty))
                MarkdownBubble(
                  text: message.text,
                  isStreaming: message.isStreaming,
                  api: api,
                  workspacePath: workspacePath,
                  onLocalFile: onLocalFile,
                ),
              if (!message.isStreaming &&
                  (message.text.contains('Implementation Plan') ||
                      message.text.contains('implementation_plan.md') ||
                      message.text.contains('# Plan')))
                ImplementationPlanCard(
                  summary: 'Le plan d\'implémentation est prêt. Vous pouvez l\'examiner ou approuver directement.',
                  onProceed: onProceedPlan ?? () {},
                  onViewPlan: onViewPlan ?? () {},
                ),
              if (!message.isStreaming &&
                  (message.text.contains('walkthrough.md') ||
                      message.text.contains('Walkthrough') ||
                      message.text.contains('# Walkthrough')))
                WalkthroughCard(
                  onViewWalkthrough: () {
                    onOpenArtifact?.call('walkthrough.md');
                  },
                ),
              if (!message.isStreaming && message.filesChanged.isNotEmpty)
                Padding(
                  padding: const EdgeInsets.only(top: 6),
                  child: FilesChangedCard(
                    files: message.filesChanged,
                    additions: message.additions,
                    deletions: message.deletions,
                    onReview: onViewReview ?? () {},
                    onOpenFile: onOpenFile,
                  ),
                ),
            ],
            if (!isCompact) ...[
              const SizedBox(height: 8),
              Row(
                children: [
                Text(
                  message.timestamp,
                  style: TextStyle(fontSize: 10.5, color: scheme.onSurfaceVariant),
                ),
                if (message.sender == 'user') ...[
                  const SizedBox(width: 8),
                  if (message.isQueued) ...[
                    Icon(Icons.schedule_outlined, size: 12, color: scheme.tertiary),
                    const SizedBox(width: 3),
                    Text(
                      'En attente',
                      style: TextStyle(fontSize: 10, color: scheme.tertiary, fontWeight: FontWeight.w600),
                    ),
                  ] else ...[
                    Icon(Icons.done_all, size: 12, color: scheme.primary),
                    const SizedBox(width: 3),
                    Text(
                      'Envoyé',
                      style: TextStyle(fontSize: 10, color: scheme.onSurfaceVariant),
                    ),
                  ],
                ],
                const Spacer(),
                if (message.isQueued && onResend != null) ...[
                  InkWell(
                    onTap: () => onResend?.call(message),
                    borderRadius: BorderRadius.circular(6),
                    child: Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                      child: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Icon(Icons.send_outlined, size: 13, color: scheme.primary),
                          const SizedBox(width: 4),
                          Text(
                            'Retransmettre',
                            style: TextStyle(
                              fontSize: 10.5,
                              color: scheme.primary,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                ],
                if (hasContent) ...[
                  Tooltip(
                    message: 'Copier le message',
                    child: InkWell(
                      onTap: () {
                        Clipboard.setData(ClipboardData(text: message.text));
                        AppToast.show(
                          context,
                          message: 'Message copié dans le presse-papiers',
                          icon: Icons.copy_outlined,
                          type: ToastType.success,
                        );
                      },
                      borderRadius: BorderRadius.circular(6),
                      child: Padding(
                        padding: const EdgeInsets.all(8),
                        child: Semantics(
                          label: 'Copier le message',
                          button: true,
                          child: Icon(Icons.copy_outlined,
                              size: 15, color: scheme.onSurfaceVariant),
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(width: 4),
                  Tooltip(
                    message: 'Utile',
                    child: InkWell(
                      onTap: () {
                        HapticFeedback.lightImpact();
                        AppToast.show(
                          context,
                          message: 'Merci pour votre retour !',
                          icon: Icons.thumb_up_rounded,
                          type: ToastType.success,
                        );
                      },
                      borderRadius: BorderRadius.circular(6),
                      child: Container(
                        padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 5),
                        decoration: BoxDecoration(
                          color: isDark ? const Color(0xFF22242A) : scheme.surfaceContainerHighest.withValues(alpha: 0.5),
                          borderRadius: BorderRadius.circular(6),
                          border: Border.all(
                            color: isDark ? const Color(0xFF32353E) : scheme.outlineVariant.withValues(alpha: 0.6),
                            width: 0.8,
                          ),
                        ),
                        child: Semantics(
                          label: 'Marquer comme utile',
                          button: true,
                          child: Icon(
                            Icons.thumb_up_outlined,
                            size: 13.5,
                            color: isDark ? const Color(0xFFD4D7E2) : scheme.onSurface,
                          ),
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(width: 6),
                  Tooltip(
                    message: 'Pas utile',
                    child: InkWell(
                      onTap: () {
                        HapticFeedback.lightImpact();
                        AppToast.show(
                          context,
                          message: 'Retour enregistré',
                          icon: Icons.thumb_down_rounded,
                          type: ToastType.info,
                        );
                      },
                      borderRadius: BorderRadius.circular(6),
                      child: Container(
                        padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 5),
                        decoration: BoxDecoration(
                          color: isDark ? const Color(0xFF22242A) : scheme.surfaceContainerHighest.withValues(alpha: 0.5),
                          borderRadius: BorderRadius.circular(6),
                          border: Border.all(
                            color: isDark ? const Color(0xFF32353E) : scheme.outlineVariant.withValues(alpha: 0.6),
                            width: 0.8,
                          ),
                        ),
                        child: Semantics(
                          label: 'Marquer comme pas utile',
                          button: true,
                          child: Icon(
                            Icons.thumb_down_outlined,
                            size: 13.5,
                            color: isDark ? const Color(0xFFD4D7E2) : scheme.onSurface,
                          ),
                        ),
                      ),
                    ),
                  ),
                ],
              ],
            ),
          ],
        ],
      ),
    ),
  );
  }
}

class _ChatSearchBar extends StatelessWidget {
  final TextEditingController controller;
  final int matchCount;
  final int currentIndex;
  final ValueChanged<String> onQueryChanged;
  final VoidCallback onNext;
  final VoidCallback onPrev;
  final VoidCallback onClose;

  const _ChatSearchBar({
    required this.controller,
    required this.matchCount,
    required this.currentIndex,
    required this.onQueryChanged,
    required this.onNext,
    required this.onPrev,
    required this.onClose,
  });

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final isDark = Theme.of(context).brightness == Brightness.dark;

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
      decoration: BoxDecoration(
        color: isDark ? AppColors.surfaceRaised : scheme.surfaceContainer,
        border: Border(
          bottom: BorderSide(
            color: isDark ? AppColors.borderSubtle : scheme.outlineVariant.withValues(alpha: 0.5),
            width: 1,
          ),
        ),
      ),
      child: Row(
        children: [
          Icon(
            Icons.search_rounded,
            size: 16,
            color: isDark ? AppColors.accentBlue : scheme.primary,
          ),
          const SizedBox(width: 8),
          Expanded(
            child: TextField(
              key: const Key('chat-search-input'),
              controller: controller,
              autofocus: true,
              style: TextStyle(fontSize: 13, color: scheme.onSurface),
              decoration: InputDecoration(
                hintText: 'Rechercher dans cette session...',
                hintStyle: TextStyle(
                  fontSize: 12.5,
                  color: scheme.onSurfaceVariant.withValues(alpha: 0.7),
                ),
                isDense: true,
                border: InputBorder.none,
                contentPadding: const EdgeInsets.symmetric(vertical: 6),
              ),
              onChanged: onQueryChanged,
            ),
          ),
          if (controller.text.isNotEmpty) ...[
            Text(
              matchCount > 0 ? '${currentIndex + 1} / $matchCount' : '0 résultat',
              style: TextStyle(
                fontSize: 11,
                fontWeight: FontWeight.w600,
                color: matchCount > 0
                    ? (isDark ? AppColors.accentBlue : scheme.primary)
                    : scheme.error,
              ),
            ),
            const SizedBox(width: 4),
            IconButton(
              key: const Key('search-prev-btn'),
              icon: const Icon(Icons.keyboard_arrow_up_rounded, size: 18),
              onPressed: matchCount > 1 ? onPrev : null,
              visualDensity: VisualDensity.compact,
              tooltip: 'Résultat précédent',
            ),
            IconButton(
              key: const Key('search-next-btn'),
              icon: const Icon(Icons.keyboard_arrow_down_rounded, size: 18),
              onPressed: matchCount > 1 ? onNext : null,
              visualDensity: VisualDensity.compact,
              tooltip: 'Résultat suivant',
            ),
          ],
          IconButton(
            key: const Key('close-search-btn'),
            icon: const Icon(Icons.close_rounded, size: 16),
            onPressed: onClose,
            visualDensity: VisualDensity.compact,
            tooltip: 'Fermer la recherche',
          ),
        ],
      ),
    );
  }
}

class _JumpToBottomButton extends StatelessWidget {
  final int count;
  final VoidCallback onTap;

  const _JumpToBottomButton({required this.count, required this.onTap});

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final isDark = Theme.of(context).brightness == Brightness.dark;
    return BouncingTap(
      key: const Key('jump-to-bottom'),
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
        decoration: BoxDecoration(
          color: isDark ? AppColors.surfaceInput : scheme.surfaceContainerHigh,
          borderRadius: BorderRadius.circular(AppRadius.pill),
          border: Border.all(
            color: isDark ? AppColors.borderSubtle : scheme.outlineVariant,
            width: 1,
          ),
          boxShadow: [
            BoxShadow(
              color: Colors.black.withValues(alpha: 0.35),
              blurRadius: 12,
              offset: const Offset(0, 4),
            ),
          ],
        ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(Icons.keyboard_arrow_down_rounded, size: 18, color: scheme.primary),
              const SizedBox(width: 4),
              if (count > 0) ...[
                Text(
                  '$count',
                  style: TextStyle(
                    fontSize: 11.5,
                    fontWeight: FontWeight.w700,
                    color: scheme.primary,
                  ),
                ),
                const SizedBox(width: 4),
              ],
              Text(
                count > 0 ? 'nouveaux tokens' : 'Retour en bas',
                style: TextStyle(
                  fontSize: 11.5,
                  fontWeight: FontWeight.w600,
                  color: count > 0 ? scheme.primary : scheme.onSurfaceVariant,
                ),
              ),
            ],
          ),
        ),
      );
  }
}

class _WelcomeEmptyState extends StatelessWidget {
  final String projectName;
  final ValueChanged<String> onSuggestionTap;
  final VoidCallback? onSelectProject;

  const _WelcomeEmptyState({
    required this.projectName,
    required this.onSuggestionTap,
    this.onSelectProject,
  });

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final isDark = Theme.of(context).brightness == Brightness.dark;
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        const AntigravityLogo(
          size: 64,
          showGlow: true,
        ),
        const SizedBox(height: 18),
        Text(
          'Antigravity 2.0',
          style: TextStyle(
            fontSize: 16,
            fontWeight: FontWeight.w600,
            color: scheme.onSurface,
            letterSpacing: 0.2,
          ),
        ),
        const SizedBox(height: 6),
        InkWell(
          onTap: onSelectProject,
          borderRadius: BorderRadius.circular(8),
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
            decoration: BoxDecoration(
              color: isDark ? AppColors.surfaceInput : scheme.surfaceContainerHighest,
              borderRadius: BorderRadius.circular(8),
              border: Border.all(
                color: isDark ? AppColors.borderSubtle : scheme.outlineVariant.withValues(alpha: 0.5),
                width: 1,
              ),
            ),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(Icons.folder_outlined, size: 14, color: scheme.primary),
                const SizedBox(width: 6),
                Text(
                  projectName.isNotEmpty ? projectName : 'Select project',
                  style: TextStyle(
                    fontSize: 12.5,
                    fontWeight: FontWeight.w500,
                    color: scheme.onSurface,
                  ),
                ),
                if (onSelectProject != null) ...[
                  const SizedBox(width: 4),
                  Icon(Icons.keyboard_arrow_down_rounded, size: 14, color: scheme.onSurfaceVariant),
                ],
              ],
            ),
          ),
        ),
        const SizedBox(height: 24),
        Wrap(
          spacing: 8,
          runSpacing: 8,
          alignment: WrapAlignment.center,
          children: [
            _SuggestionChip(
              icon: Icons.edit_note_rounded,
              label: '/plan Concevoir une fonctionnalité',
              onTap: () => onSuggestionTap('/plan '),
            ),
            _SuggestionChip(
              icon: Icons.rate_review_outlined,
              label: '/review Auditer le code',
              onTap: () => onSuggestionTap('/review '),
            ),
            _SuggestionChip(
              icon: Icons.quiz_outlined,
              label: '/grill-me Cadrer l\'architecture',
              onTap: () => onSuggestionTap('/grill-me '),
            ),
            _SuggestionChip(
              icon: Icons.search,
              label: 'Rechercher dans le codebase',
              onTap: () => onSuggestionTap('Recherche dans le codebase : '),
            ),
          ],
        ),
      ],
    );
  }
}

class _SuggestionChip extends StatelessWidget {
  final IconData icon;
  final String label;
  final VoidCallback onTap;

  const _SuggestionChip({
    required this.icon,
    required this.label,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: () {
          HapticFeedback.lightImpact();
          onTap();
        },
        borderRadius: BorderRadius.circular(AppRadius.md),
        child: Container(
          constraints: BoxConstraints(
            maxWidth: MediaQuery.of(context).size.width > 60 ? MediaQuery.of(context).size.width - 60 : 300,
          ),
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
          decoration: BoxDecoration(
            color: scheme.surfaceContainerHighest,
            borderRadius: BorderRadius.circular(AppRadius.md),
            border: Border.all(color: scheme.outlineVariant),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(icon, size: 14, color: scheme.primary),
              const SizedBox(width: 8),
              Flexible(
                child: Text(
                  label,
                  style: TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.w500,
                    color: scheme.onSurface,
                  ),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _ArtifactTabContent extends StatefulWidget {
  final DaemonApi? api;
  final String artifactName;
  final String activeSessionId;
  final VoidCallback? onOpenPlan;

  const _ArtifactTabContent({
    required this.api,
    required this.artifactName,
    required this.activeSessionId,
    this.onOpenPlan,
  });

  @override
  State<_ArtifactTabContent> createState() => _ArtifactTabContentState();
}

class _ArtifactTabContentState extends State<_ArtifactTabContent> {
  bool _isLoading = true;
  String _content = '';
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void didUpdateWidget(covariant _ArtifactTabContent oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.artifactName != widget.artifactName ||
        oldWidget.activeSessionId != widget.activeSessionId) {
      _load();
    }
  }

  Future<void> _load() async {
    final api = widget.api;
    if (api == null) {
      setState(() {
        _isLoading = false;
        _error = 'Déconnecté du daemon';
      });
      return;
    }
    setState(() {
      _isLoading = true;
      _error = null;
    });
    try {
      final res = await api.readFile(
        widget.artifactName,
        workspacePath: '.gemini/antigravity/brain/${widget.activeSessionId}',
      );
      if (mounted) {
        setState(() {
          _content = res['content'] as String? ?? '';
          _isLoading = false;
        });
      }
    } catch (_) {
      try {
        final res2 = await api.readFile(
          widget.artifactName,
          workspacePath: '.gemini/antigravity-ide/brain/${widget.activeSessionId}',
        );
        if (mounted) {
          setState(() {
            _content = res2['content'] as String? ?? '';
            _isLoading = false;
          });
          return;
        }
      } catch (e2) {
        if (mounted) {
          setState(() {
            _error = 'Impossible de charger l\'artefact ($e2)';
            _isLoading = false;
          });
        }
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final isDark = Theme.of(context).brightness == Brightness.dark;

    if (_isLoading) {
      return Center(
        child: SizedBox(
          width: 24,
          height: 24,
          child: CircularProgressIndicator(
            strokeWidth: 2,
            valueColor: AlwaysStoppedAnimation(scheme.primary),
          ),
        ),
      );
    }

    if (_error != null) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(Icons.error_outline_rounded, size: 36, color: scheme.error),
              const SizedBox(height: 12),
              Text(_error!,
                  style: TextStyle(color: scheme.error, fontSize: 13),
                  textAlign: TextAlign.center),
              const SizedBox(height: 12),
              FilledButton.tonal(
                onPressed: _load,
                child: const Text('Réessayer'),
              ),
            ],
          ),
        ),
      );
    }

    final isPlan = widget.artifactName.toLowerCase().contains('plan');

    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        Row(
          children: [
            Icon(Icons.article_outlined, size: 20, color: scheme.primary),
            const SizedBox(width: 8),
            Expanded(
              child: Text(
                widget.artifactName,
                style: TextStyle(
                  fontSize: 15,
                  fontWeight: FontWeight.w700,
                  color: scheme.onSurface,
                ),
              ),
            ),
            if (isPlan)
              FilledButton.icon(
                icon: const Icon(Icons.play_arrow_rounded, size: 16),
                label: const Text('Proceed ⌘↵'),
                style: FilledButton.styleFrom(
                  padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                  visualDensity: VisualDensity.compact,
                ),
                onPressed: widget.onOpenPlan,
              ),
          ],
        ),
        const SizedBox(height: 12),
        Divider(color: isDark ? const Color(0xFF2C2F36) : scheme.outlineVariant),
        const SizedBox(height: 12),
        MarkdownBody(content: _content.isNotEmpty ? _content : 'Artefact vide.'),
      ],
    );
  }
}

class _ExtractedMedia {
  final String path;
  final String name;
  final bool isImage;
  final String? dataUri;

  const _ExtractedMedia({
    required this.path,
    required this.name,
    this.isImage = true,
    this.dataUri,
  });
}

final RegExp _mediaImageRe = RegExp(r'!\[([^\]]*)\]\(([^)\s]+)\)');
final RegExp _mediaAttachRe = RegExp(r'\[(Images? jointes?|Image|Fichier|File|Pièce jointe|Piece jointe):\s*([^\]]+)\]', caseSensitive: false);
final RegExp _mediaArtifactRe = RegExp(
  r'\[ARTIFACT:\s*([^\]]+)\](?:\s*\r?\n\s*Path:\s*([^\r\n]+))?',
  caseSensitive: false,
);
final RegExp _mediaMetaResidualRe = RegExp(r'(?:Path|Last Edited):\s*[^\r\n]+', caseSensitive: false);
final RegExp _mediaSlashSplitRe = RegExp(r'[\\/]');

({List<_ExtractedMedia> media, String cleanText}) _extractMediaAndCleanText(String rawText) {
  if (rawText.isEmpty) return (media: const [], cleanText: '');
  if (!rawText.contains('![') &&
      !rawText.contains('[ARTIFACT:') &&
      !rawText.contains('[Artifact:') &&
      !rawText.contains('[Image') &&
      !rawText.contains('[image') &&
      !rawText.contains('[Fichier') &&
      !rawText.contains('[fichier') &&
      !rawText.contains('[File') &&
      !rawText.contains('[file') &&
      !rawText.contains('[Pièce') &&
      !rawText.contains('[Piece') &&
      !rawText.contains('Path:') &&
      !rawText.contains('Last Edited:')) {
    return (media: const [], cleanText: rawText.trim());
  }

  final mediaList = <_ExtractedMedia>[];
  var text = rawText;

  // 1. Markdown images: ![alt](url)
  for (final match in _mediaImageRe.allMatches(text)) {
    final alt = match.group(1) ?? '';
    final url = match.group(2) ?? '';
    final isDataUri = url.startsWith('data:image/');
    final name = alt.isNotEmpty ? alt : (isDataUri ? 'image.png' : url.split(_mediaSlashSplitRe).last);
    mediaList.add(_ExtractedMedia(
      path: url,
      name: name,
      isImage: true,
      dataUri: isDataUri ? url : null,
    ));
  }
  text = text.replaceAll(_mediaImageRe, '').trim();

  // 2. Bracketed attachment tags: [Images jointes: ...], [Fichier: ...]
  for (final match in _mediaAttachRe.allMatches(text)) {
    final label = match.group(1) ?? 'Image';
    final pathsStr = match.group(2) ?? '';
    final paths = pathsStr.split(',').map((s) => s.trim()).where((s) => s.isNotEmpty);
    for (final p in paths) {
      final cleanP = p.startsWith('file://') ? p.substring(7) : p;
      final name = cleanP.split(_mediaSlashSplitRe).last;
      final lower = cleanP.toLowerCase();
      final isImg = lower.endsWith('.png') ||
          lower.endsWith('.jpg') ||
          lower.endsWith('.jpeg') ||
          lower.endsWith('.gif') ||
          lower.endsWith('.webp') ||
          cleanP.startsWith('data:image/');
      mediaList.add(_ExtractedMedia(
        path: p,
        name: name.isNotEmpty ? name : label,
        isImage: isImg,
        dataUri: cleanP.startsWith('data:image/') ? cleanP : null,
      ));
    }
  }
  text = text.replaceAll(_mediaAttachRe, '').trim();

  // 3. Artifact tags: [ARTIFACT: name]\nPath: file:///...
  for (final match in _mediaArtifactRe.allMatches(text)) {
    final artName = match.group(1)?.trim() ?? 'Artifact';
    final artPath = match.group(2)?.trim() ?? artName;
    if (artName == '...' || artPath == 'file:///...' || artPath == '...' || artPath.endsWith('/...')) {
      continue;
    }
    final cleanP = artPath.startsWith('file://') ? artPath.substring(7) : artPath;
    final name = artName.isNotEmpty ? artName : cleanP.split(_mediaSlashSplitRe).last;
    final lower = cleanP.toLowerCase();
    final isImg = lower.endsWith('.png') ||
        lower.endsWith('.jpg') ||
        lower.endsWith('.jpeg') ||
        lower.endsWith('.gif') ||
        lower.endsWith('.webp') ||
        lower.endsWith('.svg') ||
        cleanP.startsWith('data:image/');
    mediaList.add(_ExtractedMedia(
      path: artPath,
      name: name,
      isImage: isImg,
      dataUri: cleanP.startsWith('data:image/') ? cleanP : null,
    ));
  }
  text = text.replaceAll(_mediaArtifactRe, '').trim();

  // 4. Nettoyage de balises de métadonnées résiduelles (Path:, Last Edited:)
  text = text.replaceAll(_mediaMetaResidualRe, '').trim();

  return (media: mediaList, cleanText: text);
}

class _MediaGalleryRow extends StatelessWidget {
  final List<_ExtractedMedia> media;
  final DaemonApi? api;
  final String workspacePath;
  final LocalFileTap? onLocalFile;

  const _MediaGalleryRow({
    required this.media,
    this.api,
    this.workspacePath = '',
    this.onLocalFile,
  });

  @override
  Widget build(BuildContext context) {
    return Wrap(
      spacing: 8,
      runSpacing: 8,
      children: media.map((item) => _MediaThumbnailItem(
        item: item,
        api: api,
        workspacePath: workspacePath,
        onTap: () {
          if (onLocalFile != null) {
            var p = item.path;
            if (p.startsWith('file:///')) {
              p = p.substring(8);
            } else if (p.startsWith('file://')) {
              p = p.substring(7);
            }
            onLocalFile!(p);
          }
        },
      )).toList(),
    );
  }
}

class _MediaThumbnailItem extends StatefulWidget {
  final _ExtractedMedia item;
  final DaemonApi? api;
  final String workspacePath;
  final VoidCallback onTap;

  const _MediaThumbnailItem({
    required this.item,
    this.api,
    this.workspacePath = '',
    required this.onTap,
  });

  @override
  State<_MediaThumbnailItem> createState() => _MediaThumbnailItemState();
}

class _MediaThumbnailItemState extends State<_MediaThumbnailItem> {
  static final Map<String, Uint8List> _thumbnailMemoryCache = {};
  static const int _maxThumbnailCacheSize = 50;
  Uint8List? _bytes;
  bool _isLoading = false;

  static void _putThumbnail(String key, Uint8List bytes) {
    _thumbnailMemoryCache.remove(key);
    while (_thumbnailMemoryCache.length >= _maxThumbnailCacheSize) {
      _thumbnailMemoryCache.remove(_thumbnailMemoryCache.keys.first);
    }
    _thumbnailMemoryCache[key] = bytes;
  }

  @override
  void initState() {
    super.initState();
    _loadThumbnail();
  }

  void _loadThumbnail() async {
    final cacheKey = widget.item.dataUri ?? widget.item.path;
    final cached = _thumbnailMemoryCache.remove(cacheKey);
    if (cached != null) {
      _thumbnailMemoryCache[cacheKey] = cached;
      setState(() => _bytes = cached);
      return;
    }

    if (widget.item.dataUri != null) {
      try {
        final comma = widget.item.dataUri!.indexOf(',');
        if (comma != -1) {
          final b = base64Decode(widget.item.dataUri!.substring(comma + 1));
          _putThumbnail(cacheKey, b);
          setState(() {
            _bytes = b;
          });
        }
      } catch (_) {}
      return;
    }

    var p = widget.item.path;
    if (p.startsWith('file:///')) {
      p = p.substring(8);
    } else if (p.startsWith('file://')) {
      p = p.substring(7);
    }

    // Try reading directly from local filesystem if accessible
    try {
      final f = File(p);
      if (f.existsSync()) {
        final b = await f.readAsBytes();
        _putThumbnail(cacheKey, b);
        if (mounted) setState(() => _bytes = b);
        return;
      }
    } catch (_) {}

    // Otherwise load via Daemon RPC
    if (widget.api != null && widget.item.isImage) {
      if (mounted) setState(() => _isLoading = true);
      try {
        final res = await widget.api!.readFile(p, workspacePath: widget.workspacePath);
        final b64 = res['base64Data'] as String?;
        if (b64 != null && b64.isNotEmpty && mounted) {
          final b = base64Decode(b64);
          _putThumbnail(cacheKey, b);
          setState(() {
            _bytes = b;
            _isLoading = false;
          });
        }
      } catch (_) {
        if (mounted) setState(() => _isLoading = false);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final isDark = Theme.of(context).brightness == Brightness.dark;

    return InkWell(
      onTap: widget.onTap,
      borderRadius: BorderRadius.circular(8),
      child: Container(
        decoration: BoxDecoration(
          color: isDark ? AppColors.surfaceInput : scheme.surfaceContainerHighest,
          borderRadius: BorderRadius.circular(8),
          border: Border.all(
            color: isDark ? AppColors.borderSubtle : scheme.outlineVariant.withValues(alpha: 0.6),
            width: 1,
          ),
        ),
        clipBehavior: Clip.antiAlias,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Thumbnail preview box
            Container(
              width: 76,
              height: 76,
              color: isDark ? const Color(0xFF141518) : scheme.surfaceContainerLow,
              child: _bytes != null
                  ? Image.memory(
                      _bytes!,
                      fit: BoxFit.cover,
                      errorBuilder: (_, __, ___) => _buildPlaceholder(scheme),
                    )
                  : (_isLoading
                      ? Center(
                          child: SizedBox(
                            width: 16,
                            height: 16,
                            child: CircularProgressIndicator(
                              strokeWidth: 1.5,
                              valueColor: AlwaysStoppedAnimation(scheme.primary),
                            ),
                          ),
                        )
                      : _buildPlaceholder(scheme)),
            ),
            // Filename label chip
            Container(
              width: 76,
              padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 3),
              color: isDark ? AppColors.surfaceRaised : scheme.surfaceContainerHighest,
              child: Text(
                widget.item.name,
                style: TextStyle(
                  fontSize: 10,
                  fontWeight: FontWeight.w500,
                  color: isDark ? AppColors.inkPrimary : scheme.onSurface,
                ),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                textAlign: TextAlign.center,
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildPlaceholder(ColorScheme scheme) {
    return Icon(
      widget.item.isImage ? Icons.image_outlined : Icons.insert_drive_file_outlined,
      size: 24,
      color: scheme.onSurfaceVariant.withValues(alpha: 0.6),
    );
  }
}

enum _UnifiedDiffOpType { equal, insert, delete }

class _UnifiedDiffOp {
  final _UnifiedDiffOpType type;
  final String line;
  const _UnifiedDiffOp(this.type, this.line);
}

