import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../core/protocol/daemon_api.dart';
import '../core/protocol/markdown_renderer.dart';
import '../core/protocol/workspace_path.dart';
import '../theme/app_colors.dart';
import 'remote_terminal_sheet.dart';
import 'syntax_highlighter.dart';
import 'unified_diff_viewer.dart';

/// Renders an assistant message with Markdown: fenced code blocks get a
/// console-style dark surface with a copy button; paragraphs get inline
/// Renders an assistant message with Markdown: fenced code blocks get a
/// console-style dark surface with a copy button; paragraphs get inline
/// bold/italic/code/link styling. Streaming text re-renders cheaply.
class MarkdownBubble extends StatefulWidget {
  final String text;
  final bool isStreaming;

  /// P3 : API daemon pour le bouton « Exécuter » des blocs shell.
  final DaemonApi? api;

  /// P3 : chemin du workspace hôte (utilisé pour créer le PTY).
  final String workspacePath;

  /// P5 : callback quand l'utilisateur tape un lien markdown file:/// —
  /// le parent ouvre le fichier (ArtifactViewerModal). Null → tooltip seul.
  final LocalFileTap? onLocalFile;
  final String? searchQuery;

  const MarkdownBubble({
    super.key,
    required this.text,
    this.isStreaming = false,
    this.api,
    this.workspacePath = '',
    this.onLocalFile,
    this.searchQuery,
  });

  @override
  State<MarkdownBubble> createState() => _MarkdownBubbleState();
}

class _MarkdownBubbleState extends State<MarkdownBubble> {
  late List<MarkdownBlock> _blocks;
  Timer? _throttleTimer;
  String _lastRenderedText = '';

  @override
  void initState() {
    super.initState();
    _lastRenderedText = widget.text;
    _blocks = MarkdownRenderer.blocksOf(widget.text);
  }

  @override
  void didUpdateWidget(covariant MarkdownBubble oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.text != oldWidget.text || widget.isStreaming != oldWidget.isStreaming) {
      if (!widget.isStreaming) {
        _throttleTimer?.cancel();
        _lastRenderedText = widget.text;
        // Texte final stabilisé → passe par le cache LRU normal.
        _blocks = MarkdownRenderer.blocksOf(widget.text);
      } else {
        // P3 : throttle adaptatif — 30 ms pour un texte raisonnable, 100 ms
        // au-delà de 20 KB (le re-parse complet d'un grand message à chaque
        // tick domine le CPU de l'UI isolate ; à 100 ms le flux reste fluide
        // visuellement puisque le texte continue de croître entre deux ticks).
        final interval = widget.text.length > 20000
            ? const Duration(milliseconds: 100)
            : const Duration(milliseconds: 30);
        if (_throttleTimer == null || !_throttleTimer!.isActive) {
          _throttleTimer = Timer(interval, () {
            if (mounted && _lastRenderedText != widget.text) {
              setState(() {
                _lastRenderedText = widget.text;
                // Snapshot intermédiaire → sans écriture dans le cache LRU.
                _blocks = MarkdownRenderer.blocksOf(widget.text);
              });
            }
          });
        }
      }
    }
  }

  @override
  void dispose() {
    _throttleTimer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final blocks = _blocks;

    return RepaintBoundary(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          for (final block in blocks) ...[
            if (block.code != null)
              _CodeBlockView(code: block.code!, api: widget.api, workspacePath: widget.workspacePath)
            else if (block.toolCall != null)
              _ToolCallPill(call: block.toolCall!)
            else if (block.table != null)
              _MarkdownTableView(table: block.table!, onLocalFile: widget.onLocalFile)
            else
              _ParagraphView(block: block, onLocalFile: widget.onLocalFile, searchQuery: widget.searchQuery),
            const SizedBox(height: 10),
          ],
          if (widget.isStreaming) const _StreamingCursor(),
        ],
      ),
    );
  }
}

class _MarkdownTableView extends StatelessWidget {
  final TableBlock table;
  final LocalFileTap? onLocalFile;

  const _MarkdownTableView({
    required this.table,
    this.onLocalFile,
  });

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final scheme = Theme.of(context).colorScheme;

    final borderColor = isDark
        ? AppColors.borderSubtle
        : scheme.outlineVariant.withValues(alpha: 0.6);
    final headerBg = isDark
        ? AppColors.surfaceRaised
        : scheme.surfaceContainerHigh;
    final alternateRowBg = isDark
        ? AppColors.surfaceBase.withValues(alpha: 0.4)
        : scheme.surfaceContainerLow;

