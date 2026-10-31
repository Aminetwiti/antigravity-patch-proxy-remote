enum MentionType { file, rule, mcp, conversation, terminal, folder, command }

class MentionItem {
  final MentionType type;
  final String label;
  final String detail;
  final String? iconName;
  final bool isDirectory;

  const MentionItem({
    required this.type,
    required this.label,
    required this.detail,
    this.iconName,
    this.isDirectory = false,
  });

  String get tag => type == MentionType.command ? label : '@${type.name}:$label';
}

