import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:mobile/theme/app_colors.dart';

/// Carte interactive d'Implementation Plan dans le chat (Antigravity 2.0 Desktop Style)
class ImplementationPlanCard extends StatelessWidget {
  final String title;
  final String? summary;
  final VoidCallback? onProceed;
  final VoidCallback onViewPlan;

  const ImplementationPlanCard({
    super.key,
    this.title = 'Implementation Plan',
    this.summary,
    this.onProceed,
    required this.onViewPlan,
  });

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final isDark = Theme.of(context).brightness == Brightness.dark;

    return Container(
      margin: const EdgeInsets.only(top: 8, bottom: 4),
      decoration: BoxDecoration(
        color: isDark ? AppColors.surfaceRaised : scheme.surfaceContainer,
        borderRadius: BorderRadius.circular(AppRadius.md),
        border: Border.all(
          color: isDark ? AppColors.borderSubtle : scheme.outlineVariant,
          width: 1,
        ),
      ),
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          onTap: () {
            HapticFeedback.selectionClick();
            onViewPlan();
          },
          borderRadius: BorderRadius.circular(10),
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
            child: Row(
              children: [
                Icon(
                  Icons.description_outlined,
                  size: 16,
                  color: isDark ? AppColors.inkPrimary : scheme.onSurface,
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    title,
                    style: TextStyle(
                      fontSize: 13,
                      fontWeight: FontWeight.w600,
                      color: isDark ? AppColors.inkPrimary : scheme.onSurface,
                    ),
                  ),
                ),
                if (onProceed != null) ...[
                  const SizedBox(width: 8),
                  InkWell(
                    onTap: () {
                      HapticFeedback.heavyImpact();
                      onProceed!();
                    },
                    borderRadius: BorderRadius.circular(6),
                    child: Container(
                      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                      decoration: BoxDecoration(
                        color: isDark ? AppColors.accentSubtle : scheme.primaryContainer,
                        borderRadius: BorderRadius.circular(AppRadius.xs),
                        border: Border.all(
                          color: scheme.primary.withValues(alpha: 0.5),
                          width: 0.8,
                        ),
                      ),
                      child: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Icon(Icons.play_arrow_rounded, size: 13, color: scheme.primary),
                          const SizedBox(width: 4),
                          Text(
                            'Proceed',
                            style: TextStyle(
                              fontSize: 11.5,
                              fontWeight: FontWeight.w600,
                              color: scheme.primary,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// Carte interactive de Walkthrough dans le chat (Antigravity 2.0 Desktop Style)
class WalkthroughCard extends StatelessWidget {
  final String title;
  final String? summary;
  final VoidCallback onViewWalkthrough;

  const WalkthroughCard({
    super.key,
    this.title = 'Walkthrough',
    this.summary,
    required this.onViewWalkthrough,
  });

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final isDark = Theme.of(context).brightness == Brightness.dark;

    return Container(
      margin: const EdgeInsets.only(top: 8, bottom: 4),
      decoration: BoxDecoration(
        color: isDark ? AppColors.surfaceRaised : scheme.surfaceContainer,
        borderRadius: BorderRadius.circular(AppRadius.md),
        border: Border.all(
          color: isDark ? AppColors.borderSubtle : scheme.outlineVariant,
          width: 1,
        ),
      ),
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          onTap: () {
            HapticFeedback.selectionClick();
            onViewWalkthrough();
          },
          borderRadius: BorderRadius.circular(AppRadius.md),
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                Row(
                  children: [
                    Icon(
                      Icons.menu_book_outlined,
                      size: 16,
                      color: isDark ? AppColors.inkPrimary : scheme.onSurface,
                    ),
                    const SizedBox(width: 8),
                    Text(
                      title,
                      style: TextStyle(
                        fontSize: 13,
                        fontWeight: FontWeight.w600,
                        color: isDark ? AppColors.inkPrimary : scheme.onSurface,
                      ),
                    ),
                  ],
                ),
                if (summary != null && summary!.isNotEmpty) ...[
                  const SizedBox(height: 6),
                  Text(
                    summary!,
                    style: TextStyle(
                      fontSize: 12,
                      height: 1.35,
                      color: isDark ? AppColors.inkSecondary : scheme.onSurfaceVariant,
                    ),
                  ),
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// Session-result card — matches the Antigravity IDE inline summary:
/// "3 files changed  +467  -223  >"  with a [Review] button.
/// Collapsed by default; tapping the row expands the file list.
class FilesChangedCard extends StatefulWidget {
  final List<String> files;
  final int additions;
  final int deletions;
  final VoidCallback onReview;
  final ValueChanged<String>? onOpenFile;
  final bool initiallyExpanded;

  const FilesChangedCard({
    super.key,
    required this.files,
    this.additions = 0,
    this.deletions = 0,
    required this.onReview,
    this.onOpenFile,
    this.initiallyExpanded = false,
  });

  @override
  State<FilesChangedCard> createState() => _FilesChangedCardState();
}

class _FilesChangedCardState extends State<FilesChangedCard>
    with SingleTickerProviderStateMixin {
  late bool _expanded;
  late final AnimationController _anim;
  late final Animation<double> _sizeFactor;

  @override
  void initState() {
    super.initState();
    _expanded = widget.initiallyExpanded;
    _anim = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 200),
      value: _expanded ? 1.0 : 0.0,
    );
    _sizeFactor = CurvedAnimation(parent: _anim, curve: Curves.easeOut);
  }

  @override
  void dispose() {
    _anim.dispose();
    super.dispose();
  }

  void _toggle() {
    setState(() => _expanded = !_expanded);
    _expanded ? _anim.forward() : _anim.reverse();
    HapticFeedback.selectionClick();
  }

  IconData _iconFor(String name) {
    final ext = name.contains('.') ? name.split('.').last.toLowerCase() : '';
    switch (ext) {
      case 'dart': return Icons.flutter_dash_outlined;
      case 'go': return Icons.code_rounded;
      case 'ts': case 'tsx': case 'js': case 'jsx': return Icons.javascript_rounded;
      case 'json': case 'yaml': case 'yml': case 'toml': return Icons.settings_suggest_outlined;
      case 'md': case 'txt': return Icons.article_outlined;
      case 'sh': case 'bat': case 'ps1': return Icons.terminal_rounded;
      default: return Icons.insert_drive_file_outlined;
    }
  }

  Color _iconColorFor(String name, bool isDark) {
    final ext = name.contains('.') ? name.split('.').last.toLowerCase() : '';
    switch (ext) {
      case 'dart': return const Color(0xFF29B6F6);
      case 'go': return const Color(0xFF00ADD8);
      case 'ts': case 'tsx': return const Color(0xFF3178C6);
      case 'js': case 'jsx': return const Color(0xFFF7DF1E);
      case 'json': case 'yaml': case 'yml': case 'toml': return const Color(0xFFA074C4);
      case 'md': case 'txt': return const Color(0xFF519ABA);
      case 'sh': case 'bat': case 'ps1': return const Color(0xFF4CAF50);
      default: return isDark ? AppColors.inkSecondary : AppColors.inkMuted;
    }
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final count = widget.files.length;
    final label = '$count ${count > 1 ? 'files changed' : 'file changed'}';

    return Container(
      margin: const EdgeInsets.only(top: 8, bottom: 4),
      decoration: BoxDecoration(
        color: isDark ? AppColors.surfaceRaised : scheme.surfaceContainer,
        borderRadius: BorderRadius.circular(AppRadius.md),
        border: Border.all(
          color: isDark ? AppColors.borderSubtle : scheme.outlineVariant,
          width: 1,
        ),
      ),
      clipBehavior: Clip.hardEdge,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          // ── Header row (Antigravity 2.0 exact UI) ───────────────────────
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
            child: Row(
              children: [
                InkWell(
                  onTap: _toggle,
                  borderRadius: BorderRadius.circular(4),
                  child: Padding(
                    padding: const EdgeInsets.symmetric(vertical: 2),
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        // File-count label
                        Text(
                          label,
                          style: TextStyle(
                            fontSize: 12.5,
                            fontWeight: FontWeight.w600,
                            color: isDark ? AppColors.inkPrimary : scheme.onSurface,
                          ),
                        ),
                        // Additions & Deletions
                        if (widget.additions > 0 || widget.deletions > 0) ...[
                          const SizedBox(width: 6),
                          if (widget.additions > 0) ...[
                            Text(
                              '+${widget.additions}',
                              style: const TextStyle(
                                fontSize: 12,
                                fontWeight: FontWeight.w700,
                                color: AppColors.positive,
                                fontFamily: 'monospace',
                              ),
                            ),
                          ],
                          if (widget.deletions > 0) ...[
                            if (widget.additions > 0) const SizedBox(width: 4),
                            Text(
                              '-${widget.deletions}',
                              style: const TextStyle(
                                fontSize: 12,
                                fontWeight: FontWeight.w700,
                                color: AppColors.danger,
                                fontFamily: 'monospace',
                              ),
                            ),
                          ],
                        ],
                        const SizedBox(width: 4),
                        // Chevron
                        AnimatedRotation(
                          turns: _expanded ? 0 : -0.25,
                          duration: const Duration(milliseconds: 180),
                          child: Icon(
                            Icons.keyboard_arrow_down_rounded,
                            size: 16,
                            color: isDark ? AppColors.inkMuted : scheme.onSurfaceVariant,
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
                const Spacer(),
                // Review button (Desktop Antigravity pill style)
                Material(
                  color: isDark ? AppColors.surfaceHover : scheme.surfaceContainerHighest,
                  borderRadius: BorderRadius.circular(AppRadius.xs),
                  child: InkWell(
                    onTap: widget.onReview,
                    borderRadius: BorderRadius.circular(AppRadius.xs),
                    child: Container(
                      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                      decoration: BoxDecoration(
                        borderRadius: BorderRadius.circular(AppRadius.xs),
                        border: Border.all(
                          color: isDark ? AppColors.borderSubtle : scheme.outlineVariant,
                          width: 0.8,
                        ),
                      ),
                      child: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Icon(
                            Icons.difference_outlined,
                            size: 13,
                            color: isDark ? AppColors.inkSecondary : scheme.onSurfaceVariant,
                          ),
                          const SizedBox(width: 4.5),
                          Text(
                            'Review',
                            style: TextStyle(
                              fontSize: 11.5,
                              fontWeight: FontWeight.w600,
                              color: isDark ? AppColors.inkPrimary : scheme.onSurface,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                ),
              ],
            ),
          ),

          // ── Expandable file list ──────────────────────────────────────
          SizeTransition(
            sizeFactor: _sizeFactor,
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                ...widget.files.map((file) {
                  final normalized = file.replaceAll('\\', '/');
                  final lastSlash = normalized.lastIndexOf('/');
                  final fileName = lastSlash >= 0
                      ? normalized.substring(lastSlash + 1)
                      : normalized;
                  final dirPath = lastSlash >= 0
                      ? normalized.substring(0, lastSlash)
                      : '';

                  return Material(
                    color: Colors.transparent,
                    child: InkWell(
                      onTap: () => widget.onOpenFile?.call(file),
                      child: Padding(
                        padding: const EdgeInsets.symmetric(
                            horizontal: 12, vertical: 4.5),
                        child: Row(
                          children: [
                            Icon(
                              _iconFor(fileName),
                              size: 13,
                              color: _iconColorFor(fileName, isDark),
                            ),
                            const SizedBox(width: 8),
                            Expanded(
                              child: RichText(
                                overflow: TextOverflow.ellipsis,
                                maxLines: 1,
                                text: TextSpan(
                                  children: [
                                    TextSpan(
                                      text: fileName,
                                      style: TextStyle(
                                        fontSize: 12,
                                        fontWeight: FontWeight.w600,
                                        color: isDark ? AppColors.inkPrimary : scheme.onSurface,
                                        fontFamily: 'monospace',
                                      ),
                                    ),
                                    if (dirPath.isNotEmpty)
                                      TextSpan(
                                        text: '  ...$dirPath',
                                        style: TextStyle(
                                          fontSize: 11,
                                          color: isDark
                                              ? AppColors.inkMuted
                                              : scheme.onSurfaceVariant.withValues(alpha: 0.7),
                                          fontFamily: 'monospace',
                                        ),
                                      ),
                                  ],
                                ),
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                  );
                }),
                const SizedBox(height: 4),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// Carte interactive de suivi des sous-tâches (TaskTrackerCard)
class TaskTrackerCard extends StatelessWidget {
  final String title;
  final String summary;
  final bool isComplete;
  final VoidCallback? onTap;

  const TaskTrackerCard({
    super.key,
    this.title = 'Task',
    required this.summary,
    this.isComplete = false,
    this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final isDark = Theme.of(context).brightness == Brightness.dark;

    return Container(
      margin: const EdgeInsets.symmetric(vertical: 6),
      decoration: BoxDecoration(
        color: isDark ? AppColors.surfaceRaised : scheme.surfaceContainer,
        borderRadius: BorderRadius.circular(AppRadius.lg),
        border: Border.all(color: isDark ? AppColors.borderStrong : scheme.outlineVariant, width: 1),
      ),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(AppRadius.lg),
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Icon(
                    isComplete ? Icons.task_alt : Icons.checklist_rtl_outlined,
                    size: 16,
                    color: isComplete
                        ? AppColors.positive
                        : AppColors.warning,
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      title,
                      style: TextStyle(
                        fontSize: 13,
                        fontWeight: FontWeight.w600,
                        color: scheme.onSurface,
                      ),
                    ),
                  ),
                  if (isComplete)
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                      decoration: BoxDecoration(
                        color: AppColors.positive.withValues(alpha: 0.15),
                        borderRadius: BorderRadius.circular(4),
                      ),
                      child: const Text(
                        'Complete',
                        style: TextStyle(
                          fontSize: 10,
                          fontWeight: FontWeight.w600,
                          color: AppColors.positive,
                        ),
                      ),
                    ),
                ],
              ),
              const SizedBox(height: 6),
              Text(
                summary,
                style: TextStyle(
                  fontSize: 12,
                  color: scheme.onSurfaceVariant,
                  height: 1.4,
                ),
                maxLines: 3,
                overflow: TextOverflow.ellipsis,
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Google Workspace 2026 Product types
enum WorkspaceProductType { docs, sheets, slides, drive, generic }

class WorkspaceProductHelper {
  static WorkspaceProductType detect(String url) {
    final lower = url.toLowerCase();
    if (lower.contains('docs.google.com/document') || lower.contains('docs.google.com/doc')) {
      return WorkspaceProductType.docs;
    }
    if (lower.contains('docs.google.com/spreadsheets') || lower.contains('sheets.google.com')) {
      return WorkspaceProductType.sheets;
    }
    if (lower.contains('docs.google.com/presentation') || lower.contains('slides.google.com')) {
      return WorkspaceProductType.slides;
    }
    if (lower.contains('drive.google.com')) {
      return WorkspaceProductType.drive;
    }
    return WorkspaceProductType.generic;
  }

  static String getLabel(WorkspaceProductType type) {
    switch (type) {
      case WorkspaceProductType.docs:
        return 'Google Docs';
      case WorkspaceProductType.sheets:
        return 'Google Sheets';
      case WorkspaceProductType.slides:
        return 'Google Slides';
      case WorkspaceProductType.drive:
        return 'Google Drive';
      case WorkspaceProductType.generic:
        return 'Web Link';
    }
  }
}

/// Official Google Workspace 2026 vector icon
class GoogleWorkspaceLogo extends StatelessWidget {
  final WorkspaceProductType type;
  final double size;

  const GoogleWorkspaceLogo({
    super.key,
    required this.type,
    this.size = 20,
  });

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: size,
      height: size,
      child: CustomPaint(
        painter: _WorkspaceIconPainter(type),
      ),
    );
  }
}

class _WorkspaceIconPainter extends CustomPainter {
  final WorkspaceProductType type;

  _WorkspaceIconPainter(this.type);

  @override
  void paint(Canvas canvas, Size size) {
    final w = size.width;
    final h = size.height;

    switch (type) {
      case WorkspaceProductType.docs:
        // Google Docs 2026: Rounded Blue Document with folded corner and white horizontal lines
        final rrect = RRect.fromRectAndRadius(
          Rect.fromLTWH(w * 0.1, h * 0.05, w * 0.8, h * 0.9),
          Radius.circular(w * 0.14),
        );
        final bgPaint = Paint()..color = const Color(0xFF2684FC); // Docs Royal Blue
        canvas.drawRRect(rrect, bgPaint);

        // Folded top-right corner effect
        final cornerPath = Path()
          ..moveTo(w * 0.62, h * 0.05)
          ..lineTo(w * 0.9, h * 0.33)
          ..lineTo(w * 0.62, h * 0.33)
          ..close();
        final foldPaint = Paint()..color = const Color(0xFFAECBFA);
        canvas.drawPath(cornerPath, foldPaint);

        // White document lines
        final linePaint = Paint()
          ..color = Colors.white
          ..strokeCap = StrokeCap.round
          ..strokeWidth = w * 0.08;
        canvas.drawLine(Offset(w * 0.26, h * 0.46), Offset(w * 0.74, h * 0.46), linePaint);
        canvas.drawLine(Offset(w * 0.26, h * 0.60), Offset(w * 0.74, h * 0.60), linePaint);
        canvas.drawLine(Offset(w * 0.26, h * 0.74), Offset(w * 0.56, h * 0.74), linePaint);
        break;

      case WorkspaceProductType.sheets:
        // Google Sheets 2026: Emerald Green Sheet with spreadsheet grid
        final rrect = RRect.fromRectAndRadius(
          Rect.fromLTWH(w * 0.1, h * 0.05, w * 0.8, h * 0.9),
          Radius.circular(w * 0.14),
        );
        final bgPaint = Paint()..color = const Color(0xFF0F9D58); // Sheets Emerald Green
        canvas.drawRRect(rrect, bgPaint);

        // Folded top-right corner
        final cornerPath = Path()
          ..moveTo(w * 0.62, h * 0.05)
          ..lineTo(w * 0.9, h * 0.33)
          ..lineTo(w * 0.62, h * 0.33)
          ..close();
        final foldPaint = Paint()..color = const Color(0xFF81C995);
        canvas.drawPath(cornerPath, foldPaint);

        // White spreadsheet grid cross
        final gridPaint = Paint()
          ..color = Colors.white
          ..strokeCap = StrokeCap.round
          ..strokeWidth = w * 0.07;
        canvas.drawLine(Offset(w * 0.26, h * 0.58), Offset(w * 0.74, h * 0.58), gridPaint);
        canvas.drawLine(Offset(w * 0.50, h * 0.42), Offset(w * 0.50, h * 0.78), gridPaint);
        break;

      case WorkspaceProductType.slides:
        // Google Slides 2026: Amber/Gold Presentation Slide
        final rrect = RRect.fromRectAndRadius(
          Rect.fromLTWH(w * 0.1, h * 0.05, w * 0.8, h * 0.9),
          Radius.circular(w * 0.14),
        );
        final bgPaint = Paint()..color = const Color(0xFFF4B400); // Slides Gold
        canvas.drawRRect(rrect, bgPaint);

        // Folded corner
        final cornerPath = Path()
          ..moveTo(w * 0.62, h * 0.05)
          ..lineTo(w * 0.9, h * 0.33)
          ..lineTo(w * 0.62, h * 0.33)
          ..close();
        final foldPaint = Paint()..color = const Color(0xFFFDE293);
        canvas.drawPath(cornerPath, foldPaint);

        // Center projector/presentation rectangle
        final slideInner = RRect.fromRectAndRadius(
          Rect.fromLTWH(w * 0.26, h * 0.44, w * 0.48, h * 0.32),
          Radius.circular(w * 0.04),
        );
        final innerPaint = Paint()..color = Colors.white;
        canvas.drawRRect(slideInner, innerPaint);
        break;

      case WorkspaceProductType.drive:
        // Google Drive 2026: 3-colored geometric triangle
        final yellowPath = Path()
          ..moveTo(w * 0.32, h * 0.15)
          ..lineTo(w * 0.68, h * 0.15)
          ..lineTo(w * 0.45, h * 0.55)
          ..lineTo(w * 0.15, h * 0.55)
          ..close();
        canvas.drawPath(yellowPath, Paint()..color = const Color(0xFFFFBA00));

        final greenPath = Path()
          ..moveTo(w * 0.68, h * 0.15)
          ..lineTo(w * 0.88, h * 0.52)
          ..lineTo(w * 0.58, h * 0.90)
          ..lineTo(w * 0.38, h * 0.55)
          ..close();
        canvas.drawPath(greenPath, Paint()..color = const Color(0xFF00AC47));

        final bluePath = Path()
          ..moveTo(w * 0.15, h * 0.55)
          ..lineTo(w * 0.45, h * 0.55)
          ..lineTo(w * 0.58, h * 0.90)
          ..lineTo(w * 0.12, h * 0.90)
          ..close();
        canvas.drawPath(bluePath, Paint()..color = const Color(0xFF2684FC));
        break;

      case WorkspaceProductType.generic:
        final circlePaint = Paint()..color = const Color(0xFF5F6368);
        canvas.drawCircle(Offset(w * 0.5, h * 0.5), w * 0.4, circlePaint);
        break;
    }
  }

  @override
  bool shouldRepaint(covariant _WorkspaceIconPainter oldDelegate) => oldDelegate.type != type;
}

/// Carte d'artefact enrichie pour les liens Google Workspace 2026 (Docs, Sheets, Slides, Drive)
class WorkspaceUrlArtifactCard extends StatelessWidget {
  final String url;
  final String title;
  final VoidCallback? onTap;

  const WorkspaceUrlArtifactCard({
    super.key,
    required this.url,
    this.title = '',
    this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final type = WorkspaceProductHelper.detect(url);
    final productLabel = WorkspaceProductHelper.getLabel(type);
    final displayTitle = title.trim().isNotEmpty ? title.trim() : productLabel;

    return Container(
      margin: const EdgeInsets.symmetric(vertical: 6),
      decoration: BoxDecoration(
        color: isDark ? AppColors.surfaceRaised : scheme.surfaceContainer,
        borderRadius: BorderRadius.circular(AppRadius.md),
        border: Border.all(
          color: isDark ? AppColors.borderSubtle : scheme.outlineVariant,
          width: 1,
        ),
      ),
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          onTap: () {
            HapticFeedback.selectionClick();
            onTap?.call();
          },
          borderRadius: BorderRadius.circular(AppRadius.md),
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 11),
            child: Row(
              children: [
                GoogleWorkspaceLogo(type: type, size: 22),
                const SizedBox(width: 10),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text(
                        displayTitle,
                        style: TextStyle(
                          fontSize: 13,
                          fontWeight: FontWeight.w600,
                          color: scheme.onSurface,
                        ),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                      const SizedBox(height: 2),
                      Row(
                        children: [
                          Container(
                            padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 1.5),
                            decoration: BoxDecoration(
                              color: isDark ? AppColors.surfaceInput : scheme.surfaceContainerHighest,
                              borderRadius: BorderRadius.circular(AppRadius.xs),
                            ),
                            child: Text(
                              productLabel,
                              style: TextStyle(
                                fontSize: 10.5,
                                fontWeight: FontWeight.w500,
                                color: scheme.primary,
                              ),
                            ),
                          ),
                          const SizedBox(width: 6),
                          Expanded(
                            child: Text(
                              url,
                              style: TextStyle(
                                fontSize: 11,
                                color: scheme.onSurfaceVariant,
                              ),
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                            ),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
                const SizedBox(width: 8),
                Icon(
                  Icons.open_in_new_rounded,
                  size: 15,
                  color: scheme.onSurfaceVariant,
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
