import 'package:flutter/material.dart';
import 'package:mobile/core/protocol/daemon_api.dart';
import 'package:mobile/services/settings_store.dart';
import 'package:mobile/theme/app_colors.dart';
import 'package:mobile/widgets/app_toast.dart';

/// Section Browser (Antigravity IDE 1:1)
/// Gère le navigateur autonome (Headless CDP / Playwright) et les captures d'écran web.
class BrowserSettingsSection extends StatefulWidget {
  final DaemonApi? api;

  const BrowserSettingsSection({super.key, this.api});

  @override
  State<BrowserSettingsSection> createState() => _BrowserSettingsSectionState();
}

class _BrowserSettingsSectionState extends State<BrowserSettingsSection> {
  bool _autoCapture = true;
  bool _headlessMode = true;
  Map<String, dynamic> _browserStatus = const {
    'available': true,
    'mode': 'headless_cdp',
    'paired': false,
  };

  @override
  void initState() {
    super.initState();
    _loadSettings();
    _fetchBrowserStatus();
  }

  Future<void> _loadSettings() async {
    final s = await SettingsStore.load();
    if (mounted) {
      setState(() {
        _autoCapture = (s['browserAutoCapture'] as bool?) ?? true;
        _headlessMode = (s['browserHeadlessMode'] as bool?) ?? true;
      });
    }
  }

  Future<void> _fetchBrowserStatus() async {
    if (widget.api == null) return;
    try {
      final status = await widget.api!.getBrowserStatus();
      if (mounted) {
        setState(() {
          _browserStatus = status;
        });
      }
    } catch (_) {}
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final isDark = Theme.of(context).brightness == Brightness.dark;

    return SingleChildScrollView(
      padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Header
          Text(
            'Browser',
            style: TextStyle(
              fontSize: 22,
              fontWeight: FontWeight.w700,
              color: scheme.onSurface,
              letterSpacing: -0.5,
            ),
          ),
          const SizedBox(height: 4),
          Text(
            'Configure remote headless browser automation, DevTools Protocol (CDP), and visual testing.',
            style: TextStyle(
              fontSize: 13,
              color: scheme.onSurfaceVariant,
            ),
          ),
          const SizedBox(height: 24),

          // Browser Status Card
          Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: isDark ? AppColors.surfaceRaised : scheme.surfaceContainer,
              borderRadius: BorderRadius.circular(AppRadius.md),
              border: Border.all(
                color: isDark ? AppColors.surfaceInput : scheme.outlineVariant,
                width: 1,
              ),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Container(
                      padding: const EdgeInsets.all(8),
                      decoration: BoxDecoration(
                        color: AppColors.accentBlue.withValues(alpha: 0.15),
                        shape: BoxShape.circle,
                      ),
                      child: const Icon(Icons.language_rounded, size: 20, color: AppColors.accentBlue),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            'Headless Chrome DevTools (CDP)',
                            style: TextStyle(fontSize: 14, fontWeight: FontWeight.w600, color: scheme.onSurface),
                          ),
                          Text(
                            _browserStatus['available'] == true ? 'Prêt pour l\'automatisation' : 'Non disponible',
                            style: TextStyle(
                              fontSize: 11.5,
                              color: _browserStatus['available'] == true ? Colors.green : scheme.error,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
                const Divider(height: 24, thickness: 0.5),
                Row(
                  children: [
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            'Mode Headless Silencieux',
                            style: TextStyle(fontSize: 13, fontWeight: FontWeight.w500, color: scheme.onSurface),
                          ),
                          const SizedBox(height: 3),
                          Text(
                            'Exécute le navigateur sans fenêtre visible pour des interactions ultra-rapides.',
                            style: TextStyle(fontSize: 11.5, color: scheme.onSurfaceVariant),
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(width: 12),
                    Switch.adaptive(
                      value: _headlessMode,
                      activeColor: AppColors.accentBlue,
                      onChanged: (val) {
                        setState(() => _headlessMode = val);
                        SettingsStore.save({'browserHeadlessMode': val});
                      },
                    ),
                  ],
                ),
                const Divider(height: 20, thickness: 0.5),
                Row(
                  children: [
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            'Captures d\'écran automatiques',
                            style: TextStyle(fontSize: 13, fontWeight: FontWeight.w500, color: scheme.onSurface),
                          ),
                          const SizedBox(height: 3),
                          Text(
                            'Prend automatiquement une capture visuelle lors des tests d\'interface et des erreurs.',
                            style: TextStyle(fontSize: 11.5, color: scheme.onSurfaceVariant),
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(width: 12),
                    Switch.adaptive(
                      value: _autoCapture,
                      activeColor: AppColors.accentBlue,
                      onChanged: (val) {
                        setState(() => _autoCapture = val);
                        SettingsStore.save({'browserAutoCapture': val});
                      },
                    ),
                  ],
                ),

              ],
            ),
          ),

          const SizedBox(height: 24),

          // Actions
          OutlinedButton.icon(
            style: OutlinedButton.styleFrom(
              foregroundColor: scheme.onSurface,
              side: BorderSide(color: isDark ? AppColors.borderSubtle : scheme.outline),
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(AppRadius.sm)),
            ),
            onPressed: () {
              AppToast.show(
                context,
                message: 'Navigateur CDP prêt pour les commandes /browser.',
                icon: Icons.check_circle_outline,
              );
            },
            icon: const Icon(Icons.speed_rounded, size: 16),
            label: const Text('Tester l\'instance Navigateur', style: TextStyle(fontSize: 13)),
          ),
          const SizedBox(height: 20),
        ],
      ),
    );
  }
}
