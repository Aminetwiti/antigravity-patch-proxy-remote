import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../../../theme/app_colors.dart';

/// Ligne élémentaire de diff avec statut (ajout, suppression, contexte, en-tête)
enum DiffLineType { context, addition, deletion, header }

class DiffLineData {
  final DiffLineType type;
  final String text;
  final int? oldLineNumber;
  final int? newLineNumber;

  const DiffLineData({
    required this.type,
    required this.text,
    this.oldLineNumber,
    this.newLineNumber,
  });
}

/// Carte de visualisation de diff de code inline fidèle à Antigravity IDE 2.0 et Deck.
class FileChangeDiffCard extends StatefulWidget {
  final String filePath;
  final String? diffContent;
  final String? diffAdded;
  final String? diffRemoved;
  final bool initiallyExpanded;
  final VoidCallback? onToggle;

  const FileChangeDiffCard({
    super.key,
    required this.filePath,
    this.diffContent,
    this.diffAdded,
    this.diffRemoved,
    this.initiallyExpanded = false,
    this.onToggle,
  });

  @override
  State<FileChangeDiffCard> createState() => _FileChangeDiffCardState();
}

class _FileChangeDiffCardState extends State<FileChangeDiffCard> {
  late bool _isExpanded;
  List<DiffLineData> _parsedLines = [];
  int _additions = 0;
  int _deletions = 0;

  @override
  void initState() {
    super.initState();
    _isExpanded = widget.initiallyExpanded;
    _parseDiff();
  }

