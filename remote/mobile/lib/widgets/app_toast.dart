import 'dart:async';
import 'dart:ui';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../theme/app_colors.dart';

enum ToastType { info, success, warning, error }

class _ToastItem {
  final String id;
  final String message;
  final IconData? icon;
  final ToastType type;
  final DateTime createdAt;
  final Duration duration;
  Timer? timer;

  _ToastItem({
    required this.id,
    required this.message,
    this.icon,
    required this.type,
    required this.duration,
  }) : createdAt = DateTime.now();
}

/// Floating Toast component in the bottom-right corner.
/// Collapses into a compact stack when multiple toasts arrive, and expands on hover.
class AppToast {
  static final List<_ToastItem> _activeToasts = [];
  static OverlayEntry? _overlayEntry;
  static final ValueNotifier<bool> _isHovered = ValueNotifier(false);
  static int _idCounter = 0;

  @visibleForTesting
  static void resetForTest() {
    for (final t in _activeToasts) {
      t.timer?.cancel();
    }
    _activeToasts.clear();
    _overlayEntry?.remove();
    _overlayEntry = null;
    _isHovered.value = false;
  }

  static void show(
    BuildContext context, {
    required String message,
    IconData? icon,
    ToastType type = ToastType.info,
    Duration duration = const Duration(seconds: 3),
  }) {
    switch (type) {
      case ToastType.info:
        HapticFeedback.selectionClick();
        break;
      case ToastType.success:
        HapticFeedback.lightImpact();
        break;
      case ToastType.warning:
        HapticFeedback.mediumImpact();
        break;
      case ToastType.error:
        HapticFeedback.heavyImpact();
        break;
    }

    final item = _ToastItem(
      id: 'toast_${++_idCounter}_${DateTime.now().millisecondsSinceEpoch}',
      message: message,
      icon: icon,
      type: type,
      duration: duration,
    );

    _activeToasts.add(item);
    _ensureOverlay(context);

    item.timer = Timer(duration, () {
      _removeToast(item.id);
    });
  }

  static void _removeToast(String id) {
    final idx = _activeToasts.indexWhere((t) => t.id == id);
    if (idx != -1) {
      _activeToasts[idx].timer?.cancel();
      _activeToasts.removeAt(idx);
    }
    if (_activeToasts.isEmpty) {
      _overlayEntry?.remove();
      _overlayEntry = null;
    } else {
      _overlayEntry?.markNeedsBuild();
    }
  }

  static void _ensureOverlay(BuildContext context) {
    if (_overlayEntry != null) {
      _overlayEntry!.markNeedsBuild();
      return;
    }

    final overlayState = Overlay.maybeOf(context, rootOverlay: true);
    if (overlayState == null) return;

    _overlayEntry = OverlayEntry(
      builder: (ctx) => _ToastStackOverlay(
        toasts: _activeToasts,
        isHovered: _isHovered,
        onDismiss: _removeToast,
      ),
    );

    overlayState.insert(_overlayEntry!);
  }
}

class _ToastStackOverlay extends StatefulWidget {
  final List<_ToastItem> toasts;
  final ValueNotifier<bool> isHovered;
  final ValueChanged<String> onDismiss;

  const _ToastStackOverlay({
    required this.toasts,
    required this.isHovered,
    required this.onDismiss,
  });

  @override
  State<_ToastStackOverlay> createState() => _ToastStackOverlayState();
}

class _ToastStackOverlayState extends State<_ToastStackOverlay> {
  bool _expanded = false;

