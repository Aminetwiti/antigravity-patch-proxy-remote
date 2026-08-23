/// Minimal Markdown renderer for the chat timeline.
///
/// ponytail: We don't need a full CommonMark implementation for streaming
/// agent output — inline styling (bold, italic, code, inline code, links)
/// plus fenced code blocks and lists covers ~99% of what Antigravity
/// renders in the console. Rich text is built on plain [TextSpan]s, so the
/// whole timeline stays a lightweight `ListView` (no webview, no plugin).
///
/// Ceiling: nested emphasis (e.g. `**bold _italic_**`) and tables are not
/// supported; upgrade path is `flutter_markdown` if a real need appears.
library;

import 'dart:convert';
import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import '../../widgets/artifact_cards.dart';

class CodeBlock {
  final String language;
  final String code;
  const CodeBlock(this.language, this.code);
}

/// A raw tool invocation embedded in the agent's text stream
/// (e.g. `<function_call>{"name":"bash",...}</function_call>` or
/// `{"tool_name":"grep","arguments":{...}}`). Rendered as a pill, not text.
class ToolCallBlock {
  final String toolName;
  final String summary;
  final String raw;
  const ToolCallBlock(this.toolName, this.summary, this.raw);
}

enum TableCellAlignment { left, center, right }

class TableBlock {
  final List<String> headers;
  final List<List<String>> rows;
  final List<TableCellAlignment> alignments;

  const TableBlock({
    required this.headers,
    required this.rows,
    required this.alignments,
  });
}

class MarkdownBlock {
  final String? paragraph; // null when this block is a code block or table
  final CodeBlock? code;
  final ToolCallBlock? toolCall;
  final TableBlock? table;
  final bool isListItem;
  final int headerLevel;
  final bool isDivider;
  final bool isQuote;

  const MarkdownBlock.paragraph(
    this.paragraph, {
    this.isListItem = false,
    this.headerLevel = 0,
    this.isDivider = false,
    this.isQuote = false,
  })  : code = null,
        toolCall = null,
        table = null;

  const MarkdownBlock.codeBlock(this.code)
      : paragraph = null,
        toolCall = null,
        table = null,
        isListItem = false,
        headerLevel = 0,
        isDivider = false,
        isQuote = false;

  const MarkdownBlock.toolCall(this.toolCall)
      : paragraph = null,
        code = null,
        table = null,
        isListItem = false,
        headerLevel = 0,
        isDivider = false,
        isQuote = false;

  const MarkdownBlock.table(this.table)
      : paragraph = null,
        code = null,
        toolCall = null,
        isListItem = false,
        headerLevel = 0,
        isDivider = false,
        isQuote = false;
}

/// Callback invoked when a markdown link pointing to a local file
/// (file:/// URI) is tapped. Absent → the link renders as a plain tooltip
/// (existing behavior for callers without a daemon handle).
typedef LocalFileTap = void Function(String filePath);

class MarkdownRenderer {
  static final Map<String, List<MarkdownBlock>> _blocksCache = {};
  static const int _maxCacheEntries = 500;

  /// P3 : taille du cache LRU — exposée uniquement pour les tests de
  /// régression (le streaming ne doit pas y écrire ses snapshots).
  @visibleForTesting
  static int get debugBlocksCacheSize => _blocksCache.length;
  static final _toolArgRe = RegExp(r'"(command|query|file|path|TargetFile|AbsolutePath)"\s*:\s*"([^"]+)"');
  static final _whitespaceRe = RegExp(r'\s+');

