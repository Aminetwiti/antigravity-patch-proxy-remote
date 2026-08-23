import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:mobile/features/code_review/models/code_comment.dart';
import 'package:mobile/features/code_review/widgets/add_comment_dialog.dart';
import '../theme/app_colors.dart';

/// Unifié et interactif : affiche un diff de code et permet d'annoter
/// des lignes spécifiques pour envoyer une revue de code groupée à l'agent.
/// Inspiré du Code Review Antigravity 2.0.
class UnifiedDiffViewer extends StatefulWidget {
  final String diffContent;
  final String? fileName;
  final String? filePath;
  final VoidCallback? onClose;
  final Function(String reviewComments)? onSendReview;
  final Function(String patchContent, List<int> selectedHunkIndices)? onApplySelectedHunks;
  final ValueChanged<CodeComment>? onCommentAdded;

  const UnifiedDiffViewer({
    super.key,
    required this.diffContent,
    this.fileName,
    this.filePath,
    this.onClose,
    this.onSendReview,
    this.onApplySelectedHunks,
    this.onCommentAdded,
  });

  @override
  State<UnifiedDiffViewer> createState() => _UnifiedDiffViewerState();
}

class _UnifiedDiffViewerState extends State<UnifiedDiffViewer> {
  static final RegExp _hunkHeaderRe = RegExp(r'@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@');
  int _additions = 0;
  int _deletions = 0;
  List<_DiffLine> _lines = [];
  final List<_DiffHunk> _hunks = [];
  final Map<int, String> _annotations = {}; // lineIndex -> comment
  bool _wrapLines = true;
  bool _hasRealDiff = true;
  bool _showSideBySideImage = true;

  bool get _isImageOrSvg {
    final name = (widget.fileName ?? widget.filePath ?? '').toLowerCase();
    return name.endsWith('.png') ||
        name.endsWith('.jpg') ||
        name.endsWith('.jpeg') ||
        name.endsWith('.gif') ||
        name.endsWith('.webp') ||
        name.endsWith('.svg');
  }

  @override
  void initState() {
    super.initState();
    _parseDiff();
  }