    TextAlign alignmentFor(int colIndex) {
      if (colIndex < table.alignments.length) {
        switch (table.alignments[colIndex]) {
          case TableCellAlignment.center:
            return TextAlign.center;
          case TableCellAlignment.right:
            return TextAlign.right;
          case TableCellAlignment.left:
            return TextAlign.left;
        }
      }
      return TextAlign.left;
    }

    final headerStyle = TextStyle(
      fontSize: 12.5,
      fontWeight: FontWeight.w700,
      color: isDark ? AppColors.inkPrimary : scheme.onSurface,
    );
    final cellStyle = TextStyle(
      fontSize: 12,
      fontWeight: FontWeight.w400,
      color: isDark ? AppColors.inkPrimary : scheme.onSurface,
    );

    return Container(
      margin: const EdgeInsets.symmetric(vertical: 6),
      decoration: BoxDecoration(
        color: isDark ? AppColors.surfaceBase : scheme.surface,
        borderRadius: BorderRadius.circular(AppRadius.md),
        border: Border.all(color: borderColor, width: 1),
      ),
      clipBehavior: Clip.antiAlias,
      child: SingleChildScrollView(
        scrollDirection: Axis.horizontal,
        physics: const BouncingScrollPhysics(),
        child: Table(
          defaultColumnWidth: const IntrinsicColumnWidth(),
          border: TableBorder(
            horizontalInside: BorderSide(color: borderColor, width: 0.8),
            verticalInside: BorderSide(color: borderColor.withValues(alpha: 0.5), width: 0.8),
          ),
          children: [
            // En-tête
            TableRow(
              decoration: BoxDecoration(color: headerBg),
              children: [
                for (var i = 0; i < table.headers.length; i++)
                  Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                    child: Text.rich(
                      TextSpan(
                        children: MarkdownRenderer.inlineSpans(
                          table.headers[i],
                          headerStyle,
                          scheme: scheme,
                          onLocalFile: onLocalFile,
                        ),
                      ),
                      textAlign: alignmentFor(i),
                    ),
                  ),
              ],
            ),
            // Lignes de données
            for (var r = 0; r < table.rows.length; r++)
              TableRow(
                decoration: BoxDecoration(
                  color: r.isOdd ? alternateRowBg : Colors.transparent,
                ),
                children: [
                  for (var c = 0; c < table.headers.length; c++)
                    Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 7),
                      child: Text.rich(
                        TextSpan(
                          children: MarkdownRenderer.inlineSpans(
                            c < table.rows[r].length ? table.rows[r][c] : '',
                            cellStyle,
                            scheme: scheme,
                            onLocalFile: onLocalFile,
                          ),
                        ),
                        textAlign: alignmentFor(c),
                      ),
                    ),
                ],
              ),
          ],
        ),
      ),
    );
  }
}

class _ParagraphView extends StatelessWidget {
  final MarkdownBlock block;
  final LocalFileTap? onLocalFile;
  final String? searchQuery;

  const _ParagraphView({required this.block, this.onLocalFile, this.searchQuery});

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final isDark = Theme.of(context).brightness == Brightness.dark;

    if (block.isDivider) {
      return Padding(
        padding: const EdgeInsets.symmetric(vertical: 8),
        child: Divider(
          height: 1,
          thickness: 0.8,
          color: isDark ? AppColors.borderSubtle : scheme.outlineVariant,
        ),
      );
    }

    if (block.headerLevel > 0) {
      double fontSize = 14;
      FontWeight fontWeight = FontWeight.w600;
      double topPadding = 6;
      double bottomPadding = 2;

      switch (block.headerLevel) {
        case 1:
          fontSize = 17.5;
          fontWeight = FontWeight.w700;
          topPadding = 12;
          bottomPadding = 4;
          break;
        case 2:
          fontSize = 15.5;
          fontWeight = FontWeight.w600;
          topPadding = 10;
          bottomPadding = 3;
          break;
        case 3:
          fontSize = 14.5;
          fontWeight = FontWeight.w600;
          topPadding = 8;
          bottomPadding = 2;
          break;
        default:
          fontSize = 13.5;
          fontWeight = FontWeight.w600;
          topPadding = 6;
          bottomPadding = 2;
      }

      final headerBase = TextStyle(
        fontSize: fontSize,
        fontWeight: fontWeight,
        height: 1.35,
        color: isDark ? AppColors.inkPrimary : scheme.onSurface,
        letterSpacing: -0.2,
      );

      final spans = MarkdownRenderer.inlineSpans(
        block.paragraph ?? '',
        headerBase,
        scheme: scheme,
        onLocalFile: onLocalFile,
        searchQuery: searchQuery,
      );

      return Padding(
        padding: EdgeInsets.only(top: topPadding, bottom: bottomPadding),
        child: Text.rich(TextSpan(children: spans)),
      );
    }

