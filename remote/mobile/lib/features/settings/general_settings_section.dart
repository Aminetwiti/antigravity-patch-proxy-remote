import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:mobile/core/notifications/approval_notifier.dart';
import 'package:mobile/core/protocol/daemon_api.dart';
import 'package:mobile/services/settings_store.dart';
import 'package:mobile/theme/app_colors.dart';
import 'package:mobile/widgets/app_toast.dart';

/// Section General (Antigravity IDE 1:1 Exact)
/// Configure agent execution, queued message delivery, and permissions.
class GeneralSettingsSection extends StatefulWidget {
  final DaemonApi? api;
  final ApprovalNotifier? notifier;
  final String workspacePath;

  const GeneralSettingsSection({
    super.key,
    this.api,
    this.notifier,
    this.workspacePath = '',
  });

  @override
  State<GeneralSettingsSection> createState() => _GeneralSettingsSectionState();
}

class _GeneralSettingsSectionState extends State<GeneralSettingsSection> {
  // Execution
  String _queuedMessagesMode = 'queue'; // 'queue' | 'immediate'

  // Agent Settings (1:1 Antigravity 2.0 Desktop)
  String _securityPreset = 'Default'; // 'Default' | 'Full machine' | 'Turbo mode' | 'Custom'

  // Agent Behavior
  String _artifactReviewPolicy = 'Always Ask'; // 'Always Ask' | 'Auto Approve' | 'Never'

  // Permissions
  String _fileAccessPolicy = 'AGENT_SETTING_POLICY_ASK'; // ALLOW | ASK
  String _internetPolicy = 'AGENT_SETTING_POLICY_ASK'; // ALLOW | ASK

  // Tool Approvals & Notifications
  bool _toolNotifications = true;

  StreamSubscription<Map<String, dynamic>>? _eventsSub;

  @override
  void initState() {
    super.initState();
    _loadSettings();
    if (widget.api != null) {
      _eventsSub = widget.api!.events.listen(_onWsEvent);
    }
  }

  @override
  void dispose() {
    _eventsSub?.cancel();
    super.dispose();
  }

  void _onWsEvent(Map<String, dynamic> event) {
    if (event['type'] == 'project_settings_updated' && event['data'] is Map) {
      final data = Map<String, dynamic>.from(event['data'] as Map);
      if (mounted) {
        setState(() {
          if (data['securityPreset'] is String) {
            _securityPreset = data['securityPreset'] as String;
          }
          if (data['artifactReviewPolicy'] is String) {
            _artifactReviewPolicy = data['artifactReviewPolicy'] as String;
          }
          if (data['queuedMessagesMode'] is String) {
            _queuedMessagesMode = data['queuedMessagesMode'] as String;
          }
        });
      }
    }
  }

  Future<void> _loadSettings() async {
    final s = await SettingsStore.load();
    if (mounted) {
      setState(() {
        _queuedMessagesMode = (s['queuedMessagesMode'] as String?) ?? 'queue';
        _securityPreset = (s['securityPreset'] as String?) ?? 'Default';
        _artifactReviewPolicy = (s['artifactReviewPolicy'] as String?) ?? 'Always Ask';
        _toolNotifications = (s['toolNotifications'] as bool?) ?? true;
      });
      widget.notifier?.setEnabled(_toolNotifications);
    }

    if (widget.api != null) {
      try {
        final pSettings = await widget.api!.getProjectSettings(workspacePath: widget.workspacePath);
        if (mounted && pSettings.isNotEmpty) {
          setState(() {
            if (pSettings['securityPreset'] is String) {
              _securityPreset = pSettings['securityPreset'] as String;
            }
            if (pSettings['artifactReviewPolicy'] is String) {
              _artifactReviewPolicy = pSettings['artifactReviewPolicy'] as String;
            }
            if (pSettings['queuedMessagesMode'] is String) {
              _queuedMessagesMode = pSettings['queuedMessagesMode'] as String;
            }
            if (pSettings['fileAccessPolicy'] is String) {
              _fileAccessPolicy = pSettings['fileAccessPolicy'] as String;
            }
            if (pSettings['internetPolicy'] is String) {
              _internetPolicy = pSettings['internetPolicy'] as String;
            }
          });
        }
      } catch (_) {}
    }
  }

