import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../../theme/app_colors.dart';

/// Carte compacte affichant la file d'attente des messages ("Queued Messages")
/// lorsqu'un agent travaille déjà sur la session active.
///
/// Reproduit fidèlement le design Antigravity IDE :
/// - Titre "Queued Messages" + badge du nombre + sous-titre "Sends after agent finishes working"
/// - Flèche chevron pour replier / déplier avec animation fluide (AnimatedSize)
/// - Liste des messages en attente avec défilement fluide (Scrollbar) si beaucoup de messages
/// - Actions par message :
///   1. Envoyer maintenant (flèche)
///   2. Modifier (crayon -> remet dans le champ de saisie)
///   3. Supprimer (corbeille)
class QueuedMessagesCard extends StatefulWidget {
  final List<Map<String, dynamic>> queuedMessages;
  final ValueChanged<int> onSendNow;
  final ValueChanged<int> onEdit;
  final ValueChanged<int> onDelete;

  const QueuedMessagesCard({
    super.key,
    required this.queuedMessages,
    required this.onSendNow,
    required this.onEdit,
    required this.onDelete,
  });

  @override
  State<QueuedMessagesCard> createState() => _QueuedMessagesCardState();
}

class _QueuedMessagesCardState extends State<QueuedMessagesCard> {
  bool _isExpanded = true;
  final ScrollController _scrollController = ScrollController();

