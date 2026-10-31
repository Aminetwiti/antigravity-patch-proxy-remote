import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:mobile/theme/app_colors.dart';
import '../../code_review/models/code_comment.dart';
import '../../../widgets/skeleton_loader.dart';

/// Modèle représentant un fichier modifié dans la session (avec additions/deletions)
class SessionModifiedFile {
  final String path;
  final int additions;
  final int deletions;
  final String? diffContent;
  final List<CodeComment> comments;

  const SessionModifiedFile({
    required this.path,
    this.additions = 0,
    this.deletions = 0,
    this.diffContent,
    this.comments = const [],
  });

  String get fileName {
    final clean = path.replaceAll('\\', '/');
    final idx = clean.lastIndexOf('/');
    return idx >= 0 ? clean.substring(idx + 1) : clean;
  }

  String get directoryPath {
    final clean = path.replaceAll('\\', '/');
    final idx = clean.lastIndexOf('/');
    return idx >= 0 ? clean.substring(0, idx) : '';
  }
}

/// Vue "Review" de session identique au Desktop IDE Antigravity 2.0
class SessionReviewView extends StatefulWidget {
  final List<SessionModifiedFile> files;
  final Function(SessionModifiedFile file) onOpenFileDiff;
  final VoidCallback? onExpandAll;
  final VoidCallback? onSplitDiffView;
  final bool isLoading;

  const SessionReviewView({
    super.key,
    required this.files,
    required this.onOpenFileDiff,
    this.onExpandAll,
    this.onSplitDiffView,
    this.isLoading = false,
  });

  @override
  State<SessionReviewView> createState() => _SessionReviewViewState();
}

class _SessionReviewViewState extends State<SessionReviewView> {
  final TextEditingController _searchController = TextEditingController();
  String _searchQuery = '';
  bool _isSearchOpen = false;
  bool _groupByFolder = false;

