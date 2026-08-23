import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../../core/protocol/daemon_api.dart';
import '../../core/notifications/approval_notifier.dart';
import '../../widgets/skeleton_loader.dart';
import 'models/scheduled_task_item.dart';
import 'scheduled_task_detail_screen.dart';
import 'package:mobile/theme/app_colors.dart';

/// Écran Scheduled Tasks (Antigravity 2.0)
/// Affiche la liste des tâches récurrentes / timers avec recherche, toggle on/off,
/// menu d'actions (Restart / Delete) et création via le modal "+ New".
/// Synchronisé via RPC et WebSocket avec le daemon.
class ScheduledTasksScreen extends StatefulWidget {
  final List<ScheduledTaskItem> tasks;
  final DaemonApi? api;
  final ValueChanged<String>? onCancelTask;
  final ValueChanged<String>? onTriggerNow;
  final Function(String id, bool isEnabled)? onToggleTask;
  final Function(ScheduledTaskItem item)? onAddTask;
  final Future<void> Function()? onRefresh;
  final List<String>? workspaces;

  const ScheduledTasksScreen({
    super.key,
    required this.tasks,
    this.api,
    this.onCancelTask,
    this.onTriggerNow,
    this.onToggleTask,
    this.onAddTask,
    this.onRefresh,
    this.workspaces,
  });

  @override
  State<ScheduledTasksScreen> createState() => _ScheduledTasksScreenState();
}

class _ScheduledTasksScreenState extends State<ScheduledTasksScreen> {
  final TextEditingController _searchController = TextEditingController();
  String _searchQuery = '';
  late List<ScheduledTaskItem> _localTasks;
  StreamSubscription<Map<String, dynamic>>? _eventsSub;
  bool _isLoading = false;

  @override
  void initState() {
    super.initState();
    _localTasks = List.from(widget.tasks);
    _searchController.addListener(() {
      setState(() {
        _searchQuery = _searchController.text.trim().toLowerCase();
      });
    });

    if (widget.api != null) {
      _loadFromApi();
      _eventsSub = widget.api!.events.listen(_handleWsEvent);
    }
  }

