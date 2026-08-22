enum MentionType { file, rule, mcp, conversation, terminal, folder }

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

  String get tag => '@${type.name}:$label';
}