    final base = TextStyle(
      fontSize: 13.5,
      height: 1.48,
      color: isDark ? AppColors.inkSecondary : scheme.onSurface,
    );

    final spans = MarkdownRenderer.inlineSpans(
      block.paragraph ?? '',
      base,
      scheme: scheme,
      onLocalFile: onLocalFile,
      searchQuery: searchQuery,
    );

    Widget childWidget;
    if (block.isQuote) {
      childWidget = Container(
        margin: const EdgeInsets.symmetric(vertical: 4),
        padding: const EdgeInsets.only(left: 10, top: 3, bottom: 3),
        decoration: BoxDecoration(
          border: Border(
            left: BorderSide(
              color: scheme.primary.withValues(alpha: 0.6),
              width: 3,
            ),
          ),
        ),
        child: Text.rich(TextSpan(children: spans)),
      );
    } else if (block.isListItem) {
      childWidget = Padding(
        padding: const EdgeInsets.only(left: 4, bottom: 2),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Padding(
              padding: const EdgeInsets.only(top: 4, right: 8),
              child: Container(
                width: 4.5,
                height: 4.5,
                margin: const EdgeInsets.only(top: 4),
                decoration: BoxDecoration(
                  color: isDark ? AppColors.inkMuted : scheme.onSurfaceVariant,
                  shape: BoxShape.circle,
                ),
              ),
            ),
            Expanded(child: Text.rich(TextSpan(children: spans))),
          ],
        ),
      );
    } else {
      childWidget = Text.rich(TextSpan(children: spans));
    }

    return childWidget;
  }
}

class _CodeBlockView extends StatefulWidget {
  final CodeBlock code;
  final DaemonApi? api;
  final String workspacePath;

  const _CodeBlockView({required this.code, this.api, this.workspacePath = ''});

  @override
  State<_CodeBlockView> createState() => _CodeBlockViewState();
}

class _CodeBlockViewState extends State<_CodeBlockView> {
  bool _expanded = false;
  bool _copied = false;
  Timer? _copyTimer;

  @override
  void dispose() {
    _copyTimer?.cancel();
    super.dispose();
  }

  bool get _isDiff {
    final lang = widget.code.language.toLowerCase();
    return lang == 'diff' || lang == 'patch';
  }

  /// P3 : blocs de code shell exécutables — le bouton « Exécuter » n'apparaît
  /// que pour bash/sh/zsh/powershell/cmd (jamais pour dart, json, diff...).
  bool get _isShell {
    const shells = {'bash', 'sh', 'zsh', 'shell', 'powershell', 'pwsh', 'cmd'};
    return shells.contains(widget.code.language.toLowerCase());
  }

