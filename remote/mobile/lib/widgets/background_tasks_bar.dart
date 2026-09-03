import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:mobile/theme/app_colors.dart';

/// Barre de statut des tâches de fond (Sticky) inspirée fidèlement d'Antigravity IDE.
/// Supporte l'ouverture/fermeture (collapsible) pour gagner de l'espace et le défilement
/// fluide (scrollable) lorsqu'il y a plusieurs tâches simultanées.
class BackgroundTasksBar extends StatefulWidget {
  final List<String> runningTasks;
  final List<String> activeGoals;
  final ValueChanged<String>? onTapTask;
  final ValueChanged<String>? onStopTask;
  final ValueChanged<String>? onTapGoal;
  final ValueChanged<String>? onStopGoal;
  final VoidCallback? onViewTasks;
  final bool initiallyExpanded;

  const BackgroundTasksBar({
    super.key,
    required this.runningTasks,
    this.activeGoals = const [],
    this.onTapTask,
    this.onStopTask,
    this.onTapGoal,
    this.onStopGoal,
    this.onViewTasks,
    this.initiallyExpanded = true,
  });

  @override
  State<BackgroundTasksBar> createState() => _BackgroundTasksBarState();
}

class _BackgroundTasksBarState extends State<BackgroundTasksBar>
    with SingleTickerProviderStateMixin {
  late AnimationController _spinController;
  late bool _expanded;
  final ScrollController _scrollController = ScrollController();

  @override
  void initState() {
    super.initState();
    _spinController = AnimationController(
      vsync: this,
      duration: const Duration(seconds: 2),
    )..repeat();
    _expanded = widget.initiallyExpanded;
  }

  @override
  void didUpdateWidget(covariant BackgroundTasksBar oldWidget) {
    super.didUpdateWidget(oldWidget);
  }

  @override
  void dispose() {
    _spinController.dispose();
    _scrollController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final taskCount = widget.runningTasks.length;
    final goalCount = widget.activeGoals.length;
    if (taskCount == 0 && goalCount == 0) return const SizedBox.shrink();

    final scheme = Theme.of(context).colorScheme;
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final taskPart = taskCount == 1 ? '1 task running' : '$taskCount tasks running';
    final goalPart = goalCount == 1 ? '1 active goal' : '$goalCount active goals';
    final taskLabel = (taskCount > 0 && goalCount > 0)
        ? '$taskPart, $goalPart'
        : (taskCount > 0 ? taskPart : goalPart);
    final viewInsets = MediaQuery.of(context).viewInsets;
    final rawInsetsBottom =
        View.of(context).viewInsets.bottom / MediaQuery.of(context).devicePixelRatio;
    final hasKeyboard = viewInsets.bottom > 50 || rawInsetsBottom > 50;
    final isActuallyExpanded = _expanded && !hasKeyboard;

    Widget buildTaskItem(String task) {
      return Padding(
        padding: const EdgeInsets.symmetric(vertical: 3),
        child: InkWell(
          borderRadius: BorderRadius.circular(6),
          onTap: () {
            HapticFeedback.selectionClick();
            widget.onTapTask?.call(task);
          },
          child: Row(
            children: [
              RotationTransition(
                turns: _spinController,
                child: Container(
                  width: 11,
                  height: 11,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    border: Border.all(
                      color: isDark ? AppColors.accentBlue : scheme.primary,
                      width: 1.5,
                    ),
                  ),
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  task,
                  style: TextStyle(
                    fontSize: 12,
                    fontFamily: 'monospace',
                    color: isDark ? AppColors.inkPrimary : scheme.onSurface,
                  ),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
              ),
              if (widget.onStopTask != null) ...[
                const SizedBox(width: 8),
                GestureDetector(
                  onTap: () {
                    HapticFeedback.mediumImpact();
                    widget.onStopTask!(task);
                  },
                  child: Container(
                    padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                    decoration: BoxDecoration(
                      color: AppColors.danger.withValues(alpha: 0.12),
                      borderRadius: BorderRadius.circular(4),
                      border: Border.all(
                        color: AppColors.danger.withValues(alpha: 0.3),
                        width: 0.8,
                      ),
                    ),
                    child: Text(
                      'Stop',
                      style: TextStyle(
                        fontSize: 10.5,
                        fontWeight: FontWeight.w600,
                        color: AppColors.danger.withValues(alpha: 0.9),
                      ),
                    ),
                  ),
                ),
              ],
            ],
          ),
        ),
      );
    }

    Widget buildGoalItem(String goal) {
      return Padding(
        padding: const EdgeInsets.symmetric(vertical: 3),
        child: InkWell(
          borderRadius: BorderRadius.circular(6),
          onTap: () {
            HapticFeedback.selectionClick();
            widget.onTapGoal?.call(goal);
          },
          child: Row(
            children: [
              RotationTransition(
                turns: _spinController,
                child: Container(
                  width: 11,
                  height: 11,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    border: Border.all(
                      color: isDark ? AppColors.accentBlue : scheme.primary,
                      width: 1.5,
                    ),
                  ),
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  goal,
                  style: TextStyle(
                    fontSize: 12,
                    color: isDark ? AppColors.inkPrimary : scheme.onSurface,
                  ),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
              ),
              if (widget.onStopGoal != null) ...[
                const SizedBox(width: 8),
                GestureDetector(
                  onTap: () {
                    HapticFeedback.mediumImpact();
                    widget.onStopGoal!(goal);
                  },
                  child: Container(
                    padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                    decoration: BoxDecoration(
                      color: AppColors.danger.withValues(alpha: 0.12),
                      borderRadius: BorderRadius.circular(4),
                      border: Border.all(
                        color: AppColors.danger.withValues(alpha: 0.3),
                        width: 0.8,
                      ),
                    ),
                    child: Text(
                      'Stop',
                      style: TextStyle(
                        fontSize: 10.5,
                        fontWeight: FontWeight.w600,
                        color: AppColors.danger.withValues(alpha: 0.9),
                      ),
                    ),
                  ),
                ),
              ],
            ],
          ),
        ),
      );
    }

    final allCount = taskCount + goalCount;

    return Container(
      margin: EdgeInsets.symmetric(horizontal: 12, vertical: hasKeyboard ? 2 : 4),
      decoration: BoxDecoration(
        color: isDark ? AppColors.surfaceRaised : scheme.surfaceContainerHighest,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(
          color: isDark
              ? AppColors.borderSubtle
              : scheme.outlineVariant.withValues(alpha: 0.6),
          width: 1,
        ),
      ),
      padding: EdgeInsets.fromLTRB(12, hasKeyboard ? 5 : 8, 12, hasKeyboard ? 5 : 8),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // En-tête : "1 task running, 1 active goal" + chevron cliquable
          InkWell(
            borderRadius: BorderRadius.circular(6),
            onTap: () {
              HapticFeedback.selectionClick();
              setState(() => _expanded = !_expanded);
            },
            child: Padding(
              padding: const EdgeInsets.symmetric(vertical: 2),
              child: Row(
                children: [
                  Text(
                    taskLabel,
                    style: TextStyle(
                      fontSize: 12,
                      fontWeight: FontWeight.w500,
                      color: isDark ? AppColors.inkSecondary : scheme.onSurfaceVariant,
                      letterSpacing: -0.1,
                    ),
                  ),
                  const Spacer(),
                  Icon(
                    isActuallyExpanded
                        ? Icons.keyboard_arrow_up_rounded
                        : Icons.keyboard_arrow_down_rounded,
                    size: 16,
                    color: isDark ? AppColors.inkSecondary : scheme.onSurfaceVariant,
                  ),
                ],
              ),
            ),
          ),

          // Contenu déroulant animé et défilable (scrollable) pour supporter beaucoup de tâches
          AnimatedSize(
            duration: const Duration(milliseconds: 200),
            curve: Curves.easeOutCubic,
            child: isActuallyExpanded
                ? Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      SizedBox(height: hasKeyboard ? 4 : 6),
                      ConstrainedBox(
                        constraints: BoxConstraints(
                          maxHeight: hasKeyboard ? 80 : (allCount > 3 ? 140 : 180),
                        ),
                        child: Scrollbar(
                          controller: _scrollController,
                          thumbVisibility: allCount > 2,
                          radius: const Radius.circular(4),
                          thickness: 3,
                          child: ListView.separated(
                            controller: _scrollController,
                            shrinkWrap: true,
                            physics: const BouncingScrollPhysics(
                              parent: AlwaysScrollableScrollPhysics(),
                            ),
                            padding: const EdgeInsets.only(right: 2),
                            itemCount: allCount,
                            separatorBuilder: (_, __) => const SizedBox(height: 2),
                            itemBuilder: (context, index) {
                              if (index < taskCount) {
                                return buildTaskItem(widget.runningTasks[index]);
                              }
                              return buildGoalItem(widget.activeGoals[index - taskCount]);
                            },
                          ),
                        ),
                      ),
                    ],
                  )
                : const SizedBox.shrink(),
          ),
        ],
      ),
    );
  }
}