  // Pre-compiled regular expressions for high-performance timeline streaming
  static final _toolCallRe = RegExp(
    r'<function_call>|<function_results>|"tool(_name)?"\s*:|(\{|\[)\s*"name"\s*:\s*"[a-zA-Z_]+"\s*,\s*"arguments"',
  );
  static final _headingRe = RegExp(r'^(#{1,4})\s+(.+)$');
  static final _dividerRe = RegExp(r'^(---|___|\*\*\*)\s*$');
  static final _quoteRe = RegExp(r'^>\s*(.+)$');
  static final _bulletListRe = RegExp(r'^\s*[-*+]\s+');
  static final _numberedListRe = RegExp(r'^\s*\d+[.)]\s+');
  static final _toolNameRe = RegExp(r'"(name|tool|tool_name)"\s*:\s*"([^"]+)"');
  static final _systemTagsRe = RegExp(
    r'<SYSTEM_MESSAGE>[\s\S]*?</SYSTEM_MESSAGE>|<SYSTEM_PROMPT>[\s\S]*?</SYSTEM_PROMPT>|<ADDITIONAL_METADATA>[\s\S]*?</ADDITIONAL_METADATA>|<USER_SETTINGS_CHANGE>[\s\S]*?</USER_SETTINGS_CHANGE>|<system_generated>[\s\S]*?</system_generated>|<context[\s\S]*?</context>|The following is a <SYSTEM_MESSAGE> not actually sent by the user[\s\S]*?(?:pay attention to\.|$)|\<identity\>[\s\S]*?\</identity\>|\<user_information\>[\s\S]*?\</user_information\>|\<skills\>[\s\S]*?\</skills\>|\<subagents\>[\s\S]*?\</subagents\>|\<messaging\>[\s\S]*?\</messaging\>|\<artifacts\>[\s\S]*?\</artifacts\>|\<slash_commands\>[\s\S]*?\</slash_commands\>|\<planning_mode\>[\s\S]*?\</planning_mode\>|\<guidelines\>[\s\S]*?\</guidelines\>|\<communication_style\>[\s\S]*?\</communication_style\>|\<conversation_transcript\>[\s\S]*?\</conversation_transcript\>',
    caseSensitive: false,
  );
  static final _bgTaskMsgRe = RegExp(
    r'\[Message\]\s*timestamp=[^\n]+\n+sender=[^\n]+\n+priority=[^\n]+\n+content=[^\n]+',
    caseSensitive: false,
  );

  /// Nettoie les balises internes et les messages systèmes résiduels
  static String cleanContent(String text) {
    if (text.isEmpty) return text;
    if (!text.contains('<') && !text.contains('[Message]')) {
      return text.trim();
    }
    var cleaned = text.replaceAll(_systemTagsRe, '').trim();
    cleaned = cleaned.replaceAll(_bgTaskMsgRe, '').trim();
    return cleaned;
  }

  /// Asynchronous block parsing with background isolate offloading for large text (> 50KB).
  static Future<List<MarkdownBlock>> blocksOfAsync(String text) async {
    if (text.length > 50000) {
      return compute(blocksOf, text);
    }
    return blocksOf(text);
  }

  /// Parses raw markdown text for live streaming snapshots without LRU caching.
  static List<MarkdownBlock> blocksOfStreaming(String text) {
    return _parseBlocks(text, cache: false);
  }

  /// Splits raw markdown text into display blocks (cached in LRU).
  static List<MarkdownBlock> blocksOf(String text) {
    return _parseBlocks(text, cache: true);
  }

