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
  String _email = 'account@antigravity.local';
  String _plan = 'Google AI Pro';
  bool _telemetryEnabled = true;
  bool _marketingEmails = false;
  List<Map<String, dynamic>> _accounts = [];
  bool _autoRotate = true;
  bool _switching = false;

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
          if (info['accounts'] is List) {
            _accounts = (info['accounts'] as List)
                .map((e) => Map<String, dynamic>.from(e as Map))
                .toList();
          }
          if (info['autoRotateEnabled'] is bool) {
            _autoRotate = info['autoRotateEnabled'] as bool;
          }
        });
      }
    } catch (_) {}
  }

  Future<void> _switchAccount(String email) async {
    if (widget.api == null || _switching || email == _email) return;
    setState(() => _switching = true);
    HapticFeedback.selectionClick();
    try {
      final res = await widget.api!.switchAccount(email);
      if (mounted) {
        if (res['ok'] == true) {
          setState(() {
            _email = email;
            if (res['accounts'] is List) {
              _accounts = (res['accounts'] as List)
                  .map((e) => Map<String, dynamic>.from(e as Map))
                  .toList();
            }
          });
          AppToast.show(
            context,
            message: 'Compte actif : $email',
            icon: Icons.check_circle_outline_rounded,
          );
        } else {
          AppToast.show(
            context,
            message: res['error']?.toString() ?? 'Échec du changement de compte',
            icon: Icons.error_outline_rounded,
          );
        }
      }
    } catch (e) {
      if (mounted) {
        AppToast.show(
          context,
          message: 'Erreur: $e',
          icon: Icons.error_outline_rounded,
        );
      }
    } finally {
      if (mounted) {
        setState(() => _switching = false);
      }
    }
  }

  Future<void> _selectBestAccount([String model = '']) async {
    if (widget.api == null || _switching) return;
    setState(() => _switching = true);
    HapticFeedback.selectionClick();
    try {
      final res = await widget.api!.selectBestAccount(model: model);
      if (mounted) {
        if (res['ok'] == true) {
          final targetEmail = res['email'] as String? ?? _email;
          setState(() {
            _email = targetEmail;
            if (res['accounts'] is List) {
              _accounts = (res['accounts'] as List)
                  .map((e) => Map<String, dynamic>.from(e as Map))
                  .toList();
            }
          });
          AppToast.show(
            context,
            message: 'Compte optimal sélectionné : $targetEmail',
            icon: Icons.auto_awesome_rounded,
          );
        } else {
          AppToast.show(
            context,
            message: res['error']?.toString() ?? 'Échec sélection du compte',
            icon: Icons.error_outline_rounded,
          );
        }
      }
    } catch (e) {
      if (mounted) {
        AppToast.show(
          context,
          message: 'Erreur: $e',
          icon: Icons.error_outline_rounded,
        );
      }
    } finally {
      if (mounted) {
        setState(() => _switching = false);
      }
    }
  }

  List<Map<String, dynamic>> _filterKeyQuotas(List<Map<String, dynamic>> all) {
    if (all.isEmpty) return const [];
    final pro = all.firstWhere(
      (q) => (q['name'] as String? ?? '').contains('pro') && !(q['name'] as String? ?? '').contains('flash'),
      orElse: () => all.first,
    );
    final claude = all.firstWhere(
      (q) => (q['name'] as String? ?? '').contains('claude'),
      orElse: () => all.length > 1 ? all[1] : all.first,
    );
    final flash = all.firstWhere(
      (q) => (q['name'] as String? ?? '').contains('flash'),
      orElse: () => all.length > 2 ? all[2] : all.first,
    );
    final set = <String>{};
    final res = <Map<String, dynamic>>[];
    for (final m in [pro, claude, flash]) {
      final name = m['name'] as String? ?? '';
      if (name.isNotEmpty && !set.contains(name)) {
        set.add(name);
        res.add(m);
      }
    }
    return res;
  }

  String _formatModelName(String raw) {
    final lower = raw.toLowerCase();
    if (lower.contains('claude')) return 'Claude';
    if (lower.contains('pro')) return 'Pro';
    if (lower.contains('flash')) return 'Flash';
    if (lower.contains('gpt')) return 'GPT';
    return raw.length > 8 ? raw.substring(0, 8) : raw;
  }

  Future<void> _toggleAutoRotate(bool val) async {
    setState(() => _autoRotate = val);
    HapticFeedback.selectionClick();
    if (widget.api != null) {
      try {
        await widget.api!.setAutoRotate(val);
        if (mounted) {
          AppToast.show(
            context,
            message: val
                ? 'Rotation automatique des quotas activée'
                : 'Rotation automatique désactivée',
            icon: val ? Icons.sync_rounded : Icons.sync_disabled_rounded,
          );
        }
      } catch (_) {}
    }
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

          const SizedBox(height: 24),

          // ── MULTI-ACCOUNT POOL GROUP
          Row(
            children: [
              Expanded(
                child: Text(
                  'Pool Multi-Comptes',
                  style: TextStyle(
                    fontSize: 14,
                    fontWeight: FontWeight.w600,
                    color: scheme.onSurface,
                  ),
                ),
              ),
              if (_accounts.isNotEmpty) ...[
                const SizedBox(width: 8),
                TextButton.icon(
                  style: TextButton.styleFrom(
                    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                    minimumSize: Size.zero,
                    tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                    backgroundColor: AppColors.accentBlue.withValues(alpha: 0.12),
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                  ),
                  icon: const Icon(Icons.auto_awesome_rounded, size: 12, color: AppColors.accentBlue),
                  label: const Text(
                    'Optimiser',
                    style: TextStyle(
                      fontSize: 10.5,
                      fontWeight: FontWeight.w600,
                      color: AppColors.accentBlue,
                    ),
                  ),
                  onPressed: _switching ? null : () => _selectBestAccount(),
                ),
                const SizedBox(width: 6),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
                  decoration: BoxDecoration(
                    color: isDark ? AppColors.surfaceInput : scheme.surfaceContainerHigh,
                    borderRadius: BorderRadius.circular(10),
                  ),
                  child: Text(
                    '${_accounts.length} comptes',
                    style: TextStyle(
                      fontSize: 10.5,
                      fontWeight: FontWeight.w600,
                      color: scheme.onSurfaceVariant,
                    ),
                  ),
                ),
              ],
            ],
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
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                // Auto-rotate toggle
                Row(
                  children: [
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            'Rotation Automatique (Fallback Quota)',
                            style: TextStyle(
                              fontSize: 13.5,
                              fontWeight: FontWeight.w500,
                              color: scheme.onSurface,
                            ),
                          ),
                          const SizedBox(height: 2),
                          Text(
                            'Bascule automatiquement sur le prochain compte disponible en cas de limite de quota (HTTP 429).',
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
                      value: _autoRotate,
                      activeColor: AppColors.accentBlue,
                      onChanged: _toggleAutoRotate,
                    ),
                  ],
                ),
                if (_accounts.isNotEmpty) ...[
                  const Divider(height: 20, thickness: 0.5),
                  ListView.separated(
                    shrinkWrap: true,
                    physics: const NeverScrollableScrollPhysics(),
                    itemCount: _accounts.length,
                    separatorBuilder: (_, __) => const Divider(height: 16, thickness: 0.5),
                    itemBuilder: (context, idx) {
                      final acc = _accounts[idx];
                      final email = acc['email'] as String? ?? '';
                      final isActive = acc['isActive'] == true || email == _email;
                      final status = acc['status'] as String? ?? (isActive ? 'active' : 'standby');
                      final isExhausted = status == 'exhausted';
                      final quotas = (acc['quotas'] as List?)
                              ?.map((q) => Map<String, dynamic>.from(q as Map))
                              .toList() ??
                          [];

                      return Row(
                        crossAxisAlignment: CrossAxisAlignment.center,
                        children: [
                          CircleAvatar(
                            radius: 14,
                            backgroundColor: isActive
                                ? AppColors.accentBlue
                                : (isExhausted ? Colors.amber.withValues(alpha: 0.3) : scheme.surfaceContainerHigh),
                            child: Text(
                              email.isNotEmpty ? email[0].toUpperCase() : '?',
                              style: TextStyle(
                                fontSize: 12,
                                fontWeight: FontWeight.bold,
                                color: isActive ? Colors.white : scheme.onSurface,
                              ),
                            ),
                          ),
                          const SizedBox(width: 10),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  email,
                                  style: TextStyle(
                                    fontSize: 12.5,
                                    fontWeight: isActive ? FontWeight.w600 : FontWeight.w400,
                                    color: scheme.onSurface,
                                  ),
                                  overflow: TextOverflow.ellipsis,
                                ),
                                const SizedBox(height: 2),
                                Row(
                                  children: [
                                    Container(
                                      width: 6,
                                      height: 6,
                                      decoration: BoxDecoration(
                                        shape: BoxShape.circle,
                                        color: isActive
                                            ? Colors.greenAccent
                                            : (isExhausted ? Colors.amber : Colors.blueGrey),
                                      ),
                                    ),
                                    const SizedBox(width: 4),
                                    Text(
                                      isActive ? 'Actif' : (isExhausted ? 'Quota épuisé' : 'Standby'),
                                      style: TextStyle(
                                        fontSize: 10.5,
                                        color: isActive ? Colors.green : scheme.onSurfaceVariant,
                                      ),
                                    ),
                                  ],
                                ),
                                if (quotas.isNotEmpty) ...[
                                  const SizedBox(height: 5),
                                  Wrap(
                                    spacing: 4,
                                    runSpacing: 3,
                                    children: _filterKeyQuotas(quotas).map((q) {
                                      final qName = _formatModelName((q['displayName'] as String?) ?? (q['name'] as String?) ?? '');
                                      final pct = (q['percentage'] as num?)?.toInt() ?? 100;
                                      final isLow = pct <= 20;
                                      final isMid = pct > 20 && pct <= 60;
                                      final color = isLow
                                          ? Colors.redAccent
                                          : (isMid ? Colors.amber : Colors.green);
                                      return Container(
                                        padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 1.5),
                                        decoration: BoxDecoration(
                                          color: color.withValues(alpha: 0.1),
                                          borderRadius: BorderRadius.circular(3),
                                          border: Border.all(color: color.withValues(alpha: 0.3), width: 0.5),
                                        ),
                                        child: Text(
                                          '$qName $pct%',
                                          style: TextStyle(
                                            fontSize: 9.5,
                                            fontWeight: FontWeight.w600,
                                            color: color,
                                          ),
                                        ),
                                      );
                                    }).toList(),
                                  ),
                                ],
                              ],
                            ),
                          ),
                          const SizedBox(width: 8),
                          if (isActive)
                            const Icon(
                              Icons.check_circle_rounded,
                              color: AppColors.accentBlue,
                              size: 20,
                            )
                          else
                            OutlinedButton(
                              style: OutlinedButton.styleFrom(
                                foregroundColor: scheme.onSurface,
                                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                                minimumSize: const Size(60, 30),
                                side: BorderSide(
                                  color: isDark ? AppColors.borderSubtle : scheme.outline,
                                ),
                                shape: RoundedRectangleBorder(
                                  borderRadius: BorderRadius.circular(AppRadius.xs),
                                ),
                              ),
                              onPressed: _switching ? null : () => _switchAccount(email),
                              child: const Text('Activer', style: TextStyle(fontSize: 11)),
                            ),
                        ],
                      );
                    },
                  ),
                ] else ...[
                  const Divider(height: 20, thickness: 0.5),
                  Text(
                    'Définissez AG_ACCOUNTS_JSON ou AG_ACCOUNTS_FILE sur le Daemon Coolify/Local pour alimenter le pool.',
                    style: TextStyle(
                      fontSize: 11.5,
                      fontStyle: FontStyle.italic,
                      color: scheme.onSurfaceVariant,
                    ),
                  ),
                ],
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