  @override
  void dispose() {
    _scrollController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    if (widget.queuedMessages.isEmpty) {
      return const SizedBox.shrink();
    }

    final scheme = Theme.of(context).colorScheme;
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final count = widget.queuedMessages.length;

    return Container(
      margin: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
      decoration: BoxDecoration(
        color: isDark ? AppColors.surfaceRaised : scheme.surfaceContainerLow,
        borderRadius: BorderRadius.circular(AppRadius.lg),
        border: Border.all(
          color: isDark
              ? AppColors.borderSubtle
              : scheme.outlineVariant.withValues(alpha: 0.5),
        ),
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          // Header
          InkWell(
            onTap: () {
              HapticFeedback.selectionClick();
              setState(() => _isExpanded = !_isExpanded);
            },
            borderRadius: BorderRadius.vertical(
              top: const Radius.circular(AppRadius.lg),
              bottom: _isExpanded
                  ? Radius.zero
                  : const Radius.circular(AppRadius.lg),
            ),
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
              child: Row(
                children: [
                  Text(
                    'Queued Messages',
                    style: TextStyle(
                      fontSize: 12.5,
                      fontWeight: FontWeight.w600,
                      color: isDark ? AppColors.inkPrimary : scheme.onSurface,
                    ),
                  ),
                  const SizedBox(width: 6),
                  Container(
                    padding:
                        const EdgeInsets.symmetric(horizontal: 5, vertical: 1),
                    decoration: BoxDecoration(
                      color: isDark
                          ? AppColors.surfaceHover
                          : scheme.surfaceContainerHighest,
                      borderRadius: BorderRadius.circular(AppRadius.pill),
                    ),
                    child: Text(
                      '$count',
                      style: TextStyle(
                        fontSize: 10.5,
                        fontWeight: FontWeight.w600,
                        color: isDark
                            ? AppColors.inkSecondary
                            : scheme.onSurfaceVariant,
                      ),
                    ),
                  ),
                  const SizedBox(width: 6),
                  Expanded(
                    child: Text(
                      'Sends after agent finishes working',
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      softWrap: false,
                      style: TextStyle(
                        fontSize: 11,
                        color: isDark
                            ? AppColors.inkMuted
                            : scheme.onSurfaceVariant.withValues(alpha: 0.8),
                      ),
                    ),
                  ),
                  const SizedBox(width: 4),
                  Icon(
                    _isExpanded
                        ? Icons.keyboard_arrow_up_rounded
                        : Icons.keyboard_arrow_down_rounded,
                    size: 16,
                    color: isDark ? AppColors.inkMuted : scheme.onSurfaceVariant,
                  ),
                ],
              ),
            ),
          ),

          // Collapsible and Scrollable list
          AnimatedSize(
            duration: const Duration(milliseconds: 200),
            curve: Curves.easeOutCubic,
            child: _isExpanded
                ? Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Divider(
                        height: 1,
                        thickness: 1,
                        color: isDark
                            ? AppColors.borderSubtle
                            : scheme.outlineVariant.withValues(alpha: 0.3),
                      ),
                      ConstrainedBox(
                        constraints: BoxConstraints(
                          maxHeight: count > 2 ? 150 : double.infinity,
                        ),
                        child: Scrollbar(
                          controller: _scrollController,
                          thumbVisibility: count > 2,
                          radius: const Radius.circular(4),
                          thickness: 3,
                          child: ListView.separated(
                            controller: _scrollController,
                            shrinkWrap: true,
                            physics: count > 2
                                ? const BouncingScrollPhysics(
                                    parent: AlwaysScrollableScrollPhysics(),
                                  )
                                : const NeverScrollableScrollPhysics(),
                            itemCount: widget.queuedMessages.length,
                            separatorBuilder: (_, __) => Divider(
                              height: 1,
                              thickness: 1,
                              color: isDark
                                  ? AppColors.borderSubtle.withValues(alpha: 0.5)
                                  : scheme.outlineVariant.withValues(alpha: 0.2),
                            ),
                            itemBuilder: (context, index) {
                              final item = widget.queuedMessages[index];
                              final text =
                                  (item['text'] as String? ?? '').trim();
                              final hasAttachment = item['fileName'] != null ||
                                  item['images'] != null;
                              final modelUID = item['modelUID']?.toString();

                              return Padding(
                                padding: const EdgeInsets.symmetric(
                                    horizontal: 12, vertical: 8),
                                child: Row(
                                  children: [
                                    // Attachment or message icon preview
                                    Container(
                                      width: 28,
                                      height: 28,
                                      decoration: BoxDecoration(
                                        color: isDark
                                            ? AppColors.surfaceInput
                                            : scheme.surfaceContainer,
                                        borderRadius:
                                            BorderRadius.circular(AppRadius.sm),
                                      ),
                                      child: Icon(
                                        hasAttachment
                                            ? Icons.attach_file
                                            : Icons
                                                .chat_bubble_outline_rounded,
                                        size: 14,
                                        color: isDark
                                            ? AppColors.inkMuted
                                            : scheme.onSurfaceVariant,
                                      ),
                                    ),
                                    const SizedBox(width: 10),

                                    // Text and optional model badge
                                    Expanded(
                                      child: Column(
                                        crossAxisAlignment:
                                            CrossAxisAlignment.start,
                                        mainAxisSize: MainAxisSize.min,
                                        children: [
                                          if (modelUID != null &&
                                              modelUID.isNotEmpty) ...[
                                            Container(
                                              padding:
                                                  const EdgeInsets.symmetric(
                                                      horizontal: 5,
                                                      vertical: 1),
                                              margin: const EdgeInsets.only(
                                                  bottom: 2),
                                              decoration: BoxDecoration(
                                                color: isDark
                                                    ? AppColors.accentBlue
                                                        .withValues(alpha: 0.15)
                                                    : scheme.primary.withValues(
                                                        alpha: 0.1),
                                                borderRadius:
                                                    BorderRadius.circular(4),
                                              ),
                                              child: Text(
                                                modelUID,
                                                style: TextStyle(
                                                  fontSize: 9.5,
                                                  fontWeight: FontWeight.w600,
                                                  color: isDark
                                                      ? AppColors
                                                          .accentBlueBright
                                                      : scheme.primary,
                                                ),
                                                maxLines: 1,
                                                overflow: TextOverflow.ellipsis,
                                              ),
                                            ),
                                          ],
                                          Text(
                                            text.isNotEmpty
                                                ? text
                                                : 'Empty message',
                                            maxLines: 2,
                                            overflow: TextOverflow.ellipsis,
                                            style: TextStyle(
                                              fontSize: 13,
                                              color: text.isNotEmpty
                                                  ? (isDark
                                                      ? AppColors.inkPrimary
                                                      : scheme.onSurface)
                                                  : (isDark
                                                      ? AppColors.inkMuted
                                                      : scheme
                                                          .onSurfaceVariant),
                                              fontStyle: text.isEmpty
                                                  ? FontStyle.italic
                                                  : FontStyle.normal,
                                            ),
                                          ),
                                        ],
                                      ),
                                    ),
                                    const SizedBox(width: 6),

                                    // Action: Send Now
                                    IconButton(
                                      icon: const Icon(
                                          Icons.arrow_forward_rounded),
                                      iconSize: 16,
                                      color: isDark
                                          ? AppColors.inkSecondary
                                          : scheme.primary,
                                      tooltip: 'Send now',
                                      padding: EdgeInsets.zero,
                                      constraints: const BoxConstraints(
                                          minWidth: 28, minHeight: 28),
                                      onPressed: () {
                                        HapticFeedback.lightImpact();
                                        widget.onSendNow(index);
                                      },
                                    ),

                                    // Action: Edit
                                    IconButton(
                                      icon: const Icon(Icons.edit_outlined),
                                      iconSize: 16,
                                      color: isDark
                                          ? AppColors.inkSecondary
                                          : scheme.onSurfaceVariant,
                                      tooltip: 'Edit message',
                                      padding: EdgeInsets.zero,
                                      constraints: const BoxConstraints(
                                          minWidth: 28, minHeight: 28),
                                      onPressed: () {
                                        HapticFeedback.lightImpact();
                                        widget.onEdit(index);
                                      },
                                    ),

                                    // Action: Delete
                                    IconButton(
                                      icon: const Icon(
                                          Icons.delete_outline_rounded),
                                      iconSize: 16,
                                      color: isDark
                                          ? AppColors.danger
                                          : scheme.error,
                                      tooltip: 'Delete from queue',
                                      padding: EdgeInsets.zero,
                                      constraints: const BoxConstraints(
                                          minWidth: 28, minHeight: 28),
                                      onPressed: () {
                                        HapticFeedback.mediumImpact();
                                        widget.onDelete(index);
                                      },
                                    ),
                                  ],
                                ),
                              );
                            },
                          ),
                        ),
                      ),
                    ],
                  )
                : const SizedBox.shrink(),
          ),
        ],
      ),
    );
  }
}