  Future<void> _setQueuedMessagesMode(String mode) async {
    setState(() => _queuedMessagesMode = mode);
    HapticFeedback.selectionClick();
    await SettingsStore.save({'queuedMessagesMode': mode});
    if (widget.api != null) {
      try {
        await widget.api!.updateProjectSettings(
          settings: {
            'queuedMessagesMode': mode,
            'securityPreset': _securityPreset,
            'artifactReviewPolicy': _artifactReviewPolicy,
          },
          workspacePath: widget.workspacePath,
        );
      } catch (_) {}
    }
    if (!mounted) return;
    AppToast.show(
      context,
      message: mode == 'queue' ? 'Queued Messages activé.' : 'Envoi immédiat activé.',
      icon: Icons.schedule_send_outlined,
    );
  }

  Future<void> _setSecurityPreset(String preset) async {
    setState(() => _securityPreset = preset);
    HapticFeedback.selectionClick();
    await SettingsStore.save({'securityPreset': preset});
    if (widget.api != null) {
      try {
        await widget.api!.updateProjectSettings(
          settings: {
            'securityPreset': preset,
            'artifactReviewPolicy': _artifactReviewPolicy,
          },
          workspacePath: widget.workspacePath,
        );
      } catch (_) {}
    }
    if (!mounted) return;
    AppToast.show(
      context,
      message: 'Security Preset : $preset',
      icon: Icons.shield_outlined,
    );
  }

  Future<void> _setArtifactReviewPolicy(String policy) async {
    setState(() => _artifactReviewPolicy = policy);
    HapticFeedback.selectionClick();
    await SettingsStore.save({'artifactReviewPolicy': policy});
    if (widget.api != null) {
      try {
        await widget.api!.updateProjectSettings(
          settings: {
            'securityPreset': _securityPreset,
            'artifactReviewPolicy': policy,
          },
          workspacePath: widget.workspacePath,
        );
      } catch (_) {}
    }
    if (!mounted) return;
    AppToast.show(
      context,
      message: 'Artifact Review Policy : $policy',
      icon: Icons.rate_review_outlined,
    );
  }

  Future<void> _setFileAccessPolicy(String policy) async {
    setState(() => _fileAccessPolicy = policy);
    HapticFeedback.selectionClick();
    await SettingsStore.save({'fileAccessPolicy': policy});
    if (widget.api != null) {
      try {
        await widget.api!.updateProjectSettings(
          settings: {
            'securityPreset': _securityPreset,
            'artifactReviewPolicy': _artifactReviewPolicy,
            'fileAccessPolicy': policy,
          },
          workspacePath: widget.workspacePath,
        );
      } catch (_) {}
    }
    if (!mounted) return;
    AppToast.show(
      context,
      message: policy == 'AGENT_SETTING_POLICY_ALLOW'
          ? 'Accès fichiers autorisé.'
          : 'Accès fichiers : demande de confirmation.',
      icon: Icons.folder_open_outlined,
    );
  }

  Future<void> _setInternetPolicy(String policy) async {
    setState(() => _internetPolicy = policy);
    HapticFeedback.selectionClick();
    await SettingsStore.save({'internetPolicy': policy});
    if (widget.api != null) {
      try {
        await widget.api!.updateProjectSettings(
          settings: {
            'securityPreset': _securityPreset,
            'artifactReviewPolicy': _artifactReviewPolicy,
            'internetPolicy': policy,
          },
          workspacePath: widget.workspacePath,
        );
      } catch (_) {}
    }
    if (!mounted) return;
    AppToast.show(
      context,
      message: policy == 'AGENT_SETTING_POLICY_ALLOW'
          ? 'Accès réseau autorisé.'
          : 'Accès réseau : demande de confirmation.',
      icon: Icons.lan_outlined,
    );
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
            'General',
            style: TextStyle(
              fontSize: 22,
              fontWeight: FontWeight.w700,
              color: scheme.onSurface,
              letterSpacing: -0.5,
            ),
          ),
          const SizedBox(height: 4),
          Text(
            'Configure agent execution, queued message delivery, and permissions.',
            style: TextStyle(
              fontSize: 13,
              color: scheme.onSurfaceVariant,
            ),
          ),
          const SizedBox(height: 24),