  void _copyCode(BuildContext context) {
    HapticFeedback.lightImpact();
    Clipboard.setData(ClipboardData(text: widget.code.code));
    setState(() => _copied = true);
    _copyTimer?.cancel();
    _copyTimer = Timer(const Duration(milliseconds: 1500), () {
      if (mounted) setState(() => _copied = false);
    });
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(
        content: Text('Code copié dans le presse-papiers'),
        duration: Duration(seconds: 1),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final isDiff = _isDiff;
    final lines = widget.code.code.split('\n');
    final isLong = lines.length > 15;
    final displayLines = (isLong && !_expanded) ? lines.take(12).toList() : lines;

    return GestureDetector(
      behavior: HitTestBehavior.translucent,
      onDoubleTap: () => _copyCode(context),
      child: Container(
        width: double.infinity,
        margin: const EdgeInsets.symmetric(vertical: 4),
        decoration: BoxDecoration(
          color: scheme.surfaceContainerHighest,
          borderRadius: BorderRadius.circular(8),
          border: Border.all(color: scheme.outlineVariant),
        ),
        clipBehavior: Clip.antiAlias,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Header row: language badge + review trigger + copy button
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
              color: scheme.surfaceContainer,
              child: Row(
                children: [
                  Icon(
                    isDiff ? Icons.difference_outlined : Icons.code,
                    size: 13,
                    color: isDiff ? scheme.primary : scheme.onSurfaceVariant,
                  ),
                  const SizedBox(width: 6),
                  Text(
                    widget.code.language.isEmpty ? 'code' : widget.code.language,
                    style: TextStyle(
                      fontSize: 11,
                      fontFamily: 'monospace',
                      fontWeight: isDiff ? FontWeight.w600 : FontWeight.normal,
                      color: isDiff ? scheme.primary : scheme.onSurfaceVariant,
                    ),
                  ),
                  const SizedBox(width: 6),
                  Text(
                    '(${lines.length} lines)',
                    style: TextStyle(
                      fontSize: 10,
                      color: scheme.outline,
                      fontFamily: 'monospace',
                    ),
                  ),
                  const Spacer(),
                  if (isDiff) ...[
                    // Review trigger
                    Semantics(
                      label: 'Ouvrir le diff interactif complet',
                      button: true,
                      child: InkWell(
                        key: const Key('open-diff-viewer'),
                        onTap: () {
                          HapticFeedback.selectionClick();
                          showModalBottomSheet(
                            context: context,
                            isScrollControlled: true,
                            backgroundColor: Colors.transparent,
                            builder: (ctx) => FractionallySizedBox(
                              heightFactor: 0.9,
                              child: UnifiedDiffViewer(
                                diffContent: widget.code.code,
                                fileName: 'Code Diff',
                                onClose: () => Navigator.of(ctx).pop(),
                              ),
                            ),
                          );
                        },
                        borderRadius: BorderRadius.circular(6),
                        child: Padding(
                          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                          child: Row(
                            children: [
                              Icon(Icons.rate_review_outlined, size: 14, color: scheme.primary),
                              const SizedBox(width: 4),
                              Text('Review', style: TextStyle(fontSize: 11.5, color: scheme.primary, fontWeight: FontWeight.w600)),
                            ],
                          ),
                        ),
                      ),
                    ),
                    const SizedBox(width: 6),
                  ],
                  if (_isShell) ...[
                    Semantics(
                      label: 'Exécuter ce bloc de commande dans le terminal distant',
                      button: true,
                      child: InkWell(
                        key: const Key('run-in-terminal'),
                        onTap: () {
                          HapticFeedback.lightImpact();
                          RemoteTerminalSheet.show(
                            context,
                            api: widget.api,
                            projectName: WorkspacePath.displayName(widget.workspacePath),
                            workspacePath: widget.workspacePath,
                            initialCommand: widget.code.code.trim(),
                          );
                        },
                        borderRadius: BorderRadius.circular(6),
                        child: Padding(
                          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                          child: Row(
                            children: [
                              Icon(Icons.play_arrow_rounded, size: 15, color: scheme.primary),
                              const SizedBox(width: 4),
                              Text('Exécuter', style: TextStyle(fontSize: 11.5, color: scheme.primary, fontWeight: FontWeight.w600)),
                            ],
                          ),
                        ),
                      ),
                    ),
                    const SizedBox(width: 6),
                  ],
                  Semantics(
                    label: _copied ? 'Code copié' : 'Copier le code dans le presse-papiers',
                    button: true,
                    child: InkWell(
                      onTap: () => _copyCode(context),
                      borderRadius: BorderRadius.circular(6),
                      child: Padding(
                        padding: const EdgeInsets.all(6),
                        child: AnimatedSwitcher(
                          duration: const Duration(milliseconds: 180),
                          transitionBuilder: (child, anim) =>
                              ScaleTransition(scale: anim, child: child),
                          child: _copied
                              ? const Icon(
                                  Icons.check_rounded,
                                  key: ValueKey('copied'),
                                  size: 15,
                                  color: AppColors.positive,
                                )
                              : Icon(
                                  Icons.copy_outlined,
                                  key: const ValueKey('copy'),
                                  size: 15,
                                  color: scheme.onSurfaceVariant,
                                ),
                        ),
                      ),
                    ),
                  ),
                ],
              ),
            ),
          // Code body with line-by-line diff formatting if diff
          if (isDiff)
            Container(
              width: double.infinity,
              padding: const EdgeInsets.symmetric(vertical: 4),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  for (final line in displayLines)
                    _DiffLineRow(line: line),
                ],
              ),
            )
          else
            Scrollbar(
              thumbVisibility: false,
              child: SingleChildScrollView(
                scrollDirection: Axis.horizontal,
                physics: const BouncingScrollPhysics(),
                padding: const EdgeInsets.all(12),
                child: RichText(
                  text: TextSpan(
                    style: TextStyle(
                      fontFamily: 'monospace',
                      fontSize: 12,
                      height: 1.5,
                      color: scheme.onSurface,
                    ),
                    children: SyntaxHighlighter.highlight(
                      (isLong && !_expanded) ? displayLines.join('\n') : widget.code.code,
                      widget.code.language,
                      defaultTextColor: scheme.onSurface,
                    ),
                  ),
                ),
              ),
            ),
          if (isLong)
            InkWell(
              onTap: () {
                setState(() => _expanded = !_expanded);
                HapticFeedback.selectionClick();
              },
              child: Container(
                width: double.infinity,
                padding: const EdgeInsets.symmetric(vertical: 6),
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  color: scheme.surfaceContainer.withValues(alpha: 0.5),
                  border: Border(top: BorderSide(color: scheme.outlineVariant, width: 0.5)),
                ),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Icon(
                      _expanded ? Icons.keyboard_arrow_up : Icons.keyboard_arrow_down,
                      size: 14,
                      color: scheme.primary,
                    ),
                    const SizedBox(width: 4),
                    Text(
                      _expanded ? 'Réduire le code' : 'Afficher tout (+${lines.length - 12} lignes)',
                      style: TextStyle(
                        fontSize: 11,
                        color: scheme.primary,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ],
                ),
              ),
            ),
        ],
      ),
    ),
    );
  }
}