  @override
  void didUpdateWidget(UnifiedDiffViewer oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.diffContent != widget.diffContent) {
      _parseDiff();
    }
  }

  void _parseDiff() {
    int adds = 0;
    int dels = 0;
    final List<_DiffLine> parsed = [];
    _hunks.clear();

    int oldLineNum = 0;
    int newLineNum = 0;

    final trimmed = widget.diffContent.trim();
    if (trimmed.isEmpty || trimmed.contains('// Aucun diff disponible pour ce fichier')) {
      setState(() {
        _additions = 0;
        _deletions = 0;
        _lines = [];
        _hunks.clear();
        _hasRealDiff = false;
      });
      return;
    }

    final rawLines = widget.diffContent.replaceAll('\r\n', '\n').replaceAll('\r', '\n').split('\n');
    for (final raw in rawLines) {
      if (raw.startsWith('@@')) {
        final hunkIndex = _hunks.length;
        final hunk = _DiffHunk(
          index: hunkIndex,
          header: raw,
          lineIndices: [parsed.length],
          isSelected: true,
        );
        _hunks.add(hunk);

        parsed.add(_DiffLine(
          type: _DiffLineType.hunkHeader,
          content: raw,
          hunkIndex: hunkIndex,
        ));
        final match = _hunkHeaderRe.firstMatch(raw);
        if (match != null) {
          oldLineNum = int.tryParse(match.group(1) ?? '1') ?? 1;
          newLineNum = int.tryParse(match.group(2) ?? '1') ?? 1;
        }
      } else if (raw.startsWith('+') && !raw.startsWith('+++')) {
        adds++;
        final hunkIdx = _hunks.isNotEmpty ? _hunks.length - 1 : null;
        if (hunkIdx != null) _hunks[hunkIdx].lineIndices.add(parsed.length);
        parsed.add(_DiffLine(
          type: _DiffLineType.addition,
          content: raw.substring(1),
          newLine: newLineNum++,
          hunkIndex: hunkIdx,
        ));
      } else if (raw.startsWith('-') && !raw.startsWith('---')) {
        dels++;
        final hunkIdx = _hunks.isNotEmpty ? _hunks.length - 1 : null;
        if (hunkIdx != null) _hunks[hunkIdx].lineIndices.add(parsed.length);
        parsed.add(_DiffLine(
          type: _DiffLineType.deletion,
          content: raw.substring(1),
          oldLine: oldLineNum++,
          hunkIndex: hunkIdx,
        ));
      } else if (raw.startsWith('---') || raw.startsWith('+++') || raw.startsWith('diff --git') || raw.startsWith('index ')) {
        parsed.add(_DiffLine(
          type: _DiffLineType.meta,
          content: raw,
        ));
      } else {
        final hunkIdx = _hunks.isNotEmpty ? _hunks.length - 1 : null;
        if (hunkIdx != null) _hunks[hunkIdx].lineIndices.add(parsed.length);
        parsed.add(_DiffLine(
          type: _DiffLineType.context,
          content: raw.startsWith(' ') ? raw.substring(1) : raw,
          oldLine: oldLineNum > 0 ? oldLineNum++ : null,
          newLine: newLineNum > 0 ? newLineNum++ : null,
          hunkIndex: hunkIdx,
        ));
      }
    }

    setState(() {
      _additions = adds;
      _deletions = dels;
      _lines = parsed;
      _hasRealDiff = parsed.isNotEmpty;
    });
  }

  String generateSelectedPatch() {
    final sb = StringBuffer();
    for (final l in _lines) {
      if (l.type == _DiffLineType.meta) {
        sb.writeln(l.content);
      }
    }
    for (final hunk in _hunks) {
      if (!hunk.isSelected) continue;
      for (final idx in hunk.lineIndices) {
        final l = _lines[idx];
        if (l.type == _DiffLineType.hunkHeader) {
          sb.writeln(l.content);
        } else if (l.type == _DiffLineType.addition) {
          sb.writeln('+${l.content}');
        } else if (l.type == _DiffLineType.deletion) {
          sb.writeln('-${l.content}');
        } else if (l.type == _DiffLineType.context) {
          sb.writeln(' ${l.content}');
        }
      }
    }
    return sb.toString().trim();
  }

  void _applySelectedHunks() {
    final patch = generateSelectedPatch();
    final selectedIndices = _hunks
        .where((h) => h.isSelected)
        .map((h) => h.index)
        .toList();
    HapticFeedback.mediumImpact();
    if (widget.onApplySelectedHunks != null) {
      widget.onApplySelectedHunks!(patch, selectedIndices);
    } else if (widget.onSendReview != null) {
      widget.onSendReview!('Patch partiel sélectionné (${selectedIndices.length}/${_hunks.length} hunks):\n```diff\n$patch\n```');
    }
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text('${selectedIndices.length}/${_hunks.length} hunk(s) validé(s)'),
        duration: const Duration(seconds: 2),
      ),
    );
  }

  void _copyDiff() {
    Clipboard.setData(ClipboardData(text: widget.diffContent));
    HapticFeedback.selectionClick();
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(
        content: Text('Diff copié dans le presse-papiers'),
        duration: Duration(seconds: 2),
      ),
    );
  }

  void _addAnnotation(int lineIndex) {
    if (lineIndex < 0 || lineIndex >= _lines.length) return;
    final line = _lines[lineIndex];
    final ctrl = TextEditingController(text: _annotations[lineIndex] ?? '');

    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text(
          'Annoter la ligne ${line.newLine ?? line.oldLine ?? (lineIndex + 1)}',
          style: const TextStyle(fontSize: 15, fontWeight: FontWeight.bold),
        ),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Container(
              padding: const EdgeInsets.all(8),
              decoration: BoxDecoration(
                color: Theme.of(context).colorScheme.surfaceContainer,
                borderRadius: BorderRadius.circular(6),
              ),
              child: Text(
                line.content.trim().isEmpty ? '(ligne vide)' : line.content.trim(),
                style: const TextStyle(fontFamily: 'monospace', fontSize: 12),
                maxLines: 3,
                overflow: TextOverflow.ellipsis,
              ),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: ctrl,
              autofocus: true,
              maxLines: 3,
              decoration: const InputDecoration(
                hintText: 'Remarque pour l\'agent (ex: ajouter une vérification d\'erreur)...',
                border: OutlineInputBorder(),
                isDense: true,
              ),
            ),
          ],
        ),
        actions: [
          if (_annotations.containsKey(lineIndex))
            TextButton(
              onPressed: () {
                setState(() => _annotations.remove(lineIndex));
                Navigator.of(ctx).pop();
              },
              child: Text('Supprimer', style: TextStyle(color: Theme.of(context).colorScheme.error)),
            ),
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(),
            child: const Text('Annuler'),
          ),
          ElevatedButton(
            onPressed: () {
              final text = ctrl.text.trim();
              if (text.isNotEmpty) {
                setState(() => _annotations[lineIndex] = text);
                widget.onCommentAdded?.call(CodeComment(
                  id: 'comment_${DateTime.now().millisecondsSinceEpoch}_$lineIndex',
                  filePath: widget.filePath ?? widget.fileName ?? 'code',
                  snippet: line.content.trim(),
                  commentText: text,
                  lineNumber: line.newLine ?? line.oldLine ?? (lineIndex + 1),
                ));
              } else {
                setState(() => _annotations.remove(lineIndex));
              }
              Navigator.of(ctx).pop();
            },
            child: const Text('Enregistrer'),
          ),
        ],
      ),
    );
  }

  void _sendReviewQueue() {
    if (_annotations.isEmpty || widget.onSendReview == null) return;

    final buffer = StringBuffer();
    final targetName = widget.fileName ?? widget.filePath ?? "files";
    buffer.writeln('Code Review Feedback for `$targetName`:');
    _annotations.forEach((lineIdx, comment) {
      if (lineIdx < _lines.length) {
        final line = _lines[lineIdx];
        final lineNum = line.newLine ?? line.oldLine ?? (lineIdx + 1);
        buffer.writeln('- Line $lineNum (`${line.content.trim()}`): $comment');
      }
    });

    widget.onSendReview!(buffer.toString());
    HapticFeedback.mediumImpact();
    setState(() => _annotations.clear());
  }

  IconData _iconForName(String name) {
    final lower = name.toLowerCase();
    if (lower.endsWith('.dart')) return Icons.flutter_dash_outlined;
    if (lower.endsWith('.go')) return Icons.code_rounded;
    if (lower.endsWith('.json') || lower.endsWith('.yaml') || lower.endsWith('.yml') || lower.endsWith('.toml')) {
      return Icons.settings_suggest_outlined;
    }
    if (lower.endsWith('.md') || lower.endsWith('.txt')) return Icons.article_outlined;
    if (lower.endsWith('.sh') || lower.endsWith('.bat') || lower.endsWith('.ps1') || lower.endsWith('.psm1') || lower.endsWith('.psd1') || lower.endsWith('.zsh')) return Icons.terminal_rounded;
    if (lower.endsWith('.gitignore') || lower.startsWith('.git')) return Icons.alt_route_rounded;
    if (lower.endsWith('.js') || lower.endsWith('.ts') || lower.endsWith('.tsx') || lower.endsWith('.jsx')) {
      return Icons.javascript_rounded;
    }
    return Icons.insert_drive_file_outlined;
  }

  Color _colorForName(String name) {
    final lower = name.toLowerCase();
    if (lower.endsWith('.dart')) return const Color(0xFF29B6F6);
    if (lower.endsWith('.go')) return const Color(0xFF00ADD8);
    if (lower.endsWith('.json') || lower.endsWith('.yaml') || lower.endsWith('.yml') || lower.endsWith('.toml')) {
      return const Color(0xFFEAB308);
    }
    if (lower.endsWith('.md')) return const Color(0xFFA855F7);
    if (lower.endsWith('.sh') || lower.endsWith('.bat') || lower.endsWith('.ps1') || lower.endsWith('.psm1') || lower.endsWith('.psd1') || lower.endsWith('.zsh')) {
      return const Color(0xFF22C55E);
    }
    if (lower.endsWith('.gitignore')) return const Color(0xFFF43F5E);
    if (lower.endsWith('.ts') || lower.endsWith('.tsx')) return const Color(0xFF3178C6);
    if (lower.endsWith('.js') || lower.endsWith('.jsx')) return const Color(0xFFF7DF1E);
    return const Color(0xFF9E9FA9);
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final displayName = widget.fileName ?? 'Code Changes';
    final subPath = widget.filePath != null && widget.filePath != widget.fileName ? widget.filePath! : '';

    return SafeArea(
      top: false,
      bottom: true,
      child: Container(
        decoration: BoxDecoration(
          color: isDark ? const Color(0xFF13151A) : scheme.surface,
          borderRadius: const BorderRadius.vertical(top: Radius.circular(20)),
          border: Border.all(color: isDark ? const Color(0xFF272A30) : scheme.outlineVariant),
          boxShadow: [
            BoxShadow(
              color: Colors.black.withValues(alpha: isDark ? 0.5 : 0.15),
              blurRadius: 16,
              offset: const Offset(0, -4),
            ),
          ],
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            // Drag handle pill
            Center(
              child: Container(
                margin: const EdgeInsets.only(top: 8, bottom: 6),
                width: 36,
                height: 4,
                decoration: BoxDecoration(
                  color: isDark ? const Color(0xFF3B3E47) : scheme.outlineVariant,
                  borderRadius: BorderRadius.circular(2),
                ),
              ),
            ),

            // Header
            Container(
              padding: const EdgeInsets.fromLTRB(14, 4, 12, 10),
              decoration: BoxDecoration(
                border: Border(
                  bottom: BorderSide(
                    color: isDark ? const Color(0xFF23262D) : scheme.outlineVariant,
                  ),
                ),
              ),
              child: Row(
                children: [
                  Container(
                    width: 32,
                    height: 32,
                    decoration: BoxDecoration(
                      color: _colorForName(displayName).withValues(alpha: 0.15),
                      borderRadius: BorderRadius.circular(8),
                    ),
                    child: Icon(
                      _iconForName(displayName),
                      size: 17,
                      color: _colorForName(displayName),
                    ),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Text(
                          displayName,
                          style: TextStyle(
                            color: scheme.onSurface,
                            fontSize: 13.5,
                            fontWeight: FontWeight.w700,
                            letterSpacing: -0.2,
                          ),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                        if (subPath.isNotEmpty)
                          Text(
                            subPath,
                            style: TextStyle(
                              color: isDark ? const Color(0xFF7E808A) : scheme.onSurfaceVariant,
                              fontSize: 11,
                            ),
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                          ),
                      ],
                    ),
                  ),
                  const SizedBox(width: 8),

                  // Additions / Deletions pills
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2.5),
                    decoration: BoxDecoration(
                      color: const Color(0xFF22C55E).withValues(alpha: 0.15),
                      borderRadius: BorderRadius.circular(6),
                    ),
                    child: Text(
                      '+$_additions',
                      style: const TextStyle(
                        color: Color(0xFF22C55E),
                        fontSize: 11.5,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ),
                  const SizedBox(width: 5),
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2.5),
                    decoration: BoxDecoration(
                      color: const Color(0xFFEF4444).withValues(alpha: 0.15),
                      borderRadius: BorderRadius.circular(6),
                    ),
                    child: Text(
                      '-$_deletions',
                      style: const TextStyle(
                        color: Color(0xFFEF4444),
                        fontSize: 11.5,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ),
                  const SizedBox(width: 6),

                  // Toggle Wrap lines
                  IconButton(
                    icon: Icon(
                      _wrapLines ? Icons.wrap_text_rounded : Icons.format_align_left_rounded,
                      size: 18,
                      color: _wrapLines ? scheme.primary : scheme.onSurfaceVariant,
                    ),
                    onPressed: () {
                      HapticFeedback.selectionClick();
                      setState(() => _wrapLines = !_wrapLines);
                    },
                    tooltip: _wrapLines ? 'Désactiver le retour à la ligne' : 'Activer le retour à la ligne',
                    padding: EdgeInsets.zero,
                    constraints: const BoxConstraints(minWidth: 32, minHeight: 32),
                  ),

                  // Toggle image side-by-side mode
                  if (_isImageOrSvg)
                    IconButton(
                      icon: Icon(
                        _showSideBySideImage ? Icons.splitscreen_rounded : Icons.code_rounded,
                        size: 16,
                        color: _showSideBySideImage ? scheme.primary : scheme.onSurfaceVariant,
                      ),
                      onPressed: () {
                        setState(() => _showSideBySideImage = !_showSideBySideImage);
                      },
                      tooltip: _showSideBySideImage ? 'Afficher le diff textuel' : 'Afficher côte à côte',
                      padding: EdgeInsets.zero,
                      constraints: const BoxConstraints(minWidth: 32, minHeight: 32),
                    ),

                  // Copy diff
                  IconButton(
                    icon: Icon(Icons.copy_rounded, size: 16, color: scheme.onSurfaceVariant),
                    onPressed: _copyDiff,
                    tooltip: 'Copier le diff',
                    padding: EdgeInsets.zero,
                    constraints: const BoxConstraints(minWidth: 32, minHeight: 32),
                  ),

                  if (widget.onClose != null) ...[
                    IconButton(
                      icon: Icon(Icons.close_rounded, size: 18, color: scheme.onSurfaceVariant),
                      onPressed: widget.onClose,
                      tooltip: 'Fermer',
                      padding: EdgeInsets.zero,
                      constraints: const BoxConstraints(minWidth: 32, minHeight: 32),
                    ),
                  ],
                ],
              ),
            ),

            // Diff content or Empty State
            Expanded(
              child: _isImageOrSvg && _showSideBySideImage
                  ? _buildImageSideBySideView(context, isDark, scheme)
                  : (!_hasRealDiff || _lines.isEmpty)
                      ? _buildEmptyState(context, isDark, scheme)
                      : _wrapLines
                          ? ListView.builder(
                              padding: const EdgeInsets.symmetric(vertical: 4),
                              itemCount: _lines.length,
                              itemBuilder: (context, index) => _buildDiffItem(index, scheme),
                            )
                          : LayoutBuilder(
                              builder: (context, constraints) {
                                return SingleChildScrollView(
                                  scrollDirection: Axis.horizontal,
                                  child: SizedBox(
                                    width: 800,
                                    height: constraints.maxHeight,
                                    child: ListView.builder(
                                      padding: const EdgeInsets.symmetric(vertical: 4),
                                      itemCount: _lines.length,
                                      itemBuilder: (context, index) => _buildDiffItem(index, scheme),
                                    ),
                                  ),
                                );
                              },
                            ),
            ),

            // Bottom Hunks selection bar
            if (_hunks.isNotEmpty)
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
                decoration: BoxDecoration(
                  color: isDark ? const Color(0xFF181B20) : scheme.surfaceContainer,
                  border: Border(
                    top: BorderSide(
                      color: isDark ? const Color(0xFF272A30) : scheme.outlineVariant,
                    ),
                  ),
                ),
                child: Row(
                  children: [
                    Icon(Icons.checklist_rounded, size: 16, color: scheme.primary),
                    const SizedBox(width: 8),
                    Text(
                      '${_hunks.where((h) => h.isSelected).length}/${_hunks.length} hunk(s) sélectionné(s)',
                      style: TextStyle(
                        color: scheme.onSurface,
                        fontSize: 12,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                    const Spacer(),
                    TextButton(
                      onPressed: () {
                        final allSelected = _hunks.every((h) => h.isSelected);
                        setState(() {
                          for (final h in _hunks) {
                            h.isSelected = !allSelected;
                          }
                        });
                      },
                      child: Text(
                        _hunks.every((h) => h.isSelected) ? 'Tout décocher' : 'Tout cocher',
                        style: const TextStyle(fontSize: 11),
                      ),
                    ),
                    const SizedBox(width: 6),
                    ElevatedButton.icon(
                      icon: const Icon(Icons.done_all_rounded, size: 14),
                      label: const Text('Valider sélection', style: TextStyle(fontSize: 12)),
                      onPressed: _applySelectedHunks,
                      style: ElevatedButton.styleFrom(
                        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                        backgroundColor: scheme.primary,
                        foregroundColor: scheme.onPrimary,
                      ),
                    ),
                  ],
                ),
              ),

            // Bottom Review Queue bar
            if (_annotations.isNotEmpty && widget.onSendReview != null)
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
                decoration: BoxDecoration(
                  color: isDark ? const Color(0xFF1B1D22) : scheme.surfaceContainer,
                  border: Border(
                    top: BorderSide(
                      color: isDark ? const Color(0xFF272A30) : scheme.outlineVariant,
                    ),
                  ),
                ),
                child: Row(
                  children: [
                    Icon(Icons.rate_review_outlined, size: 16, color: scheme.primary),
                    const SizedBox(width: 8),
                    Text(
                      '${_annotations.length} note(s) de revue',
                      style: TextStyle(
                        color: scheme.onSurface,
                        fontSize: 12,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                    const Spacer(),
                    ElevatedButton.icon(
                      icon: const Icon(Icons.send_rounded, size: 14),
                      label: const Text('Envoyer à l\'Agent', style: TextStyle(fontSize: 12)),
                      onPressed: _sendReviewQueue,
                      style: ElevatedButton.styleFrom(
                        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                      ),
                    ),
                  ],
                ),
              ),
          ],
        ),
      ),
    );
  }

  Widget _buildEmptyState(BuildContext context, bool isDark, ColorScheme scheme) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              width: 56,
              height: 56,
              decoration: BoxDecoration(
                color: isDark ? const Color(0xFF1E2026) : scheme.surfaceContainerHighest,
                shape: BoxShape.circle,
              ),
              child: Icon(
                Icons.difference_outlined,
                size: 28,
                color: isDark ? const Color(0xFF6B6E7B) : scheme.outline,
              ),
            ),
            const SizedBox(height: 14),
            Text(
              'Aucune modification détaillée',
              style: TextStyle(
                fontSize: 14,
                fontWeight: FontWeight.w700,
                color: scheme.onSurface,
              ),
            ),
            const SizedBox(height: 6),
            Text(
              'Ce fichier a été mentionné dans la session mais ne comporte aucun delta non validé ou son contenu n\'a pas pu être chargé.',
              style: TextStyle(
                fontSize: 12,
                color: isDark ? const Color(0xFF8F909A) : scheme.onSurfaceVariant,
                height: 1.4,
              ),
              textAlign: TextAlign.center,
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildDiffItem(int index, ColorScheme scheme) {
    final line = _lines[index];
    final hasComment = _annotations.containsKey(index);
    final isDark = Theme.of(context).brightness == Brightness.dark;

    if (line.type == _DiffLineType.hunkHeader && line.hunkIndex != null && line.hunkIndex! < _hunks.length) {
      final hunk = _hunks[line.hunkIndex!];
      return Container(
        margin: const EdgeInsets.symmetric(vertical: 4, horizontal: 6),
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
        decoration: BoxDecoration(
          color: scheme.primary.withValues(alpha: 0.12),
          borderRadius: BorderRadius.circular(6),
          border: Border.all(color: scheme.primary.withValues(alpha: 0.3)),
        ),
        child: Row(
          children: [
            Checkbox(
              value: hunk.isSelected,
              activeColor: scheme.primary,
              materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
              visualDensity: VisualDensity.compact,
              onChanged: (val) {
                HapticFeedback.selectionClick();
                setState(() => hunk.isSelected = val ?? true);
              },
            ),
            const SizedBox(width: 4),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
              decoration: BoxDecoration(
                color: hunk.isSelected ? scheme.primary : scheme.surfaceContainerHighest,
                borderRadius: BorderRadius.circular(4),
              ),
              child: Text(
                'Hunk #${hunk.index + 1}',
                style: TextStyle(
                  fontSize: 10.5,
                  fontWeight: FontWeight.w700,
                  color: hunk.isSelected ? scheme.onPrimary : scheme.onSurfaceVariant,
                ),
              ),
            ),
            const SizedBox(width: 8),
            Expanded(
              child: Text(
                line.content,
                style: TextStyle(
                  fontSize: 11,
                  fontFamily: 'monospace',
                  fontWeight: FontWeight.w600,
                  color: scheme.primary,
                ),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
              ),
            ),
            InkWell(
              onTap: () {
                HapticFeedback.selectionClick();
                setState(() => hunk.isSelected = !hunk.isSelected);
              },
              borderRadius: BorderRadius.circular(4),
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                child: Text(
                  hunk.isSelected ? 'Inclus' : 'Exclu',
                  style: TextStyle(
                    fontSize: 11,
                    fontWeight: FontWeight.w600,
                    color: hunk.isSelected ? const Color(0xFF22C55E) : scheme.outline,
                  ),
                ),
              ),
            ),
          ],
        ),
      );
    }

    final isHunkExcluded = line.hunkIndex != null &&
        line.hunkIndex! < _hunks.length &&
        !_hunks[line.hunkIndex!].isSelected;

    final contentWidget = InkWell(
      onTap: () => _addAnnotation(index),
      hoverColor: isDark ? const Color(0xFF1E2128) : scheme.surfaceContainerHighest,
      splashColor: scheme.primary.withValues(alpha: 0.12),
      highlightColor: scheme.primary.withValues(alpha: 0.08),
      onLongPress: () {
        showDialog(
          context: context,
          builder: (ctx) => AddCommentDialog(
            filePath: widget.filePath ?? widget.fileName ?? 'code',
            selectedSnippet: line.content.trim(),
            lineNumber: line.newLine ?? line.oldLine ?? (index + 1),
            initialComment: _annotations[index],
            onDelete: () {
              setState(() => _annotations.remove(index));
            },
            onCommentAdded: (c) {
              setState(() => _annotations[index] = c.commentText);
              widget.onCommentAdded?.call(c);
            },
          ),
        );
      },
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          _buildLineRow(line, hasComment, scheme),
          if (hasComment)
            Container(
              margin: const EdgeInsets.only(left: 68, right: 14, bottom: 4),
              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
              decoration: BoxDecoration(
                color: scheme.primary.withValues(alpha: 0.15),
                borderRadius: BorderRadius.circular(6),
                border: Border.all(color: scheme.primary.withValues(alpha: 0.3)),
              ),
              child: Row(
                children: [
                  Icon(Icons.comment_outlined, size: 14, color: scheme.primary),
                  const SizedBox(width: 6),
                  Expanded(
                    child: Text(
                      _annotations[index]!,
                      style: TextStyle(
                        color: scheme.primary,
                        fontSize: 12,
                        fontWeight: FontWeight.w500,
                      ),
                    ),
                  ),
                ],
              ),
            ),
        ],
      ),
    );

    if (isHunkExcluded) {
      return Opacity(
        opacity: 0.38,
        child: contentWidget,
      );
    }
    return contentWidget;
  }

  Widget _buildLineRow(_DiffLine line, bool hasComment, ColorScheme scheme) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    Color bg = Colors.transparent;
    Color textColor = isDark ? AppColors.inkPrimary : scheme.onSurface;
    String prefix = ' ';

    switch (line.type) {
      case _DiffLineType.addition:
        bg = isDark ? AppColors.diffInsertedLine : const Color(0x1816A34A);
        textColor = isDark ? const Color(0xFF81C995) : const Color(0xFF15803D);
        prefix = '+';
        break;
      case _DiffLineType.deletion:
        bg = isDark ? AppColors.diffRemovedLine : const Color(0x18DC2626);
        textColor = isDark ? const Color(0xFFF28B82) : const Color(0xFFB91C1C);
        prefix = '-';
        break;
      case _DiffLineType.hunkHeader:
        bg = isDark ? const Color(0x228AB4F8) : scheme.primary.withValues(alpha: 0.10);
        textColor = isDark ? AppColors.accentBlue : scheme.primary;
        prefix = ' ';
        break;
      case _DiffLineType.meta:
        textColor = isDark ? AppColors.inkMuted : scheme.outline;
        prefix = ' ';
        break;
      case _DiffLineType.context:
        textColor = isDark ? AppColors.inkSecondary : scheme.onSurfaceVariant;
        prefix = ' ';
        break;
    }

    return Container(
      color: bg,
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2.5),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 28,
            child: Text(
              line.oldLine?.toString() ?? '',
              textAlign: TextAlign.right,
              style: TextStyle(
                color: isDark ? AppColors.inkDisabled : scheme.outline,
                fontSize: 11,
                fontFamily: 'monospace',
                height: 1.4,
              ),
            ),
          ),
          const SizedBox(width: 4),
          SizedBox(
            width: 28,
            child: Text(
              line.newLine?.toString() ?? '',
              textAlign: TextAlign.right,
              style: TextStyle(
                color: isDark ? AppColors.inkDisabled : scheme.outline,
                fontSize: 11,
                fontFamily: 'monospace',
                height: 1.4,
              ),
            ),
          ),
          const SizedBox(width: 6),
          SizedBox(
            width: 12,
            child: Text(
              prefix,
              style: TextStyle(
                color: textColor,
                fontSize: 12,
                fontWeight: FontWeight.bold,
                fontFamily: 'monospace',
                height: 1.4,
              ),
            ),
          ),
          const SizedBox(width: 4),
          Expanded(
            child: Text(
              line.content,
              style: TextStyle(
                color: textColor,
                fontSize: 12,
                fontFamily: 'monospace',
                height: 1.4,
              ),
            ),
          ),
          if (hasComment)
            Padding(
              padding: const EdgeInsets.only(left: 6, right: 4),
              child: Icon(Icons.comment, size: 14, color: scheme.primary),
            ),
        ],
      ),
    );
  }

  Widget _buildImageSideBySideView(BuildContext context, bool isDark, ColorScheme scheme) {
    final fileName = widget.fileName ?? widget.filePath ?? 'image';
    final isSvg = fileName.toLowerCase().endsWith('.svg');

    return Padding(
      padding: const EdgeInsets.all(12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
            decoration: BoxDecoration(
              color: isDark ? const Color(0xFF1E2128) : scheme.surfaceContainerHigh,
              borderRadius: BorderRadius.circular(6),
              border: Border.all(
                color: isDark ? const Color(0xFF2C2F38) : scheme.outlineVariant.withValues(alpha: 0.6),
              ),
            ),
            child: Row(
              children: [
                Icon(
                  isSvg ? Icons.polyline_rounded : Icons.image_rounded,
                  size: 15,
                  color: scheme.primary,
                ),
                const SizedBox(width: 8),
                Text(
                  isSvg ? 'Prévisualisation SVG côte à côte' : 'Comparaison d\'image côte à côte',
                  style: TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.w600,
                    color: scheme.onSurface,
                  ),
                ),
                const Spacer(),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                  decoration: BoxDecoration(
                    color: scheme.primary.withValues(alpha: 0.15),
                    borderRadius: BorderRadius.circular(4),
                  ),
                  child: Text(
                    isSvg ? 'VECTOR SVG' : fileName.split('.').last.toUpperCase(),
                    style: TextStyle(
                      fontSize: 10,
                      fontWeight: FontWeight.w700,
                      color: scheme.primary,
                    ),
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 10),
          Expanded(
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                // Panneau gauche : Avant / Original
                Expanded(
                  child: Container(
                    padding: const EdgeInsets.all(8),
                    decoration: BoxDecoration(
                      color: isDark ? const Color(0xFF16181D) : scheme.surface,
                      borderRadius: BorderRadius.circular(8),
                      border: Border.all(
                        color: const Color(0xFFEF4444).withValues(alpha: 0.3),
                      ),
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          children: [
                            Container(
                              padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                              decoration: BoxDecoration(
                                color: const Color(0xFFEF4444).withValues(alpha: 0.15),
                                borderRadius: BorderRadius.circular(4),
                              ),
                              child: const Text(
                                'ORIGINAL (AVANT)',
                                style: TextStyle(
                                  fontSize: 10,
                                  fontWeight: FontWeight.w700,
                                  color: Color(0xFFEF4444),
                                ),
                              ),
                            ),
                          ],
                        ),
                        const Spacer(),
                        Center(
                          child: Column(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              Icon(
                                isSvg ? Icons.polyline_outlined : Icons.image_not_supported_outlined,
                                size: 36,
                                color: isDark ? const Color(0xFF5A5D6A) : scheme.outline,
                              ),
                              const SizedBox(height: 6),
                              Text(
                                'Version précédente',
                                style: TextStyle(
                                  fontSize: 11,
                                  color: isDark ? const Color(0xFF8E909D) : scheme.onSurfaceVariant,
                                ),
                              ),
                            ],
                          ),
                        ),
                        const Spacer(),
                      ],
                    ),
                  ),
                ),
                const SizedBox(width: 10),
                // Panneau droit : Après / Modifié
                Expanded(
                  child: Container(
                    padding: const EdgeInsets.all(8),
                    decoration: BoxDecoration(
                      color: isDark ? const Color(0xFF16181D) : scheme.surface,
                      borderRadius: BorderRadius.circular(8),
                      border: Border.all(
                        color: const Color(0xFF22C55E).withValues(alpha: 0.3),
                      ),
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          children: [
                            Container(
                              padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                              decoration: BoxDecoration(
                                color: const Color(0xFF22C55E).withValues(alpha: 0.15),
                                borderRadius: BorderRadius.circular(4),
                              ),
                              child: const Text(
                                'MODIFIÉ (APRÈS)',
                                style: TextStyle(
                                  fontSize: 10,
                                  fontWeight: FontWeight.w700,
                                  color: Color(0xFF22C55E),
                                ),
                              ),
                            ),
                          ],
                        ),
                        const Spacer(),
                        Center(
                          child: Column(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              Icon(
                                isSvg ? Icons.polyline_rounded : Icons.image_rounded,
                                size: 36,
                                color: scheme.primary,
                              ),
                              const SizedBox(height: 6),
                              Text(
                                'Nouvelle version',
                                style: TextStyle(
                                  fontSize: 11,
                                  fontWeight: FontWeight.w600,
                                  color: scheme.onSurface,
                                ),
                              ),
                            ],
                          ),
                        ),
                        const Spacer(),
                      ],
                    ),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _DiffHunk {
  final int index;
  final String header;
  final List<int> lineIndices;
  bool isSelected;

  _DiffHunk({
    required this.index,
    required this.header,
    required this.lineIndices,
    this.isSelected = true,
  });
}

enum _DiffLineType { hunkHeader, addition, deletion, context, meta }

class _DiffLine {
  final _DiffLineType type;
  final String content;
  final int? oldLine;
  final int? newLine;
  final int? hunkIndex;

  _DiffLine({
    required this.type,
    required this.content,
    this.oldLine,
    this.newLine,
    this.hunkIndex,
  });
}