          // ── 1. Execution
          _buildSectionHeader('Execution', scheme),
          const SizedBox(height: 8),
          _buildCard(
            isDark: isDark,
            scheme: scheme,
            child: LayoutBuilder(
              builder: (context, constraints) {
                final isCompact = constraints.maxWidth < 360;
                final textCol = Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'Queued Messages',
                      style: TextStyle(fontSize: 13.5, fontWeight: FontWeight.w600, color: scheme.onSurface),
                    ),
                    const SizedBox(height: 3),
                    Text(
                      'Configure when follow-up messages are sent.',
                      style: TextStyle(fontSize: 12, color: scheme.onSurfaceVariant),
                    ),
                    const SizedBox(height: 2),
                    Wrap(
                      crossAxisAlignment: WrapCrossAlignment.center,
                      children: [
                        Text(
                          'Keyboard shortcuts',
                          style: TextStyle(fontSize: 11, color: scheme.onSurfaceVariant.withValues(alpha: 0.8)),
                        ),
                        const SizedBox(width: 4),
                        Icon(Icons.info_outline, size: 12, color: scheme.onSurfaceVariant),
                      ],
                    ),
                  ],
                );
                final toggle = _buildSegmentedToggle(
                  isDark: isDark,
                  scheme: scheme,
                  options: const [
                    {'id': 'queue', 'label': 'Queue'},
                    {'id': 'immediate', 'label': 'Send Immediately'},
                  ],
                  selectedId: _queuedMessagesMode,
                  onChanged: _setQueuedMessagesMode,
                );

