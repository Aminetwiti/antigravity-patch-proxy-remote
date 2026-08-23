import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:mobile/core/protocol/daemon_api.dart';
import 'package:mobile/services/settings_store.dart';
import 'package:mobile/theme/app_colors.dart';
import 'package:mobile/widgets/app_toast.dart';

/// Section Models & Usage (Antigravity IDE 1:1 Exact)
/// Manage your model quota and credits.
class ModelsSettingsSection extends StatefulWidget {
  final DaemonApi? api;
  final String currentDefaultModel;
  final ValueChanged<String>? onDefaultModelChanged;

  const ModelsSettingsSection({
    super.key,
    this.api,
    this.currentDefaultModel = 'Gemini 3.7 Flash Medium',
    this.onDefaultModelChanged,
  });

  @override
  State<ModelsSettingsSection> createState() => _ModelsSettingsSectionState();
}

class _ModelsSettingsSectionState extends State<ModelsSettingsSection> {
  late String _selectedModel;
  String _reasoningEffort = 'medium'; // off, low, medium, high
  bool _enableCreditOverages = false;
  bool _isLoadingQuotas = false;
  Map<String, String> _modelStatuses = {};

  // Real-time Quota metrics (1:1 with Antigravity IDE).
  // null = pas encore chargé (push quota_update ou fetch) — on affiche un état
  // de chargement au lieu de valeurs factices (BUG-SET-008).
  int? _geminiWeeklyPercent;
  final String _geminiWeeklyRefresh = 'in 2 days, 21 hours';
  int? _gemini5HourPercent;
  final String _gemini5HourRefresh = 'in 2 hours, 32 minutes';

  int? _claudeWeeklyPercent;
  final String _claudeWeeklyRefresh = 'in 5 days, 18 hours';
  int? _claude5HourPercent;
  final String _claude5HourRefresh = 'in 4 hours, 2 minutes';

  final List<String> _models = [
    'Gemini 3.7 Flash Medium',
    'Gemini 3.6 Flash Medium',
    'Gemini 3.5 Flash Medium',
    'Gemini 3.1 Pro Low',
    'Claude Sonnet 4.6 (Thinking)',
    'Claude Opus 4.6 (Thinking)',
    'Claude 3.7 Sonnet',
    'GPT-4o',
    'GPT-OSS 120B (Medium)',
    'DeepSeek R1',
  ];

  StreamSubscription<Map<String, dynamic>>? _eventsSub;

  @override
  void initState() {
    super.initState();
    _selectedModel = widget.currentDefaultModel;
    _loadSettings();
    _fetchAccountAndQuotas();
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
    if (event['type'] == 'quota_update' && event['data'] is Map) {
      _applyQuotaData(Map<String, dynamic>.from(event['data'] as Map));
    }
  }

  void _applyQuotaData(Map<String, dynamic> q) {
    if (!mounted) return;
    setState(() {
      if (q['weeklyPercent'] is int) _geminiWeeklyPercent = q['weeklyPercent'] as int;
      if (q['geminiWeekly'] is int) _geminiWeeklyPercent = q['geminiWeekly'] as int;
      if (q['fiveHourPercent'] is int) _gemini5HourPercent = q['fiveHourPercent'] as int;
      if (q['gemini5Hour'] is int) _gemini5HourPercent = q['gemini5Hour'] as int;
      if (q['weeklyPercentClaude'] is int) _claudeWeeklyPercent = q['weeklyPercentClaude'] as int;
      if (q['claudeWeekly'] is int) _claudeWeeklyPercent = q['claudeWeekly'] as int;
      if (q['fiveHourPercentClaude'] is int) _claude5HourPercent = q['fiveHourPercentClaude'] as int;
      if (q['claude5Hour'] is int) _claude5HourPercent = q['claude5Hour'] as int;
    });
  }

  Future<void> _loadSettings() async {
    final s = await SettingsStore.load();
    if (mounted) {
      setState(() {
        _reasoningEffort = (s['reasoningEffort'] as String?) ?? 'medium';
        _enableCreditOverages = (s['enableCreditOverages'] as bool?) ?? false;
      });
    }
  }