class _DiffLineRow extends StatelessWidget {
  final String line;

  const _DiffLineRow({required this.line});

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final isDark = Theme.of(context).brightness == Brightness.dark;
    Color? bgColor;
    Color textColor = scheme.onSurface;
    FontWeight fontWeight = FontWeight.normal;

    if (line.startsWith('+') && !line.startsWith('+++')) {
      bgColor = isDark ? const Color(0x339BB955) : const Color(0x221A7F37);
      textColor = isDark ? const Color(0xFF4ADE80) : const Color(0xFF1A7F37);
    } else if (line.startsWith('-') && !line.startsWith('---')) {
      bgColor = isDark ? const Color(0x33FF0000) : const Color(0x22CF222E);
      textColor = isDark ? const Color(0xFFF87171) : const Color(0xFFCF222E);
    } else if (line.startsWith('@@')) {
      bgColor = scheme.primary.withValues(alpha: 0.12);
      textColor = scheme.primary;
      fontWeight = FontWeight.w600;
    }

    return Container(
      color: bgColor,
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 1.5),
      child: Text(
        line.isEmpty ? ' ' : line,
        style: TextStyle(
          fontFamily: 'monospace',
          fontSize: 11.5,
          color: textColor,
          fontWeight: fontWeight,
          height: 1.4,
        ),
      ),
    );
  }
}

class _ToolCallPill extends StatefulWidget {
  final ToolCallBlock call;

  const _ToolCallPill({required this.call});

  @override
  State<_ToolCallPill> createState() => _ToolCallPillState();
}

class _ToolCallPillState extends State<_ToolCallPill> {
  bool _expanded = false;

  bool get _isSubagent {
    final t = widget.call.toolName.toLowerCase();
    return t.contains('subagent') || t == 'manage_task';
  }

  bool get _isBrowser {
    final t = widget.call.toolName.toLowerCase();
    return t.contains('browser') || t.contains('read_url');
  }

  IconData _iconFor(String tool) {
    final t = tool.toLowerCase();
    if (t.contains('subagent')) return Icons.smart_toy_outlined;
    if (t.contains('browser')) return Icons.travel_explore_outlined;
    if (t.contains('bash') || t.contains('command') || t.contains('run')) {
      return Icons.terminal;
    } else if (t.contains('file') || t.contains('read') || t.contains('write')) {
      return Icons.folder_outlined;
    } else if (t.contains('search') || t.contains('grep')) {
      return Icons.search;
    }
    return Icons.build_outlined;
  }

  String get _badgeText {
    if (_isSubagent) return 'SUBAGENT';
    if (_isBrowser) return 'BROWSER';
    final t = widget.call.toolName.toLowerCase();
    if (t.contains('command') || t.contains('run')) return 'COMMAND';
    if (t.contains('file')) return 'FILE';
    return 'TOOL';
  }

