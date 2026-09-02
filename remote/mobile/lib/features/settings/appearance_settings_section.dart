import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../../services/settings_store.dart';
import 'package:mobile/theme/app_colors.dart';
import 'package:mobile/widgets/app_toast.dart';

/// Préférences d'apparence (Antigravity IDE 1:1 Exact)
/// Configure the agent's visual theme and display preferences.
class AppearanceSettingsSection extends StatefulWidget {
  const AppearanceSettingsSection({
    super.key,
    required this.initialIndex,
    this.initialCompactBubbles = false,
    this.initialMonospaceCode = true,
    required this.onThemeModeChanged,
  });

  final int initialIndex;
  final bool initialCompactBubbles;
  final bool initialMonospaceCode;
  final ValueChanged<int> onThemeModeChanged;

  @override
  State<AppearanceSettingsSection> createState() => _AppearanceSettingsSectionState();
}

class _AppearanceSettingsSectionState extends State<AppearanceSettingsSection> {
  late int _themeModeIndex = widget.initialIndex;

  // Chat Settings
  bool _verboseAgentChat = true;
  String _conversationWidth = 'Default'; // 'Default' | 'Narrow' | 'Wide'

  // Light Theme Tokens
  String _lightPreset = 'Default Light';

  // Couleurs par preset (Light). ponytail: visuel uniquement — aucun thème
  // réel ne consomme ces tokens; la sélection reste FRONTEND-ONLY.
  static const Map<String, Map<String, String>> _lightPalettes = {
    'Default Light': {'bg': '#EEEEEE', 'fg': '#101010', 'accent': '#007ACC'},
    'Monokai Light': {'bg': '#F5F5F5', 'fg': '#272822', 'accent': '#A6E22E'},
    'GitHub Light': {'bg': '#FFFFFF', 'fg': '#24292F', 'accent': '#0969DA'},
  };

  // Dark Theme Tokens
  String _darkPreset = 'Default Dark';

  static const Map<String, Map<String, String>> _darkPalettes = {
    'Default Dark': {'bg': '#141619', 'fg': '#E6EDF3', 'accent': '#007ACC'},
    'One Dark Pro': {'bg': '#282C34', 'fg': '#ABB2BF', 'accent': '#61AFEF'},
    'GitHub Dark': {'bg': '#0D1117', 'fg': '#C9D1D9', 'accent': '#58A6FF'},
    'Dracula': {'bg': '#282A36', 'fg': '#F8F8F2', 'accent': '#BD93F9'},
  };

  String get _lightBg => _lightPalettes[_lightPreset]?['bg'] ?? '#EEEEEE';
  String get _lightFg => _lightPalettes[_lightPreset]?['fg'] ?? '#101010';
  String get _lightAccent => _lightPalettes[_lightPreset]?['accent'] ?? '#007ACC';

  String get _darkBg => _darkPalettes[_darkPreset]?['bg'] ?? '#141619';
  String get _darkFg => _darkPalettes[_darkPreset]?['fg'] ?? '#E6EDF3';
  String get _darkAccent => _darkPalettes[_darkPreset]?['accent'] ?? '#007ACC';

  Color _hex(String s) => Color(int.parse(s.replaceFirst('#', ''), radix: 16) | 0xFF000000);

  @override
  void initState() {
    super.initState();
    _themeModeIndex = widget.initialIndex;
    _loadSettings();
  }

  Future<void> _loadSettings() async {
    final s = await SettingsStore.load();
    if (mounted) {
      setState(() {
        _themeModeIndex = (s['themeMode'] as int?) ?? widget.initialIndex;
        _verboseAgentChat = (s['verboseAgentChat'] as bool?) ?? true;
        _conversationWidth = (s['conversationWidth'] as String?) ?? 'Default';
        _lightPreset = (s['lightPreset'] as String?) ?? 'Default Light';
        _darkPreset = (s['darkPreset'] as String?) ?? 'Default Dark';
      });
    }
  }

  void _setThemeMode(int index) {
    setState(() => _themeModeIndex = index);
    widget.onThemeModeChanged(index);
    SettingsStore.save({'themeMode': index});
  }

  void _setVerboseAgentChat(bool val) {
    setState(() => _verboseAgentChat = val);
    SettingsStore.save({'verboseAgentChat': val});
    AppToast.show(
      context,
      message: val ? 'Verbose Agent Chat activé.' : 'Verbose Agent Chat désactivé.',
      icon: Icons.chat_bubble_outline,
    );
  }

