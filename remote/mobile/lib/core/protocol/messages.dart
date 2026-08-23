/// Protocol Data Models for Antigravity Remote Protocol
class CascadeSession {
  final String id;
  final String workspacePath;
  final String title;
  final String status;
  final String time;
  final DateTime? updatedAt;
  final String? lastPrompt;
  final String? worktree;
  final String? projectId;
  /// Nombre d'étapes enregistrées — sert à détecter l'activité récente (point bleu)
  final int stepCount;
  /// Indicateur d'activité non-consultée — identique au point bleu de l'IDE
  final bool hasUnread;
  /// Session archivée — double garde si l'état Jetbox daemon est stale
  final bool isArchived;
  /// Session épinglée
  final bool isPinned;

  const CascadeSession({
    required this.id,
    required this.workspacePath,
    required this.title,
    required this.status,
    required this.time,
    this.updatedAt,
    this.lastPrompt,
    this.worktree,
    this.projectId,
    this.stepCount = 0,
    this.hasUnread = false,
    this.isPinned = false,
    this.isArchived = false,
  });

  factory CascadeSession.fromJson(Map<String, dynamic> json, [DateTime? now]) {
    DateTime? parsedDate;
    if (json['updatedAt'] is String && (json['updatedAt'] as String).isNotEmpty) {
      parsedDate = DateTime.tryParse(json['updatedAt']);
    } else if (json['lastTurnTime'] is String && (json['lastTurnTime'] as String).isNotEmpty) {
      parsedDate = DateTime.tryParse(json['lastTurnTime']);
    } else if (json['updatedAt'] is int || json['updatedAt'] is num) {
      parsedDate = DateTime.fromMillisecondsSinceEpoch((json['updatedAt'] as num).toInt());
    }

    return CascadeSession(
      id: json['cascadeId'] ?? json['id'] ?? '',
      workspacePath: json['workspacePath'] ?? json['workspace'] ?? '',
      title: json['title'] ?? 'Cascade Session',
      status: json['status'] ?? 'CASCADE_STATUS_READY',
      time: json['time'] ?? (parsedDate != null ? formatRelativeTime(parsedDate, now) : _relativeTime(json['updatedAt'], now)),
      updatedAt: parsedDate,
      lastPrompt: json['lastPrompt']?.toString(),
      worktree: json['worktree']?.toString(),
      projectId: json['projectId']?.toString(),
      stepCount: (json['stepCount'] as num?)?.toInt() ?? 0,
      hasUnread: json['hasUnread'] == true,
      isPinned: json['isPinned'] == true || json['pinned'] == true,
      isArchived: json['isArchived'] == true,
    );
  }

  static String formatRelativeTime(DateTime parsed, [DateTime? now]) {
    if (parsed.year < 2000) return 'Just now';
    final currentNow = now ?? DateTime.now();
    final diff = currentNow.difference(parsed.toLocal());
    if (diff.inMinutes < 1) return 'Just now';
    if (diff.inMinutes < 60) return '${diff.inMinutes}m';
    if (diff.inHours < 24) return '${diff.inHours}h';
    return '${diff.inDays}d';
  }

  static String _relativeTime(Object? iso, [DateTime? now]) {
    if (iso is! String || iso.isEmpty) return 'Just now';
    final parsed = DateTime.tryParse(iso);
    if (parsed == null) return 'Just now';
    return formatRelativeTime(parsed, now);
  }

  bool get isAvailable {
    if (id.isEmpty) return false;
    if (isArchived) return false;
    if (status.isNotEmpty) {
      final st = status.toUpperCase();
      if (st.contains('ARCHIV') ||
          st.contains('DELET') ||
          st.contains('TRASH') ||
          st.contains('KILLED') ||
          st.contains('SUBAGENT')) {
        return false;
      }
    }
    if (title.contains('subagent') ||
        title.contains('Subagent') ||
        workspacePath.contains('subagent') ||
        workspacePath.contains('Subagent')) {
      final lowerTitle = title.toLowerCase();
      final lowerWs = workspacePath.toLowerCase();
      if (lowerTitle.startsWith('subagent') ||
          lowerTitle.contains('subagent-') ||
          lowerTitle.contains('subagent_') ||
          lowerWs.startsWith('subagent') ||
          lowerWs.contains('subagent-') ||
          lowerWs.contains('subagent_')) {
        return false;
      }
    }
    return true;
  }

