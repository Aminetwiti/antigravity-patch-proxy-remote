import 'dart:async';
import 'package:flutter/material.dart';
import '../../theme/app_colors.dart';

/// FloatingResolutionBanner — Bannière flottante animée non-intrusive
/// style "Quiet Console" notifiant la résolution distante ou l'arbitrage d'un conflit.
class FloatingResolutionBanner extends StatefulWidget {
  final String message;
  final bool isConflict;
  final VoidCallback onDismiss;
  final Duration autoDismissDuration;

  const FloatingResolutionBanner({
    super.key,
    required this.message,
    this.isConflict = false,
    required this.onDismiss,
    this.autoDismissDuration = const Duration(milliseconds: 3500),
  });

  @override
  State<FloatingResolutionBanner> createState() => _FloatingResolutionBannerState();
}

class _FloatingResolutionBannerState extends State<FloatingResolutionBanner>
    with SingleTickerProviderStateMixin {
  late AnimationController _controller;
  late Animation<Offset> _offsetAnimation;
  late Animation<double> _fadeAnimation;
  Timer? _dismissTimer;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 220),
    );

    _offsetAnimation = Tween<Offset>(
      begin: const Offset(0, -0.6),
      end: Offset.zero,
    ).animate(CurvedAnimation(
      parent: _controller,
      curve: Curves.easeOutCubic,
    ));

    _fadeAnimation = CurvedAnimation(
      parent: _controller,
      curve: Curves.easeOut,
    );

    _controller.forward();

    _dismissTimer = Timer(widget.autoDismissDuration, () {
      _dismissWithAnimation();
    });
  }

  void _dismissWithAnimation() {
    if (!mounted) return;
    _controller.reverse().then((_) {
      if (mounted) {
        widget.onDismiss();
      }
    });
  }

  @override
  void dispose() {
    _dismissTimer?.cancel();
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final isDark = theme.brightness == Brightness.dark;

    final borderColor = widget.isConflict
        ? (isDark ? AppColors.warning.withValues(alpha: 0.6) : Colors.amber.shade700)
        : (isDark ? AppColors.borderSubtle : AppColors.borderDefault);

    final iconColor = widget.isConflict
        ? (isDark ? AppColors.warning : Colors.amber.shade800)
        : (isDark ? AppColors.accentBlueBright : AppColors.accentBlue);

    final iconData = widget.isConflict
        ? Icons.bolt_rounded
        : Icons.desktop_windows_outlined;

    return SlideTransition(
      position: _offsetAnimation,
      child: FadeTransition(
        opacity: _fadeAnimation,
        child: Container(
          margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
          decoration: BoxDecoration(
            color: isDark ? AppColors.surfaceOverlay : Colors.white,
            borderRadius: BorderRadius.circular(10),
            border: Border.all(color: borderColor, width: 1),
            boxShadow: [
              BoxShadow(
                color: Colors.black.withValues(alpha: 0.18),
                blurRadius: 10,
                offset: const Offset(0, 4),
              ),
            ],
          ),
          child: Row(
            children: [
              Icon(iconData, size: 18, color: iconColor),
              const SizedBox(width: 10),
              Expanded(
                child: Text(
                  widget.message,
                  style: TextStyle(
                    fontSize: 12.5,
                    fontWeight: FontWeight.w600,
                    fontFamily: 'monospace',
                    color: isDark ? AppColors.inkPrimary : Colors.black87,
                    height: 1.25,
                  ),
                ),
              ),
              const SizedBox(width: 6),
              InkWell(
                key: const Key('floating-banner-close-btn'),
                onTap: _dismissWithAnimation,
                borderRadius: BorderRadius.circular(12),
                child: Padding(
                  padding: const EdgeInsets.all(4),
                  child: Icon(
                    Icons.close,
                    size: 14,
                    color: isDark ? AppColors.inkMuted : Colors.black45,
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
