class CodeComment {
  final String id;
  final String filePath;
  final String snippet;
  final String commentText;
  final int? lineNumber;
  final DateTime createdAt;

  CodeComment({
    required this.id,
    required this.filePath,
    required this.snippet,
    required this.commentText,
    this.lineNumber,
    DateTime? createdAt,
  }) : createdAt = createdAt ?? DateTime.now();

  String formatPromptQuote() {
    final linePrefix = lineNumber != null && lineNumber! > 0 ? ' (Line $lineNumber)' : '';
    return '> In `$filePath`$linePrefix:\n> ```\n> $snippet\n> ```\n$commentText\n';
  }
}
