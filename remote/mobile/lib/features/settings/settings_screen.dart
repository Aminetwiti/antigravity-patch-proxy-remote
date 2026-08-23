import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:http/http.dart' as http;
import 'package:mobile/core/notifications/approval_notifier.dart';
import 'package:mobile/core/protocol/daemon_api.dart';
import 'package:mobile/theme/app_colors.dart';
import 'package:mobile/widgets/app_toast.dart';

import 'account_settings_section.dart';
import 'appearance_settings_section.dart';
import 'app_settings_section.dart';
import 'browser_settings_section.dart';
import 'customizations_settings_section.dart';
import 'general_settings_section.dart';
import 'models_settings_section.dart';
import 'shortcuts_modal.dart';

enum SettingsCategory {
  account,
  general,
  appearance,
  models,
  customizations,
  browser,
  app,
}

/// Écran des Paramètres Modulaire Antigravity (Alignement 1:1 Desktop IDE)
class SettingsScreen extends StatefulWidget {
  const SettingsScreen({
    super.key,
    this.initialSettings = const {},
    this.onThemeModeChanged,
    this.onDaemonSaved,
    this.onDiscover,
    this.onConnect,
    this.api,
    this.notifier,
    this.httpClient,
    this.workspacePath = '',
    this.initialCategory = SettingsCategory.account,
  });

  final Map<String, dynamic> initialSettings;
  final ValueChanged<int>? onThemeModeChanged;
  final ValueChanged<Map<String, dynamic>>? onDaemonSaved;
  final VoidCallback? onDiscover;
  final Future<bool> Function(String host, int port, String csrfToken)? onConnect;
  final DaemonApi? api;
  final ApprovalNotifier? notifier;
  final http.Client? httpClient;
  final String workspacePath;
  final SettingsCategory initialCategory;