  @override
  Widget build(BuildContext context) {
    if (widget.toasts.isEmpty) return const SizedBox.shrink();

    final isDark = Theme.of(context).brightness == Brightness.dark;
    final scheme = Theme.of(context).colorScheme;
    final displayToasts = widget.toasts.reversed.toList();
    final topToast = displayToasts.first;
    final extraCount = displayToasts.length - 1;

    return Positioned(
      right: 16,
      bottom: 24,
      child: Material(
        color: Colors.transparent,
        child: MouseRegion(
          onEnter: (_) => setState(() => _expanded = true),
          onExit: (_) => setState(() => _expanded = false),
          child: GestureDetector(
            onTap: () => setState(() => _expanded = !_expanded),
            child: AnimatedContainer(
              duration: const Duration(milliseconds: 200),
              curve: Curves.easeOutCubic,
              constraints: const BoxConstraints(maxWidth: 360),
              child: _expanded && displayToasts.length > 1
                  ? Column(
                      mainAxisSize: MainAxisSize.min,
                      crossAxisAlignment: CrossAxisAlignment.end,
                      children: [
                        for (int i = 0; i < displayToasts.length; i++) ...[
                          _buildSingleToast(
                            toast: displayToasts[i],
                            isDark: isDark,
                            scheme: scheme,
                            showBadge: false,
                            onClose: () => widget.onDismiss(displayToasts[i].id),
                          ),
                          if (i < displayToasts.length - 1) const SizedBox(height: 6),
                        ],
                      ],
                    )
                  : Stack(
                      clipBehavior: Clip.none,
                      alignment: Alignment.bottomRight,
                      children: [
                        if (extraCount > 1)
                          Positioned(
                            bottom: 8,
                            right: 8,
                            left: 8,
                            child: Container(
                              height: 38,
                              decoration: BoxDecoration(
                                color: (isDark ? AppColors.surfaceInput : scheme.surfaceContainerHighest).withValues(alpha: 0.6),
                                borderRadius: BorderRadius.circular(AppRadius.pill),
                              ),
                            ),
                          ),
                        if (extraCount > 0)
                          Positioned(
                            bottom: 4,
                            right: 4,
                            left: 4,
                            child: Container(
                              height: 38,
                              decoration: BoxDecoration(
                                color: (isDark ? AppColors.surfaceInput : scheme.surfaceContainerHighest).withValues(alpha: 0.8),
                                borderRadius: BorderRadius.circular(AppRadius.pill),
                              ),
                            ),
                          ),
                        _buildSingleToast(
                          toast: topToast,
                          isDark: isDark,
                          scheme: scheme,
                          showBadge: extraCount > 0,
                          extraCount: extraCount,
                          onClose: () => widget.onDismiss(topToast.id),
                        ),
                      ],
                    ),
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildSingleToast({
    required _ToastItem toast,
    required bool isDark,
    required ColorScheme scheme,
    bool showBadge = false,
    int extraCount = 0,
    VoidCallback? onClose,
  }) {
    final (defaultIcon, iconColor, bg, borderColor) = switch (toast.type) {
      ToastType.info => (
          Icons.info_outline,
          isDark ? AppColors.accentBlueBright : scheme.primary,
          (isDark ? AppColors.surfaceRaised : scheme.surfaceContainerHighest).withValues(alpha: isDark ? 0.88 : 0.94),
          (isDark ? AppColors.accentBlue : scheme.primary).withValues(alpha: 0.35),
        ),
      ToastType.success => (
          Icons.check_circle_outline,
          AppColors.positive,
          (isDark ? AppColors.surfaceRaised : scheme.surfaceContainerHighest).withValues(alpha: isDark ? 0.88 : 0.94),
          AppColors.positive.withValues(alpha: 0.35),
        ),
      ToastType.warning => (
          Icons.warning_amber_rounded,
          AppColors.warning,
          (isDark ? AppColors.surfaceRaised : scheme.surfaceContainerHighest).withValues(alpha: isDark ? 0.88 : 0.94),
          AppColors.warning.withValues(alpha: 0.35),
        ),
      ToastType.error => (
          Icons.error_outline,
          isDark ? AppColors.danger : scheme.error,
          (isDark ? AppColors.surfaceRaised : scheme.surfaceContainerHighest).withValues(alpha: isDark ? 0.88 : 0.94),
          (isDark ? AppColors.danger : scheme.error).withValues(alpha: 0.35),
        ),
    };

    return ClipRRect(
      borderRadius: BorderRadius.circular(AppRadius.pill),
      child: BackdropFilter(
        filter: ImageFilter.blur(sigmaX: 12, sigmaY: 12),
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 9),
          decoration: BoxDecoration(
            color: bg,
            borderRadius: BorderRadius.circular(AppRadius.pill),
            boxShadow: [
              BoxShadow(
                color: Colors.black.withValues(alpha: isDark ? 0.35 : 0.15),
                blurRadius: 12,
                offset: const Offset(0, 4),
              ),
            ],
            border: Border.all(
              color: borderColor,
              width: 1,
            ),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(toast.icon ?? defaultIcon, size: 16, color: iconColor),
              const SizedBox(width: 8),
              Flexible(
                child: Text(
                  toast.message,
                  style: TextStyle(
                    fontSize: 12.5,
                    fontWeight: FontWeight.w500,
                    color: isDark ? AppColors.inkPrimary : scheme.onSurface,
                  ),
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                ),
              ),
              if (showBadge && extraCount > 0) ...[
                const SizedBox(width: 8),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                  decoration: BoxDecoration(
                    color: scheme.primary.withValues(alpha: 0.2),
                    borderRadius: BorderRadius.circular(10),
                  ),
                  child: Text(
                    '+$extraCount',
                    style: TextStyle(
                      fontSize: 10.5,
                      fontWeight: FontWeight.w700,
                      color: scheme.primary,
                    ),
                  ),
                ),
              ],
              if (onClose != null) ...[
                const SizedBox(width: 6),
                InkWell(
                  onTap: onClose,
                  borderRadius: BorderRadius.circular(10),
                  child: Padding(
                    padding: const EdgeInsets.all(2),
                    child: Icon(
                      Icons.close_rounded,
                      size: 13,
                      color: isDark ? AppColors.inkMuted : scheme.onSurfaceVariant,
                    ),
                  ),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}