  static List<MarkdownBlock> _parseBlocks(String text, {required bool cache}) {
    if (cache) {
      final cached = _blocksCache.remove(text);
      if (cached != null) {
        // LRU refresh: réinsère en fin pour que l'éviction retire les entrées
        // les moins récemment utilisées et non les plus anciennes insérées.
        _blocksCache[text] = cached;
        return cached;
      }
    }

    final cleanText = cleanContent(text);
    if (cleanText.isEmpty) return const [];

    final lines = cleanText.replaceAll('\r\n', '\n').split('\n');
    final blocks = <MarkdownBlock>[];
    final buffer = <String>[];
    var inFence = false;
    var fenceLang = '';

    void flushParagraph() {
      if (buffer.isEmpty) return;
      final raw = buffer.join('\n').trim();
      buffer.clear();
      if (raw.isEmpty) return;
      // Single-line tool invocation → dedicated pill block.
      if (_toolCallRe.hasMatch(raw)) {
        final parsed = _toolCallOf(raw);
        blocks.add(MarkdownBlock.toolCall(parsed));
        return;
      }
      final rawLines = raw.split('\n');
      var i = 0;
      while (i < rawLines.length) {
        final line = rawLines[i];
        final trimmed = line.trim();
        if (trimmed.isEmpty) {
          i++;
          continue;
        }

        // Détection de tableau GFM (en-tête + ligne de délimitation |---|)
        if (trimmed.startsWith('|') && trimmed.endsWith('|') && i + 1 < rawLines.length) {
          final nextTrimmed = rawLines[i + 1].trim();
          if (_isTableDelimiter(nextTrimmed)) {
            final headers = _parseTableRow(trimmed);
            final alignments = _parseTableAlignments(nextTrimmed);
            final rows = <List<String>>[];
            i += 2;
            while (i < rawLines.length) {
              final rowTrimmed = rawLines[i].trim();
              if (rowTrimmed.startsWith('|') && rowTrimmed.endsWith('|')) {
                rows.add(_parseTableRow(rowTrimmed));
                i++;
              } else {
                break;
              }
            }
            blocks.add(MarkdownBlock.table(TableBlock(
              headers: headers,
              rows: rows,
              alignments: alignments,
            )));
            continue;
          }
        }

        final headMatch = _headingRe.firstMatch(trimmed);
        if (headMatch != null) {
          final level = headMatch.group(1)!.length;
          final content = headMatch.group(2)!.trim();
          blocks.add(MarkdownBlock.paragraph(content, headerLevel: level));
          i++;
          continue;
        }

        if (_dividerRe.hasMatch(trimmed)) {
          blocks.add(const MarkdownBlock.paragraph('', isDivider: true));
          i++;
          continue;
        }

        final quoteMatch = _quoteRe.firstMatch(trimmed);
        if (quoteMatch != null) {
          blocks.add(MarkdownBlock.paragraph(quoteMatch.group(1)!.trim(), isQuote: true));
          i++;
          continue;
        }

        if (_bulletListRe.hasMatch(line)) {
          blocks.add(MarkdownBlock.paragraph(
            line.replaceFirst(_bulletListRe, ''),
            isListItem: true,
          ));
        } else if (_numberedListRe.hasMatch(line)) {
          blocks.add(MarkdownBlock.paragraph(
            line.replaceFirst(_numberedListRe, ''),
            isListItem: true,
          ));
        } else {
          blocks.add(MarkdownBlock.paragraph(line));
        }
        i++;
      }
    }

    for (final line in lines) {
      if (line.trimLeft().startsWith('```')) {
        if (inFence) {
          blocks.add(MarkdownBlock.codeBlock(CodeBlock(fenceLang, buffer.join('\n'))));
          buffer.clear();
          inFence = false;
        } else {
          flushParagraph();
          inFence = true;
          fenceLang = line.trimLeft().substring(3).trim();
        }
        continue;
      }
      if (inFence) {
        buffer.add(line);
      } else {
        buffer.add(line);
      }
    }

    if (inFence) {
      blocks.add(MarkdownBlock.codeBlock(CodeBlock(fenceLang, buffer.join('\n'))));
      buffer.clear();
    }
    flushParagraph();

    if (cache) {
      while (_blocksCache.length >= _maxCacheEntries) {
        _blocksCache.remove(_blocksCache.keys.first);
      }
      _blocksCache[text] = List<MarkdownBlock>.unmodifiable(blocks);
    }
    return blocks;
  }

  /// Parses a raw tool-invocation string into a [ToolCallBlock].
  static ToolCallBlock _toolCallOf(String raw) {
    final name = _toolNameRe.firstMatch(raw)?.group(2) ?? 'tool';
    // Compact one-line summary: first quoted argument value, else first line.
    final summary = _toolArgRe.firstMatch(raw)?.group(2) ??
        raw.replaceAll(_whitespaceRe, ' ').substring(0, raw.length > 80 ? 80 : raw.length);
    return ToolCallBlock(name, summary, raw);
  }

  static bool _isTableDelimiter(String line) {
    final trimmed = line.trim();
    if (!trimmed.startsWith('|') || !trimmed.endsWith('|')) return false;
    final cells = trimmed.substring(1, trimmed.length - 1).split('|');
    if (cells.isEmpty) return false;
    return cells.every((c) {
      final t = c.trim();
      return _tableCellRe.hasMatch(t) && t.replaceAll(':', '').replaceAll('-', '').isEmpty;
    });
  }

  static List<String> _parseTableRow(String line) {
    final trimmed = line.trim();
    final content = trimmed.startsWith('|') && trimmed.endsWith('|')
        ? trimmed.substring(1, trimmed.length - 1)
        : trimmed;
    return content.split('|').map((c) => c.trim()).toList();
  }

  static List<TableCellAlignment> _parseTableAlignments(String delimiterLine) {
    final cells = _parseTableRow(delimiterLine);
    return cells.map((c) {
      final t = c.trim();
      if (t.startsWith(':') && t.endsWith(':')) return TableCellAlignment.center;
      if (t.endsWith(':')) return TableCellAlignment.right;
      return TableCellAlignment.left;
    }).toList();
  }