  bool get isRunning {
    final st = status.toUpperCase();
    return st.contains('RUNNING') ||
        st.contains('BUSY') ||
        st.contains('STREAMING') ||
        st.contains('TASK') ||
        st.contains('EXECUTING') ||
        st.contains('BACKGROUND');
  }

  bool get isBackgroundTask {
    final st = status.toUpperCase();
    return st.contains('BACKGROUND') || st.contains('TASK') || st.contains('EXECUTING');
  }

  bool get isWaitingAction {
    final st = status.toUpperCase();
    return st.contains('WAIT') || st.contains('APPROVAL') || st.contains('QUESTION') || st.contains('USER_ACTION');
  }

  bool get isError {
    final st = status.toUpperCase();
    return st.contains('ERROR') || st.contains('FAIL');
  }

  bool get isReady {
    final st = status.toUpperCase();
    return st.contains('READY') || st.contains('IDLE') || st.contains('PAUSE');
  }

  CascadeSession copyWith({
    String? id,
    String? workspacePath,
    String? title,
    String? status,
    String? time,
    String? lastPrompt,
    String? worktree,
    String? projectId,
    int? stepCount,
    bool? hasUnread,
    bool? isPinned,
    bool? isArchived,
  }) {
    return CascadeSession(
      id: id ?? this.id,
      workspacePath: workspacePath ?? this.workspacePath,
      title: title ?? this.title,
      status: status ?? this.status,
      time: time ?? this.time,
      lastPrompt: lastPrompt ?? this.lastPrompt,
      worktree: worktree ?? this.worktree,
      projectId: projectId ?? this.projectId,
      stepCount: stepCount ?? this.stepCount,
      hasUnread: hasUnread ?? this.hasUnread,
      isPinned: isPinned ?? this.isPinned,
      isArchived: isArchived ?? this.isArchived,
    );
  }

  Map<String, dynamic> toJson() => {
        'cascadeId': id,
        'workspacePath': workspacePath,
        'title': title,
        'status': status,
        'time': time,
        if (lastPrompt != null) 'lastPrompt': lastPrompt,
        if (worktree != null) 'worktree': worktree,
        if (projectId != null) 'projectId': projectId,
        'stepCount': stepCount,
        'hasUnread': hasUnread,
        'isPinned': isPinned,
      };
}

/// Official Antigravity 2.0 Project model (from ~/.gemini/config/projects/)
class ProjectItem {
  final String id;
  final String name;
  final String folderUri;
  final String path;
  final DateTime? updatedAt;

  const ProjectItem({
    required this.id,
    required this.name,
    required this.folderUri,
    required this.path,
    this.updatedAt,
  });

  factory ProjectItem.fromJson(Map<String, dynamic> json) {
    return ProjectItem(
      id: json['id']?.toString() ?? '',
      name: json['name']?.toString() ?? 'Unnamed Project',
      folderUri: json['folderUri']?.toString() ?? '',
      path: json['path']?.toString() ?? '',
      updatedAt: json['updatedAt'] != null
          ? DateTime.tryParse(json['updatedAt'].toString())
          : null,
    );
  }

  Map<String, dynamic> toJson() => {
        'id': id,
        'name': name,
        'folderUri': folderUri,
        'path': path,
        'updatedAt': updatedAt?.toIso8601String(),
      };
}

/// Type de segment pour le flux chronologique entrelacé d'Antigravity 2.0.
enum ChatSegmentType {
  thought, // Pensées, outils, diffs, minuteurs
  text,    // Paragraphe de texte émis par l'assistant
  error,   // Message d'erreur d'exécution de l'agent
}

/// Segment unitaire dans une bulle de message pour le rendu chronologique séquentiel.
class ChatSegment {
  final ChatSegmentType type;
  final String content;
  final String? title;
  final bool isRunning;

