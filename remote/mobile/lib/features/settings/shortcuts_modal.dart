import 'package:flutter/material.dart';
import 'package:mobile/theme/app_colors.dart';

/// Modal Raccourcis Clavier Antigravity 2.0
class ShortcutsModal extends StatelessWidget {
  const ShortcutsModal({super.key});

  static void show(BuildContext context) {
    showDialog(
      context: context,
      builder: (ctx) => const ShortcutsModal(),
    );
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final isDark = Theme.of(context).brightness == Brightness.dark;

    final shortcuts = [
      {'key': 'Ctrl/Cmd + K', 'desc': 'Ouvrir la palette de commandes / Recherche'},
      {'key': 'Ctrl/Cmd + N', 'desc': 'Créer une nouvelle conversation'},
      {'key': 'Ctrl/Cmd + Enter', 'desc': 'Envoyer le message à l\'agent'},
      {'key': 'Ctrl/Cmd + H', 'desc': 'Ouvrir l\'historique des conversations'},
      {'key': 'Ctrl/Cmd + Shift + M', 'desc': 'Explorateur MCP & Outils'},
      {'key': 'Esc', 'desc': 'Annuler / Fermer la fenêtre modale'},
      {'key': 'Tab', 'desc': 'Compléter la suggestion de commande'},
    ];

    final hasTightKeyboard = MediaQuery.of(context).viewInsets.bottom > 150 && MediaQuery.of(context).size.height < 450;

    return AlertDialog(
      scrollable: true,
      insetPadding: EdgeInsets.symmetric(horizontal: 16, vertical: hasTightKeyboard ? 4 : 16),
      titlePadding: EdgeInsets.fromLTRB(16, hasTightKeyboard ? 8 : 18, 16, hasTightKeyboard ? 6 : 10),
      contentPadding: const EdgeInsets.symmetric(horizontal: 16),
      backgroundColor: isDark ? const Color(0xFF141619) : scheme.surfaceContainer,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(AppRadius.lg),
        side: BorderSide(color: isDark ? const Color(0xFF26282E) : scheme.outlineVariant),
      ),
      title: Row(
        children: [
          Icon(Icons.keyboard_outlined, size: 20, color: scheme.primary),
          const SizedBox(width: 8),
          Text(
            'Shortcuts',
            style: TextStyle(fontSize: 16, fontWeight: FontWeight.w600, color: scheme.onSurface),
          ),
        ],
      ),
      content: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 360),
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: shortcuts.map((s) {
              return Padding(
                padding: const EdgeInsets.symmetric(vertical: 6),
                child: Wrap(
                  spacing: 8,
                  runSpacing: 4,
                  crossAxisAlignment: WrapCrossAlignment.center,
                  children: [
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                      decoration: BoxDecoration(
                        color: isDark ? const Color(0xFF1F2228) : scheme.surfaceContainerHigh,
                        borderRadius: BorderRadius.circular(4),
                        border: Border.all(color: isDark ? const Color(0xFF33363F) : scheme.outlineVariant),
                      ),
                      child: Text(
                        s['key']!,
                        style: TextStyle(
                          fontSize: 11.5,
                          fontFamily: 'monospace',
                          fontWeight: FontWeight.w600,
                          color: scheme.onSurface,
                        ),
                      ),
                    ),
                    Text(
                      s['desc']!,
                      style: TextStyle(fontSize: 12, color: scheme.onSurfaceVariant),
                    ),
                  ],
                ),
              );
            }).toList(),
          ),
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: const Text('Fermer'),
        ),
      ],
    );
  }
}
