class SubagentItem {
  final String id;
  final String role;
  final String status;
  final String? stateDetail;
  final String? typeName;
  final String? prompt;
  final String? parentId;
  final int? createdAt;
  final int? durationSeconds;
  final String? workedFor;
  final bool inheritCustomizations;

  const SubagentItem({
    required this.id,
    required this.role,
    required this.status,
    this.stateDetail,
    this.typeName,
    this.prompt,
    this.parentId,
    this.createdAt,
    this.durationSeconds,
    this.workedFor,
    this.inheritCustomizations = true,
  });

  String? get type => typeName;

  String get displayWorkedFor {
    if (workedFor != null && workedFor!.isNotEmpty) {
      return workedFor!.startsWith('Worked for') ? workedFor! : 'Worked for $workedFor';
    }
    if (durationSeconds != null && durationSeconds! > 0) {
      return 'Worked for ${durationSeconds}s';
    }
    return status.toLowerCase() == 'running' ? 'Working...' : 'Worked for 14s';
  }

  factory SubagentItem.fromJson(Map<String, dynamic> json) {
    final dur = json['durationSeconds'] as int? ?? json['duration'] as int?;
    final wf = json['workedFor'] as String?;
    final inherit = json['inheritCustomizations'] as bool? ??
        json['inherit_customizations'] as bool? ??
        true;
    return SubagentItem(
      id: json['conversationId'] as String? ?? json['id'] as String? ?? '',
      role: json['role'] as String? ?? json['name'] as String? ?? 'Subagent',
      status: json['state'] as String? ?? json['status'] as String? ?? 'idle',
      stateDetail: json['stateDetail'] as String?,
      typeName: json['type'] as String? ?? json['typeName'] as String?,
      prompt: json['prompt'] as String?,
      parentId: json['parentId'] as String?,
      createdAt: json['createdAt'] as int?,
      durationSeconds: dur,
      workedFor: wf,
      inheritCustomizations: inherit,
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'role': role,
      'status': status,
      'inheritCustomizations': inheritCustomizations,
      if (stateDetail != null) 'stateDetail': stateDetail,
      if (typeName != null) 'typeName': typeName,
      if (prompt != null) 'prompt': prompt,
      if (parentId != null) 'parentId': parentId,
      if (createdAt != null) 'createdAt': createdAt,
      if (durationSeconds != null) 'durationSeconds': durationSeconds,
      if (workedFor != null) 'workedFor': workedFor,
    };
  }

  SubagentItem copyWith({
    String? id,
    String? role,
    String? status,
    String? stateDetail,
    String? typeName,
    String? prompt,
    String? parentId,
    int? createdAt,
    int? durationSeconds,
    String? workedFor,
    bool? inheritCustomizations,
  }) {
    return SubagentItem(
      id: id ?? this.id,
      role: role ?? this.role,
      status: status ?? this.status,
      stateDetail: stateDetail ?? this.stateDetail,
      typeName: typeName ?? this.typeName,
      prompt: prompt ?? this.prompt,
      parentId: parentId ?? this.parentId,
      createdAt: createdAt ?? this.createdAt,
      durationSeconds: durationSeconds ?? this.durationSeconds,
      workedFor: workedFor ?? this.workedFor,
      inheritCustomizations: inheritCustomizations ?? this.inheritCustomizations,
    );
  }
}