  const ChatSegment({
    required this.type,
    required this.content,
    this.title,
    this.isRunning = false,
  });

  ChatSegment copyWith({
    ChatSegmentType? type,
    String? content,
    String? title,
    bool? isRunning,
  }) {
    return ChatSegment(
      type: type ?? this.type,
      content: content ?? this.content,
      title: title ?? this.title,
      isRunning: isRunning ?? this.isRunning,
    );
  }

  Map<String, dynamic> toJson() => {
        'type': type.name,
        'content': content,
        if (title != null) 'title': title,
        if (isRunning) 'isRunning': isRunning,
      };

  factory ChatSegment.fromJson(Map<String, dynamic> json) {
    final typeStr = json['type']?.toString();
    final type = typeStr == 'thought'
        ? ChatSegmentType.thought
        : (typeStr == 'error' ? ChatSegmentType.error : ChatSegmentType.text);
    return ChatSegment(
      type: type,
      content: json['content']?.toString() ?? '',
      title: json['title']?.toString(),
      isRunning: json['isRunning'] == true,
    );
  }
}

class ChatMessage {
  final String id;
  final String sender; // 'user' or 'assistant'
  final String text;
  final String? thought;
  final List<ChatSegment> segments;
  final String timestamp;
  final bool isStreaming;
  final bool isError;
  // true quand le message est en attente d'envoi dans l'outbox hors-ligne.
  final bool isQueued;
  final String? modelLabel;
  final int? stepIndex;

  /// Session result: list of modified file paths, populated at stream_end.
  final List<String> filesChanged;
  final int additions;
  final int deletions;

  const ChatMessage({
    required this.id,
    required this.sender,
    required this.text,
    this.thought,
    this.segments = const [],
    required this.timestamp,
    this.isStreaming = false,
    this.isError = false,
    this.isQueued = false,
    this.modelLabel,
    this.stepIndex,
    this.filesChanged = const [],
    this.additions = 0,
    this.deletions = 0,
  });

  ChatMessage copyWith({
    String? text,
    String? thought,
    List<ChatSegment>? segments,
    bool? isStreaming,
    bool? isError,
    bool? isQueued,
    String? modelLabel,
    int? stepIndex,
    List<String>? filesChanged,
    int? additions,
    int? deletions,
  }) {
    return ChatMessage(
      id: id,
      sender: sender,
      text: text ?? this.text,
      thought: thought ?? this.thought,
      segments: segments ?? this.segments,
      timestamp: timestamp,
      isStreaming: isStreaming ?? this.isStreaming,
      isError: isError ?? this.isError,
      isQueued: isQueued ?? this.isQueued,
      modelLabel: modelLabel ?? this.modelLabel,
      stepIndex: stepIndex ?? this.stepIndex,
      filesChanged: filesChanged ?? this.filesChanged,
      additions: additions ?? this.additions,
      deletions: deletions ?? this.deletions,
    );
  }

  Map<String, dynamic> toJson() => {
        'id': id,
        'sender': sender,
        'text': text,
        if (thought != null) 'thought': thought,
        if (segments.isNotEmpty)
          'segments': segments.map((s) => s.toJson()).toList(),
        'timestamp': timestamp,
        'isStreaming': isStreaming,
        'isError': isError,
        'isQueued': isQueued,
        if (modelLabel != null) 'modelLabel': modelLabel,
        if (stepIndex != null) 'stepIndex': stepIndex,
        'filesChanged': filesChanged,
        'additions': additions,
        'deletions': deletions,
      };