  /// Builds inline [TextSpan]s for a paragraph, resolving bold/italic/code.
  /// [onLocalFile] (P5) est appelé quand l'utilisateur tape un lien markdown
  /// vers un fichier local (file:///...) — le caller ouvre le fichier (ex.
  /// ArtifactViewerModal). Sans callback, le lien reste un simple tooltip.
  static final _codeRe = RegExp(r'`([^`]+)`');
  static final _imageRe = RegExp(r'!\[([^\]]*)\]\(([^)\s]+)\)');
  static final _linkRe = RegExp(r'\[([^\]]+)\]\(([^)\s]+)\)');
  static final _boldRe = RegExp(r'\*\*([^*]+)\*\*');
  static final _italicRe = RegExp(r'\*(?=\S)([^*\n]+?)(?<=\S)\*(?!\*)');
  static final _artifactTagRe = RegExp(r'^\[ARTIFACT:\s*([^\]]+)\](?:\s*\r?\n\s*Path:\s*([^\r\n]+))?', caseSensitive: false);
  static final _attachmentTagRe = RegExp(r'^\[(Images? jointes?|Image|Fichier|File|Pièce jointe|Piece jointe):\s*([^\]]+)\]', caseSensitive: false);
  static final _matchAttachPrefixRe = RegExp(r'\[(Images? jointes?|Image|Fichier|File|Pièce jointe|Piece jointe):\s*[^\]]+\]', caseSensitive: false);
  static final _matchArtifactPrefixRe = RegExp(r'\[ARTIFACT:\s*[^\]]+\]', caseSensitive: false);
  static final _tableCellRe = RegExp(r'^:?-+:?$');
  static final Map<String, bool> _localFileExistsCache = {};
  static const int _maxLocalFileExistsEntries = 500;

  static final Map<String, List<InlineSpan>> _inlineSpansCache = {};
  static const int _maxInlineCacheEntries = 1000;

  // Pattern de surlignage compilé une seule fois par requête de recherche
  // (au lieu d'une RegExp neuve par paragraphe à chaque build).
  static String? _lastSearchQuery;
  static RegExp? _lastSearchPattern;

