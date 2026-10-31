class ScheduledTaskEvent {
  final String id;
  final DateTime timestamp;
  final String outcome; // 'done', 'error', 'running', 'cancelled'
  final String message;
  final int? durationMs;

  ScheduledTaskEvent({
    required this.id,
    required this.timestamp,
    required this.outcome,
    required this.message,
    this.durationMs,
  });

  factory ScheduledTaskEvent.fromJson(Map<String, dynamic> json) {
    return ScheduledTaskEvent(
      id: json['id'] as String? ?? '',
      timestamp: json['timestamp'] != null
          ? DateTime.tryParse(json['timestamp'].toString()) ?? DateTime.now()
          : DateTime.now(),
      outcome: json['outcome'] as String? ?? 'done',
      message: json['message'] as String? ?? '',
      durationMs: json['durationMs'] as int?,
    );
  }

  Map<String, dynamic> toJson() => {
        'id': id,
        'timestamp': timestamp.toIso8601String(),
        'outcome': outcome,
        'message': message,
        if (durationMs != null) 'durationMs': durationMs,
      };
}

class ScheduledTaskItem {
  final String id;
  final String prompt;
  final String? name;
  final String? workspaceName;
  final String? cronExpression;
  final int? durationSeconds;
  final bool isDaemon;
  final int iterationsRun;
  final DateTime? nextRunAt;
  final bool isEnabled;
  final String status; // 'Running', 'Paused', 'Stopped', 'Scheduled'
  final String uptime;
  final List<ScheduledTaskEvent> events;

  ScheduledTaskItem({
    required this.id,
    required this.prompt,
    this.name,
    this.workspaceName,
    this.cronExpression,
    this.durationSeconds,
    this.isDaemon = false,
    this.iterationsRun = 0,
    this.nextRunAt,
    this.isEnabled = true,
    this.status = 'Running',
    this.uptime = '1m',
    this.events = const [],
  });

  String get displayName => (name != null && name!.isNotEmpty) ? name! : prompt;

  String get formattedSchedule {
    if (cronExpression != null && cronExpression!.isNotEmpty) {
      if (cronExpression == '0 9 * * *') return 'Daily around 9:00 AM';
      if (cronExpression == '0 0 * * *') return 'Daily around 12:00 AM';
      if (cronExpression == '0 12 * * *') return 'Daily around 12:00 PM';
      if (cronExpression == '0 * * * *') return 'Hourly';
      if (cronExpression == '*/15 * * * *') return 'Every 15 minutes';
      if (cronExpression == '*/5 * * * *') return 'Every 5 minutes (${cronExpression!})';
      return cronExpression!;
    }
    if (durationSeconds != null) {
      final mins = (durationSeconds! / 60).round();
      return 'Timer in ${mins > 0 ? '$mins min' : '$durationSeconds sec'}';
    }
    return 'Daily around 9:00 AM';
  }

  ScheduledTaskItem copyWith({
    String? id,
    String? prompt,
    String? name,
    String? workspaceName,
    String? cronExpression,
    int? durationSeconds,
    bool? isDaemon,
    int? iterationsRun,
    DateTime? nextRunAt,
    bool? isEnabled,
    String? status,
    String? uptime,
    List<ScheduledTaskEvent>? events,
  }) {
    return ScheduledTaskItem(
      id: id ?? this.id,
      prompt: prompt ?? this.prompt,
      name: name ?? this.name,
      workspaceName: workspaceName ?? this.workspaceName,
      cronExpression: cronExpression ?? this.cronExpression,
      durationSeconds: durationSeconds ?? this.durationSeconds,
      isDaemon: isDaemon ?? this.isDaemon,
      iterationsRun: iterationsRun ?? this.iterationsRun,
      nextRunAt: nextRunAt ?? this.nextRunAt,
      isEnabled: isEnabled ?? this.isEnabled,
      status: status ?? this.status,
      uptime: uptime ?? this.uptime,
      events: events ?? this.events,
    );
  }

  factory ScheduledTaskItem.fromJson(Map<String, dynamic> json) {
    var rawEvents = json['events'] as List? ?? [];
    return ScheduledTaskItem(
      id: json['id'] as String? ?? '',
      prompt: json['prompt'] as String? ?? '',
      name: json['name'] as String?,
      workspaceName: json['workspaceName'] as String?,
      cronExpression: json['cronExpression'] as String?,
      durationSeconds: json['durationSeconds'] as int?,
      isDaemon: json['isDaemon'] as bool? ?? false,
      iterationsRun: json['iterationsRun'] as int? ?? 0,
      nextRunAt: json['nextRunAt'] != null
          ? DateTime.tryParse(json['nextRunAt'].toString())
          : null,
      isEnabled: json['isEnabled'] as bool? ?? true,
      status: json['status'] as String? ?? 'Running',
      uptime: json['uptime'] as String? ?? '1m',
      events: rawEvents.map((e) => ScheduledTaskEvent.fromJson(e is Map<String, dynamic> ? e : (e is Map ? Map<String, dynamic>.from(e) : <String, dynamic>{}))).toList(),
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'prompt': prompt,
      if (name != null) 'name': name,
      if (workspaceName != null) 'workspaceName': workspaceName,
      if (cronExpression != null) 'cronExpression': cronExpression,
      if (durationSeconds != null) 'durationSeconds': durationSeconds,
      'isDaemon': isDaemon,
      'iterationsRun': iterationsRun,
      if (nextRunAt != null) 'nextRunAt': nextRunAt!.toIso8601String(),
      'isEnabled': isEnabled,
      'status': status,
      'uptime': uptime,
      'events': events.map((e) => e.toJson()).toList(),
    };
  }
}