                if (isCompact) {
                  return Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      textCol,
                      const SizedBox(height: 10),
                      toggle,
                    ],
                  );
                }

                return Row(
                  crossAxisAlignment: CrossAxisAlignment.center,
                  children: [
                    Expanded(child: textCol),
                    const SizedBox(width: 12),
                    toggle,
                  ],
                );
              },
            ),
          ),

          const SizedBox(height: 24),

          // ── 2. Agent Settings
          _buildSectionHeader('Agent Settings', scheme),
          const SizedBox(height: 8),
          _buildCard(
            isDark: isDark,
            scheme: scheme,
            child: LayoutBuilder(
              builder: (context, constraints) {
                final isCompact = constraints.maxWidth < 360;
                final textCol = Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'Security Preset',
                      style: TextStyle(fontSize: 13.5, fontWeight: FontWeight.w600, color: scheme.onSurface),
                    ),
                    const SizedBox(height: 3),
                    Text(
                      _getSecurityPresetDescription(_securityPreset),
                      style: TextStyle(fontSize: 12, color: scheme.onSurfaceVariant),
                    ),
                    const SizedBox(height: 2),
                    Wrap(
                      crossAxisAlignment: WrapCrossAlignment.center,
                      children: [
                        Text(
                          'Learn more about $_securityPreset',
                          style: TextStyle(fontSize: 11, color: scheme.onSurfaceVariant.withValues(alpha: 0.8)),
                        ),
                        const SizedBox(width: 4),
                        Icon(Icons.info_outline, size: 12, color: scheme.onSurfaceVariant),
                      ],
                    ),
                  ],
                );
                final dropdown = _buildDropdown(
                  isDark: isDark,
                  scheme: scheme,
                  value: _securityPreset,
                  items: const ['Default', 'Full machine', 'Turbo mode', 'Custom'],
                  onChanged: (val) {
                    if (val != null) _setSecurityPreset(val);
                  },
                );

                if (isCompact) {
                  return Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      textCol,
                      const SizedBox(height: 10),
                      dropdown,
                    ],
                  );
                }

                return Row(
                  crossAxisAlignment: CrossAxisAlignment.center,
                  children: [
                    Expanded(child: textCol),
                    const SizedBox(width: 12),
                    dropdown,
                  ],
                );
              },
            ),
          ),

          const SizedBox(height: 24),

          // ── 3. Agent Behavior
          _buildSectionHeader('Agent Behavior', scheme),
          const SizedBox(height: 8),
          _buildCard(
            isDark: isDark,
            scheme: scheme,
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.center,
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'Artifact Review Policy',
                        style: TextStyle(fontSize: 13.5, fontWeight: FontWeight.w600, color: scheme.onSurface),
                      ),
                      const SizedBox(height: 3),
                      Text(
                        'Specifies Agent\'s behavior when asking for review on artifacts, which are documents it creates to enable a richer conversation experience.',
                        style: TextStyle(fontSize: 12, color: scheme.onSurfaceVariant),
                      ),
                    ],
                  ),
                ),
                const SizedBox(width: 12),
                _buildDropdown(
                  isDark: isDark,
                  scheme: scheme,
                  value: _artifactReviewPolicy,
                  items: const ['Always Ask', 'Auto Approve', 'Never'],
                  onChanged: (val) {
                    if (val != null) _setArtifactReviewPolicy(val);
                  },
                ),
              ],
            ),
          ),

          const SizedBox(height: 24),

          // ── 3.5 Tool Approval Notifications
          _buildCard(
            isDark: isDark,
            scheme: scheme,
            child: Row(
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'Tool Approval Notifications',
                        style: TextStyle(fontSize: 13.5, fontWeight: FontWeight.w600, color: scheme.onSurface),
                      ),
                      const SizedBox(height: 3),
                      Text(
                        'Notify on device when the agent requests tool approval.',
                        style: TextStyle(fontSize: 12, color: scheme.onSurfaceVariant),
                      ),
                    ],
                  ),
                ),
                const SizedBox(width: 12),
                Switch.adaptive(
                  value: _toolNotifications,
                  onChanged: (val) {
                    setState(() => _toolNotifications = val);
                    HapticFeedback.selectionClick();
                    widget.notifier?.setEnabled(val);
                    SettingsStore.save({'toolNotifications': val});
                  },
                ),
              ],
            ),
          ),


          const SizedBox(height: 24),

          // ── 4. File Permissions
          _buildSectionHeader('File Permissions', scheme),
          const SizedBox(height: 8),
          _buildCard(
            isDark: isDark,
            scheme: scheme,
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.center,
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'File Access Rules',
                        style: TextStyle(fontSize: 13.5, fontWeight: FontWeight.w600, color: scheme.onSurface),
                      ),
                      const SizedBox(height: 3),
                      Text(
                        'Configure allowed and denied paths for file reads and writes.',
                        style: TextStyle(fontSize: 12, color: scheme.onSurfaceVariant),
                      ),
                    ],
                  ),
                ),
                const SizedBox(width: 12),
                OutlinedButton(
                  onPressed: () {
                    _setFileAccessPolicy(
                      _fileAccessPolicy == 'AGENT_SETTING_POLICY_ALLOW'
                          ? 'AGENT_SETTING_POLICY_ASK'
                          : 'AGENT_SETTING_POLICY_ALLOW',
                    );
                  },
                  style: OutlinedButton.styleFrom(
                    padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                    side: BorderSide(color: isDark ? const Color(0xFF33363F) : scheme.outlineVariant),
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(6)),
                  ),
                  child: Text(
                    _fileAccessPolicy == 'AGENT_SETTING_POLICY_ALLOW' ? 'Restrict' : 'Open',
                    style: TextStyle(fontSize: 12.5, fontWeight: FontWeight.w600, color: scheme.onSurface),
                  ),
                ),
              ],
            ),
          ),

          const SizedBox(height: 24),

          // ── 5. Network Permissions
          _buildSectionHeader('Network Permissions', scheme),
          const SizedBox(height: 8),
          _buildCard(
            isDark: isDark,
            scheme: scheme,
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.center,
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'Network Access Policy',
                        style: TextStyle(fontSize: 13.5, fontWeight: FontWeight.w600, color: scheme.onSurface),
                      ),
                      const SizedBox(height: 3),
                      Text(
                        'Allow outbound network connections to approved hosts and MCP servers.',
                        style: TextStyle(fontSize: 12, color: scheme.onSurfaceVariant),
                      ),
                    ],
                  ),
                ),
                const SizedBox(width: 12),
                OutlinedButton(
                  onPressed: () {
                    _setInternetPolicy(
                      _internetPolicy == 'AGENT_SETTING_POLICY_ALLOW'
                          ? 'AGENT_SETTING_POLICY_ASK'
                          : 'AGENT_SETTING_POLICY_ALLOW',
                    );
                  },
                  style: OutlinedButton.styleFrom(
                    padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                    side: BorderSide(color: isDark ? const Color(0xFF33363F) : scheme.outlineVariant),
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(6)),
                  ),
                  child: Text(
                    _internetPolicy == 'AGENT_SETTING_POLICY_ALLOW' ? 'Restrict' : 'Open',
                    style: TextStyle(fontSize: 12.5, fontWeight: FontWeight.w600, color: scheme.onSurface),
                  ),
                ),
              ],
            ),
          ),

          const SizedBox(height: 20),
        ],
      ),
    );
  }

  Widget _buildSectionHeader(String title, ColorScheme scheme) {
    return Text(
      title,
      style: TextStyle(
        fontSize: 13,
        fontWeight: FontWeight.w600,
        color: scheme.onSurface,
      ),
    );
  }

  Widget _buildCard({
    required bool isDark,
    required ColorScheme scheme,
    required Widget child,
  }) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: isDark ? const Color(0xFF141619) : scheme.surfaceContainer,
        borderRadius: BorderRadius.circular(AppRadius.md),
        border: Border.all(
          color: isDark ? const Color(0xFF26282E) : scheme.outlineVariant,
          width: 1,
        ),
      ),
      child: child,
    );
  }

  Widget _buildSegmentedToggle({
    required bool isDark,
    required ColorScheme scheme,
    required List<Map<String, String>> options,
    required String selectedId,
    required ValueChanged<String> onChanged,
  }) {
    return Container(
      decoration: BoxDecoration(
        color: isDark ? const Color(0xFF1F2228) : scheme.surfaceContainerHighest,
        borderRadius: BorderRadius.circular(6),
        border: Border.all(color: isDark ? const Color(0xFF33363F) : scheme.outlineVariant),
      ),
      padding: const EdgeInsets.all(2),
      child: Wrap(
        spacing: 2,
        runSpacing: 2,
        children: options.map((opt) {
          final isSelected = opt['id'] == selectedId;
          return GestureDetector(
            onTap: () => onChanged(opt['id']!),
            child: AnimatedContainer(
              duration: const Duration(milliseconds: 150),
              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
              decoration: BoxDecoration(
                color: isSelected
                    ? (isDark ? const Color(0xFF33363F) : scheme.surface)
                    : Colors.transparent,
                borderRadius: BorderRadius.circular(4),
              ),
              child: Text(
                opt['label']!,
                style: TextStyle(
                  fontSize: 11.5,
                  fontWeight: isSelected ? FontWeight.w600 : FontWeight.w500,
                  color: isSelected ? scheme.onSurface : scheme.onSurfaceVariant,
                ),
              ),
            ),
          );
        }).toList(),
      ),
    );
  }

  Widget _buildDropdown({
    required bool isDark,
    required ColorScheme scheme,
    required String value,
    required List<String> items,
    required ValueChanged<String?> onChanged,
  }) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 2),
      decoration: BoxDecoration(
        color: isDark ? const Color(0xFF1F2228) : scheme.surfaceContainerHighest,
        borderRadius: BorderRadius.circular(6),
        border: Border.all(color: isDark ? const Color(0xFF33363F) : scheme.outlineVariant),
      ),
      child: DropdownButtonHideUnderline(
        child: DropdownButton<String>(
          value: items.contains(value) ? value : items.first,
          dropdownColor: isDark ? const Color(0xFF1F2228) : scheme.surfaceContainerHigh,
          icon: Icon(Icons.keyboard_arrow_down_rounded, size: 18, color: scheme.onSurfaceVariant),
          style: TextStyle(fontSize: 12, fontWeight: FontWeight.w500, color: scheme.onSurface),
          isDense: true,
          items: items.map((item) {
            return DropdownMenuItem<String>(
              value: item,
              child: Text(item),
            );
          }).toList(),
          onChanged: onChanged,
        ),
      ),
    );
  }

  String _getSecurityPresetDescription(String preset) {
    switch (preset) {
      case 'Full machine':
        return 'All terminal commands require review. The agent can read or write to any file in the machine.';
      case 'Turbo mode':
        return 'Disables all safety barriers for maximal iteration velocity.';
      case 'Custom':
        return 'Manually customize individual settings.';
      case 'Default':
      default:
        return 'Requires manual review for all terminal commands and file accesses outside of the working folders.';
    }
  }
}