  @override
  void didUpdateWidget(FileChangeDiffCard oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.diffContent != widget.diffContent ||
        oldWidget.filePath != widget.filePath) {
      _parseDiff();
    }
  }

  String _getFileName(String path) {
    final parts = path.split(RegExp(r'[/\\]'));
    return parts.isNotEmpty ? parts.last : path;
  }

  String _getLanguageBadge(String path) {
    final ext = path.split('.').last.toLowerCase();
    switch (ext) {
      case 'dart':
        return 'Dart';
      case 'go':
        return 'Go';
      case 'ts':
      case 'tsx':
        return 'TS';
      case 'js':
      case 'jsx':
        return 'JS';
      case 'py':
        return 'Py';
      case 'json':
        return 'JSON';
      case 'md':
        return 'MD';
      case 'yaml':
      case 'yml':
        return 'YAML';
      case 'html':
        return 'HTML';
      case 'css':
        return 'CSS';
      default:
        return ext.toUpperCase();
    }
  }

  void _parseDiff() {
    final raw = widget.diffContent?.trim() ?? '';
    if (raw.isEmpty) {
      _additions = int.tryParse(widget.diffAdded?.replaceAll('+', '') ?? '0') ?? 0;
      _deletions = int.tryParse(widget.diffRemoved?.replaceAll('-', '') ?? '0') ?? 0;
      _parsedLines = [];
      return;
    }

    int adds = 0;
    int dels = 0;
    final lines = <DiffLineData>[];
    int oldNum = 1;
    int newNum = 1;

    for (final line in raw.split('\n')) {
      if (line.startsWith('@@')) {
        final match = RegExp(r'@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@').firstMatch(line);
        if (match != null) {
          oldNum = int.tryParse(match.group(1) ?? '1') ?? 1;
          newNum = int.tryParse(match.group(2) ?? '1') ?? 1;
        }
        lines.add(DiffLineData(
          type: DiffLineType.header,
          text: line,
        ));
      } else if (line.startsWith('+') && !line.startsWith('+++')) {
        adds++;
        lines.add(DiffLineData(
          type: DiffLineType.addition,
          text: line.substring(1),
          newLineNumber: newNum++,
        ));
      } else if (line.startsWith('-') && !line.startsWith('---')) {
        dels++;
        lines.add(DiffLineData(
          type: DiffLineType.deletion,
          text: line.substring(1),
          oldLineNumber: oldNum++,
        ));
      } else if (!line.startsWith('---') && !line.startsWith('+++') && !line.startsWith('diff --git')) {
        lines.add(DiffLineData(
          type: DiffLineType.context,
          text: line.startsWith(' ') ? line.substring(1) : line,
          oldLineNumber: oldNum++,
          newLineNumber: newNum++,
        ));
      }
    }

    setState(() {
      _additions = adds > 0 ? adds : (int.tryParse(widget.diffAdded?.replaceAll('+', '') ?? '0') ?? 0);
      _deletions = dels > 0 ? dels : (int.tryParse(widget.diffRemoved?.replaceAll('-', '') ?? '0') ?? 0);
      _parsedLines = lines;
    });
  }

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final scheme = Theme.of(context).colorScheme;
    final fileName = _getFileName(widget.filePath);
    final langBadge = _getLanguageBadge(widget.filePath);

    return Container(
      margin: const EdgeInsets.symmetric(vertical: 4),
      decoration: BoxDecoration(
        color: isDark ? AppColors.surfaceRaised : scheme.surfaceContainerLow,
        borderRadius: BorderRadius.circular(AppRadius.md),
        border: Border.all(
          color: isDark ? AppColors.borderSubtle : scheme.outlineVariant.withValues(alpha: 0.5),
          width: 1,
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        mainAxisSize: MainAxisSize.min,
        children: [
          // En-tête cliquable du fichier
          InkWell(
            onTap: () {
              HapticFeedback.selectionClick();
              setState(() => _isExpanded = !_isExpanded);
              widget.onToggle?.call();
            },
            borderRadius: BorderRadius.circular(AppRadius.md),
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 7),
              child: Row(
                children: [
                  Icon(
                    _isExpanded
                        ? Icons.keyboard_arrow_down_rounded
                        : Icons.keyboard_arrow_right_rounded,
                    size: 16,
                    color: AppColors.inkMuted,
                  ),
                  const SizedBox(width: 4),
                  const Icon(
                    Icons.description_outlined,
                    size: 14,
                    color: AppColors.accentBlueBright,
                  ),
                  const SizedBox(width: 6),
                  Flexible(
                    child: Text(
                      fileName,
                      style: TextStyle(
                        fontFamily: 'monospace',
                        fontSize: 12,
                        fontWeight: FontWeight.w600,
                        color: isDark ? AppColors.inkPrimary : scheme.onSurface,
                      ),
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                  const SizedBox(width: 6),
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 1.5),
                    decoration: BoxDecoration(
                      color: isDark ? AppColors.surfaceInput : scheme.surfaceContainerHighest,
                      borderRadius: BorderRadius.circular(4),
                    ),
                    child: Text(
                      langBadge,
                      style: const TextStyle(
                        fontSize: 9.5,
                        fontWeight: FontWeight.w600,
                        color: AppColors.inkMuted,
                      ),
                    ),
                  ),
                  const Spacer(),
                  if (_additions > 0)
                    Text(
                      '+$_additions',
                      style: const TextStyle(
                        fontFamily: 'monospace',
                        fontSize: 11,
                        fontWeight: FontWeight.w600,
                        color: AppColors.positive,
                      ),
                    ),
                  if (_additions > 0 && _deletions > 0) const SizedBox(width: 6),
                  if (_deletions > 0)
                    Text(
                      '-$_deletions',
                      style: const TextStyle(
                        fontFamily: 'monospace',
                        fontSize: 11,
                        fontWeight: FontWeight.w600,
                        color: AppColors.danger,
                      ),
                    ),
                ],
              ),
            ),
          ),

          // Zone de diff dépliée
          if (_isExpanded) ...[
            Divider(
              height: 1,
              thickness: 1,
              color: isDark ? AppColors.borderSubtle : scheme.outlineVariant.withValues(alpha: 0.3),
            ),
            if (_parsedLines.isEmpty)
              Padding(
                padding: const EdgeInsets.all(12),
                child: Text(
                  'Fichier modifié : ${widget.filePath}',
                  style: const TextStyle(
                    fontFamily: 'monospace',
                    fontSize: 11,
                    color: AppColors.inkMuted,
                  ),
                ),
              )
            else
              Container(
                constraints: const BoxConstraints(maxHeight: 280),
                decoration: BoxDecoration(
                  color: isDark ? AppColors.surfaceBase : scheme.surface,
                  borderRadius: const BorderRadius.vertical(bottom: Radius.circular(AppRadius.md)),
                ),
                child: SingleChildScrollView(
                  scrollDirection: Axis.horizontal,
                  child: SingleChildScrollView(
                    padding: const EdgeInsets.symmetric(vertical: 6),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: _parsedLines.map((line) => _buildDiffLine(line, isDark, scheme)).toList(),
                    ),
                  ),
                ),
              ),
          ],
        ],
      ),
    );
  }

  Widget _buildDiffLine(DiffLineData line, bool isDark, ColorScheme scheme) {
    Color? rowBg;
    Color textColor = isDark ? AppColors.inkPrimary : scheme.onSurface;
    String prefix = ' ';

    if (line.type == DiffLineType.addition) {
      rowBg = AppColors.positive.withValues(alpha: isDark ? 0.12 : 0.08);
      textColor = isDark ? AppColors.positive : const Color(0xFF15803D);
      prefix = '+';
    } else if (line.type == DiffLineType.deletion) {
      rowBg = AppColors.danger.withValues(alpha: isDark ? 0.12 : 0.08);
      textColor = isDark ? AppColors.danger : const Color(0xFFB91C1C);
      prefix = '-';
    } else if (line.type == DiffLineType.header) {
      rowBg = AppColors.accentBlue.withValues(alpha: 0.08);
      textColor = AppColors.accentBlueBright;
      prefix = '@';
    }

    return Container(
      color: rowBg ?? Colors.transparent,
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 1.5),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          // Numéro de ligne
          SizedBox(
            width: 32,
            child: Text(
              line.newLineNumber?.toString() ?? line.oldLineNumber?.toString() ?? '',
              textAlign: TextAlign.right,
              style: TextStyle(
                fontFamily: 'monospace',
                fontSize: 10,
                color: AppColors.inkMuted.withValues(alpha: 0.6),
              ),
            ),
          ),
          const SizedBox(width: 8),
          // Symbole +/-
          SizedBox(
            width: 12,
            child: Text(
              prefix,
              style: TextStyle(
                fontFamily: 'monospace',
                fontSize: 11,
                fontWeight: FontWeight.w700,
                color: textColor,
              ),
            ),
          ),
          const SizedBox(width: 4),
          // Contenu de la ligne
          Text(
            line.text,
            style: TextStyle(
              fontFamily: 'monospace',
              fontSize: 11,
              color: textColor,
            ),
          ),
        ],
      ),
    );
  }
}