  /// Builds inline [TextSpan]s for a paragraph, resolving bold/italic/code.
  /// [onLocalFile] (P5) est appelé quand l'utilisateur tape un lien markdown
  /// vers un fichier local (file:///...) — le caller ouvre le fichier (ex.
  /// ArtifactViewerModal). Sans callback, le lien reste un simple tooltip.
  static List<InlineSpan> inlineSpans(
    String text,
    TextStyle base, {
    required ColorScheme scheme,
    LocalFileTap? onLocalFile,
    String? searchQuery,
  }) {
    final bool canCache = searchQuery == null && onLocalFile == null;
    final String cacheKey = canCache
        ? '${text.hashCode}_${base.fontSize}_${base.color?.value}_${base.fontWeight}_${base.fontStyle}_${scheme.primary.value}'
        : '';
    if (canCache) {
      final cached = _inlineSpansCache.remove(cacheKey);
      if (cached != null) {
        _inlineSpansCache[cacheKey] = cached;
        return cached;
      }
    }

    final spans = <InlineSpan>[];

    void addTextSpans(List<TextSpan> newSpans) {
      for (final span in newSpans) {
        if (spans.isNotEmpty &&
            spans.last is TextSpan &&
            (spans.last as TextSpan).children == null &&
            (spans.last as TextSpan).recognizer == null &&
            span.children == null &&
            span.recognizer == null &&
            (spans.last as TextSpan).style == span.style) {
          final prev = spans.removeLast() as TextSpan;
          spans.add(TextSpan(text: '${prev.text ?? ''}${span.text ?? ''}', style: span.style));
        } else {
          spans.add(span);
        }
      }
    }

    List<TextSpan> highlightText(String content, TextStyle style) {
      if (searchQuery == null || searchQuery.isEmpty) {
        return [TextSpan(text: content, style: style)];
      }
      if (searchQuery != _lastSearchQuery || _lastSearchPattern == null) {
        _lastSearchQuery = searchQuery;
        _lastSearchPattern = RegExp(RegExp.escape(searchQuery), caseSensitive: false);
      }
      final pattern = _lastSearchPattern!;
      final res = <TextSpan>[];
      int cursor = 0;
      for (final match in pattern.allMatches(content)) {
        if (match.start > cursor) {
          res.add(TextSpan(text: content.substring(cursor, match.start), style: style));
        }
        res.add(TextSpan(
          text: content.substring(match.start, match.end),
          style: style.copyWith(
            backgroundColor: Colors.amber.withValues(alpha: 0.35),
            fontWeight: FontWeight.bold,
          ),
        ));
        cursor = match.end;
      }
      if (cursor < content.length) {
        res.add(TextSpan(text: content.substring(cursor), style: style));
      }
      return res;
    }

    var remaining = text;
    while (remaining.isNotEmpty) {
      // Fast path: find earliest trigger character for markdown syntax (` ! [ *)
      int nextTrigger = -1;
      for (int i = 0; i < remaining.length; i++) {
        final c = remaining.codeUnitAt(i);
        if (c == 0x60 /* ` */ || c == 0x21 /* ! */ || c == 0x5B /* [ */ || c == 0x2A /* * */) {
          nextTrigger = i;
          break;
        }
      }

      if (nextTrigger == -1) {
        // No more markdown trigger characters anywhere in the remaining text
        addTextSpans(highlightText(remaining, base));
        break;
      } else if (nextTrigger > 0) {
        // Emit plain text up to the first trigger character
        addTextSpans(highlightText(remaining.substring(0, nextTrigger), base));
        remaining = remaining.substring(nextTrigger);
      }

      // 1. Inline code — highest priority, its content must not be restyled.
      final codeMatch = _codeRe.firstMatch(remaining);
      if (codeMatch != null && codeMatch.start == 0) {
        final isDark = scheme.brightness == Brightness.dark;
        spans.add(TextSpan(
          text: codeMatch.group(1),
          style: base.copyWith(
            fontFamily: 'monospace',
            fontSize: (base.fontSize ?? 13) * 0.92,
            color: isDark ? const Color(0xFFE2E8F0) : const Color(0xFF1E293B),
            backgroundColor: isDark
                ? const Color(0xFF27272A).withValues(alpha: 0.85)
                : const Color(0xFFE2E8F0).withValues(alpha: 0.85),
          ),
        ));
        remaining = remaining.substring(codeMatch.end);
        continue;
      }

      // 2. Markdown Image ![alt](url)
      final imageMatch = _imageRe.firstMatch(remaining);
      if (imageMatch != null && imageMatch.start == 0) {
        final alt = imageMatch.group(1) ?? '';
        final url = imageMatch.group(2) ?? '';
        final isLocalFile = url.startsWith('file://');
        final isDataUri = url.startsWith('data:image/');
        final filePath = isLocalFile ? _filePathOf(url) : '';

        spans.add(WidgetSpan(
          alignment: PlaceholderAlignment.middle,
          child: Padding(
            padding: const EdgeInsets.symmetric(vertical: 4),
            child: _buildImageWidget(
              url: url,
              alt: alt,
              filePath: filePath,
              isLocalFile: isLocalFile,
              isDataUri: isDataUri,
              scheme: scheme,
              onLocalFile: onLocalFile,
            ),
          ),
        ));
        remaining = remaining.substring(imageMatch.end);
        continue;
      }

      // 3. Artifact Tag [ARTIFACT: name]\nPath: file:///...
      final artifactMatch = _artifactTagRe.firstMatch(remaining);
      if (artifactMatch != null) {
        final artName = artifactMatch.group(1)?.trim() ?? 'Artifact';
        final artPath = artifactMatch.group(2)?.trim() ?? artName;
        // Ignorer les placeholders d'exemples comme "..." ou "file:///..."
        if (artName == '...' || artPath == 'file:///...' || artPath == '...' || artPath.endsWith('/...')) {
          spans.add(TextSpan(
            text: artifactMatch.group(0),
            style: TextStyle(fontFamily: 'monospace', fontSize: 12, color: scheme.onSurfaceVariant),
          ));
          remaining = remaining.substring(artifactMatch.end);
          continue;
        }
        final isLocalFile = artPath.startsWith('file://') || artPath.contains(':\\') || artPath.startsWith('/');
        final filePath = isLocalFile ? _filePathOf(artPath) : artPath;
        final lower = filePath.toLowerCase();
        final isImg = lower.endsWith('.png') ||
            lower.endsWith('.jpg') ||
            lower.endsWith('.jpeg') ||
            lower.endsWith('.gif') ||
            lower.endsWith('.webp') ||
            lower.endsWith('.svg');

        if (isImg) {
          spans.add(WidgetSpan(
            alignment: PlaceholderAlignment.middle,
            child: Padding(
            padding: const EdgeInsets.symmetric(vertical: 4),
            child: _buildImageWidget(
              url: artPath,
              alt: artName,
              filePath: filePath,
              isLocalFile: isLocalFile,
              isDataUri: artPath.startsWith('data:image/'),
              scheme: scheme,
              onLocalFile: onLocalFile,
            ),
          ),
        ));
      } else {
        final fileName = filePath.split(RegExp(r'[\\/]')).last;
        spans.add(WidgetSpan(
          alignment: PlaceholderAlignment.middle,
          child: Padding(
            padding: const EdgeInsets.symmetric(vertical: 3),
            child: InkWell(
              onTap: onLocalFile == null ? null : () => onLocalFile(filePath),
              borderRadius: BorderRadius.circular(8),
              child: Container(
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                decoration: BoxDecoration(
                  color: scheme.surfaceContainerHighest,
                  borderRadius: BorderRadius.circular(8),
                  border: Border.all(color: scheme.outlineVariant.withValues(alpha: 0.6)),
                ),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Icon(Icons.insert_drive_file_outlined, size: 16, color: scheme.primary),
                    const SizedBox(width: 6),
                    Text(
                      fileName.isNotEmpty ? fileName : filePath,
                      style: TextStyle(
                        fontSize: 12.5,
                        fontWeight: FontWeight.w600,
                        color: scheme.onSurface,
                      ),
                    ),
                    const SizedBox(width: 4),
                    Icon(Icons.open_in_new, size: 13, color: scheme.onSurfaceVariant),
                  ],
                ),
              ),
            ),
          ),
        ));
      }
      remaining = remaining.substring(artifactMatch.end);
      continue;
    }