  @override
  void initState() {
    super.initState();
    _searchController.addListener(() {
      setState(() => _searchQuery = _searchController.text.trim().toLowerCase());
    });
  }

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  IconData _iconForName(String name) {
    final lower = name.toLowerCase();
    if (lower.endsWith('.dart')) return Icons.flutter_dash_outlined;
    if (lower.endsWith('.go')) return Icons.code_rounded;
    if (lower.endsWith('.json') ||
        lower.endsWith('.yaml') ||
        lower.endsWith('.yml') ||
        lower.endsWith('.toml')) {
      return Icons.settings_suggest_outlined;
    }
    if (lower.endsWith('.md') || lower.endsWith('.txt')) {
      return Icons.article_outlined;
    }
    if (lower.endsWith('.sh') || lower.endsWith('.bat') || lower.endsWith('.ps1')) {
      return Icons.terminal_rounded;
    }
    if (lower.endsWith('.gitignore') || lower.startsWith('.git')) {
      return Icons.alt_route_rounded;
    }
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
    if (lower.endsWith('.sh') || lower.endsWith('.bat')) return const Color(0xFF22C55E);
    if (lower.endsWith('.gitignore')) return const Color(0xFFF43F5E);
    if (lower.endsWith('.ts') || lower.endsWith('.tsx')) return const Color(0xFF3178C6);
    if (lower.endsWith('.js') || lower.endsWith('.jsx')) return const Color(0xFFF7DF1E);
    return const Color(0xFF9E9FA9);
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final q = _searchQuery.toLowerCase();
    final filtered = widget.files.where((f) {
      if (q.isEmpty) return true;
      return f.path.toLowerCase().contains(q) ||
          f.fileName.toLowerCase().contains(q) ||
          (f.diffContent != null && f.diffContent!.toLowerCase().contains(q));
    }).toList();

    return CallbackShortcuts(
      bindings: <ShortcutActivator, VoidCallback>{
        const SingleActivator(LogicalKeyboardKey.keyF, control: true): () {
          setState(() => _isSearchOpen = true);
        },
        const SingleActivator(LogicalKeyboardKey.keyF, meta: true): () {
          setState(() => _isSearchOpen = true);
        },
      },
      child: Focus(
        autofocus: false,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
        // ── En-tête : Titre "Review (N)" + Actions
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 12, 12, 8),
          child: Row(
            children: [
              Text(
                'Review',
                style: TextStyle(
                  fontSize: 16,
                  fontWeight: FontWeight.w700,
                  color: scheme.onSurface,
                  letterSpacing: -0.2,
                ),
              ),
              const SizedBox(width: 8),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
                decoration: BoxDecoration(
                  color: isDark ? AppColors.surfaceInput : scheme.surfaceContainerHighest,
                  borderRadius: BorderRadius.circular(AppRadius.pill),
                ),
                child: Text(
                  '${widget.files.length}',
                  style: TextStyle(
                    fontSize: 11.5,
                    fontWeight: FontWeight.w600,
                    color: isDark ? AppColors.inkSecondary : scheme.onSurfaceVariant,
                  ),
                ),
              ),
              const Spacer(),

              // ⋮ Options menu
              PopupMenuButton<String>(
                tooltip: 'Options de revue',
                color: isDark ? AppColors.surfaceRaised : scheme.surfaceContainer,
                surfaceTintColor: Colors.transparent,
                elevation: 8,
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(AppRadius.md),
                  side: BorderSide(color: isDark ? AppColors.borderSubtle : scheme.outlineVariant, width: 1),
                ),
                icon: Icon(
                  Icons.more_vert_rounded,
                  size: 18,
                  color: scheme.onSurfaceVariant,
                ),
                padding: EdgeInsets.zero,
                onSelected: (val) {
                  if (val == 'split') {
                    widget.onSplitDiffView?.call();
                  } else if (val == 'expand') {
                    widget.onExpandAll?.call();
                  } else if (val == 'copy_paths') {
                    final paths = widget.files.map((f) => f.path).join('\n');
                    Clipboard.setData(ClipboardData(text: paths));
                    ScaffoldMessenger.of(context).showSnackBar(
                      const SnackBar(
                        content: Text('Liste des chemins copiée'),
                        duration: Duration(seconds: 2),
                      ),
                    );
                  }
                },
                itemBuilder: (context) => [
                  PopupMenuItem<String>(
                    value: 'split',
                    height: 34,
                    child: Row(
                      crossAxisAlignment: CrossAxisAlignment.center,
                      children: [
                        Icon(Icons.splitscreen_rounded, size: 15, color: scheme.onSurface),
                        const SizedBox(width: 8),
                        Text('View Split Diff', style: TextStyle(fontSize: 13, color: scheme.onSurface)),
                      ],
                    ),
                  ),
                  PopupMenuItem<String>(
                    value: 'expand',
                    height: 34,
                    child: Row(
                      crossAxisAlignment: CrossAxisAlignment.center,
                      children: [
                        Icon(Icons.unfold_more_rounded, size: 15, color: scheme.onSurface),
                        const SizedBox(width: 8),
                        Text('Expand All', style: TextStyle(fontSize: 13, color: scheme.onSurface)),
                      ],
                    ),
                  ),
                  PopupMenuItem<String>(
                    value: 'copy_paths',
                    height: 34,
                    child: Row(
                      crossAxisAlignment: CrossAxisAlignment.center,
                      children: [
                        Icon(Icons.copy_rounded, size: 15, color: scheme.onSurface),
                        const SizedBox(width: 8),
                        Text('Copy File Paths', style: TextStyle(fontSize: 13, color: scheme.onSurface)),
                      ],
                    ),
                  ),
                ],
              ),

              // 🔍 Search toggle
              IconButton(
                icon: Icon(
                  Icons.search_rounded,
                  size: 18,
                  color: _isSearchOpen ? scheme.primary : scheme.onSurfaceVariant,
                ),
                tooltip: 'Rechercher un fichier modifié',
                onPressed: () {
                  setState(() {
                    _isSearchOpen = !_isSearchOpen;
                    if (!_isSearchOpen) {
                      _searchController.clear();
                      _searchQuery = '';
                    }
                  });
                },
                padding: EdgeInsets.zero,
                constraints: const BoxConstraints(minWidth: 32, minHeight: 32),
              ),

              // ☰ Group/View toggle
              IconButton(
                icon: Icon(
                  _groupByFolder ? Icons.view_list_rounded : Icons.folder_outlined,
                  size: 18,
                  color: _groupByFolder ? scheme.primary : scheme.onSurfaceVariant,
                ),
                tooltip: _groupByFolder ? 'Vue liste plate' : 'Grouper par dossier',
                onPressed: () => setState(() => _groupByFolder = !_groupByFolder),
                padding: EdgeInsets.zero,
                constraints: const BoxConstraints(minWidth: 32, minHeight: 32),
              ),
            ],
          ),
        ),

        // ── Barre de recherche conditionnelle
        if (_isSearchOpen)
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 4),
            child: Container(
              height: 34,
              decoration: BoxDecoration(
                color: isDark ? AppColors.surfaceInput : scheme.surfaceContainerHighest,
                borderRadius: BorderRadius.circular(AppRadius.md),
                border: Border.all(color: isDark ? AppColors.borderSubtle : scheme.outlineVariant, width: 1),
              ),
              child: TextField(
                controller: _searchController,
                style: TextStyle(fontSize: 12.5, color: scheme.onSurface),
                cursorColor: scheme.primary,
                decoration: InputDecoration(
                  hintText: 'Filtrer les modifications...',
                  hintStyle: TextStyle(fontSize: 12, color: scheme.onSurfaceVariant),
                  prefixIcon: Icon(Icons.search_rounded, size: 16, color: scheme.onSurfaceVariant),
                  suffixIcon: _searchQuery.isNotEmpty
                      ? IconButton(
                          icon: Icon(Icons.close_rounded, size: 14, color: scheme.onSurfaceVariant),
                          tooltip: 'Effacer la recherche',
                          onPressed: () {
                            _searchController.clear();
                            setState(() => _searchQuery = '');
                          },
                        )
                      : null,
                  filled: false,
                  contentPadding: const EdgeInsets.symmetric(horizontal: 8, vertical: 0),
                  border: InputBorder.none,
                ),
                onChanged: (val) => setState(() => _searchQuery = val.trim()),
              ),
            ),
          ),

        Divider(color: isDark ? AppColors.borderSubtle : scheme.outlineVariant, height: 1),

        // ── Liste des fichiers modifiés
        Expanded(
          child: widget.isLoading && widget.files.isEmpty
              ? SkeletonLoader(
                  child: ListView(
                    padding: const EdgeInsets.symmetric(vertical: 6),
                    physics: const NeverScrollableScrollPhysics(),
                    children: [
                      const SkeletonDiffFileItem(),
                      Divider(color: isDark ? AppColors.borderSubtle : scheme.outlineVariant, height: 1, indent: 14, endIndent: 14),
                      const SkeletonDiffFileItem(),
                      Divider(color: isDark ? AppColors.borderSubtle : scheme.outlineVariant, height: 1, indent: 14, endIndent: 14),
                      const SkeletonDiffFileItem(),
                      Divider(color: isDark ? AppColors.borderSubtle : scheme.outlineVariant, height: 1, indent: 14, endIndent: 14),
                      const SkeletonDiffFileItem(),
                    ],
                  ),
                )
              : filtered.isEmpty
              ? LayoutBuilder(
                  builder: (context, constraints) => SingleChildScrollView(
                    child: ConstrainedBox(
                      constraints: BoxConstraints(minHeight: constraints.maxHeight),
                      child: Center(
                        child: Padding(
                          padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 12),
                          child: Column(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              Icon(
                                _searchQuery.isNotEmpty ? Icons.search_off_rounded : Icons.check_circle_outline_rounded,
                                size: 32,
                                color: AppColors.inkMuted,
                              ),
                              const SizedBox(height: 8),
                              Text(
                                _searchQuery.isNotEmpty
                                    ? 'Aucun fichier pour "$_searchQuery"'
                                    : 'Aucun fichier modifié dans cette session',
                                style: const TextStyle(fontSize: 13, color: AppColors.inkMuted),
                                textAlign: TextAlign.center,
                              ),
                            ],
                          ),
                        ),
                      ),
                    ),
                  ),
                )
              : ListView.separated(
                  padding: const EdgeInsets.symmetric(vertical: 4),
                  itemCount: filtered.length,
                  separatorBuilder: (context, index) => Divider(
                    color: isDark ? AppColors.borderSubtle : scheme.outlineVariant,
                    height: 1,
                    indent: 14,
                    endIndent: 14,
                  ),
                  itemBuilder: (context, index) {
                    final file = filtered[index];
                    return _ChangedFileRow(
                      file: file,
                      icon: _iconForName(file.fileName),
                      iconColor: _colorForName(file.fileName),
                      onTap: () => widget.onOpenFileDiff(file),
                    );
                  },
                ),
        ),
      ],
        ),
      ),
    );
  }
}