  Color get _badgeColor {
    if (_isSubagent) return const Color(0xFF528BFF);
    if (_isBrowser) return const Color(0xFF00B4D8);
    final t = widget.call.toolName.toLowerCase();
    if (t.contains('command') || t.contains('run')) return const Color(0xFFE07A5F);
    if (t.contains('file')) return const Color(0xFF81B29A);
    return const Color(0xFFA1A1AA);
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final badgeColor = _badgeColor;
    final hasDetails = widget.call.raw.isNotEmpty;

    return Container(
      width: double.infinity,
      margin: const EdgeInsets.symmetric(vertical: 2),
      decoration: BoxDecoration(
        color: _isSubagent
            ? const Color(0xFF528BFF).withValues(alpha: 0.1)
            : _isBrowser
                ? const Color(0xFF00B4D8).withValues(alpha: 0.08)
                : scheme.secondaryContainer.withValues(alpha: 0.35),
        borderRadius: BorderRadius.circular(8),
        border: Border.all(
          color: _isSubagent
              ? const Color(0xFF528BFF).withValues(alpha: 0.3)
              : _isBrowser
                  ? const Color(0xFF00B4D8).withValues(alpha: 0.25)
                  : scheme.secondary.withValues(alpha: 0.3),
        ),
      ),
      clipBehavior: Clip.antiAlias,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          InkWell(
            onTap: hasDetails
                ? () {
                    setState(() => _expanded = !_expanded);
                    HapticFeedback.selectionClick();
                  }
                : null,
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
              child: Row(
                children: [
                  Icon(_iconFor(widget.call.toolName), size: 15, color: badgeColor),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      widget.call.summary.isEmpty ? widget.call.toolName : '${widget.call.toolName} — ${widget.call.summary}',
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                        fontSize: 12,
                        fontFamily: 'monospace',
                        color: scheme.onSecondaryContainer,
                        fontWeight: _isSubagent || _isBrowser ? FontWeight.w500 : FontWeight.normal,
                      ),
                    ),
                  ),
                  const SizedBox(width: 8),
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                    decoration: BoxDecoration(
                      color: badgeColor.withValues(alpha: 0.15),
                      borderRadius: BorderRadius.circular(4),
                      border: Border.all(color: badgeColor.withValues(alpha: 0.4), width: 0.8),
                    ),
                    child: Text(
                      _badgeText,
                      style: TextStyle(
                        fontSize: 9,
                        letterSpacing: 0.8,
                        fontWeight: FontWeight.w700,
                        color: badgeColor,
                      ),
                    ),
                  ),
                  if (hasDetails) ...[
                    const SizedBox(width: 4),
                    Icon(
                      _expanded ? Icons.keyboard_arrow_up : Icons.keyboard_arrow_down,
                      size: 14,
                      color: scheme.outline,
                    ),
                  ],
                ],
              ),
            ),
          ),
          if (_expanded && hasDetails)
            Container(
              padding: const EdgeInsets.all(10),
              decoration: BoxDecoration(
                color: scheme.surfaceContainerHighest.withValues(alpha: 0.7),
                border: Border(top: BorderSide(color: scheme.outlineVariant, width: 0.5)),
              ),
              child: SelectableText(
                widget.call.raw,
                style: TextStyle(
                  fontFamily: 'monospace',
                  fontSize: 11,
                  color: scheme.onSurfaceVariant,
                  height: 1.35,
                ),
              ),
            ),
        ],
      ),
    );
  }
}

class _StreamingCursor extends StatefulWidget {
  const _StreamingCursor();

  @override
  State<_StreamingCursor> createState() => _StreamingCursorState();
}

class _StreamingCursorState extends State<_StreamingCursor>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 800),
  )..repeat(reverse: true);

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    // Accessibilité : ne pas animer si l'utilisateur a désactivé les
    // animations système (audit UX P2-8).
    final reduceMotion = MediaQuery.disableAnimationsOf(context);
    return Padding(
      padding: const EdgeInsets.only(top: 2),
      child: reduceMotion
          ? const _CursorBox()
          : FadeTransition(
              opacity: Tween<double>(begin: 0.35, end: 1.0)
                  .animate(_controller),
              child: const _CursorBox(),
            ),
    );
  }
}

class _CursorBox extends StatelessWidget {
  const _CursorBox();

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 8,
      height: 14,
      decoration: BoxDecoration(
        color: Theme.of(context).colorScheme.primary,
        borderRadius: BorderRadius.circular(2),
      ),
    );
  }
}
