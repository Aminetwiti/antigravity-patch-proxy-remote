import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../../../theme/app_colors.dart';

class SlashAction {
  final String command;
  final String label;
  final IconData icon;

  const SlashAction({
    required this.command,
    required this.label,
    required this.icon,
  });
}

class ActionPillsBar extends StatelessWidget {
  const ActionPillsBar({
    super.key,
    required this.onActionSelected,
    this.actions = const [
      SlashAction(command: '/btw', label: 'BTW (Side Question)', icon: Icons.help_outline),
      SlashAction(command: '/grill-me', label: 'Grill Me (Plan Interview)', icon: Icons.psychology_outlined),
      SlashAction(command: '/teamwork-preview', label: 'Teamwork (Multi-Agent)', icon: Icons.group_work_outlined),
      SlashAction(command: '/goal', label: 'Goal (Long Task)', icon: Icons.flag_outlined),
      SlashAction(command: '/learn', label: 'Learn (Save Habit)', icon: Icons.school_outlined),
    ],
  });

  final ValueChanged<String> onActionSelected;
  final List<SlashAction> actions;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final isDark = Theme.of(context).brightness == Brightness.dark;

    return SizedBox(
      height: 34,
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.symmetric(horizontal: 4),
        itemCount: actions.length,
        separatorBuilder: (_, __) => const SizedBox(width: 6),
        itemBuilder: (context, index) {
          final action = actions[index];
          return Semantics(
            label: 'Commande ${action.command} : ${action.label}',
            button: true,
            child: Tooltip(
              message: action.label,
              child: Material(
                color: Colors.transparent,
                child: InkWell(
                  onTap: () {
                    HapticFeedback.selectionClick();
                    onActionSelected(action.command);
                  },
                  borderRadius: BorderRadius.circular(20),
                  child: Container(
                    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
                    decoration: BoxDecoration(
                      gradient: AppGradients.cardCool(isDark: isDark),
                      color: isDark ? AppColors.surfaceRaised : scheme.surfaceContainerHighest,
                      borderRadius: BorderRadius.circular(AppRadius.pill),
                      border: Border.all(
                        color: isDark ? AppColors.borderSubtle : scheme.outlineVariant.withValues(alpha: 0.5),
                        width: 0.8,
                      ),
                    ),
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Icon(action.icon, size: 13.5, color: scheme.primary),
                        const SizedBox(width: 5),
                        Text(
                          action.command,
                          style: TextStyle(
                            fontSize: 12,
                            fontWeight: FontWeight.w600,
                            color: isDark ? AppColors.inkPrimary : scheme.onSurface,
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            ),
          );
        },
      ),
    );
  }
}