  Future<void> _loadFromApi() async {
    if (widget.api == null) return;
    setState(() => _isLoading = true);
    try {
      final remoteTasks = await widget.api!.listScheduledTasks();
      if (mounted) {
        setState(() {
          _localTasks = List<ScheduledTaskItem>.from(remoteTasks);
          _isLoading = false;
        });
      }
    } catch (_) {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  void _handleWsEvent(Map<String, dynamic> event) {
    final type = event['type'] as String? ?? '';
    final rawData = event['data'];
    final data = rawData is Map ? Map<String, dynamic>.from(rawData) : const <String, dynamic>{};

    if (type == 'scheduled_task_created') {
      final rawTask = data['task'];
      if (rawTask is Map) {
        final item = ScheduledTaskItem.fromJson(Map<String, dynamic>.from(rawTask));
        setState(() {
          _localTasks.removeWhere((t) => t.id == item.id);
          _localTasks.insert(0, item);
        });
      }
    } else if (type == 'scheduled_task_updated' || type == 'scheduled_task_event') {
      final rawTask = data['task'];
      if (rawTask is Map) {
        final item = ScheduledTaskItem.fromJson(Map<String, dynamic>.from(rawTask));
        setState(() {
          final idx = _localTasks.indexWhere((t) => t.id == item.id);
          if (idx >= 0) {
            _localTasks[idx] = item;
          } else {
            _localTasks.insert(0, item);
          }
        });
      }
      // P1 : une tâche planifiée vient de démarrer (cron ou déclenchement
      // manuel) — notification discrète, auto-annulée 5 s, dédupliquée 30 s.
      if (type == 'scheduled_task_event' && data['taskStarted'] == true) {
        final rawTask2 = data['task'];
        if (rawTask2 is Map) {
          final item = ScheduledTaskItem.fromJson(Map<String, dynamic>.from(rawTask2));
          ApprovalNotifier.instance.notifyTaskStarted(
            cascadeId: item.id,
            prompt: item.prompt,
          );
        }
      }
    } else if (type == 'scheduled_task_deleted') {
      final taskId = data['taskId'] as String? ?? '';
      if (taskId.isNotEmpty) {
        setState(() {
          _localTasks.removeWhere((t) => t.id == taskId);
        });
      }
    }
  }

  @override
  void didUpdateWidget(covariant ScheduledTasksScreen oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.tasks != widget.tasks) {
      setState(() {
        _localTasks = List.from(widget.tasks);
      });
    }
  }

  @override
  void dispose() {
    _eventsSub?.cancel();
    _searchController.dispose();
    super.dispose();
  }

  void _openNewTaskModal() {
    HapticFeedback.selectionClick();
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      backgroundColor: Colors.transparent,
      builder: (context) => _NewScheduledTaskModal(
        workspaces: widget.workspaces ?? const ['Workspace'],
        onAdd: (newTask) {
          setState(() {
            _localTasks.insert(0, newTask);
          });
          if (widget.onAddTask != null) {
            widget.onAddTask?.call(newTask);
          } else {
            widget.api?.scheduleTask(newTask);
          }
        },
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final filtered = _localTasks.where((task) {
      if (_searchQuery.isEmpty) return true;
      final name = task.displayName.toLowerCase();
      final prompt = task.prompt.toLowerCase();
      final cron = (task.cronExpression ?? '').toLowerCase();
      return name.contains(_searchQuery) || prompt.contains(_searchQuery) || cron.contains(_searchQuery);
    }).toList();

    final scheme = Theme.of(context).colorScheme;
    final isDark = Theme.of(context).brightness == Brightness.dark;

    return Scaffold(
      backgroundColor: isDark ? const Color(0xFF0F1117) : scheme.surface,
      appBar: AppBar(
        backgroundColor: isDark ? const Color(0xFF13151B) : scheme.surfaceContainerLow,
        elevation: 0,
        leading: IconButton(
          icon: Icon(Icons.arrow_back_rounded, size: 20, color: scheme.onSurface),
          onPressed: () => Navigator.of(context).pop(),
        ),
        title: Text(
          'Scheduled Tasks',
          style: TextStyle(
            fontSize: 16,
            fontWeight: FontWeight.w700,
            color: scheme.onSurface,
            letterSpacing: -0.2,
          ),
        ),
        actions: [
          Padding(
            padding: const EdgeInsets.only(right: 12),
            child: Material(
              color: Colors.transparent,
              child: InkWell(
                onTap: _openNewTaskModal,
                borderRadius: BorderRadius.circular(AppRadius.md),
                child: Container(
                  padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                  decoration: BoxDecoration(
                    color: scheme.primaryContainer.withValues(alpha: 0.25),
                    borderRadius: BorderRadius.circular(AppRadius.md),
                    border: Border.all(color: scheme.primary.withValues(alpha: 0.4), width: 1),
                  ),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text(
                        '+ New',
                        style: TextStyle(
                          fontSize: 12.5,
                          fontWeight: FontWeight.w500,
                          color: scheme.onSurface,
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ),
        ],
      ),
      body: SafeArea(
        child: Column(
          children: [
            // ── Search Bar ──────────────────────────────────────────
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 4, 16, 12),
              child: Container(
                height: 40,
                decoration: BoxDecoration(
                  color: isDark ? const Color(0xFF1B1D22) : scheme.surfaceContainerHighest,
                  borderRadius: BorderRadius.circular(AppRadius.lg),
                  border: Border.all(color: scheme.outlineVariant, width: 1),
                ),
                child: TextField(
                  controller: _searchController,
                  style: TextStyle(fontSize: 13, color: scheme.onSurface),
                  cursorColor: scheme.primary,
                  decoration: InputDecoration(
                    hintText: 'Search tasks...',
                    hintStyle: TextStyle(fontSize: 13, color: scheme.onSurfaceVariant.withValues(alpha: 0.7)),
                    prefixIcon: Icon(Icons.search_rounded, size: 18, color: scheme.onSurfaceVariant),
                    suffixIcon: _searchQuery.isNotEmpty
                        ? IconButton(
                            icon: Icon(Icons.close_rounded, size: 16, color: scheme.onSurfaceVariant),
                            tooltip: 'Effacer la recherche',
                            onPressed: () => _searchController.clear(),
                          )
                        : null,
                    border: InputBorder.none,
                    contentPadding: const EdgeInsets.symmetric(vertical: 10),
                  ),
                ),
              ),
            ),

            if (_isLoading)
              LinearProgressIndicator(minHeight: 2, color: scheme.primary, backgroundColor: Colors.transparent),

            // ── Tasks List or Empty State ─────────────────────────────
            Expanded(
              child: _isLoading && filtered.isEmpty
                  ? SkeletonLoader(
                      child: ListView(
                        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
                        physics: const NeverScrollableScrollPhysics(),
                        children: const [
                          SkeletonScheduledTaskRow(),
                          Divider(height: 1),
                          SkeletonScheduledTaskRow(),
                          Divider(height: 1),
                          SkeletonScheduledTaskRow(),
                        ],
                      ),
                    )
                  : RefreshIndicator(
                      onRefresh: widget.onRefresh ?? _loadFromApi,
                      color: scheme.primary,
                      child: filtered.isEmpty
                          ? SingleChildScrollView(
                              physics: const AlwaysScrollableScrollPhysics(),
                              child: SizedBox(
                                height: MediaQuery.of(context).size.height * 0.6,
                                child: _buildEmptyState(scheme),
                              ),
                            )
                    : ListView.separated(
                        physics: const AlwaysScrollableScrollPhysics(),
                        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 6),
                        itemCount: filtered.length,
                        separatorBuilder: (context, index) => Divider(
                          height: 1,
                          color: scheme.outlineVariant,
                          indent: 12,
                          endIndent: 12,
                        ),
                        itemBuilder: (context, index) {
                          final task = filtered[index];
                          return _ScheduledTaskRow(
                            task: task,
                            onTap: () {
                              HapticFeedback.selectionClick();
                              Navigator.of(context).push(
                                MaterialPageRoute(
                                  builder: (context) => ScheduledTaskDetailScreen(
                                    task: task,
                                    onUpdateTask: (updated) {
                                      setState(() {
                                        final idx = _localTasks.indexWhere((t) => t.id == updated.id);
                                        if (idx >= 0) {
                                          _localTasks[idx] = updated;
                                        }
                                      });
                                      widget.api?.updateScheduledTask(updated);
                                    },
                                    onTriggerNow: (id) {
                                      if (widget.onTriggerNow != null) {
                                        widget.onTriggerNow?.call(id);
                                      } else {
                                        widget.api?.triggerScheduledTask(id);
                                      }
                                    },
                                    onDeleteTask: (id) {
                                      setState(() {
                                        _localTasks.removeWhere((t) => t.id == id);
                                      });
                                      if (widget.onCancelTask != null) {
                                        widget.onCancelTask?.call(id);
                                      } else {
                                        widget.api?.cancelScheduledTask(id);
                                      }
                                    },
                                  ),
                                ),
                              );
                            },
                            onToggle: (enabled) {
                              setState(() {
                                final idx = _localTasks.indexWhere((t) => t.id == task.id);
                                if (idx >= 0) {
                                  _localTasks[idx] = _localTasks[idx].copyWith(
                                    isEnabled: enabled,
                                    status: enabled ? 'Running' : 'Paused',
                                  );
                                }
                              });
                              if (widget.onToggleTask != null) {
                                widget.onToggleTask?.call(task.id, enabled);
                              } else {
                                widget.api?.toggleScheduledTask(task.id, enabled);
                              }
                            },
                            onRestart: () {
                              if (widget.onTriggerNow != null) {
                                widget.onTriggerNow?.call(task.id);
                              } else {
                                widget.api?.triggerScheduledTask(task.id);
                              }
                            },
                            onDelete: () {
                              setState(() {
                                _localTasks.removeWhere((t) => t.id == task.id);
                              });
                              if (widget.onCancelTask != null) {
                                widget.onCancelTask?.call(task.id);
                              } else {
                                widget.api?.cancelScheduledTask(task.id);
                              }
                            },
                          );
                        },
                      ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildEmptyState(ColorScheme scheme) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.schedule_outlined, size: 42, color: scheme.onSurfaceVariant),
            const SizedBox(height: 14),
            Text(
              _searchQuery.isNotEmpty
                  ? 'Aucune tâche pour "$_searchQuery"'
                  : 'Aucune tâche planifiée',
              style: TextStyle(
                fontSize: 14,
                fontWeight: FontWeight.w600,
                color: scheme.onSurface,
              ),
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 6),
            Text(
              'No scheduled tasks configured.\nCliquez sur "+ New" pour programmer un cron job ou un timer.',
              style: TextStyle(
                fontSize: 12,
                color: scheme.onSurfaceVariant,
                height: 1.4,
              ),
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 16),
            ElevatedButton.icon(
              onPressed: _openNewTaskModal,
              icon: const Icon(Icons.add, size: 16),
              label: const Text('Add Scheduled Task'),
              style: ElevatedButton.styleFrom(
                backgroundColor: scheme.primary,
                foregroundColor: AppColors.onAccent,
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(AppRadius.md)),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _ScheduledTaskRow extends StatelessWidget {
  final ScheduledTaskItem task;
  final VoidCallback onTap;
  final ValueChanged<bool> onToggle;
  final VoidCallback onRestart;
  final VoidCallback onDelete;

  const _ScheduledTaskRow({
    required this.task,
    required this.onTap,
    required this.onToggle,
    required this.onRestart,
    required this.onDelete,
  });

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final title = task.displayName;
    final schedule = task.formattedSchedule;

    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      child: Row(
        children: [
          // Titre et Subtitle (Daily around 9:00 AM) - Tappable pour ouvrir les détails
          Expanded(
            child: InkWell(
              onTap: onTap,
              borderRadius: BorderRadius.circular(AppRadius.md),
              child: Padding(
                padding: const EdgeInsets.symmetric(vertical: 4),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      title,
                      style: TextStyle(
                        fontSize: 13.5,
                        fontWeight: FontWeight.w500,
                        color: scheme.onSurface,
                        letterSpacing: -0.1,
                      ),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                    const SizedBox(height: 3),
                    Text(
                      schedule,
                      style: TextStyle(
                        fontSize: 11.5,
                        color: scheme.onSurfaceVariant,
                      ),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ],
                ),
              ),
            ),
          ),

          const SizedBox(width: 4),

          // Menu d'actions contextuelles (3 points verticaux ⋮ comme sur le Desktop IDE)
          PopupMenuButton<String>(
            icon: Icon(Icons.more_vert, size: 18, color: scheme.onSurfaceVariant),
            tooltip: 'Actions',
            padding: EdgeInsets.zero,
            constraints: const BoxConstraints(minWidth: 32, minHeight: 32),
            color: isDark ? const Color(0xFF1B1D22) : scheme.surfaceContainerHighest,
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(AppRadius.md),
              side: BorderSide(color: scheme.outlineVariant, width: 1),
            ),
            onSelected: (value) {
              if (value == 'trigger') {
                HapticFeedback.selectionClick();
                onRestart();
              } else if (value == 'edit') {
                HapticFeedback.selectionClick();
                onTap();
              } else if (value == 'delete') {
                HapticFeedback.mediumImpact();
                onDelete();
              }
            },
            itemBuilder: (context) => [
              PopupMenuItem(
                value: 'trigger',
                height: 38,
                child: Row(
                  children: [
                    Icon(Icons.play_arrow_rounded, size: 16, color: scheme.primary),
                    const SizedBox(width: 8),
                    Text('Trigger Now', style: TextStyle(fontSize: 12.5, color: scheme.onSurface)),
                  ],
                ),
              ),
              PopupMenuItem(
                value: 'edit',
                height: 38,
                child: Row(
                  children: [
                    Icon(Icons.edit_outlined, size: 15, color: scheme.onSurfaceVariant),
                    const SizedBox(width: 8),
                    Text('Edit', style: TextStyle(fontSize: 12.5, color: scheme.onSurface)),
                  ],
                ),
              ),
              const PopupMenuDivider(height: 1),
              PopupMenuItem(
                value: 'delete',
                height: 38,
                child: Row(
                  children: [
                    Icon(Icons.delete_outline_rounded, size: 16, color: scheme.error),
                    const SizedBox(width: 8),
                    Text('Delete', style: TextStyle(fontSize: 12.5, color: scheme.error)),
                  ],
                ),
              ),
            ],
          ),

          const SizedBox(width: 4),

          // Switch Toggle (Bleu Antigravity 2.0 / Switch)
          Transform.scale(
            scale: 0.8,
            child: Switch(
              value: task.isEnabled,
              activeColor: scheme.primary,
              activeTrackColor: scheme.primary.withValues(alpha: 0.5),
              inactiveThumbColor: scheme.onSurfaceVariant,
              inactiveTrackColor: isDark ? const Color(0xFF2C2F36) : scheme.surfaceContainerHighest,
              onChanged: (val) {
                HapticFeedback.selectionClick();
                onToggle(val);
              },
            ),
          ),
        ],
      ),
    );
  }
}

/// Modal Bottom Sheet "New Scheduled Task" (Exact Antigravity 2.0 UI)
class _NewScheduledTaskModal extends StatefulWidget {
  final List<String> workspaces;
  final ValueChanged<ScheduledTaskItem> onAdd;

  const _NewScheduledTaskModal({
    required this.workspaces,
    required this.onAdd,
  });

  @override
  State<_NewScheduledTaskModal> createState() => _NewScheduledTaskModalState();
}

class _NewScheduledTaskModalState extends State<_NewScheduledTaskModal> {
  final TextEditingController _nameController = TextEditingController();
  final TextEditingController _promptController = TextEditingController();

  late String _selectedProject;
  String _selectedFrequency = 'Daily';
  String _selectedTime = '9:00 AM';

  final List<String> _frequencies = ['Daily', 'Hourly', 'Weekly', 'Every 15 min', 'Custom Cron'];
  final List<String> _times = ['9:00 AM', '12:00 PM', '6:00 PM', '12:00 AM', '3:00 PM', '6:00 AM'];

  @override
  void initState() {
    super.initState();
    _selectedProject = widget.workspaces.isNotEmpty ? widget.workspaces.first : 'Workspace';
  }

  @override
  void dispose() {
    _nameController.dispose();
    _promptController.dispose();
    super.dispose();
  }

  String _computeCronExpression() {
    if (_selectedFrequency == 'Daily') {
      if (_selectedTime == '9:00 AM') return '0 9 * * *';
      if (_selectedTime == '12:00 PM') return '0 12 * * *';
      if (_selectedTime == '6:00 PM') return '0 18 * * *';
      if (_selectedTime == '12:00 AM') return '0 0 * * *';
      return '0 9 * * *';
    } else if (_selectedFrequency == 'Hourly') {
      return '0 * * * *';
    } else if (_selectedFrequency == 'Every 15 min') {
      return '*/15 * * * *';
    } else if (_selectedFrequency == 'Weekly') {
      return '0 9 * * 1';
    }
    return '0 9 * * *';
  }

  void _submit() {
    final name = _nameController.text.trim();
    final prompt = _promptController.text.trim();
    if (name.isEmpty && prompt.isEmpty) return;

    final cron = _computeCronExpression();
    final item = ScheduledTaskItem(
      id: 'task_${DateTime.now().millisecondsSinceEpoch}',
      name: name.isNotEmpty ? name : prompt,
      prompt: prompt.isNotEmpty ? prompt : name,
      workspaceName: _selectedProject,
      cronExpression: cron,
      isDaemon: true,
      isEnabled: true,
    );

    widget.onAdd(item);
    Navigator.of(context).pop();
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final isDark = Theme.of(context).brightness == Brightness.dark;

    return SafeArea(
      top: false,
      child: Container(
        decoration: BoxDecoration(
          color: isDark ? const Color(0xFF131416) : scheme.surfaceContainer,
          borderRadius: const BorderRadius.vertical(top: Radius.circular(16)),
          border: Border(top: BorderSide(color: scheme.outlineVariant, width: 1)),
        ),
        padding: EdgeInsets.fromLTRB(20, 16, 20, MediaQuery.of(context).viewInsets.bottom + 20),
        child: SingleChildScrollView(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
            // Header: Title + Close Icon
            Row(
              children: [
                Expanded(
                  child: Text(
                    'New Scheduled Task',
                    style: TextStyle(
                      fontSize: 16,
                      fontWeight: FontWeight.w600,
                      color: scheme.onSurface,
                    ),
                  ),
                ),
                IconButton(
                  icon: Icon(Icons.close_rounded, size: 18, color: scheme.onSurfaceVariant),
                  tooltip: 'Fermer',
                  onPressed: () => Navigator.of(context).pop(),
                  constraints: const BoxConstraints(minWidth: 28, minHeight: 28),
                  padding: EdgeInsets.zero,
                ),
              ],
            ),

            const SizedBox(height: 16),

            // ── Name Field ──
            Text(
              'Name',
              style: TextStyle(
                fontSize: 12.5,
                fontWeight: FontWeight.w500,
                color: scheme.onSurfaceVariant,
              ),
            ),
            const SizedBox(height: 6),
            Container(
              decoration: BoxDecoration(
                color: isDark ? const Color(0xFF1B1D22) : scheme.surfaceContainerHighest,
                borderRadius: BorderRadius.circular(AppRadius.md),
                border: Border.all(color: scheme.outlineVariant),
              ),
              padding: const EdgeInsets.symmetric(horizontal: 12),
              child: TextField(
                controller: _nameController,
                style: TextStyle(fontSize: 13, color: scheme.onSurface),
                decoration: InputDecoration(
                  hintText: 'Enter scheduled task name...',
                  hintStyle: TextStyle(fontSize: 13, color: scheme.onSurfaceVariant.withValues(alpha: 0.7)),
                  border: InputBorder.none,
                ),
              ),
            ),

            const SizedBox(height: 14),

            // ── Project Field ──
            Text(
              'Project',
              style: TextStyle(
                fontSize: 12.5,
                fontWeight: FontWeight.w500,
                color: scheme.onSurfaceVariant,
              ),
            ),
            const SizedBox(height: 6),
            Container(
              decoration: BoxDecoration(
                color: isDark ? const Color(0xFF1B1D22) : scheme.surfaceContainerHighest,
                borderRadius: BorderRadius.circular(AppRadius.md),
                border: Border.all(color: scheme.outlineVariant),
              ),
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 2),
              child: DropdownButtonHideUnderline(
                child: DropdownButton<String>(
                  value: _selectedProject,
                  dropdownColor: isDark ? const Color(0xFF1B1D22) : scheme.surfaceContainerHighest,
                  icon: Icon(Icons.keyboard_arrow_down_rounded, color: scheme.onSurfaceVariant, size: 18),
                  isExpanded: true,
                  items: widget.workspaces
                      .map((ws) => DropdownMenuItem(
                            value: ws,
                            child: Row(
                              children: [
                                Icon(Icons.folder_outlined, size: 14, color: scheme.onSurfaceVariant),
                                const SizedBox(width: 8),
                                Text(
                                  ws,
                                  style: TextStyle(fontSize: 13, color: scheme.onSurface),
                                ),
                              ],
                            ),
                          ))
                      .toList(),
                  onChanged: (val) {
                    if (val != null) setState(() => _selectedProject = val);
                  },
                ),
              ),
            ),

            const SizedBox(height: 14),

            // ── Schedule Field (Frequency + around + Time) ──
            Text(
              'Schedule',
              style: TextStyle(
                fontSize: 12.5,
                fontWeight: FontWeight.w500,
                color: scheme.onSurfaceVariant,
              ),
            ),
            const SizedBox(height: 6),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              crossAxisAlignment: WrapCrossAlignment.center,
              children: [
                // Frequency Dropdown (Daily ⌄)
                Container(
                  decoration: BoxDecoration(
                    color: isDark ? const Color(0xFF1B1D22) : scheme.surfaceContainerHighest,
                    borderRadius: BorderRadius.circular(AppRadius.md),
                    border: Border.all(color: scheme.outlineVariant),
                  ),
                  padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 2),
                  child: DropdownButtonHideUnderline(
                    child: DropdownButton<String>(
                      value: _selectedFrequency,
                      dropdownColor: isDark ? const Color(0xFF1B1D22) : scheme.surfaceContainerHighest,
                      icon: Icon(Icons.keyboard_arrow_down_rounded, color: scheme.onSurfaceVariant, size: 16),
                      items: _frequencies
                          .map((f) => DropdownMenuItem(
                                value: f,
                                child: Text(f, style: TextStyle(fontSize: 12.5, color: scheme.onSurface)),
                              ))
                          .toList(),
                      onChanged: (val) {
                        if (val != null) setState(() => _selectedFrequency = val);
                      },
                    ),
                  ),
                ),

                Text(
                  'around',
                  style: TextStyle(fontSize: 12, color: scheme.onSurfaceVariant),
                ),

                // Time Dropdown (9:00 AM ⌄)
                Container(
                  decoration: BoxDecoration(
                    color: isDark ? const Color(0xFF1B1D22) : scheme.surfaceContainerHighest,
                    borderRadius: BorderRadius.circular(AppRadius.md),
                    border: Border.all(color: scheme.outlineVariant),
                  ),
                  padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 2),
                  child: DropdownButtonHideUnderline(
                    child: DropdownButton<String>(
                      value: _selectedTime,
                      dropdownColor: isDark ? const Color(0xFF1B1D22) : scheme.surfaceContainerHighest,
                      icon: Icon(Icons.keyboard_arrow_down_rounded, color: scheme.onSurfaceVariant, size: 16),
                      items: _times
                          .map((t) => DropdownMenuItem(
                                value: t,
                                child: Text(t, style: TextStyle(fontSize: 12.5, color: scheme.onSurface)),
                              ))
                          .toList(),
                      onChanged: (val) {
                        if (val != null) setState(() => _selectedTime = val);
                      },
                    ),
                  ),
                ),
              ],
            ),
            Container(
              margin: const EdgeInsets.only(top: 8),
              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
              decoration: BoxDecoration(
                color: isDark ? const Color(0xFF1B1D22) : scheme.surfaceContainerHighest,
                borderRadius: BorderRadius.circular(AppRadius.sm),
                border: Border.all(color: scheme.outlineVariant),
              ),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Icon(Icons.schedule_rounded, size: 13, color: isDark ? const Color(0xFF22C55E) : const Color(0xFF1A7F37)),
                  const SizedBox(width: 6),
                  Text(
                    'Cron : ${_computeCronExpression()}',
                    style: TextStyle(
                      fontSize: 11,
                      fontFamily: 'monospace',
                      color: isDark ? const Color(0xFF22C55E) : const Color(0xFF1A7F37),
                    ),
                  ),
                ],
              ),
            ),

            const SizedBox(height: 14),

            // ── Prompt Field ──
            Text(
              'Prompt',
              style: TextStyle(
                fontSize: 12.5,
                fontWeight: FontWeight.w500,
                color: scheme.onSurfaceVariant,
              ),
            ),
            const SizedBox(height: 6),
            Container(
              decoration: BoxDecoration(
                color: isDark ? const Color(0xFF1B1D22) : scheme.surfaceContainerHighest,
                borderRadius: BorderRadius.circular(AppRadius.md),
                border: Border.all(color: scheme.outlineVariant),
              ),
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
              child: TextField(
                controller: _promptController,
                maxLines: 3,
                style: TextStyle(fontSize: 13, color: scheme.onSurface),
                decoration: InputDecoration(
                  hintText: 'Enter a prompt for the agent to run...',
                  hintStyle: TextStyle(fontSize: 13, color: scheme.onSurfaceVariant.withValues(alpha: 0.7)),
                  border: InputBorder.none,
                ),
              ),
            ),

            const SizedBox(height: 6),
            Text(
              'All scheduled tasks run as Flash.',
              style: TextStyle(fontSize: 11, color: scheme.onSurfaceVariant),
            ),

            const SizedBox(height: 20),

            // ── Add Scheduled Task Action Button ──
            Align(
              alignment: Alignment.centerRight,
              child: ElevatedButton(
                onPressed: _submit,
                style: ElevatedButton.styleFrom(
                  backgroundColor: scheme.primary,
                  foregroundColor: AppColors.onAccent,
                  padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(AppRadius.md)),
                ),
                child: const Text(
                  'Add Scheduled Task',
                  style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600),
                ),
              ),
            ),
          ],
        ),
        ),
      ),
    );
  }
}
