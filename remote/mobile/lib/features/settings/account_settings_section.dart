import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:mobile/core/protocol/daemon_api.dart';
import 'package:mobile/theme/app_colors.dart';
import 'package:mobile/widgets/app_toast.dart';

/// Section Account (Antigravity IDE 1:1)
/// Affiche le plan Google AI, l'email, les toggles de télémétrie et d'emails marketing.
class AccountSettingsSection extends StatefulWidget {
  final DaemonApi? api;

  const AccountSettingsSection({super.key, this.api});

  @override
  State<AccountSettingsSection> createState() => _AccountSettingsSectionState();
}

class _AccountSettingsSectionState extends State<AccountSettingsSection> {
  String _email = 'lesjardindelavie@gmail.com';
  String _plan = 'Google AI Pro';
  bool _telemetryEnabled = true;
  bool _marketingEmails = false;

  @override
  void initState() {
    super.initState();
    _loadAccountInfo();
  }

  Future<void> _loadAccountInfo() async {
    if (widget.api == null) return;
    try {
      final info = await widget.api!.getAccountInfo();
      if (mounted) {
        setState(() {
          _email = (info['email'] as String?) ?? _email;
          _plan = (info['plan'] as String?) ?? _plan;
          _telemetryEnabled = (info['telemetryEnabled'] as bool?) ?? _telemetryEnabled;
          _marketingEmails = (info['marketingEmails'] as bool?) ?? _marketingEmails;
        });
      }
    } catch (_) {}
  }

  Future<void> _toggleTelemetry(bool val) async {
    setState(() => _telemetryEnabled = val);
    HapticFeedback.selectionClick();
    if (widget.api != null) {
      try {
        await widget.api!.setAccountPreferences(telemetryEnabled: val);
      } catch (_) {}
    }
  }

  Future<void> _toggleMarketing(bool val) async {
    setState(() => _marketingEmails = val);
    HapticFeedback.selectionClick();
    if (widget.api != null) {
      try {
        await widget.api!.setAccountPreferences(marketingEmails: val);
      } catch (_) {}
    }
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
            'Account',
            style: TextStyle(
              fontSize: 22,
              fontWeight: FontWeight.w700,
              color: scheme.onSurface,
              letterSpacing: -0.5,
            ),
          ),
          const SizedBox(height: 4),
          Text(
            'Manage your plan, credentials, and general preferences.',
            style: TextStyle(
              fontSize: 13,
              color: scheme.onSurfaceVariant,
            ),
          ),
          const SizedBox(height: 24),

          // ── GENERAL GROUP
          Text(
            'General',
            style: TextStyle(
              fontSize: 14,
              fontWeight: FontWeight.w600,
              color: scheme.onSurface,
            ),
          ),
          const SizedBox(height: 10),

          Container(
            decoration: BoxDecoration(
              color: isDark ? AppColors.surfaceRaised : scheme.surfaceContainer,
              borderRadius: BorderRadius.circular(AppRadius.md),
              border: Border.all(
                color: isDark ? AppColors.surfaceInput : scheme.outlineVariant,
                width: 1,
              ),
            ),
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
            child: Column(
              children: [
                // Telemetry
                Row(
                  children: [
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            'Enable Telemetry',
                            style: TextStyle(
                              fontSize: 13.5,
                              fontWeight: FontWeight.w500,
                              color: scheme.onSurface,
                            ),
                          ),
                          const SizedBox(height: 2),
                          Text(
                            'When toggled on, Antigravity collects usage data to help Google enhance performance and features.',
                            style: TextStyle(
                              fontSize: 11.5,
                              color: scheme.onSurfaceVariant,
                            ),
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(width: 12),
                    Switch.adaptive(
                      value: _telemetryEnabled,
                      activeColor: AppColors.accentBlue,
                      onChanged: _toggleTelemetry,
                    ),
                  ],
                ),
                const Divider(height: 20, thickness: 0.5),
                // Marketing Emails
                Row(
                  children: [
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            'Marketing Emails',
                            style: TextStyle(
                              fontSize: 13.5,
                              fontWeight: FontWeight.w500,
                              color: scheme.onSurface,
                            ),
                          ),
                          const SizedBox(height: 2),
                          Text(
                            'Receive product updates, tips, and promotions from Google Antigravity via email.',
                            style: TextStyle(
                              fontSize: 11.5,
                              color: scheme.onSurfaceVariant,
                            ),
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(width: 12),
                    Switch.adaptive(
                      value: _marketingEmails,
                      activeColor: AppColors.accentBlue,
                      onChanged: _toggleMarketing,
                    ),
                  ],
                ),
              ],
            ),
          ),

