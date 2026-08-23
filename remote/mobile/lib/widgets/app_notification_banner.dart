import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../features/chat_stream/models/banner_notification.dart';
import '../theme/app_colors.dart';

/// Composant bannière d'alerte polymorphe et modulaire pour Antigravity Remote.
/// Conforme 1:1 avec les tokens "The Quiet Console" de l'IDE Desktop.
class AppNotificationBanner extends StatelessWidget {
  final BannerNotificationData data;
  final bool isCompact;

  const AppNotificationBanner({
    super.key,
    required this.data,
    this.isCompact = false,
  });

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final scheme = Theme.of(context).colorScheme;

    IconData iconData;

    switch (data.type) {
      case BannerType.quotaExceeded:
        iconData = Icons.indeterminate_check_box_outlined;
        break;
      case BannerType.modelCapacity:
        iconData = Icons.cloud_off_rounded;
        break;
      case BannerType.apiKeyInvalid:
        iconData = Icons.key_off_rounded;
        break;
      case BannerType.fallbackActive:
        iconData = Icons.swap_horiz_rounded;
        break;
      case BannerType.contextLimit:
        iconData = Icons.memory_rounded;
        break;
    }

    final surfaceBg = isDark
        ? const Color(0xFF15161A)
        : scheme.surfaceContainerHighest.withValues(alpha: 0.95);

    final dismissAction = data.actions.where((a) => a.label.toLowerCase() == 'dismiss' || a.label.toLowerCase() == 'ignorer').firstOrNull;
    final otherActions = data.actions.where((a) => a != dismissAction).toList();

    return Container(
      margin: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
      padding: EdgeInsets.symmetric(
        horizontal: 16,
        vertical: isCompact ? 10 : 14,
      ),
      decoration: BoxDecoration(
        color: surfaceBg,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(
          color: isDark ? const Color(0xFF272A30) : scheme.outlineVariant.withValues(alpha: 0.7),
          width: 1.0,
        ),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.35),
            blurRadius: 14,
            offset: const Offset(0, 4),
          ),
        ],
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(iconData, size: 17, color: isDark ? const Color(0xFF9E9E9E) : scheme.onSurfaceVariant),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  data.title,
                  style: TextStyle(
                    fontSize: 13.5,
                    fontWeight: FontWeight.w600,
                    color: isDark ? Colors.white : scheme.onSurface,
                    letterSpacing: -0.01,
                  ),
                ),
              ),
              if (data.errorId != null && !isCompact)
                InkWell(
                  onTap: () {
                    Clipboard.setData(ClipboardData(text: data.errorId!));
                    HapticFeedback.lightImpact();
                  },
                  borderRadius: BorderRadius.circular(4),
                  child: Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 2.5),
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Icon(Icons.copy_rounded, size: 11, color: isDark ? AppColors.inkMuted : scheme.outline),
                        const SizedBox(width: 4),
                        Text(
                          'ID',
                          style: TextStyle(
                            fontSize: 10,
                            color: isDark ? AppColors.inkMuted : scheme.outline,
                            fontWeight: FontWeight.w500,
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
            ],
          ),
          if (!isCompact) ...[
            const SizedBox(height: 8),
            Text(
              data.message,
              style: TextStyle(
                fontSize: 12.5,
                height: 1.45,
                color: isDark ? const Color(0xFFB0B3BC) : scheme.onSurfaceVariant,
              ),
            ),
          ],
          const SizedBox(height: 14),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              // Bouton Dismiss à gauche
              if (dismissAction != null)
                InkWell(
                  onTap: () {
                    HapticFeedback.lightImpact();
                    dismissAction.onPressed();
                  },
                  borderRadius: BorderRadius.circular(6),
                  child: Container(
                    padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 7),
                    decoration: BoxDecoration(
                      color: isDark ? const Color(0xFF26282E) : scheme.surfaceContainerHigh,
                      borderRadius: BorderRadius.circular(6),
                      border: Border.all(
                        color: isDark ? const Color(0xFF383A42) : scheme.outlineVariant.withValues(alpha: 0.5),
                        width: 0.8,
                      ),
                    ),
                    child: Text(
                      dismissAction.label,
                      style: TextStyle(
                        fontSize: 12,
                        fontWeight: FontWeight.w500,
                        color: isDark ? const Color(0xFFD4D4D8) : scheme.onSurface,
                      ),
                    ),
                  ),
                )
              else
                const SizedBox.shrink(),
              // Boutons d'action à droite
              Row(
                mainAxisSize: MainAxisSize.min,
                children: otherActions.map((action) {
                  final isPrimary = action.isPrimary;
                  return Padding(
                    padding: const EdgeInsets.only(left: 8),
                    child: InkWell(
                      onTap: () {
                        HapticFeedback.lightImpact();
                        action.onPressed();
                      },
                      borderRadius: BorderRadius.circular(6),
                      child: Container(
                        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 7),
                        decoration: BoxDecoration(
                          color: isPrimary
                              ? const Color(0xFF007FFF)
                              : (isDark ? const Color(0xFF26282E) : scheme.surfaceContainerHigh),
                          borderRadius: BorderRadius.circular(6),
                          border: isPrimary
                              ? null
                              : Border.all(
                                  color: isDark ? const Color(0xFF383A42) : scheme.outlineVariant.withValues(alpha: 0.5),
                                  width: 0.8,
                                ),
                        ),
                        child: Text(
                          action.label,
                          style: TextStyle(
                            fontSize: 12,
                            fontWeight: isPrimary ? FontWeight.w600 : FontWeight.w500,
                            color: isPrimary ? Colors.white : (isDark ? const Color(0xFFE0E0E0) : scheme.onSurface),
                          ),
                        ),
                      ),
                    ),
                  );
                }).toList(),
              ),
            ],
          ),
        ],
      ),
    );
  }
}