class _ChangedFileRow extends StatelessWidget {
  final SessionModifiedFile file;
  final IconData icon;
  final Color iconColor;
  final VoidCallback onTap;

  const _ChangedFileRow({
    required this.file,
    required this.icon,
    required this.iconColor,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final isDark = Theme.of(context).brightness == Brightness.dark;

    final rowContent = InkWell(
      onTap: () {
        HapticFeedback.selectionClick();
        onTap();
      },
      hoverColor: isDark ? AppColors.surfaceHover : scheme.surfaceContainerHighest,
      splashColor: scheme.primary.withValues(alpha: 0.1),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
        child: Row(
          children: [
            // Icône du langage / fichier
            Icon(
              icon,
              size: 16,
              color: iconColor,
            ),
            const SizedBox(width: 9),

            // Nom du fichier + chemin relatif
            Expanded(
              child: Row(
                children: [
                  Flexible(
                    child: Text(
                      file.fileName,
                      style: TextStyle(
                        fontSize: 13,
                        fontWeight: FontWeight.w600,
                        color: isDark ? AppColors.inkPrimary : scheme.onSurface,
                        letterSpacing: -0.1,
                      ),
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                  if (file.directoryPath.isNotEmpty) ...[
                    const SizedBox(width: 6),
                    Flexible(
                      child: Text(
                        file.directoryPath,
                        style: TextStyle(
                          fontSize: 11.5,
                          color: isDark ? AppColors.inkSecondary : scheme.onSurfaceVariant,
                        ),
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                  ],
                ],
              ),
            ),

            const SizedBox(width: 10),

            // Badges Additions / Deletions: +X -Y
            Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                if (file.comments.isNotEmpty) ...[
                  FileCommentPill(
                    comments: file.comments,
                    onSelectComment: (c) {
                      onTap();
                    },
                  ),
                  const SizedBox(width: 8),
                ],
                if (file.additions > 0 || file.deletions == 0)
                  Text(
                    '+${file.additions}',
                    style: const TextStyle(
                      fontSize: 11.5,
                      fontWeight: FontWeight.w600,
                      color: AppColors.positive,
                    ),
                  ),
                if (file.deletions > 0) ...[
                  const SizedBox(width: 5),
                  Text(
                    '-${file.deletions}',
                    style: const TextStyle(
                      fontSize: 11.5,
                      fontWeight: FontWeight.w600,
                      color: AppColors.danger,
                    ),
                  ),
                ],
              ],
            ),

            const SizedBox(width: 6),
            const Icon(
              Icons.chevron_right_rounded,
              size: 15,
              color: AppColors.inkMuted,
            ),
          ],
        ),
      ),
    );

    return Draggable<String>(
      data: '@${file.path.isNotEmpty ? file.path : file.fileName}',
      feedback: Material(
        color: Colors.transparent,
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
          decoration: BoxDecoration(
            color: scheme.surfaceContainerHighest,
            borderRadius: BorderRadius.circular(AppRadius.md),
            border: Border.all(color: scheme.primary),
            boxShadow: [
              BoxShadow(color: Colors.black.withValues(alpha: 0.2), blurRadius: 8),
            ],
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(icon, size: 14, color: iconColor),
              const SizedBox(width: 6),
              Text(
                '@${file.fileName}',
                style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: scheme.onSurface),
              ),
            ],
          ),
        ),
      ),
      child: rowContent,
    );
  }
}