          const SizedBox(height: 24),

          // ── ACCOUNT GROUP
          Text(
            'Account',
            style: TextStyle(
              fontSize: 14,
              fontWeight: FontWeight.w600,
              color: scheme.onSurface,
            ),
          ),
          const SizedBox(height: 10),

          Container(
            decoration: BoxDecoration(
              color: isDark ? AppColors.surfaceRaised : scheme.surfaceContainer,
              borderRadius: BorderRadius.circular(AppRadius.md),
              border: Border.all(
                color: isDark ? AppColors.surfaceInput : scheme.outlineVariant,
                width: 1,
              ),
            ),
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
            child: Column(
              children: [
                // Plan info
                Row(
                  children: [
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            'Your Plan: $_plan',
                            style: TextStyle(
                              fontSize: 13.5,
                              fontWeight: FontWeight.w600,
                              color: scheme.onSurface,
                            ),
                          ),
                          const SizedBox(height: 2),
                          Text(
                            'You can upgrade to a Google AI Ultra plan to receive higher rate limits.',
                            style: TextStyle(
                              fontSize: 11.5,
                              color: scheme.onSurfaceVariant,
                            ),
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(width: 12),
                    ElevatedButton(
                      style: ElevatedButton.styleFrom(
                        backgroundColor: AppColors.accentBlue,
                        foregroundColor: Colors.white,
                        elevation: 0,
                        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(AppRadius.sm),
                        ),
                      ),
                      onPressed: () {
                        AppToast.show(
                          context,
                          message: 'Plan $_plan actif avec quotas prioritaires.',
                          icon: Icons.workspace_premium_rounded,
                        );
                      },
                      child: const Text('Upgrade', style: TextStyle(fontWeight: FontWeight.w600, fontSize: 12.5)),
                    ),
                  ],
                ),
                const Divider(height: 24, thickness: 0.5),
                // Email
                Row(
                  children: [
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            'Email',
                            style: TextStyle(
                              fontSize: 13.5,
                              fontWeight: FontWeight.w500,
                              color: scheme.onSurface,
                            ),
                          ),
                          const SizedBox(height: 2),
                          Text(
                            _email,
                            style: TextStyle(
                              fontSize: 12,
                              color: scheme.onSurfaceVariant,
                            ),
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(width: 12),
                    OutlinedButton(
                      style: OutlinedButton.styleFrom(
                        foregroundColor: scheme.onSurface,
                        side: BorderSide(color: isDark ? AppColors.borderSubtle : scheme.outline),
                        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(AppRadius.sm),
                        ),
                      ),
                      onPressed: () {
                        AppToast.show(
                          context,
                          message: 'Session connectée via Google Cloud Code.',
                          icon: Icons.info_outline,
                        );
                      },
                      child: const Text('Sign Out', style: TextStyle(fontSize: 12.5)),
                    ),
                  ],
                ),
              ],
            ),
          ),

          const SizedBox(height: 32),

          // Terms footer
          Center(
            child: Text(
              'By using this app, you agree to its Terms of Service',
              style: TextStyle(
                fontSize: 11.5,
                color: scheme.onSurfaceVariant.withValues(alpha: 0.8),
              ),
            ),
          ),
          const SizedBox(height: 20),
        ],
      ),
    );
  }
}
