class McpServerInfo {
  final String name;
  final String status;
  final int toolCount;
  final List<String> tools;
  final String? description;
  final String? sidecarId;

  const McpServerInfo({
    required this.name,
    required this.status,
    required this.toolCount,
    required this.tools,
    this.description,
    this.sidecarId,
  });

  factory McpServerInfo.fromJson(Map<String, dynamic> json) {
    final toolsList = (json['tools'] as List<dynamic>?)?.map((e) => e.toString()).toList() ?? [];
    final count = json['toolCount'] as int?;
    return McpServerInfo(
      name: json['name'] as String? ?? 'unknown',
      status: json['status'] as String? ?? 'ready',
      toolCount: count ?? toolsList.length,
      tools: toolsList,
      description: json['description'] as String?,
      sidecarId: json['sidecarId'] as String? ?? json['id'] as String?,
    );
  }

  Map<String, dynamic> toJson() => {
        'name': name,
        'status': status,
        'toolCount': toolCount,
        'tools': tools,
        if (description != null) 'description': description,
        if (sidecarId != null) 'sidecarId': sidecarId,
      };
}