/// Pilule de comptage de commentaires avec prévisualisation au survol et navigation ciblée
class FileCommentPill extends StatelessWidget {
  final List<CodeComment> comments;
  final ValueChanged<CodeComment>? onSelectComment;

  const FileCommentPill({
    super.key,
    required this.comments,
    this.onSelectComment,
  });

  @override
  Widget build(BuildContext context) {
    if (comments.isEmpty) return const SizedBox.shrink();
    final scheme = Theme.of(context).colorScheme;

    final previewLines = comments.map((c) {
      final lineStr = c.lineNumber != null && c.lineNumber! > 0 ? 'L.${c.lineNumber}: ' : '';
      final snippet = c.commentText.length > 50 ? '${c.commentText.substring(0, 47)}...' : c.commentText;
      return '$lineStr"$snippet"';
    }).join('\n');

    return Tooltip(
      message: 'Commentaires sur ce fichier :\n$previewLines\n(Cliquer pour concentrer)',
      waitDuration: const Duration(milliseconds: 100),
      child: InkWell(
        onTap: () {
          HapticFeedback.selectionClick();
          if (comments.length == 1) {
            onSelectComment?.call(comments.first);
          } else if (comments.length > 1) {
            _showCommentSelectorSheet(context, scheme);
          }
        },
        borderRadius: BorderRadius.circular(AppRadius.pill),
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
          decoration: BoxDecoration(
            color: scheme.primary.withValues(alpha: 0.15),
            borderRadius: BorderRadius.circular(AppRadius.pill),
            border: Border.all(
              color: scheme.primary.withValues(alpha: 0.4),
              width: 0.8,
            ),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(Icons.chat_bubble_outline_rounded, size: 11, color: scheme.primary),
              const SizedBox(width: 4),
              Text(
                '${comments.length}',
                style: TextStyle(
                  fontSize: 10.5,
                  fontWeight: FontWeight.w700,
                  color: scheme.primary,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  void _showCommentSelectorSheet(BuildContext context, ColorScheme scheme) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    showModalBottomSheet(
      context: context,
      backgroundColor: Colors.transparent,
      builder: (ctx) => Container(
        decoration: BoxDecoration(
          color: isDark ? AppColors.surfaceRaised : scheme.surfaceContainerHigh,
          borderRadius: const BorderRadius.vertical(top: Radius.circular(AppRadius.lg)),
          border: Border.all(
            color: isDark ? AppColors.borderSubtle : scheme.outlineVariant,
            width: 1,
          ),
        ),
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Center(
              child: Container(
                width: 36,
                height: 4,
                margin: const EdgeInsets.only(bottom: 12),
                decoration: BoxDecoration(
                  color: isDark ? AppColors.borderStrong : scheme.outlineVariant,
                  borderRadius: BorderRadius.circular(2),
                ),
              ),
            ),
            Row(
              children: [
                Icon(Icons.chat_bubble_outline_rounded, size: 15, color: scheme.primary),
                const SizedBox(width: 8),
                Text(
                  'Commentaires (${comments.length})',
                  style: TextStyle(
                    fontSize: 13,
                    fontWeight: FontWeight.w600,
                    color: isDark ? AppColors.inkPrimary : scheme.onSurface,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 10),
            ConstrainedBox(
              constraints: const BoxConstraints(maxHeight: 280),
              child: ListView.separated(
                shrinkWrap: true,
                itemCount: comments.length,
                separatorBuilder: (_, __) => Divider(
                  height: 1,
                  color: isDark ? AppColors.borderSubtle : scheme.outlineVariant.withValues(alpha: 0.5),
                ),
                itemBuilder: (context, index) {
                  final c = comments[index];
                  final linePrefix = c.lineNumber != null && c.lineNumber! > 0 ? 'Ligne ${c.lineNumber}' : 'Fichier';
                  return InkWell(
                    onTap: () {
                      Navigator.of(ctx).pop();
                      onSelectComment?.call(c);
                    },
                    borderRadius: BorderRadius.circular(AppRadius.md),
                    child: Padding(
                      padding: const EdgeInsets.symmetric(vertical: 8, horizontal: 4),
                      child: Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Container(
                            padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                            decoration: BoxDecoration(
                              color: scheme.primary.withValues(alpha: 0.12),
                              borderRadius: BorderRadius.circular(4),
                            ),
                            child: Text(
                              linePrefix,
                              style: TextStyle(
                                fontSize: 10.5,
                                fontFamily: 'monospace',
                                fontWeight: FontWeight.w600,
                                color: scheme.primary,
                              ),
                            ),
                          ),
                          const SizedBox(width: 10),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  c.commentText,
                                  style: TextStyle(
                                    fontSize: 12.5,
                                    color: isDark ? AppColors.inkPrimary : scheme.onSurface,
                                  ),
                                ),
                                if (c.snippet.isNotEmpty) ...[
                                  const SizedBox(height: 3),
                                  Text(
                                    c.snippet,
                                    style: TextStyle(
                                      fontSize: 11,
                                      fontFamily: 'monospace',
                                      color: isDark ? AppColors.inkMuted : scheme.onSurfaceVariant,
                                    ),
                                    maxLines: 1,
                                    overflow: TextOverflow.ellipsis,
                                  ),
                                ],
                              ],
                            ),
                          ),
                          Icon(Icons.chevron_right_rounded, size: 16, color: isDark ? AppColors.inkMuted : scheme.onSurfaceVariant),
                        ],
                      ),
                    ),
                  );
                },
              ),
            ),
            const SizedBox(height: 6),
          ],
        ),
      ),
    );
  }
}
