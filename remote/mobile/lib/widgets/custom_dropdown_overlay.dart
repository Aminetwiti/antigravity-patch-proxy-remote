import 'package:flutter/material.dart';
import '../theme/app_colors.dart';

class CustomDropdownOverlay {
  static OverlayEntry? _currentOverlay;

  static void show({
    required BuildContext context,
    required GlobalKey targetKey,
    required Widget child,
    double? width,
    double? maxHeight,
    bool alignRight = false,
  }) {
    hide();
    
    final RenderBox renderBox = targetKey.currentContext!.findRenderObject() as RenderBox;
    final size = renderBox.size;
    final offset = renderBox.localToGlobal(Offset.zero);

    _currentOverlay = OverlayEntry(
      builder: (context) {
        final media = MediaQuery.of(context);
        final screenHeight = media.size.height;
        final screenWidth = media.size.width;
        final paddingTop = media.padding.top;
        final paddingBottom = media.padding.bottom;
        
        final spaceBelow = screenHeight - (offset.dy + size.height + 8) - paddingBottom;
        final spaceAbove = offset.dy - paddingTop - 8;
        
        double targetMaxHeight = maxHeight ?? 300;
        bool showAbove = spaceBelow < targetMaxHeight && spaceAbove > spaceBelow;
        
        double effectiveMaxHeight = showAbove 
            ? spaceAbove.clamp(120.0, targetMaxHeight) 
            : spaceBelow.clamp(120.0, targetMaxHeight);

        double top = showAbove ? -1 : offset.dy + size.height + 8;
        double bottom = showAbove ? (screenHeight - offset.dy + 8) : 0.0;

        final effectiveWidth = (width ?? size.width).clamp(160.0, screenWidth - 16.0);
        double left = alignRight ? -1 : offset.dx.clamp(8.0, (screenWidth - effectiveWidth - 8.0).clamp(8.0, screenWidth));
        double right = alignRight ? (screenWidth - offset.dx - size.width).clamp(8.0, (screenWidth - effectiveWidth - 8.0).clamp(8.0, screenWidth)) : -1;

        return Stack(
          children: [
            GestureDetector(
              behavior: HitTestBehavior.translucent,
              onTap: hide,
              child: Container(
                color: Colors.transparent,
                width: double.infinity,
                height: double.infinity,
              ),
            ),
            Positioned(
              top: showAbove ? null : top,
              bottom: showAbove ? bottom : null,
              left: alignRight ? null : left,
              right: alignRight ? right : null,
              width: effectiveWidth,
              child: Material(
                color: Colors.transparent,
                child: Builder(builder: (context) {
                  final scheme = Theme.of(context).colorScheme;
                  return Container(
                    constraints: BoxConstraints(maxHeight: effectiveMaxHeight),
                    decoration: BoxDecoration(
                      color: scheme.surfaceContainer,
                      borderRadius: BorderRadius.circular(AppRadius.md),
                      border: Border.all(color: scheme.outlineVariant),
                      boxShadow: [
                        BoxShadow(
                          color: Colors.black.withValues(alpha: 0.25),
                          blurRadius: 10,
                          offset: const Offset(0, 4),
                        ),
                      ],
                    ),
                    child: ClipRRect(
                      borderRadius: BorderRadius.circular(AppRadius.md),
                      child: NotificationListener<ScrollNotification>(
                        onNotification: (notification) => true,
                        child: child,
                      ),
                    ),
                  );
                }),
              ),
            ),
          ],
        );
      },
    );

    Overlay.of(context).insert(_currentOverlay!);
  }

  static void hide() {
    _currentOverlay?.remove();
    _currentOverlay = null;
  }
}