  factory ChatMessage.fromJson(Map<String, dynamic> json) {
    List<ChatSegment> segs = const [];
    if (json['segments'] is List) {
      segs = (json['segments'] as List)
          .whereType<Map>()
          .map((m) => ChatSegment.fromJson(Map<String, dynamic>.from(m)))
          .toList();
    }
    return ChatMessage(
      id: json['id']?.toString() ?? '',
      sender: json['sender']?.toString() ?? 'assistant',
      text: json['text']?.toString() ?? '',
      thought: json['thought']?.toString(),
      segments: segs,
      timestamp: json['timestamp']?.toString() ?? '',
      isStreaming: json['isStreaming'] == true,
      isError: json['isError'] == true,
      isQueued: json['isQueued'] == true,
      modelLabel: json['modelLabel']?.toString(),
      stepIndex: (json['stepIndex'] as num?)?.toInt(),
      filesChanged: (json['filesChanged'] as List?)?.map((e) => e.toString()).toList() ?? const [],
      additions: json['additions'] is int ? json['additions'] as int : int.tryParse(json['additions']?.toString() ?? '0') ?? 0,
      deletions: json['deletions'] is int ? json['deletions'] as int : int.tryParse(json['deletions']?.toString() ?? '0') ?? 0,
    );
  }
}

enum ToolDecision { allow, deny }

/// Portée d'une décision d'approbation : ponctuelle, conversation/session, projet, ou globale (toujours).
enum ApprovalScope {
  once,
  session,
  project,
  global;

  String toWireString() {
    switch (this) {
      case ApprovalScope.session:
        return 'session';
      case ApprovalScope.project:
        return 'project';
      case ApprovalScope.global:
        return 'global';
      case ApprovalScope.once:
        return 'once';
    }
  }

  static ApprovalScope fromWire(String? val) {
    if (val == null) return ApprovalScope.once;
    switch (val.toLowerCase()) {
      case 'session':
      case 'conversation':
        return ApprovalScope.session;
      case 'project':
      case 'workspace':
        return ApprovalScope.project;
      case 'global':
      case 'always':
        return ApprovalScope.global;
      case 'once':
      default:
        return ApprovalScope.once;
    }
  }
}

class ToolApprovalRequest {
  final String callId;
  final String toolName;
  final String command;
  final String description;
  final String cascadeId;
  final String trajectoryId;
  final int stepIndex;
  final String approvalType;
  final String? filePath;
  final String? url;
  final String? mcpServer;
  final String? mcpTool;
  final String? mcpArgs;
  final bool isDestructive;

  /// Portée sélectionnée pour l'approbation.
  final ApprovalScope scope;

  const ToolApprovalRequest({
    required this.callId,
    required this.toolName,
    required this.command,
    required this.description,
    this.cascadeId = '',
    this.trajectoryId = '',
    this.stepIndex = -1,
    this.approvalType = 'approval',
    this.filePath,
    this.url,
    this.mcpServer,
    this.mcpTool,
    this.mcpArgs,
    this.isDestructive = false,
    this.scope = ApprovalScope.once,
  });

  bool get isFileApproval =>
      approvalType == 'file_permission' ||
      approvalType == 'permission' ||
      filePath != null;

  bool get isUrlApproval =>
      approvalType == 'read_url_content' ||
      approvalType == 'open_browser_url' ||
      url != null;

  bool get isMcpApproval =>
      approvalType == 'mcp_tool' ||
      mcpServer != null;

  bool get isStdinApproval =>
      approvalType == 'send_command_input' ||
      toolName.toLowerCase().contains('stdin');

  bool get isDeployApproval =>
      approvalType == 'deploy' ||
      toolName.toLowerCase().contains('deploy');

  bool get isSubagentApproval =>
      approvalType == 'invoke_subagent' ||
      toolName.toLowerCase().contains('subagent');

  bool get checkDestructive {
    if (isDestructive) return true;
    final cmd = command.toLowerCase();
    final tool = toolName.toLowerCase();
    return tool.contains('delete') ||
        cmd.contains('rm -rf') ||
        cmd.contains('rmdir') ||
        cmd.contains('drop database') ||
        cmd.contains('git reset --hard') ||
        cmd.contains('git push --force') ||
        cmd.contains('git push -f');
  }