  @override
  State<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends State<SettingsScreen> {
  late SettingsCategory _selectedCategory;
  String _selectedDefaultModel = 'Gemini 3.7 Flash Medium';

  @override
  void initState() {
    super.initState();
    _selectedCategory = widget.initialCategory;
    _selectedDefaultModel =
        (widget.initialSettings['defaultModel'] as String?) ?? 'Gemini 3.7 Flash Medium';
  }

  Widget _buildCategoryContent(SettingsCategory category) {
    switch (category) {
      case SettingsCategory.account:
        return AccountSettingsSection(api: widget.api);
      case SettingsCategory.general:
        return GeneralSettingsSection(
          api: widget.api,
          notifier: widget.notifier,
          workspacePath: widget.workspacePath,
        );
      case SettingsCategory.appearance:
        return AppearanceSettingsSection(
          initialIndex: (widget.initialSettings['themeIndex'] as int?) ?? 0,
          onThemeModeChanged: widget.onThemeModeChanged ?? (_) {},
        );
      case SettingsCategory.models:
        return ModelsSettingsSection(
          api: widget.api,
          currentDefaultModel: _selectedDefaultModel,
          onDefaultModelChanged: (m) => setState(() => _selectedDefaultModel = m),
        );
      case SettingsCategory.customizations:
        return CustomizationsSettingsSection(api: widget.api);
      case SettingsCategory.browser:
        return BrowserSettingsSection(api: widget.api);
      case SettingsCategory.app:
        return AppSettingsSection(
          api: widget.api,
          onDaemonSaved: widget.onDaemonSaved,
          onDiscover: widget.onDiscover,
          onConnect: widget.onConnect,
          httpClient: widget.httpClient,
        );
    }
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final isWide = MediaQuery.of(context).size.width >= 640;

    return Scaffold(
      backgroundColor: isDark ? const Color(0xFF0F1012) : scheme.surface,
      appBar: AppBar(
        backgroundColor: isDark ? const Color(0xFF0F1012) : scheme.surfaceContainer,
        elevation: 0,
        leading: IconButton(
          icon: Icon(Icons.arrow_back_ios_new_rounded, size: 18, color: scheme.onSurface),
          onPressed: () => Navigator.of(context).pop(),
          tooltip: 'Fermer',
        ),
        title: Text(
          'Settings',
          style: TextStyle(
            fontSize: 17,
            fontWeight: FontWeight.w600,
            color: scheme.onSurface,
            letterSpacing: -0.2,
          ),
        ),
        actions: [
          IconButton(
            tooltip: 'Shortcuts',
            icon: Icon(Icons.keyboard_outlined, size: 20, color: scheme.onSurfaceVariant),
            onPressed: () => ShortcutsModal.show(context),
          ),
          IconButton(
            tooltip: 'Feedback',
            icon: Icon(Icons.feedback_outlined, size: 19, color: scheme.onSurfaceVariant),
            onPressed: () {
              AppToast.show(context, message: 'Support et feedback disponibles sur github.com/google/antigravity');
            },
          ),
        ],
      ),
      body: isWide
          ? _buildMasterDetailLayout(isDark, scheme)
          : _buildMobileLayout(isDark, scheme),
    );
  }

  Widget _buildMasterDetailLayout(bool isDark, ColorScheme scheme) {
    return Row(
      children: [
        // Left Categories Sidebar (240px wide)
        Container(
          width: 240,
          decoration: BoxDecoration(
            color: isDark ? const Color(0xFF141619) : scheme.surfaceContainer,
            border: Border(
              right: BorderSide(
                color: isDark ? const Color(0xFF26282E) : scheme.outlineVariant,
                width: 1,
              ),
            ),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const SizedBox(height: 12),
              _buildCategoryHeader('SETTINGS'),
              _buildCategoryItem(SettingsCategory.account, 'Account', Icons.person_outline),
              _buildCategoryItem(SettingsCategory.general, 'General', Icons.tune_rounded),
              _buildCategoryItem(SettingsCategory.appearance, 'Appearance', Icons.palette_outlined),
              _buildCategoryItem(SettingsCategory.models, 'Models', Icons.smart_toy_outlined),
              _buildCategoryItem(SettingsCategory.customizations, 'Customizations', Icons.extension_outlined),
              _buildCategoryItem(SettingsCategory.browser, 'Browser', Icons.language_rounded),
              _buildCategoryItem(SettingsCategory.app, 'App', Icons.settings_ethernet_rounded),

              const SizedBox(height: 16),
              _buildCategoryHeader('PROJECTS'),
              if (widget.workspacePath.isNotEmpty)
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
                  child: Row(
                    children: [
                      Icon(Icons.folder_outlined, size: 15, color: scheme.primary),
                      const SizedBox(width: 8),
                      Expanded(
                        child: Text(
                          widget.workspacePath.split(RegExp(r'[\\/]')).last,
                          style: TextStyle(fontSize: 12.5, color: scheme.primary, fontWeight: FontWeight.w500),
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                    ],
                  ),
                ),

              const Spacer(),
              const Divider(height: 1, thickness: 0.5),
              _buildFooterAction('Shortcuts', Icons.keyboard_outlined, () => ShortcutsModal.show(context)),
              _buildFooterAction('Provide Feedback', Icons.feedback_outlined, () {
                AppToast.show(context, message: 'Support et feedback : github.com/google/antigravity');
              }),
              const SizedBox(height: 8),
            ],
          ),
        ),

        // Right Content View
        Expanded(
          child: _buildCategoryContent(_selectedCategory),
        ),
      ],
    );
  }

  Widget _buildMobileLayout(bool isDark, ColorScheme scheme) {
    return ListView(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
      children: [
        _buildCategoryHeader('SETTINGS'),
        _buildMobileTile(
          SettingsCategory.account,
          'Account',
          'Plan Google AI, email et télémétrie',
          Icons.person_outline,
        ),
        _buildMobileTile(
          SettingsCategory.general,
          'General',
          'Autonomie, délais d\'auto-refus et notifications',
          Icons.tune_rounded,
        ),
        _buildMobileTile(
          SettingsCategory.appearance,
          'Appearance',
          'Thèmes, styles de bulles et polices',
          Icons.palette_outlined,
        ),
        _buildMobileTile(
          SettingsCategory.models,
          'Models',
          'Modèle par défaut, Thinking budget et fallbacks',
          Icons.smart_toy_outlined,
        ),
        _buildMobileTile(
          SettingsCategory.customizations,
          'Customizations',
          'Skills, Rules, et serveurs MCP',
          Icons.extension_outlined,
        ),
        _buildMobileTile(
          SettingsCategory.browser,
          'Browser',
          'Navigateur headless CDP et captures web',
          Icons.language_rounded,
        ),
        _buildMobileTile(
          SettingsCategory.app,
          'App & Daemon Bridge',
          'Connexion hôte/port, tunnels et diagnostics',
          Icons.settings_ethernet_rounded,
        ),
        const SizedBox(height: 20),
        _buildCategoryHeader('AIDE & RACCOURCIS'),
        ListTile(
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(AppRadius.md)),
          leading: Icon(Icons.keyboard_outlined, size: 20, color: scheme.onSurfaceVariant),
          title: Text('Shortcuts', style: TextStyle(fontSize: 13.5, color: scheme.onSurface)),
          trailing: Icon(Icons.arrow_forward_ios_rounded, size: 12, color: scheme.onSurfaceVariant),
          onTap: () => ShortcutsModal.show(context),
        ),
        ListTile(
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(AppRadius.md)),
          leading: Icon(Icons.feedback_outlined, size: 20, color: scheme.onSurfaceVariant),
          title: Text('Provide Feedback', style: TextStyle(fontSize: 13.5, color: scheme.onSurface)),
          trailing: Icon(Icons.open_in_new_rounded, size: 14, color: scheme.onSurfaceVariant),
          onTap: () {
            AppToast.show(context, message: 'Support et feedback : github.com/google/antigravity');
          },
        ),
      ],
    );
  }

  Widget _buildMobileTile(
    SettingsCategory category,
    String title,
    String subtitle,
    IconData icon,
  ) {
    final scheme = Theme.of(context).colorScheme;
    final isDark = Theme.of(context).brightness == Brightness.dark;

    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      decoration: BoxDecoration(
        color: isDark ? const Color(0xFF141619) : scheme.surfaceContainer,
        borderRadius: BorderRadius.circular(AppRadius.md),
        border: Border.all(
          color: isDark ? const Color(0xFF26282E) : scheme.outlineVariant,
          width: 1,
        ),
      ),
      child: Material(
        type: MaterialType.transparency,
        child: ListTile(
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(AppRadius.md)),
          leading: Container(
            padding: const EdgeInsets.all(8),
            decoration: BoxDecoration(
              color: const Color(0xFF007AFF).withValues(alpha: 0.12),
              borderRadius: BorderRadius.circular(8),
            ),
            child: Icon(icon, size: 18, color: const Color(0xFF007AFF)),
          ),
          title: Text(
            title,
            style: TextStyle(fontSize: 14, fontWeight: FontWeight.w600, color: scheme.onSurface),
          ),
          subtitle: Text(
            subtitle,
            style: TextStyle(fontSize: 11.5, color: scheme.onSurfaceVariant),
          ),
          trailing: Icon(Icons.arrow_forward_ios_rounded, size: 13, color: scheme.onSurfaceVariant),
          onTap: () {
            Navigator.of(context).push(
              MaterialPageRoute(
                builder: (ctx) => Scaffold(
                  backgroundColor: isDark ? const Color(0xFF0F1012) : scheme.surface,
                  appBar: AppBar(
                    backgroundColor: isDark ? const Color(0xFF0F1012) : scheme.surfaceContainer,
                    elevation: 0,
                    leading: IconButton(
                      icon: Icon(Icons.arrow_back_ios_new_rounded, size: 18, color: scheme.onSurface),
                      onPressed: () => Navigator.of(ctx).pop(),
                    ),
                    title: Text(title, style: TextStyle(fontSize: 16, fontWeight: FontWeight.w600, color: scheme.onSurface)),
                  ),
                  body: _buildCategoryContent(category),
                ),
              ),
            );
          },
        ),
      ),
    );
  }

  Widget _buildCategoryHeader(String title) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
      child: Text(
        title,
        style: const TextStyle(
          fontSize: 11,
          fontWeight: FontWeight.w700,
          color: Color(0xFF8F909A),
          letterSpacing: 0.8,
        ),
      ),
    );
  }

  Widget _buildCategoryItem(SettingsCategory category, String title, IconData icon) {
    final isSelected = _selectedCategory == category;
    final scheme = Theme.of(context).colorScheme;
    final isDark = Theme.of(context).brightness == Brightness.dark;

    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
      child: InkWell(
        onTap: () {
          HapticFeedback.selectionClick();
          setState(() => _selectedCategory = category);
        },
        borderRadius: BorderRadius.circular(AppRadius.sm),
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 7),
          decoration: BoxDecoration(
            color: isSelected
                ? (isDark ? const Color(0xFF24272E) : scheme.primaryContainer)
                : Colors.transparent,
            borderRadius: BorderRadius.circular(AppRadius.sm),
          ),
          child: Row(
            children: [
              Icon(
                icon,
                size: 16,
                color: isSelected ? const Color(0xFF007AFF) : scheme.onSurfaceVariant,
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Text(
                  title,
                  style: TextStyle(
                    fontSize: 13,
                    fontWeight: isSelected ? FontWeight.w600 : FontWeight.w500,
                    color: isSelected ? scheme.onSurface : scheme.onSurfaceVariant,
                  ),
                  overflow: TextOverflow.ellipsis,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildFooterAction(String title, IconData icon, VoidCallback onTap) {
    final scheme = Theme.of(context).colorScheme;
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 2),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(4),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 6),
          child: Row(
            children: [
              Icon(icon, size: 14, color: scheme.onSurfaceVariant),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  title,
                  style: TextStyle(fontSize: 12, color: scheme.onSurfaceVariant),
                  overflow: TextOverflow.ellipsis,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