  Future<void> _fetchAccountAndQuotas() async {
    if (widget.api == null) return;
    setState(() => _isLoadingQuotas = true);
    try {
      try {
        final quotaSummary = await widget.api!.getUserQuotaSummary();
        if (mounted && quotaSummary.isNotEmpty) {
          _applyQuotaData(quotaSummary);
        }
      } catch (_) {}

      final info = await widget.api!.getAccountInfo();
      if (mounted && info['quotas'] is Map) {
        _applyQuotaData(Map<String, dynamic>.from(info['quotas'] as Map));
      }
      try {
        final statuses = await widget.api!.getModelStatuses();
        if (mounted && statuses.isNotEmpty) {
          final Map<String, String> parsed = {};
          statuses.forEach((k, v) {
            parsed[k.toLowerCase()] = v.toString();
          });
          setState(() {
            _modelStatuses = parsed;
          });
        }
      } catch (_) {}
    } catch (_) {
    } finally {
      if (mounted) setState(() => _isLoadingQuotas = false);
    }
  }

  void _onModelSelected(String model) {
    setState(() => _selectedModel = model);
    HapticFeedback.selectionClick();
    SettingsStore.save({'defaultModel': model});
    widget.onDefaultModelChanged?.call(model);
    if (widget.api != null) {
      widget.api!.sendCommand('/model $model');
    }
    AppToast.show(context, message: 'Modèle par défaut : $model', icon: Icons.smart_toy_outlined);
  }