      // 4. Bracketed Attachment Tag [Images jointes: ...], [Image: ...], [Fichier: ...]
      final attachmentMatch = _attachmentTagRe.firstMatch(remaining);
      if (attachmentMatch != null) {
        final label = attachmentMatch.group(1) ?? 'Fichier';
        final pathsStr = attachmentMatch.group(2) ?? '';
        final paths = pathsStr.split(',').map((s) => s.trim()).where((s) => s.isNotEmpty);

        for (final p in paths) {
          final isLocalFile = p.startsWith('file://') || p.contains(':\\') || p.startsWith('/');
          final filePath = isLocalFile ? _filePathOf(p) : p;
          final lower = filePath.toLowerCase();
          final isImg = lower.endsWith('.png') ||
              lower.endsWith('.jpg') ||
              lower.endsWith('.jpeg') ||
              lower.endsWith('.gif') ||
              lower.endsWith('.webp') ||
              lower.endsWith('.svg');

          if (isImg) {
            spans.add(WidgetSpan(
              alignment: PlaceholderAlignment.middle,
              child: Padding(
                padding: const EdgeInsets.symmetric(vertical: 4),
                child: _buildImageWidget(
                  url: p,
                  alt: label,
                  filePath: filePath,
                  isLocalFile: isLocalFile,
                  isDataUri: p.startsWith('data:image/'),
                  scheme: scheme,
                  onLocalFile: onLocalFile,
                ),
              ),
            ));
          } else {
            final fileName = filePath.split(RegExp(r'[\\/]')).last;
            spans.add(WidgetSpan(
              alignment: PlaceholderAlignment.middle,
              child: Padding(
                padding: const EdgeInsets.symmetric(vertical: 3),
                child: InkWell(
                  onTap: onLocalFile == null ? null : () => onLocalFile(filePath),
                  borderRadius: BorderRadius.circular(8),
                  child: Container(
                    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                    decoration: BoxDecoration(
                      color: scheme.surfaceContainerHighest,
                      borderRadius: BorderRadius.circular(8),
                      border: Border.all(color: scheme.outlineVariant.withValues(alpha: 0.6)),
                    ),
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Icon(Icons.insert_drive_file_outlined, size: 16, color: scheme.primary),
                        const SizedBox(width: 6),
                        Text(
                          fileName.isNotEmpty ? fileName : filePath,
                          style: TextStyle(
                            fontSize: 12.5,
                            fontWeight: FontWeight.w600,
                            color: scheme.onSurface,
                          ),
                        ),
                        const SizedBox(width: 4),
                        Icon(Icons.open_in_new, size: 13, color: scheme.onSurfaceVariant),
                      ],
                    ),
                  ),
                ),
              ),
            ));
          }
        }
        remaining = remaining.substring(attachmentMatch.end);
        continue;
      }

      // 5. Link with tooltip showing full target path/URL on hover.
      // P5 : un lien file:/// devient tappable (ouvre le fichier côté hôte)
      // quand onLocalFile est fourni ; sinon comportement historique.
      final linkMatch = _linkRe.firstMatch(remaining);
      if (linkMatch != null && linkMatch.start == 0) {
        final label = linkMatch.group(1) ?? '';
        final url = linkMatch.group(2) ?? '';
        final isLocalFile = url.startsWith('file://');
        if (isLocalFile) {
          final filePath = _filePathOf(url);
          spans.add(WidgetSpan(
            alignment: PlaceholderAlignment.baseline,
            baseline: TextBaseline.alphabetic,
            child: Tooltip(
              waitDuration: const Duration(milliseconds: 100),
              message: 'Ouvrir : $filePath',
              child: GestureDetector(
                onTap: onLocalFile == null ? null : () => onLocalFile(filePath),
                child: Text(
                  label,
                  style: base.copyWith(
                    color: scheme.primary,
                    decoration: TextDecoration.underline,
                    fontWeight: FontWeight.w500,
                  ),
                ),
              ),
            ),
          ));
        } else if (WorkspaceProductHelper.detect(url) != WorkspaceProductType.generic) {
          spans.add(WidgetSpan(
            alignment: PlaceholderAlignment.middle,
            child: Padding(
              padding: const EdgeInsets.symmetric(vertical: 4),
              child: WorkspaceUrlArtifactCard(
                url: url,
                title: label,
                onTap: onLocalFile == null ? null : () => onLocalFile(url),
              ),
            ),
          ));
        } else {
          spans.add(WidgetSpan(
            alignment: PlaceholderAlignment.baseline,
            baseline: TextBaseline.alphabetic,
            child: Tooltip(
              waitDuration: const Duration(milliseconds: 100),
              message: 'Chemin complet : $url',
              child: Text(
                label,
                style: base.copyWith(
                  color: scheme.primary,
                  decoration: TextDecoration.underline,
                ),
              ),
            ),
          ));
        }
        remaining = remaining.substring(linkMatch.end);
        continue;
      }

      // 6. Bold.
      final boldMatch = _boldRe.firstMatch(remaining);
      if (boldMatch != null && boldMatch.start == 0) {
        spans.add(TextSpan(
          text: boldMatch.group(1),
          style: base.copyWith(fontWeight: FontWeight.w700),
        ));
        remaining = remaining.substring(boldMatch.end);
        continue;
      }

      // 7. Italic.
      final italicMatch = _italicRe.firstMatch(remaining);
      if (italicMatch != null && italicMatch.start == 0) {
        spans.add(TextSpan(
          text: italicMatch.group(1),
          style: base.copyWith(fontStyle: FontStyle.italic),
        ));
        remaining = remaining.substring(italicMatch.end);
        continue;
      }

      // 8. Plain text up to the next markdown token if nothing matched at start 0.
      final nextIndex = <int>[
        for (final r in [_codeRe, _imageRe, _linkRe, _matchArtifactPrefixRe, _matchAttachPrefixRe, _boldRe, _italicRe])
          r.firstMatch(remaining)?.start ?? remaining.length,
      ].reduce((a, b) => a < b ? a : b);
      if (nextIndex == 0) {
        // Defensive: a token matched but not at position 0 (shouldn't happen).
        addTextSpans(highlightText(remaining[0], base));
        remaining = remaining.substring(1);
        continue;
      }
      addTextSpans(highlightText(remaining.substring(0, nextIndex), base));
      remaining = remaining.substring(nextIndex);
    }
    if (canCache) {
      while (_inlineSpansCache.length >= _maxInlineCacheEntries) {
        _inlineSpansCache.remove(_inlineSpansCache.keys.first);
      }
      _inlineSpansCache[cacheKey] = List<InlineSpan>.unmodifiable(spans);
    }
    return spans;
  }

  /// Construit un aperçu soigné pour une image markdown (locale, data URI ou distante).
  static Widget _buildImageWidget({
    required String url,
    required String alt,
    required String filePath,
    required bool isLocalFile,
    required bool isDataUri,
    required ColorScheme scheme,
    LocalFileTap? onLocalFile,
  }) {
    if (isDataUri) {
      try {
        final commaIdx = url.indexOf(',');
        if (commaIdx != -1) {
          final b64 = url.substring(commaIdx + 1);
          final bytes = base64Decode(b64);
          return InkWell(
            onTap: onLocalFile == null ? null : () => onLocalFile(url),
            borderRadius: BorderRadius.circular(8),
            child: ClipRRect(
              borderRadius: BorderRadius.circular(8),
              child: Image.memory(
                bytes,
                fit: BoxFit.contain,
                errorBuilder: (_, __, ___) => _imageErrorTile(alt.isNotEmpty ? alt : 'Image', scheme),
              ),
            ),
          );
        }
      } catch (_) {}
    }

    if (isLocalFile && filePath.isNotEmpty) {
      // existsSync est un appel système bloquant dans le chemin de build :
      // le résultat est mémoïsé par chemin (les fichiers ne disparaissent
      bool fileExists;
      final cachedExists = _localFileExistsCache.remove(filePath);
      if (cachedExists != null) {
        _localFileExistsCache[filePath] = cachedExists;
        fileExists = cachedExists;
      } else {
        try {
          fileExists = File(filePath).existsSync();
        } catch (_) {
          fileExists = false;
        }
        while (_localFileExistsCache.length >= _maxLocalFileExistsEntries) {
          _localFileExistsCache.remove(_localFileExistsCache.keys.first);
        }
        _localFileExistsCache[filePath] = fileExists;
      }
      try {
        final file = File(filePath);
        if (fileExists) {
          return InkWell(
            onTap: onLocalFile == null ? null : () => onLocalFile(filePath),
            borderRadius: BorderRadius.circular(8),
            child: ClipRRect(
              borderRadius: BorderRadius.circular(8),
              child: Image.file(
                file,
                key: ValueKey('local_img_${file.path}'),
                fit: BoxFit.contain,
                errorBuilder: (_, __, ___) => _imageErrorTile(alt.isNotEmpty ? alt : filePath, scheme),
              ),
            ),
          );
        }
      } catch (_) {}

      // Image sur l'hôte distant (PC)
      return InkWell(
        onTap: onLocalFile == null ? null : () => onLocalFile(filePath),
        borderRadius: BorderRadius.circular(8),
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
          decoration: BoxDecoration(
            color: scheme.surfaceContainerHighest,
            borderRadius: BorderRadius.circular(8),
            border: Border.all(color: scheme.outlineVariant.withValues(alpha: 0.6)),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(Icons.image_outlined, size: 18, color: scheme.primary),
              const SizedBox(width: 8),
              Flexible(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(
                      alt.isNotEmpty ? alt : filePath.split(RegExp(r'[\\/]')).last,
                      style: TextStyle(
                        fontSize: 12.5,
                        fontWeight: FontWeight.w600,
                        color: scheme.onSurface,
                      ),
                      overflow: TextOverflow.ellipsis,
                    ),
                    Text(
                      'Image enregistrée sur l\'hôte',
                      style: TextStyle(
                        fontSize: 11,
                        color: scheme.onSurfaceVariant,
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 6),
              Icon(Icons.open_in_new, size: 14, color: scheme.onSurfaceVariant),
            ],
          ),
        ),
      );
    }

    if (url.startsWith('http://') || url.startsWith('https://')) {
      return ClipRRect(
        borderRadius: BorderRadius.circular(8),
        child: Image.network(
          url,
          fit: BoxFit.contain,
          errorBuilder: (_, __, ___) => _imageErrorTile(alt.isNotEmpty ? alt : url, scheme),
        ),
      );
    }

    return _imageErrorTile(alt.isNotEmpty ? alt : url, scheme);
  }

  static Widget _imageErrorTile(String label, ColorScheme scheme) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(
        color: scheme.surfaceContainerHighest,
        borderRadius: BorderRadius.circular(6),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(Icons.broken_image_outlined, size: 14, color: scheme.error),
          const SizedBox(width: 6),
          Flexible(
            child: Text(
              label,
              style: TextStyle(fontSize: 12, color: scheme.onSurfaceVariant),
              overflow: TextOverflow.ellipsis,
            ),
          ),
        ],
      ),
    );
  }

  /// Normalise une URI file:/// en chemin hôte (décode %XX, gère les
  /// variantes file:// et file:///). Best-effort : une URI mal encodée est
  /// renvoyée telle quelle plutôt que de faire planter le rendu.
  static String _filePathOf(String url) {
    var p = url;
    if (p.startsWith('file:///')) {
      p = p.substring(8);
    } else if (p.startsWith('file://')) {
      p = p.substring(7);
    }
    try {
      p = Uri.decodeComponent(p);
    } catch (_) {}
    return p;
  }
}
