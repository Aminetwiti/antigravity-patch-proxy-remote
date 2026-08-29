import 'package:flutter/material.dart';
import '../models/mention_item.dart';
import 'package:mobile/theme/app_colors.dart';

class MentionAutocompleteOverlay extends StatelessWidget {
  final String query;
  final List<MentionItem> items;
  final ValueChanged<MentionItem> onSelected;
  final double maxHeight;
  final int selectedIndex;
  final ScrollController? scrollController;

  const MentionAutocompleteOverlay({
    super.key,
    required this.query,
    required this.items,
    required this.onSelected,
    this.maxHeight = 260.0,
    this.selectedIndex = 0,
    this.scrollController,
  });

  List<MentionItem> get _filteredItems {
    final isSlash = query.startsWith('/');
    final clean = (query.startsWith('@') || query.startsWith('/'))
        ? query.substring(1).trim().toLowerCase()
        : query.trim().toLowerCase();
    if (clean.isEmpty) {
      if (isSlash) {
        return items.where((item) => item.type == MentionType.command).toList();
      }
      return items;
    }
    return items.where((item) {
      if (isSlash && item.type != MentionType.command) return false;
      return item.label.toLowerCase().contains(clean) ||
          item.detail.toLowerCase().contains(clean) ||
          item.type.name.toLowerCase().contains(clean) ||
          item.tag.toLowerCase().contains(clean);
    }).toList();
  }

  IconData _iconForItem(MentionItem item) {
    if (item.isDirectory || item.type == MentionType.folder) {
      return Icons.folder_outlined;
    }
    switch (item.type) {
      case MentionType.file:
        return Icons.insert_drive_file_outlined;
      case MentionType.folder:
        return Icons.folder_outlined;
      case MentionType.rule:
        return Icons.rule_outlined;
      case MentionType.mcp:
        return Icons.extension_outlined;
      case MentionType.conversation:
        return Icons.chat_bubble_outline_rounded;
      case MentionType.terminal:
        return Icons.terminal_outlined;
      case MentionType.command:
        return Icons.bolt_rounded;
    }
  }

  Color _badgeColorForType(MentionType type, ColorScheme scheme) {
    switch (type) {
      case MentionType.file:
      case MentionType.folder:
        return scheme.primary;
      case MentionType.rule:
        return scheme.tertiary;
      case MentionType.mcp:
        return scheme.secondary;
      case MentionType.conversation:
        return scheme.tertiary;
      case MentionType.terminal:
        return scheme.outline;
      case MentionType.command:
        return const Color(0xFFF59E0B);
    }
  }

  @override
  Widget build(BuildContext context) {
    final filtered = _filteredItems;
    final scheme = Theme.of(context).colorScheme;
    final isSlash = query.startsWith('/') || (filtered.isNotEmpty && filtered.every((i) => i.type == MentionType.command));
    final headerIcon = isSlash ? Icons.bolt_rounded : Icons.alternate_email;
    final headerTitle = isSlash ? 'Commandes rapides (/) (${filtered.length})' : 'Mentions (${filtered.length})';
    final emptyTitle = isSlash ? 'Aucune commande correspondant à "$query"' : 'No matching mentions for "$query"';

    return Container(
      constraints: BoxConstraints(maxHeight: maxHeight),
      decoration: BoxDecoration(
        color: scheme.surfaceContainer,
        borderRadius: BorderRadius.circular(AppRadius.lg),
        border: Border.all(color: scheme.outlineVariant),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.25),
            blurRadius: 12,
            offset: const Offset(0, 4),
          ),
        ],
      ),
      child: Material(
        color: Colors.transparent,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
              child: Row(
                children: [
                  Icon(headerIcon, size: 14, color: isSlash ? const Color(0xFFF59E0B) : scheme.primary),
                  const SizedBox(width: 6),
                  Text(
                    headerTitle,
                    style: TextStyle(
                      fontSize: 12,
                      fontWeight: FontWeight.w600,
                      color: scheme.onSurfaceVariant,
                    ),
                  ),
                ],
              ),
            ),
            Divider(color: scheme.outlineVariant, height: 1),
            if (filtered.isEmpty)
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
                child: Text(
                  emptyTitle,
                  style: TextStyle(fontSize: 12, color: scheme.onSurfaceVariant),
                ),
              )
            else
              Flexible(
                child: ListView.separated(
                  controller: scrollController,
                  padding: const EdgeInsets.symmetric(vertical: 4),
                  shrinkWrap: true,
                  itemCount: filtered.length,
                  separatorBuilder: (context, index) => Divider(
                    color: scheme.outlineVariant,
                    height: 1,
                    indent: 40,
                  ),
                  itemBuilder: (context, index) {
                    final item = filtered[index];
                    final isHighlighted = index == selectedIndex;
                    return InkWell(
                      onTap: () => onSelected(item),
                      child: Container(
                        color: isHighlighted ? scheme.primary.withValues(alpha: 0.1) : Colors.transparent,
                        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                        child: Row(
                          children: [
                            Container(
                              padding: const EdgeInsets.all(6),
                              decoration: BoxDecoration(
                                color: _badgeColorForType(item.type, scheme).withValues(alpha: 0.15),
                                borderRadius: BorderRadius.circular(AppRadius.sm),
                              ),
                              child: Icon(
                                _iconForItem(item),
                                size: 16,
                                color: _badgeColorForType(item.type, scheme),
                              ),
                            ),
                            const SizedBox(width: 10),
                            Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Row(
                                    children: [
                                      Expanded(
                                        child: Text(
                                          item.label,
                                          style: TextStyle(
                                            fontSize: 13,
                                            fontWeight: FontWeight.w500,
                                            color: scheme.onSurface,
                                          ),
                                          overflow: TextOverflow.ellipsis,
                                        ),
                                      ),
                                      Container(
                                        padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1.5),
                                        decoration: BoxDecoration(
                                          color: scheme.surfaceContainerHighest,
                                          borderRadius: BorderRadius.circular(AppRadius.sm),
                                        ),
                                        child: Text(
                                          item.type.name,
                                          style: TextStyle(
                                            fontSize: 10,
                                            fontWeight: FontWeight.w600,
                                            color: _badgeColorForType(item.type, scheme),
                                          ),
                                        ),
                                      ),
                                    ],
                                  ),
                                  if (item.detail.isNotEmpty) ...[
                                    const SizedBox(height: 2),
                                    Text(
                                      item.detail,
                                      style: TextStyle(
                                        fontSize: 11,
                                        color: scheme.onSurfaceVariant,
                                      ),
                                      maxLines: 1,
                                      overflow: TextOverflow.ellipsis,
                                    ),
                                  ],
                                ],
                              ),
                            ),
                          ],
                        ),
                      ),
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