  void _onReasoningChanged(String effort) {
    setState(() => _reasoningEffort = effort);
    HapticFeedback.selectionClick();
    SettingsStore.save({'reasoningEffort': effort});
    AppToast.show(context, message: 'Thinking Budget : ${effort.toUpperCase()}', icon: Icons.psychology_outlined);
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
          // Header avec bouton refresh ↻
          Row(
            children: [
              Expanded(
                child: Text(
                  'Models & Usage',
                  style: TextStyle(
                    fontSize: 22,
                    fontWeight: FontWeight.w700,
                    color: scheme.onSurface,
                    letterSpacing: -0.5,
                  ),
                  overflow: TextOverflow.ellipsis,
                ),
              ),
              const SizedBox(width: 8),
              IconButton(
                icon: _isLoadingQuotas
                    ? const SizedBox(
                        width: 16,
                        height: 16,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : Icon(Icons.refresh, size: 18, color: scheme.onSurfaceVariant),
                tooltip: 'Actualiser les quotas',
                onPressed: _isLoadingQuotas ? null : _fetchAccountAndQuotas,
              ),
            ],
          ),
          const SizedBox(height: 2),
          Text(
            'Manage your model quota and credits.',
            style: TextStyle(
              fontSize: 13,
              color: scheme.onSurfaceVariant,
            ),
          ),
          const SizedBox(height: 24),

          // ── 1. Plan
          _buildSectionHeader('Plan', scheme),
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
                      'Your Plan: Google AI Pro',
                      style: TextStyle(fontSize: 13.5, fontWeight: FontWeight.w600, color: scheme.onSurface),
                    ),
                    const SizedBox(height: 3),
                    Text(
                      'You can upgrade to a Google AI Ultra plan to receive higher rate limits.',
                      style: TextStyle(fontSize: 12, color: scheme.onSurfaceVariant),
                    ),
                  ],
                );
                final button = ElevatedButton(
                  onPressed: () {
                    AppToast.show(context, message: 'Redirection vers Google AI One Pro / Ultra...', icon: Icons.rocket_launch_outlined);
                  },
                  style: ElevatedButton.styleFrom(
                    backgroundColor: const Color(0xFF007AFF),
                    foregroundColor: Colors.white,
                    padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(6)),
                    elevation: 0,
                  ),
                  child: const Text(
                    'Upgrade',
                    style: TextStyle(fontSize: 12.5, fontWeight: FontWeight.w600),
                  ),
                );

                if (isCompact) {
                  return Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      textCol,
                      const SizedBox(height: 10),
                      button,
                    ],
                  );
                }

                return Row(
                  crossAxisAlignment: CrossAxisAlignment.center,
                  children: [
                    Expanded(child: textCol),
                    const SizedBox(width: 12),
                    button,
                  ],
                );
              },
            ),
          ),

          const SizedBox(height: 24),

          // ── 2. Model Credits
          _buildSectionHeader('Model Credits', scheme),
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
                      'Enable AI Credit Overages',
                      style: TextStyle(fontSize: 13.5, fontWeight: FontWeight.w600, color: scheme.onSurface),
                    ),
                    const SizedBox(height: 3),
                    Text(
                      'When toggled on, Antigravity will use your AI credits to fulfill model requests once you\'re out of model quota. Antigravity will always use your model quota first before using AI credits.',
                      style: TextStyle(fontSize: 12, color: scheme.onSurfaceVariant),
                    ),
                  ],
                );
                final toggle = Switch.adaptive(
                  value: _enableCreditOverages,
                  activeColor: const Color(0xFF007AFF),
                  onChanged: (val) {
                    setState(() => _enableCreditOverages = val);
                    SettingsStore.save({'enableCreditOverages': val});
                  },
                );

                if (isCompact) {
                  return Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      textCol,
                      const SizedBox(height: 8),
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

          // ── 3. Gemini Models
          Wrap(
            crossAxisAlignment: WrapCrossAlignment.center,
            children: [
              _buildSectionHeader('Gemini Models', scheme),
              const SizedBox(width: 4),
              Icon(Icons.info_outline, size: 13, color: scheme.onSurfaceVariant),
            ],
          ),
          const SizedBox(height: 8),
          _buildCard(
            isDark: isDark,
            scheme: scheme,
            child: Column(
              children: [
                _buildQuotaRow(
                  title: 'Weekly Limit Remaining',
                  subtitle: 'You have used some of your weekly limit, it will fully refresh $_geminiWeeklyRefresh.',
                  percent: _geminiWeeklyPercent,
                  isDark: isDark,
                  scheme: scheme,
                ),
                const Divider(height: 20, thickness: 0.5),
                _buildQuotaRow(
                  title: 'Five Hour Limit Remaining',
                  subtitle: 'You have used some of your 5-hour limit, it will fully refresh $_gemini5HourRefresh.',
                  percent: _gemini5HourPercent,
                  isDark: isDark,
                  scheme: scheme,
                ),
              ],
            ),
          ),

          const SizedBox(height: 24),

          // ── 4. Claude and GPT models
          Wrap(
            crossAxisAlignment: WrapCrossAlignment.center,
            children: [
              _buildSectionHeader('Claude and GPT models', scheme),
              const SizedBox(width: 4),
              Icon(Icons.info_outline, size: 13, color: scheme.onSurfaceVariant),
            ],
          ),
          const SizedBox(height: 8),
          _buildCard(
            isDark: isDark,
            scheme: scheme,
            child: Column(
              children: [
                _buildQuotaRow(
                  title: 'Weekly Limit Remaining',
                  subtitle: 'You have used some of your weekly limit, it will fully refresh $_claudeWeeklyRefresh.',
                  percent: _claudeWeeklyPercent,
                  isDark: isDark,
                  scheme: scheme,
                ),
                const Divider(height: 20, thickness: 0.5),
                _buildQuotaRow(
                  title: 'Five Hour Limit Remaining',
                  subtitle: 'You have used some of your 5-hour limit, it will fully refresh $_claude5HourRefresh.',
                  percent: _claude5HourPercent,
                  isDark: isDark,
                  scheme: scheme,
                ),
              ],
            ),
          ),

          const SizedBox(height: 24),

          // ── 5. Default Model Selection & Thinking Budget
          _buildSectionHeader('Default Model & Thinking Budget', scheme),
          const SizedBox(height: 8),
          _buildCard(
            isDark: isDark,
            scheme: scheme,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                LayoutBuilder(
                  builder: (context, constraints) {
                    final isCompact = constraints.maxWidth < 420;
                    final textCol = Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          'Active Model',
                          style: TextStyle(fontSize: 13.5, fontWeight: FontWeight.w600, color: scheme.onSurface),
                        ),
                        const SizedBox(height: 2),
                        Text(
                          'Select the primary model used for agent turns.',
                          style: TextStyle(fontSize: 12, color: scheme.onSurfaceVariant),
                        ),
                      ],
                    );
                    final dropdown = _buildDropdown(
                      isDark: isDark,
                      scheme: scheme,
                      value: _selectedModel,
                      items: _models,
                      onChanged: (v) {
                        if (v != null) _onModelSelected(v);
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
                        SizedBox(width: 200, child: dropdown),
                      ],
                    );
                  },
                ),
                const Divider(height: 20, thickness: 0.5),
                Text(
                  'Thinking Budget / Reasoning Effort',
                  style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: scheme.onSurface),
                ),
                const SizedBox(height: 4),
                Text(
                  'Control reasoning token allocation for extended problem solving.',
                  style: TextStyle(fontSize: 11.5, color: scheme.onSurfaceVariant),
                ),
                const SizedBox(height: 10),
                _buildSegmentedToggle(
                  isDark: isDark,
                  scheme: scheme,
                  options: const [
                    {'id': 'off', 'label': 'Off'},
                    {'id': 'low', 'label': 'Low (1k)'},
                    {'id': 'medium', 'label': 'Medium (8k)'},
                    {'id': 'high', 'label': 'High (32k)'},
                  ],
                  selectedId: _reasoningEffort,
                  onChanged: _onReasoningChanged,
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

  Widget _buildQuotaRow({
    required String title,
    required String subtitle,
    required int? percent,
    required bool isDark,
    required ColorScheme scheme,
  }) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.center,
      children: [
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                title,
                style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: scheme.onSurface),
              ),
              const SizedBox(height: 2),
              Text(
                subtitle,
                style: TextStyle(fontSize: 11.5, color: scheme.onSurfaceVariant),
              ),
            ],
          ),
        ),
        const SizedBox(width: 16),
        Text(
          percent == null ? '--' : '$percent%',
          style: TextStyle(
            fontSize: 13.5,
            fontWeight: FontWeight.w700,
            color: scheme.onSurface,
          ),
        ),
        const SizedBox(width: 8),
        // ponytail: placeholder statique '--' quand la valeur est null — un
        // spinner indéterminé animerait en continu et casserait pumpAndSettle.
        SizedBox(
          width: 22,
          height: 22,
          child: percent == null
              ? const Icon(Icons.more_horiz, size: 18)
              : CircularProgressIndicator(
                  value: percent / 100.0,
                  strokeWidth: 3,
                  backgroundColor: isDark ? const Color(0xFF26282E) : scheme.outlineVariant,
                  color: percent > 20 ? const Color(0xFF34C759) : const Color(0xFFFF9500),
                ),
        ),
      ],
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
          isExpanded: true,
          items: items.map((item) {
            final lower = item.toLowerCase();
            Color dotColor = const Color(0xFF4CAF50); // Vert par défaut (opérationnel)
            String? statusText;
            for (final entry in _modelStatuses.entries) {
              if (lower.contains(entry.key)) {
                final st = entry.value.toLowerCase();
                if (st.contains('degrad') || st.contains('warn')) {
                  dotColor = const Color(0xFFFFA000);
                  statusText = 'Dégradé';
                } else if (st.contains('down') || st.contains('error')) {
                  dotColor = const Color(0xFFE5534B);
                  statusText = 'Indisponible';
                }
                break;
              }
            }

            return DropdownMenuItem<String>(
              value: item,
              child: Row(
                children: [
                  Container(
                    width: 6,
                    height: 6,
                    margin: const EdgeInsets.only(right: 8),
                    decoration: BoxDecoration(
                      color: dotColor,
                      shape: BoxShape.circle,
                    ),
                  ),
                  Expanded(
                    child: Text(
                      item,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                  if (statusText != null) ...[
                    const SizedBox(width: 6),
                    Text(
                      '($statusText)',
                      style: TextStyle(
                        fontSize: 10,
                        color: dotColor,
                        fontWeight: FontWeight.w500,
                      ),
                    ),
                  ],
                ],
              ),
            );
          }).toList(),
          onChanged: onChanged,
        ),
      ),
    );
  }
}