  factory ToolApprovalRequest.fromJson(Map<String, dynamic> json) {
    final cmd = json['command'] ?? '';
    final tool = json['toolName'] ?? json['tool'] ?? 'run_command';
    final appType = json['approvalType'] ?? 'approval';
    final isDestruct = json['isDestructive'] == true ||
        tool.toString().toLowerCase().contains('delete') ||
        cmd.toString().toLowerCase().contains('rm -rf');

    return ToolApprovalRequest(
      callId: json['callId'] ?? json['approvalId'] ?? '',
      toolName: tool,
      command: cmd,
      description: json['description'] ??
          'An agent tool requires user confirmation',
      cascadeId: json['cascadeId'] ?? '',
      trajectoryId: json['trajectoryId'] ?? '',
      stepIndex: (json['stepIndex'] as num?)?.toInt() ?? -1,
      approvalType: appType,
      filePath: json['filePath'] ?? json['path'] ?? json['file_path'],
      url: json['url'] ?? json['targetUrl'] ?? json['target_url'],
      mcpServer: json['mcpServer'] ?? json['serverName'] ?? json['server_name'],
      mcpTool: json['mcpTool'] ?? json['tool_name'],
      mcpArgs: json['mcpArgs'] ?? json['argumentsJson'] ?? json['arguments_json'],
      isDestructive: isDestruct,
      scope: ApprovalScope.fromWire(json['scope']?.toString()),
    );
  }
}

class AskQuestionChoiceRequest {
  final String requestId;
  final String cascadeId;
  final String trajectoryId;
  final int stepIndex;
  final String question;
  final List<String> options;
  final bool isMultiSelect;
  final bool allowCustom;

  const AskQuestionChoiceRequest({
    required this.requestId,
    this.cascadeId = '',
    this.trajectoryId = '',
    this.stepIndex = -1,
    required this.question,
    required this.options,
    this.isMultiSelect = false,
    this.allowCustom = true,
  });

  factory AskQuestionChoiceRequest.fromJson(Map<String, dynamic> json) {
    List<String> parsedOptions = [];
    String parsedQuestion = json['question'] ?? '';
    bool isMulti = json['isMultiSelect'] == true || json['is_multi_select'] == true;

    if (json['options'] is List) {
      parsedOptions = (json['options'] as List).map((e) => e.toString()).toList();
    } else if (json['questions'] is List && (json['questions'] as List).isNotEmpty) {
      final firstQ = (json['questions'] as List).first;
      if (firstQ is Map) {
        if (firstQ['options'] is List) {
          parsedOptions = (firstQ['options'] as List).map((e) => e.toString()).toList();
        }
        if (parsedQuestion.isEmpty && firstQ['question'] != null) {
          parsedQuestion = firstQ['question'].toString();
        }
        if (firstQ['is_multi_select'] == true || firstQ['isMultiSelect'] == true) {
          isMulti = true;
        }
      }
    }

    if (parsedQuestion.isEmpty) {
      parsedQuestion = 'The agent needs your feedback:';
    }

    return AskQuestionChoiceRequest(
      requestId: json['requestId'] ?? json['callId'] ?? '',
      cascadeId: json['cascadeId'] ?? '',
      trajectoryId: json['trajectoryId'] ?? '',
      stepIndex: (json['stepIndex'] as num?)?.toInt() ?? -1,
      question: parsedQuestion,
      options: parsedOptions,
      isMultiSelect: isMulti,
      allowCustom: json['allowCustom'] ?? true,
    );
  }
}

class ClientMessage {
  final String type;
  final String? requestId;
  final String? cascadeId;
  final Map<String, dynamic>? data;

  const ClientMessage({
    required this.type,
    this.requestId,
    this.cascadeId,
    this.data,
  });

  factory ClientMessage.fromJson(Map<String, dynamic> json) {
    return ClientMessage(
      type: json['type'] as String? ?? '',
      requestId: json['requestId'] as String?,
      cascadeId: json['cascadeId'] as String?,
      data: json['data'] is Map ? Map<String, dynamic>.from(json['data'] as Map) : null,
    );
  }

  Map<String, dynamic> toJson() => {
    'type': type,
    if (requestId != null) 'requestId': requestId,
    if (cascadeId != null) 'cascadeId': cascadeId,
    if (data != null) ...data!,
  };
}