  void _setConversationWidth(String width) {
    setState(() => _conversationWidth = width);
    SettingsStore.save({'conversationWidth': width});
    AppToast.show(
      context,
      message: 'Largeur de conversation : $width',
      icon: Icons.view_column_outlined,
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
            'Appearance',
            style: TextStyle(
              fontSize: 22,
              fontWeight: FontWeight.w700,
              color: scheme.onSurface,
              letterSpacing: -0.5,
            ),
          ),
          const SizedBox(height: 4),
          Text(
            'Configure the agent\'s visual theme and display preferences.',
            style: TextStyle(
              fontSize: 13,
              color: scheme.onSurfaceVariant,
            ),
          ),
          const SizedBox(height: 24),

          // ── 1. Chat Settings
          _buildSectionHeader('Chat Settings', scheme),
          const SizedBox(height: 8),
          _buildCard(
            isDark: isDark,
            scheme: scheme,
            child: Column(
              children: [
                // Verbose Agent Chat
                Row(
                  crossAxisAlignment: CrossAxisAlignment.center,
                  children: [
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            'Verbose Agent Chat',
                            style: TextStyle(fontSize: 13.5, fontWeight: FontWeight.w600, color: scheme.onSurface),
                          ),
                          const SizedBox(height: 3),
                          Text(
                            'Display and preserve intermediate thinking steps.',
                            style: TextStyle(fontSize: 12, color: scheme.onSurfaceVariant),
                          ),
                        ],
                      ),
                    ),
                    Switch.adaptive(
                      value: _verboseAgentChat,
                      activeColor: AppColors.accentBlue,
                      onChanged: _setVerboseAgentChat,
                    ),
                  ],
                ),
                const Divider(height: 20, thickness: 0.5),
                // Conversation Width
                LayoutBuilder(
                  builder: (context, constraints) {
                    final isCompact = constraints.maxWidth < 360;
                    final textCol = Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          'Conversation Width',
                          style: TextStyle(fontSize: 13.5, fontWeight: FontWeight.w600, color: scheme.onSurface),
                        ),
                        const SizedBox(height: 3),
                        Text(
                          'Configure the maximum width of the conversation panel.',
                          style: TextStyle(fontSize: 12, color: scheme.onSurfaceVariant),
                        ),
                      ],
                    );
                    final toggle = _buildSegmentedToggle(
                      isDark: isDark,
                      scheme: scheme,
                      options: const [
                        {'id': 'Default', 'label': 'Default'},
                        {'id': 'Narrow', 'label': 'Narrow'},
                        {'id': 'Wide', 'label': 'Wide'},
                      ],
                      selectedId: _conversationWidth,
                      onChanged: _setConversationWidth,
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
              ],
            ),
          ),

          const SizedBox(height: 24),

          // ── 2. Appearance Mode
          _buildSectionHeader('Appearance', scheme),
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
                      'Appearance',
                      style: TextStyle(fontSize: 13.5, fontWeight: FontWeight.w600, color: scheme.onSurface),
                    ),
                    const SizedBox(height: 3),
                    Text(
                      'Select light, dark, or inherit system settings.',
                      style: TextStyle(fontSize: 12, color: scheme.onSurfaceVariant),
                    ),
                  ],
                );
                final toggle = Container(
                  decoration: BoxDecoration(
                    color: isDark ? AppColors.surfaceRaised : scheme.surfaceContainerHighest,
                    borderRadius: BorderRadius.circular(6),
                    border: Border.all(color: isDark ? AppColors.borderSubtle : scheme.outlineVariant),
                  ),
                  padding: const EdgeInsets.all(2),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      _buildIconToggle(0, Icons.computer_outlined, 'System', isDark, scheme),
                      _buildIconToggle(1, Icons.light_mode_outlined, 'Light', isDark, scheme),
                      _buildIconToggle(2, Icons.dark_mode_outlined, 'Dark', isDark, scheme),
                    ],
                  ),
                );

                if (isCompact) {
                  return Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      textCol,
                      const SizedBox(height: 12),
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

          // ── 3. Light Theme
          _buildSectionHeader('Light Theme', scheme),
          const SizedBox(height: 8),
          _buildCard(
            isDark: isDark,
            scheme: scheme,
            child: Column(
              children: [
                _buildThemeRow(
                  label: 'Preset',
                  child: _buildDropdown(
                    isDark: isDark,
                    scheme: scheme,
                    value: _lightPreset,
                    items: const ['Default Light', 'Monokai Light', 'GitHub Light'],
                    onChanged: (v) {
                      if (v != null) {
                        setState(() => _lightPreset = v);
                        SettingsStore.save({'lightPreset': v});
                      }
                    },
                  ),
                ),
                const SizedBox(height: 12),
                _buildThemeRow(
                  label: 'Background',
                  child: _buildColorPreview(_hex(_lightBg), _lightBg, isDark, scheme),
                ),
                const SizedBox(height: 12),
                _buildThemeRow(
                  label: 'Foreground',
                  child: _buildColorPreview(_hex(_lightFg), _lightFg, isDark, scheme),
                ),
                const SizedBox(height: 12),
                _buildThemeRow(
                  label: 'Accent',
                  child: _buildColorPreview(_hex(_lightAccent), _lightAccent, isDark, scheme),
                ),
              ],
            ),
          ),

          const SizedBox(height: 24),

          // ── 4. Dark Theme
          _buildSectionHeader('Dark Theme', scheme),
          const SizedBox(height: 8),
          _buildCard(
            isDark: isDark,
            scheme: scheme,
            child: Column(
              children: [
                _buildThemeRow(
                  label: 'Preset',
                  child: _buildDropdown(
                    isDark: isDark,
                    scheme: scheme,
                    value: _darkPreset,
                    items: const ['Default Dark', 'One Dark Pro', 'GitHub Dark', 'Dracula'],
                    onChanged: (v) {
                      if (v != null) {
                        setState(() => _darkPreset = v);
                        SettingsStore.save({'darkPreset': v});
                      }
                    },
                  ),
                ),
                const SizedBox(height: 12),
                _buildThemeRow(
                  label: 'Background',
                  child: _buildColorPreview(_hex(_darkBg), _darkBg, isDark, scheme),
                ),
                const SizedBox(height: 12),
                _buildThemeRow(
                  label: 'Foreground',
                  child: _buildColorPreview(_hex(_darkFg), _darkFg, isDark, scheme),
                ),
                const SizedBox(height: 12),
                _buildThemeRow(
                  label: 'Accent',
                  child: _buildColorPreview(_hex(_darkAccent), _darkAccent, isDark, scheme),
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
        color: isDark ? AppColors.surfaceRaised : scheme.surfaceContainer,
        borderRadius: BorderRadius.circular(AppRadius.md),
        border: Border.all(
          color: isDark ? AppColors.surfaceInput : scheme.outlineVariant,
          width: 1,
        ),
      ),
      child: child,
    );
  }

  Widget _buildIconToggle(
    int index,
    IconData icon,
    String tooltip,
    bool isDark,
    ColorScheme scheme,
  ) {
    final isSelected = _themeModeIndex == index;
    return GestureDetector(
      onTap: () {
        HapticFeedback.selectionClick();
        _setThemeMode(index);
      },
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
        decoration: BoxDecoration(
          color: isSelected ? (isDark ? AppColors.borderSubtle : scheme.surface) : Colors.transparent,
          borderRadius: BorderRadius.circular(4),
        ),
        child: Icon(
          icon,
          size: 16,
          color: isSelected ? scheme.primary : scheme.onSurfaceVariant,
        ),
      ),
    );
  }

  Widget _buildThemeRow({required String label, required Widget child}) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      children: [
        Expanded(
          child: Text(
            label,
            style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w500),
            overflow: TextOverflow.ellipsis,
          ),
        ),
        const SizedBox(width: 8),
        child,
      ],
    );
  }

  Widget _buildColorPreview(Color color, String hexLabel, bool isDark, ColorScheme scheme) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(
        color: isDark ? AppColors.surfaceRaised : scheme.surfaceContainerHighest,
        borderRadius: BorderRadius.circular(6),
        border: Border.all(color: isDark ? AppColors.borderSubtle : scheme.outlineVariant),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            width: 14,
            height: 14,
            decoration: BoxDecoration(
              color: color,
              borderRadius: BorderRadius.circular(3),
              border: Border.all(color: Colors.white24, width: 0.5),
            ),
          ),
          const SizedBox(width: 8),
          Text(
            hexLabel,
            style: TextStyle(
              fontSize: 11.5,
              fontFamily: 'monospace',
              fontWeight: FontWeight.w600,
              color: scheme.onSurface,
            ),
          ),
        ],
      ),
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
        color: isDark ? AppColors.surfaceRaised : scheme.surfaceContainerHighest,
        borderRadius: BorderRadius.circular(6),
        border: Border.all(color: isDark ? AppColors.borderSubtle : scheme.outlineVariant),
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
                    ? (isDark ? AppColors.borderSubtle : scheme.surface)
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
        color: isDark ? AppColors.surfaceRaised : scheme.surfaceContainerHighest,
        borderRadius: BorderRadius.circular(6),
        border: Border.all(color: isDark ? AppColors.borderSubtle : scheme.outlineVariant),
      ),
      child: DropdownButtonHideUnderline(
        child: DropdownButton<String>(
          value: items.contains(value) ? value : items.first,
          dropdownColor: isDark ? AppColors.surfaceRaised : scheme.surfaceContainerHigh,
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
}
