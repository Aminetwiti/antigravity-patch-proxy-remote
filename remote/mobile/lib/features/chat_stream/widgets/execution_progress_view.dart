import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../../../theme/app_colors.dart';

/// Type d'étape d'exécution fidèle à Antigravity 2.0 Desktop.
enum ExecutionStepType {
  header,
  command,
  fileEdit,
  fileAnalysis,
  exploredGroup,
  task,
  taskFinished,
  workedDuration,
  timer,
  autoProceed,
  subagent,
  narrativeText,
  thought,
  search,
  processingGroup,
}

class ExecutionStepItem {
  final ExecutionStepType type;
  final String action; // "Edited", "Analyzed", "Ran", "Run", "Explored", "Task", "Worked", "Timed", "Auto-proceeded with", "Subagent"
  final String title; // "chat_stream_screen.dart", "1 task", "332 finished", "for 19m", "30 seconds", etc.
  final String? diffAdded; // "+12"
  final String? diffRemoved; // "-3"
  final String? lineRange; // "#L680-710"
  final String? thoughtTitle; // "Examining Conditional Logic"
  final String? consolePrompt; // "...\remote\mobile > flutter test --exclude-tags=live"
  final String? consoleOutput; // "Working." or stdout
  final String? timerPrompt; // "Check flutter test results"
  final String? timerStatus; // "Status: Fired"
  final String? rawDetail;
  final List<ExecutionStepItem>? subItems; // Indented child items (e.g. Analyzed under Explored)
  final bool isExpandable;
  final bool isRunning;

  const ExecutionStepItem({
    required this.type,
    required this.action,
    required this.title,
    this.diffAdded,
    this.diffRemoved,
    this.lineRange,
    this.thoughtTitle,
    this.consolePrompt,
    this.consoleOutput,
    this.timerPrompt,
    this.timerStatus,
    this.rawDetail,
    this.subItems,
    this.isExpandable = false,
    this.isRunning = false,
  });
}

/// Vue de déroulement d'exécution en direct fidèle à Antigravity 2.0 ("The Quiet Console").
/// Affiche la progression temps réel de l'agent en cours d'exécution avec chronomètre,
/// modèle actif, étapes d'outils animées, sous-messages ouvrables et indicateur "Working..".
class ExecutionProgressView extends StatefulWidget {
  final String? messageId;
  final String? thoughtText;
  final bool isStreaming;
  final String? modelLabel;
  final VoidCallback? onToggleExpand;
  final VoidCallback? onStop;
  final ValueChanged<String>? onOpenArtifact;
  final bool initiallyExpanded;

  const ExecutionProgressView({
    super.key,
    this.messageId,
    this.thoughtText,
    this.isStreaming = false,
    this.modelLabel,
    this.onToggleExpand,
    this.onStop,
    this.onOpenArtifact,
    this.initiallyExpanded = false,
  });

  @override
  State<ExecutionProgressView> createState() => _ExecutionProgressViewState();
}

class _ExecutionProgressViewState extends State<ExecutionProgressView>
    with SingleTickerProviderStateMixin {
  final Set<int> _expandedIndices = {};
  int _secondsElapsed = 0;
  Timer? _timer;
  late AnimationController _pulseAnim;
  bool _showAllSteps = false;
  late bool _isExpanded;

  @override
  void initState() {
    super.initState();
    _isExpanded = widget.initiallyExpanded || widget.isStreaming;
    _pulseAnim = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 1200),
    )..repeat(reverse: true);

    if (widget.isStreaming) {
      _startTimer();
    }
  }

  @override
  void didUpdateWidget(ExecutionProgressView oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.isStreaming && !oldWidget.isStreaming) {
      _secondsElapsed = 0;
      _isExpanded = true;
      _startTimer();
    } else if (!widget.isStreaming && oldWidget.isStreaming) {
      _timer?.cancel();
      // Lorsque l'agent termine son travail, replier automatiquement la réflexion
      _isExpanded = widget.initiallyExpanded;
    } else if (widget.initiallyExpanded != oldWidget.initiallyExpanded) {
      _isExpanded = widget.initiallyExpanded;
    }
  }

  @override
  void dispose() {
    _timer?.cancel();
    _pulseAnim.dispose();
    super.dispose();
  }

  void _startTimer() {
    _timer?.cancel();
    _timer = Timer.periodic(const Duration(seconds: 1), (_) {
      if (mounted) {
        setState(() => _secondsElapsed++);
      }
    });
  }

  String _formatDuration(int seconds) {
    if (seconds <= 0) return '1s';
    if (seconds < 60) return '${seconds}s';
    final mins = seconds ~/ 60;
    final secs = seconds % 60;
    return secs > 0 ? '${mins}m ${secs}s' : '${mins}m';
  }

  List<ExecutionStepItem> _parseSteps(String raw) {
    if (raw.trim().isEmpty) {
      if (widget.isStreaming) {
        return [
          ExecutionStepItem(
            type: ExecutionStepType.workedDuration,
            action: 'Working',
            title: _secondsElapsed > 0 ? 'for ${_formatDuration(_secondsElapsed)}' : '..',
            isRunning: true,
            isExpandable: false,
          )
        ];
      }
      return [];
    }

    final rawItems = <ExecutionStepItem>[];
    final lines = raw.split('\n');
    final currentThoughtBuffer = StringBuffer();
    bool inConsoleBlock = false;
    String currentCmdTitle = '';
    String currentCmdPrompt = '';
    final consoleBuffer = StringBuffer();

    void flushConsole() {
      if (currentCmdTitle.isNotEmpty) {
        final out = consoleBuffer.toString().trim();
        rawItems.add(ExecutionStepItem(
          type: ExecutionStepType.command,
          action: 'Run',
          title: currentCmdTitle,
          consolePrompt: currentCmdPrompt.isNotEmpty
              ? currentCmdPrompt
              : '> $currentCmdTitle',
          consoleOutput: out.isNotEmpty ? out : 'Working.',
          isExpandable: true,
          isRunning: widget.isStreaming,
        ));
        currentCmdTitle = '';
        currentCmdPrompt = '';
        consoleBuffer.clear();
      }
    }

    for (int i = 0; i < lines.length; i++) {
      final line = lines[i].trim();
      if (line.isEmpty) continue;

      if (line.startsWith('```console') || line.startsWith('```terminal') || line.startsWith('```shell')) {
        inConsoleBlock = true;
        continue;
      }
      if (inConsoleBlock) {
        if (line.startsWith('```')) {
          inConsoleBlock = false;
          flushConsole();
        } else if (line.contains(' > ')) {
          currentCmdPrompt = line;
        } else {
          consoleBuffer.writeln(line);
        }
        continue;
      }

      final lower = line.toLowerCase();

      // 1. Auto-proceeded with <Plan/Artifact>
      if (lower.startsWith('auto-proceeded with') ||
          lower.startsWith('auto proceeded with') ||
          lower.startsWith('auto-proceed with')) {
        final prefix = lower.startsWith('auto-proceeded with')
            ? 'auto-proceeded with'
            : (lower.startsWith('auto proceeded with')
                ? 'auto proceeded with'
                : 'auto-proceed with');
        var planName = line.substring(prefix.length).trim();
        planName = planName.replaceAll('📄', '').replaceAll('`', '').trim();
        rawItems.add(ExecutionStepItem(
          type: ExecutionStepType.autoProceed,
          action: 'Auto-proceeded with',
          title: planName.isNotEmpty ? planName : 'Implementation Plan',
          isExpandable: false,
        ));
        continue;
      }

      // 2. Timed <duration> / Wait for task-<id>: Timer has expired
      if (lower.startsWith('timed ') ||
          lower.startsWith('wait for task') ||
          lower.startsWith('wait for ') ||
          lower.startsWith('timer has expired') ||
          lower.startsWith('scheduled ')) {
        final title = line;
        final action = '';

        // Lookahead for prompt and status
        String? timerPrompt;
        String? timerStatus;
        int nextI = i + 1;
        while (nextI < lines.length) {
          final nextLine = lines[nextI].trim();
          if (nextLine.isEmpty) {
            nextI++;
            continue;
          }
          final nextLower = nextLine.toLowerCase();
          if (nextLower.startsWith('status:')) {
            timerStatus = nextLine;
            nextI++;
          } else if (nextLine.startsWith('>') ||
              (!nextLower.startsWith('task ') &&
                  !nextLower.startsWith('worked ') &&
                  !nextLower.startsWith('explored ') &&
                  !nextLower.startsWith('edited ') &&
                  !nextLower.startsWith('analyzed ') &&
                  !nextLower.startsWith('ran ') &&
                  !nextLower.startsWith('wait for ') &&
                  !nextLower.startsWith('timed ') &&
                  timerPrompt == null)) {
            timerPrompt = nextLine.startsWith('>') ? nextLine.substring(1).trim() : nextLine;
            nextI++;
          } else {
            break;
          }
        }
        if (timerPrompt != null || timerStatus != null) {
          i = nextI - 1;
        }

        rawItems.add(ExecutionStepItem(
          type: ExecutionStepType.timer,
          action: action,
          title: title,
          timerPrompt: timerPrompt,
          timerStatus: timerStatus ?? 'Status: Fired',
          isExpandable: true,
        ));
        continue;
      }

      // 3. Task <id> finished / Task finished / Running ... finished / Task <id> completed
      if ((lower.startsWith('task ') || lower.startsWith('running ') || lower.startsWith('run ')) &&
          (lower.contains('finished') || lower.contains('completed') || lower.contains('done'))) {
        var clean = line;
        if (clean.endsWith('>')) clean = clean.substring(0, clean.length - 1).trim();
        rawItems.add(ExecutionStepItem(
          type: ExecutionStepType.taskFinished,
          action: '',
          title: clean,
          isExpandable: true,
          rawDetail: clean,
        ));
        continue;
      }

      // 4. Worked for <duration> / Thought for <duration> / Thinking for <duration>
      if (lower.startsWith('worked for ') ||
          lower.startsWith('thinking for ') ||
          lower.startsWith('thought for ')) {
        var clean = line;
        if (clean.endsWith('>')) clean = clean.substring(0, clean.length - 1).trim();
        final action = lower.startsWith('worked for ')
            ? 'Worked'
            : (lower.startsWith('thinking for ') ? 'Thinking' : 'Thought');
        final dur = clean.substring(action.length).trim();
        rawItems.add(ExecutionStepItem(
          type: ExecutionStepType.workedDuration,
          action: action,
          title: dur,
          isExpandable: true,
        ));
        continue;
      }

      // 5. Edited / Wrote <ext> <file> +X -Y
      if (lower.startsWith('edited ') ||
          lower.startsWith('wrote ') ||
          lower.startsWith('writing to file') ||
          lower.startsWith('editing file')) {
        final isEdit = lower.startsWith('edited ') || lower.startsWith('editing file');
        final prefixLen = lower.startsWith('edited ')
            ? 7
            : (lower.startsWith('wrote ')
                ? 6
                : (lower.startsWith('writing to file') ? 15 : 12));
        final rest = line.substring(prefixLen).trim();
        final parts = rest.split(RegExp(r'\s+'));
        String fileName = rest;
        String? add;
        String? del;
        String? extTag;
        int idx = 0;
        if (parts.isNotEmpty && RegExp(r'^(TS|JS|Dart|Go|Py|>_|JSON|MD|HTML|CSS|YAML|SQL)$', caseSensitive: false).hasMatch(parts[0])) {
          extTag = parts[0];
          idx = 1;
        }
        if (idx < parts.length) {
          fileName = parts[idx];
          idx++;
        }
        while (idx < parts.length) {
          final p = parts[idx];
          if (p.startsWith('+')) {
            add = p;
          } else if (p.startsWith('-')) {
            del = p;
          }
          idx++;
        }
        rawItems.add(ExecutionStepItem(
          type: ExecutionStepType.fileEdit,
          action: isEdit ? 'Edited' : 'Wrote',
          title: extTag != null ? '$extTag $fileName' : fileName,
          diffAdded: add ?? '+1',
          diffRemoved: del ?? '-0',
        ));
        continue;
      }

      // 6. Analyzed / Viewed / Reading <ext> <file> #L123-456
      if (lower.startsWith('analyzed ') ||
          lower.startsWith('viewed ') ||
          lower.startsWith('reading file') ||
          lower.startsWith('viewing file')) {
        final isAnalyzed = lower.startsWith('analyzed ');
        final prefixLen = lower.startsWith('analyzed ')
            ? 9
            : (lower.startsWith('viewed ')
                ? 7
                : (lower.startsWith('reading file') ? 12 : 12));
        final rest = line.substring(prefixLen).trim();
        final match = RegExp(r'^(?:(TS|JS|Dart|Go|Py|>_|JSON|MD|HTML|CSS|YAML|SQL)\s+)?(\S+)(?:\s+(#L\d+(?:-\d+)?))?', caseSensitive: false).firstMatch(rest);
        final extTag = match?.group(1);
        final fileName = match?.group(2) ?? rest;
        final lineRange = match?.group(3);
        rawItems.add(ExecutionStepItem(
          type: ExecutionStepType.fileAnalysis,
          action: isAnalyzed ? 'Analyzed' : 'Viewed',
          title: extTag != null ? '$extTag $fileName' : fileName,
          lineRange: lineRange,
        ));
        continue;
      }

      // 6b. Searched / Search <query> <count> results
      if (lower.startsWith('searched ') || lower.startsWith('search ')) {
        final prefixLen = lower.startsWith('searched ') ? 9 : 7;
        final rest = line.substring(prefixLen).trim();
        final match = RegExp(r'^(.*?)(?:\s+(\d+)\s+results?)?$', caseSensitive: false).firstMatch(rest);
        final query = match?.group(1)?.trim() ?? rest;
        final count = match?.group(2);
        rawItems.add(ExecutionStepItem(
          type: ExecutionStepType.search,
          action: 'Search',
          title: query,
          diffAdded: count != null ? '$count results' : null,
          isExpandable: true,
        ));
        continue;
      }

      // 7. Explored <N> task(s) / file(s)
      if (lower.startsWith('explored ')) {
        var title = line.substring(9).trim();
        if (title.endsWith('>')) title = title.substring(0, title.length - 1).trim();
        rawItems.add(ExecutionStepItem(
          type: ExecutionStepType.exploredGroup,
          action: 'Explored',
          title: title.isNotEmpty ? title : '1 file',
          isExpandable: true,
        ));
        continue;
      }

      // 8. Subagent invocation / task
      if (lower.startsWith('subagent') ||
          lower.startsWith('invoking subagent') ||
          lower.startsWith('spawned subagent') ||
          lower.startsWith('sub-agent')) {
        final clean = line.replaceFirst(
            RegExp(r'^(invoking subagent|spawned subagent|subagent|sub-agent)[:\s]*', caseSensitive: false), '').trim();
        rawItems.add(ExecutionStepItem(
          type: ExecutionStepType.subagent,
          action: 'Subagent',
          title: clean.isNotEmpty ? clean : 'Agent',
          isExpandable: true,
          isRunning: widget.isStreaming,
        ));
        continue;
      }

      // 9. Ran / Run <command>
      if (lower.startsWith('ran ') ||
          lower.startsWith('run ') ||
          lower.startsWith('running command:') ||
          lower.startsWith('executed:')) {
        final cleanTitle = line.replaceFirst(
            RegExp(r'^(ran|run|running command:|executed:)\s*', caseSensitive: false), '');
        currentCmdTitle = cleanTitle;
        currentCmdPrompt = '> $cleanTitle';
        if (i + 1 >= lines.length || !lines[i + 1].trim().startsWith('```')) {
          flushConsole();
        }
        continue;
      }

      // 10. Checked task / Search / Task
      if (lower.startsWith('checked task ') ||
          lower.startsWith('search ') ||
          lower.startsWith('task ') ||
          lower.startsWith('searching ')) {
        final isChecked = lower.startsWith('checked task ');
        final isSearch = lower.startsWith('search ') || lower.startsWith('searching ');
        String action = 'Task';
        String title = line.substring(5).trim();
        if (isChecked) {
          action = 'Checked task';
          title = line.substring(13).trim();
        } else if (isSearch) {
          action = 'Search';
          title = lower.startsWith('searching ') ? line.substring(10).trim() : line.substring(7).trim();
        }
        rawItems.add(ExecutionStepItem(
          type: ExecutionStepType.task,
          action: action,
          title: title,
          isExpandable: true,
        ));
        continue;
      }

      // 11. Error messages
      if (lower.startsWith('error')) {
        var clean = line;
        if (clean.endsWith('>')) clean = clean.substring(0, clean.length - 1).trim();
        rawItems.add(ExecutionStepItem(
          type: ExecutionStepType.task,
          action: '',
          title: clean,
          isExpandable: true,
          rawDetail: clean,
        ));
        continue;
      }

      // 12. Narrative text from agent (e.g. "Vérification globale...", "Attente des résultats...")
      if (line.endsWith('...') || line.endsWith('…') || (!line.startsWith('#') && line.length < 100 && !line.contains('`'))) {
        rawItems.add(ExecutionStepItem(
          type: ExecutionStepType.narrativeText,
          action: '',
          title: line,
          isExpandable: false,
        ));
        continue;
      }

      // 13. Output / thought text
      currentThoughtBuffer.writeln(lines[i]);
    }

    flushConsole();

    // Grouping: Si on a un exploredGroup suivi d'analyses, on les regroupe sous le groupe Explored
    final items = <ExecutionStepItem>[];
    for (int i = 0; i < rawItems.length; i++) {
      final current = rawItems[i];
      if (current.type == ExecutionStepType.exploredGroup) {
        final sub = <ExecutionStepItem>[];
        int j = i + 1;
        while (j < rawItems.length && rawItems[j].type == ExecutionStepType.fileAnalysis) {
          sub.add(rawItems[j]);
          j++;
        }
        if (sub.isNotEmpty) {
          items.add(ExecutionStepItem(
            type: ExecutionStepType.exploredGroup,
            action: current.action,
            title: sub.length == 1 ? '1 file' : '${sub.length} files',
            subItems: sub,
            isExpandable: true,
          ));
          i = j - 1;
          continue;
        }
      }
      items.add(current);
    }

    // Process Thought Buffer
    final thoughtContent = currentThoughtBuffer.toString().trim();
    if (thoughtContent.isNotEmpty) {
      String? thoughtTitle;
      String body = thoughtContent;
      final thoughtLines = thoughtContent.split('\n');
      if (thoughtLines.isNotEmpty) {
        final first = thoughtLines.first.trim();
        if (first.startsWith('**') && first.endsWith('**') && first.length > 4) {
          thoughtTitle = first.substring(2, first.length - 2).trim();
          body = thoughtLines.skip(1).join('\n').trim();
        } else if (first.length < 50 && !first.endsWith('.') && thoughtLines.length > 1) {
          thoughtTitle = first;
          body = thoughtLines.skip(1).join('\n').trim();
        }
      }

      final durationStr = widget.isStreaming
          ? (_secondsElapsed > 0 ? 'for ${_formatDuration(_secondsElapsed)}' : '')
          : (_secondsElapsed > 0 ? 'for ${_formatDuration(_secondsElapsed)}' : 'for 1s');

      items.add(ExecutionStepItem(
        type: ExecutionStepType.thought,
        action: widget.isStreaming ? 'Thinking' : 'Thought',
        title: durationStr.isNotEmpty ? durationStr : 'for 1s',
        thoughtTitle: thoughtTitle ?? 'Reasoning',
        rawDetail: body.isNotEmpty ? body : thoughtContent,
        isExpandable: true,
        isRunning: widget.isStreaming,
      ));
    }

    return _groupExplorationSteps(items);
  }

  List<ExecutionStepItem> _groupExplorationSteps(List<ExecutionStepItem> source) {
    if (source.isEmpty) return source;

    final result = <ExecutionStepItem>[];
    final explorationGroup = <ExecutionStepItem>[];

    bool isExplorationStep(ExecutionStepType type) {
      return type == ExecutionStepType.fileAnalysis ||
          type == ExecutionStepType.search ||
          type == ExecutionStepType.exploredGroup;
    }

    void flushExploration(bool isLastGroup) {
      if (explorationGroup.isEmpty) return;

      int fileCount = 0;
      int searchCount = 0;
      for (final item in explorationGroup) {
        if (item.type == ExecutionStepType.search) {
          searchCount++;
        } else {
          fileCount++;
        }
      }

      final parts = <String>[];
      if (fileCount > 0) {
        parts.add(fileCount == 1 ? '1 file' : '$fileCount files');
      }
      if (searchCount > 0) {
        parts.add(searchCount == 1 ? '1 search' : '$searchCount searches');
      }
      final title = parts.join(', ');

      final bool isRunning = widget.isStreaming && isLastGroup;
      final action = isRunning ? 'Exploring' : 'Explored';

      result.add(ExecutionStepItem(
        type: ExecutionStepType.exploredGroup,
        action: action,
        title: title.isNotEmpty ? title : 'files',
        subItems: List.from(explorationGroup),
        isExpandable: true,
        isRunning: isRunning,
      ));

      explorationGroup.clear();
    }

    for (int i = 0; i < source.length; i++) {
      final item = source[i];
      if (isExplorationStep(item.type)) {
        explorationGroup.add(item);
      } else {
        flushExploration(false);
        result.add(item);
      }
    }
    flushExploration(true);

    return result;
  }

  Widget _buildPulsingDot({Color? color}) {
    final dotColor = color ?? AppColors.accentBlueBright;
    return AnimatedBuilder(
      animation: _pulseAnim,
      builder: (context, child) {
        return Container(
          width: 8,
          height: 8,
          decoration: BoxDecoration(
            shape: BoxShape.circle,
            color: dotColor,
            boxShadow: [
              BoxShadow(
                color: dotColor.withValues(alpha: 0.25 + 0.5 * _pulseAnim.value),
                blurRadius: 3 + 3 * _pulseAnim.value,
                spreadRadius: 0.5 + 1.5 * _pulseAnim.value,
              ),
            ],
          ),
        );
      },
    );
  }

  Widget _buildLiveAgentHeader(ColorScheme scheme, bool isDark) {
    return Container(
      margin: const EdgeInsets.only(bottom: 6),
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6.5),
      decoration: BoxDecoration(
        color: isDark ? const Color(0xFF12151D) : scheme.primaryContainer.withValues(alpha: 0.25),
        gradient: AppGradients.cardCool(isDark: isDark),
        borderRadius: BorderRadius.circular(8),
        border: Border.all(
          color: isDark ? const Color(0xFF3186FF).withValues(alpha: 0.35) : scheme.primary.withValues(alpha: 0.25),
          width: 0.8,
        ),
      ),
      child: Row(
        children: [
          _buildPulsingDot(),
          const SizedBox(width: 8),
          Expanded(
            child: Row(
              children: [
                Flexible(
                  child: Text(
                    'Agent en cours d\'exécution',
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      fontSize: 12,
                      fontWeight: FontWeight.w600,
                      color: isDark ? AppColors.accentBlueBright : scheme.primary,
                    ),
                  ),
                ),
                const SizedBox(width: 6),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 5.5, vertical: 1.5),
                  decoration: BoxDecoration(
                    color: isDark ? const Color(0xFF1C2230) : scheme.surfaceContainerHighest,
                    borderRadius: BorderRadius.circular(4),
                    border: Border.all(
                      color: isDark ? const Color(0xFF2E3A52) : scheme.outlineVariant.withValues(alpha: 0.5),
                      width: 0.5,
                    ),
                  ),
                  child: Text(
                    _formatDuration(_secondsElapsed),
                    style: TextStyle(
                      fontSize: 10.5,
                      fontFamily: 'monospace',
                      fontWeight: FontWeight.w600,
                      color: isDark ? const Color(0xFF9E9FA8) : scheme.onSurfaceVariant,
                    ),
                  ),
                ),
                if (widget.modelLabel != null && widget.modelLabel!.isNotEmpty) ...[
                  const SizedBox(width: 6),
                  Flexible(
                    child: Text(
                      widget.modelLabel!,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                        fontSize: 10.5,
                        fontFamily: 'monospace',
                        color: isDark ? const Color(0xFF71717A) : scheme.outline,
                      ),
                    ),
                  ),
                ],
              ],
            ),
          ),
          if (widget.isStreaming && widget.onStop != null) ...[
            const SizedBox(width: 6),
            Material(
              color: Colors.transparent,
              child: InkWell(
                onTap: () {
                  HapticFeedback.mediumImpact();
                  widget.onStop?.call();
                },
                borderRadius: BorderRadius.circular(4),
                child: Container(
                  padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2.5),
                  decoration: BoxDecoration(
                    color: isDark ? const Color(0xFF3B181E) : const Color(0xFFFEE2E2),
                    borderRadius: BorderRadius.circular(4),
                    border: Border.all(
                      color: isDark ? const Color(0xFFEF4444).withValues(alpha: 0.5) : const Color(0xFFDC2626).withValues(alpha: 0.4),
                      width: 0.8,
                    ),
                  ),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Icon(
                        Icons.stop_rounded,
                        size: 11,
                        color: isDark ? const Color(0xFFF87171) : const Color(0xFFDC2626),
                      ),
                      const SizedBox(width: 3),
                      Text(
                        'Stop',
                        style: TextStyle(
                          fontSize: 10.5,
                          fontWeight: FontWeight.w700,
                          color: isDark ? const Color(0xFFF87171) : const Color(0xFFDC2626),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ],
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final raw = widget.thoughtText ?? '';

    if (raw.trim().isEmpty) {
      if (widget.isStreaming) {
        return RepaintBoundary(
          child: Container(
            margin: const EdgeInsets.only(bottom: 8),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                _buildLiveAgentHeader(scheme, isDark),
                Padding(
                  padding: const EdgeInsets.symmetric(vertical: 4, horizontal: 2),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      SizedBox(
                        width: 12,
                        height: 12,
                        child: CircularProgressIndicator(
                          strokeWidth: 1.5,
                          valueColor: AlwaysStoppedAnimation<Color>(
                            isDark ? const Color(0xFF60A5FA) : scheme.primary,
                          ),
                        ),
                      ),
                      const SizedBox(width: 8),
                      Text(
                        'Thinking…',
                        style: TextStyle(
                          fontSize: 12,
                          color: isDark ? const Color(0xFF9E9FA8) : scheme.onSurfaceVariant,
                          fontWeight: FontWeight.w400,
                        ),
                      ),
                    ],
                  ),
                ),
                const _LiveWorkingIndicator(),
              ],
            ),
          ),
        );
      }
      return const SizedBox.shrink();
    }

    final steps = _parseSteps(raw);
    if (steps.isEmpty && !widget.isStreaming) {
      return const SizedBox.shrink();
    }

    if (!widget.isStreaming && !_isExpanded) {
      return _buildCollapsedSummary(steps, scheme, isDark);
    }

    final showAll = _showAllSteps || widget.initiallyExpanded;
    final displaySteps = (!widget.isStreaming && steps.length > 8 && !showAll)
        ? steps.take(6).toList()
        : steps;
    final hiddenCount = steps.length - displaySteps.length;

    final firstThoughtIndex = displaySteps.indexWhere((s) =>
        s.type == ExecutionStepType.thought ||
        s.type == ExecutionStepType.narrativeText ||
        s.type == ExecutionStepType.workedDuration);

    return RepaintBoundary(
      child: AnimatedSize(
        duration: const Duration(milliseconds: 260),
        curve: Curves.fastOutSlowIn,
        alignment: Alignment.topLeft,
        child: Container(
          margin: const EdgeInsets.only(bottom: 8),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
            if (widget.isStreaming)
              _buildLiveAgentHeader(scheme, isDark)
            else
              Padding(
                padding: const EdgeInsets.only(bottom: 4),
                child: InkWell(
                  onTap: () {
                    HapticFeedback.selectionClick();
                    setState(() => _isExpanded = false);
                    widget.onToggleExpand?.call();
                  },
                  borderRadius: BorderRadius.circular(4),
                  child: Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 2, vertical: 3),
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Text(
                          _getMasterTitle(steps),
                          style: TextStyle(
                            fontSize: 12.5,
                            fontWeight: FontWeight.w500,
                            color: isDark ? const Color(0xFF9E9FA8) : scheme.onSurfaceVariant,
                          ),
                        ),
                        const SizedBox(width: 4),
                        Icon(
                          Icons.keyboard_arrow_down_rounded,
                          size: 15,
                          color: isDark ? const Color(0xFF8B8D98) : scheme.onSurfaceVariant,
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            for (int i = 0; i < displaySteps.length; i++)
              _buildStepRow(displaySteps[i], i, scheme, isDark, isFirstThought: i == firstThoughtIndex),
            if (widget.isStreaming)
              const _LiveWorkingIndicator(),
            if (hiddenCount > 0)
              Padding(
                padding: const EdgeInsets.only(top: 2, bottom: 4),
                child: InkWell(
                  onTap: () {
                    HapticFeedback.selectionClick();
                    setState(() => _showAllSteps = true);
                  },
                  borderRadius: BorderRadius.circular(4),
                  child: Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 2),
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        const Icon(Icons.unfold_more, size: 12, color: Color(0xFF8B8D98)),
                        const SizedBox(width: 4),
                        Text(
                          '+ $hiddenCount more steps',
                          style: const TextStyle(
                            fontSize: 11,
                            color: Color(0xFF8B8D98),
                            fontWeight: FontWeight.w500,
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              )
            else if (_showAllSteps && steps.length > 8)
              Padding(
                padding: const EdgeInsets.only(top: 2, bottom: 4),
                child: InkWell(
                  onTap: () {
                    HapticFeedback.selectionClick();
                    setState(() => _showAllSteps = false);
                  },
                  borderRadius: BorderRadius.circular(4),
                  child: const Padding(
                    padding: EdgeInsets.symmetric(horizontal: 4, vertical: 2),
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Icon(Icons.unfold_less, size: 12, color: Color(0xFF8B8D98)),
                        SizedBox(width: 4),
                        Text(
                          'Show fewer steps',
                          style: TextStyle(
                            fontSize: 11,
                            color: Color(0xFF8B8D98),
                            fontWeight: FontWeight.w500,
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
          ],
        ),
      ),
    ),
  );
}

  String _getMasterTitle(List<ExecutionStepItem> steps) {
    for (final s in steps) {
      if (s.type == ExecutionStepType.workedDuration) {
        return '${s.action} ${s.title}';
      }
    }
    return _secondsElapsed > 0
        ? 'Worked for ${_formatDuration(_secondsElapsed)}'
        : 'Worked for 2m';
  }

  Widget _buildCollapsedSummary(List<ExecutionStepItem> steps, ColorScheme scheme, bool isDark) {
    final title = _getMasterTitle(steps);

    return RepaintBoundary(
      child: Container(
        margin: const EdgeInsets.only(bottom: 6),
        child: InkWell(
          onTap: () {
            HapticFeedback.selectionClick();
            setState(() => _isExpanded = true);
            widget.onToggleExpand?.call();
          },
          borderRadius: BorderRadius.circular(6),
          child: Padding(
            padding: const EdgeInsets.symmetric(vertical: 3, horizontal: 2),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  title,
                  style: TextStyle(
                    fontSize: 12.5,
                    fontWeight: FontWeight.w500,
                    color: isDark ? const Color(0xFF9E9FA8) : scheme.onSurfaceVariant,
                  ),
                ),
                const SizedBox(width: 4),
                Icon(
                  Icons.chevron_right_rounded,
                  size: 15,
                  color: isDark ? const Color(0xFF71717A) : scheme.outline,
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildStepRow(
    ExecutionStepItem item,
    int index,
    ColorScheme scheme,
    bool isDark, {
    bool isFirstThought = false,
  }) {
    // 1. Cas particulier : Narrative Text (commentaire en ligne de l'agent)
    if (item.type == ExecutionStepType.narrativeText) {
      final isExpanded = _expandedIndices.contains(index) || widget.initiallyExpanded;
      return InkWell(
        key: (isFirstThought && widget.messageId != null)
            ? Key('thought-toggle-${widget.messageId}')
            : null,
        onTap: () {
          HapticFeedback.selectionClick();
          setState(() {
            if (_expandedIndices.contains(index)) {
              _expandedIndices.remove(index);
            } else {
              _expandedIndices.add(index);
            }
          });
          widget.onToggleExpand?.call();
        },
        borderRadius: BorderRadius.circular(4),
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 3, horizontal: 2),
          child: Text(
            item.title,
            key: (isFirstThought && widget.messageId != null)
                ? Key('thought-${widget.messageId}')
                : null,
            maxLines: isExpanded ? null : 1,
            overflow: isExpanded ? TextOverflow.visible : TextOverflow.ellipsis,
            style: TextStyle(
              fontSize: 12.5,
              height: 1.4,
              color: isDark ? const Color(0xFFD4D4D8) : scheme.onSurface,
              fontWeight: FontWeight.w400,
            ),
          ),
        ),
      );
    }

    // 2. Cas particulier : Auto-proceeded with Implementation Plan / Artifact
    if (item.type == ExecutionStepType.autoProceed) {
      return GestureDetector(
        onTap: () {
          HapticFeedback.selectionClick();
          widget.onOpenArtifact?.call(item.title);
        },
        child: Container(
          margin: const EdgeInsets.symmetric(vertical: 4),
          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
          decoration: BoxDecoration(
            color: isDark ? const Color(0xFF14171F) : scheme.surfaceContainerHighest.withValues(alpha: 0.5),
            borderRadius: BorderRadius.circular(8),
            border: Border.all(
              color: isDark ? const Color(0xFF27272A) : scheme.outlineVariant.withValues(alpha: 0.6),
              width: 0.8,
            ),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(
                Icons.check_circle_outline_rounded,
                size: 14,
                color: isDark ? const Color(0xFF9E9FA8) : scheme.onSurfaceVariant,
              ),
              const SizedBox(width: 6),
              Text(
                'Auto-proceeded with',
                style: TextStyle(
                  fontSize: 12,
                  color: isDark ? const Color(0xFF9E9FA8) : scheme.onSurfaceVariant,
                  fontWeight: FontWeight.w400,
                ),
              ),
              const SizedBox(width: 6),
              Icon(
                Icons.article_outlined,
                size: 13,
                color: isDark ? const Color(0xFFF4F4F5) : scheme.onSurface,
              ),
              const SizedBox(width: 4),
              Flexible(
                child: Text(
                  item.title,
                  style: TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.w600,
                    color: isDark ? const Color(0xFFF4F4F5) : scheme.onSurface,
                  ),
                  overflow: TextOverflow.ellipsis,
                ),
              ),
            ],
          ),
        ),
      );
    }

    final isExploredGroup = item.type == ExecutionStepType.exploredGroup;
    final isExpanded = _expandedIndices.contains(index) ||
        (isExploredGroup && item.isRunning) ||
        (widget.initiallyExpanded &&
            (item.type == ExecutionStepType.thought ||
             item.type == ExecutionStepType.timer ||
             item.type == ExecutionStepType.processingGroup ||
             item.type == ExecutionStepType.exploredGroup));

    final isThoughtType = item.type == ExecutionStepType.thought || item.type == ExecutionStepType.workedDuration;

    return Container(
      margin: const EdgeInsets.only(bottom: 2.5),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          InkWell(
            key: (isFirstThought && isThoughtType && widget.messageId != null)
                ? Key('thought-toggle-${widget.messageId}')
                : null,
            onTap: item.isExpandable
                ? () {
                    HapticFeedback.selectionClick();
                    setState(() {
                      if (_expandedIndices.contains(index)) {
                        _expandedIndices.remove(index);
                      } else {
                        _expandedIndices.add(index);
                      }
                    });
                    if (isThoughtType) {
                      widget.onToggleExpand?.call();
                    }
                  }
                : null,
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 2, vertical: 2.5),
              child: Row(
                children: [
                  // Action verb: "Explored", "Edited", "Run", "Thought", "Worked", "Timed", "Subagent"
                  if (item.action.isNotEmpty) ...[
                    Text(
                      item.action,
                      style: const TextStyle(
                        fontSize: 12,
                        color: Color(0xFF9E9FA8),
                        fontWeight: FontWeight.w400,
                      ),
                    ),
                    const SizedBox(width: 5),
                  ],

                  // File Edit Badge (🟢 emerald pencil icon)
                  if (item.type == ExecutionStepType.fileEdit) ...[
                    Container(
                      margin: const EdgeInsets.only(right: 5),
                      width: 13,
                      height: 13,
                      decoration: const BoxDecoration(
                        color: Color(0xFF10B981),
                        shape: BoxShape.circle,
                      ),
                      child: const Center(
                        child: Icon(
                          Icons.edit_note_rounded,
                          size: 9,
                          color: Colors.white,
                        ),
                      ),
                    ),
                  ],

                  // File Read Badge (🔵 sky blue document icon)
                  if (item.type == ExecutionStepType.fileAnalysis) ...[
                    Container(
                      margin: const EdgeInsets.only(right: 5),
                      width: 13,
                      height: 13,
                      decoration: const BoxDecoration(
                        color: Color(0xFF0284C7),
                        shape: BoxShape.circle,
                      ),
                      child: const Center(
                        child: Icon(
                          Icons.description_rounded,
                          size: 8.5,
                          color: Colors.white,
                        ),
                      ),
                    ),
                  ],

                  // Search Icon Badge (🔍 teal/cyan icon)
                  if (item.type == ExecutionStepType.search) ...[
                    Container(
                      margin: const EdgeInsets.only(right: 5),
                      width: 13,
                      height: 13,
                      decoration: const BoxDecoration(
                        color: Color(0xFF0D9488),
                        shape: BoxShape.circle,
                      ),
                      child: const Center(
                        child: Icon(
                          Icons.search_rounded,
                          size: 8.5,
                          color: Colors.white,
                        ),
                      ),
                    ),
                  ],

                  // Subagent Icon Badge (🟣 purple agent icon)
                  if (item.type == ExecutionStepType.subagent) ...[
                    Container(
                      margin: const EdgeInsets.only(right: 5),
                      width: 13,
                      height: 13,
                      decoration: const BoxDecoration(
                        color: Color(0xFF7C3AED),
                        shape: BoxShape.circle,
                      ),
                      child: const Center(
                        child: Icon(
                          Icons.smart_toy_rounded,
                          size: 8.5,
                          color: Colors.white,
                        ),
                      ),
                    ),
                  ],

                  // Command / Task Finished Icon Badge (⬛ dark terminal icon)
                  if (item.type == ExecutionStepType.command || item.type == ExecutionStepType.taskFinished) ...[
                    Container(
                      margin: const EdgeInsets.only(right: 5),
                      width: 13,
                      height: 13,
                      decoration: const BoxDecoration(
                        color: Color(0xFF3F3F46),
                        shape: BoxShape.circle,
                      ),
                      child: const Center(
                        child: Icon(
                          Icons.terminal_rounded,
                          size: 8.5,
                          color: Colors.white,
                        ),
                      ),
                    ),
                  ],

                  // Timer Icon Badge (🟠 amber timer icon)
                  if (item.type == ExecutionStepType.timer) ...[
                    Container(
                      margin: const EdgeInsets.only(right: 5),
                      width: 13,
                      height: 13,
                      decoration: const BoxDecoration(
                        color: Color(0xFFEA580C),
                        shape: BoxShape.circle,
                      ),
                      child: const Center(
                        child: Icon(
                          Icons.timer_outlined,
                          size: 8.5,
                          color: Colors.white,
                        ),
                      ),
                    ),
                  ],

                  // Thought / Reasoning Icon Badge (🟡 gold lightbulb icon)
                  if (item.type == ExecutionStepType.thought) ...[
                    Container(
                      margin: const EdgeInsets.only(right: 5),
                      width: 13,
                      height: 13,
                      decoration: const BoxDecoration(
                        color: Color(0xFFF59E0B),
                        shape: BoxShape.circle,
                      ),
                      child: const Center(
                        child: Icon(
                          Icons.lightbulb_rounded,
                          size: 8.5,
                          color: Colors.white,
                        ),
                      ),
                    ),
                  ],

                  // Step title (Filename / Duration / Command / Task status)
                  Flexible(
                    child: Text(
                      isExpanded && item.rawDetail != null && !isThoughtType && item.type != ExecutionStepType.timer
                          ? item.rawDetail!
                          : item.title,
                      key: (isFirstThought && isThoughtType && widget.messageId != null)
                          ? Key('thought-${widget.messageId}')
                          : null,
                      maxLines: isExpanded ? null : 1,
                      overflow: isExpanded ? TextOverflow.visible : TextOverflow.ellipsis,
                      style: TextStyle(
                        fontSize: 12,
                        fontFamily: (item.type == ExecutionStepType.command ||
                                item.type == ExecutionStepType.fileEdit ||
                                item.type == ExecutionStepType.fileAnalysis)
                            ? 'monospace'
                            : null,
                        fontWeight: isThoughtType
                            ? FontWeight.w400
                            : FontWeight.w500,
                        color: isThoughtType
                            ? const Color(0xFF9E9FA8)
                            : (item.type == ExecutionStepType.taskFinished
                                ? const Color(0xFF9E9FA8)
                                : const Color(0xFFF4F4F5)),
                      ),
                    ),
                  ),

                  // Line range badge: #L680-710
                  if (item.lineRange != null) ...[
                    const SizedBox(width: 5),
                    Text(
                      item.lineRange!,
                      style: const TextStyle(
                        fontSize: 11,
                        fontFamily: 'monospace',
                        color: Color(0xFF71717A),
                      ),
                    ),
                  ],

                  // Search result count badge or Diffs: +12 -3
                  if (item.diffAdded != null && item.type == ExecutionStepType.search) ...[
                    const SizedBox(width: 6),
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 1.5),
                      decoration: BoxDecoration(
                        color: isDark ? const Color(0xFF1F2430) : scheme.surfaceContainerHighest,
                        borderRadius: BorderRadius.circular(4),
                        border: Border.all(
                          color: isDark ? const Color(0xFF2E3345) : scheme.outlineVariant,
                          width: 0.5,
                        ),
                      ),
                      child: Text(
                        item.diffAdded!,
                        style: const TextStyle(
                          fontSize: 10.5,
                          fontFamily: 'monospace',
                          fontWeight: FontWeight.w500,
                          color: Color(0xFF9E9FA8),
                        ),
                      ),
                    ),
                  ] else if (item.diffAdded != null) ...[
                    const SizedBox(width: 6),
                    Text(
                      item.diffAdded!,
                      style: const TextStyle(
                        fontSize: 11,
                        fontFamily: 'monospace',
                        fontWeight: FontWeight.w600,
                        color: Color(0xFF4ADE80),
                      ),
                    ),
                    const SizedBox(width: 4),
                    Text(
                      item.diffRemoved ?? '-0',
                      style: const TextStyle(
                        fontSize: 11,
                        fontFamily: 'monospace',
                        fontWeight: FontWeight.w600,
                        color: Color(0xFFF87171),
                      ),
                    ),
                  ],

                  // Running Spinner / Pulse or Expand Chevron
                  if (item.isRunning) ...[
                    const SizedBox(width: 6),
                    const SizedBox(
                      width: 10,
                    ),
                  ],

                  if (item.isExpandable) ...[
                    const SizedBox(width: 4),
                    Icon(
                      isExpanded
                          ? Icons.keyboard_arrow_down_rounded
                          : Icons.chevron_right_rounded,
                      size: 14,
                      color: const Color(0xFF71717A),
                    ),
                  ],
                ],
              ),
            ),
          ),

          // Sub-items for Explored Group (Indented Children)
          AnimatedSize(
            duration: const Duration(milliseconds: 220),
            curve: Curves.fastOutSlowIn,
            alignment: Alignment.topLeft,
            child: (isExpanded && item.subItems != null && item.subItems!.isNotEmpty)
                ? Padding(
                    padding: const EdgeInsets.only(left: 14, top: 2, bottom: 2),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        for (final sub in item.subItems!)
                          Padding(
                            padding: const EdgeInsets.symmetric(vertical: 2),
                            child: Row(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                Text(
                                  sub.action,
                                  style: const TextStyle(
                                    fontSize: 12,
                                    color: Color(0xFF9E9FA8),
                                    fontWeight: FontWeight.w400,
                                  ),
                                ),
                                const SizedBox(width: 5),
                                if (sub.type == ExecutionStepType.search) ...[
                                  Container(
                                    margin: const EdgeInsets.only(right: 5),
                                    width: 13,
                                    height: 13,
                                    decoration: const BoxDecoration(
                                      color: Color(0xFF0D9488),
                                      shape: BoxShape.circle,
                                    ),
                                    child: const Center(
                                      child: Icon(
                                        Icons.search_rounded,
                                        size: 8.5,
                                        color: Colors.white,
                                      ),
                                    ),
                                  ),
                                ] else if (sub.type == ExecutionStepType.fileAnalysis || sub.type == ExecutionStepType.fileEdit) ...[
                                  Container(
                                    margin: const EdgeInsets.only(right: 5),
                                    width: 13,
                                    height: 13,
                                    decoration: const BoxDecoration(
                                      color: Color(0xFF0284C7),
                                      shape: BoxShape.circle,
                                    ),
                                    child: const Center(
                                      child: Icon(
                                        Icons.description_rounded,
                                        size: 8.5,
                                        color: Colors.white,
                                      ),
                                    ),
                                  ),
                                ],
                                Flexible(
                                  child: Text(
                                    sub.title,
                                    style: TextStyle(
                                      fontSize: 12,
                                      fontFamily: (sub.type == ExecutionStepType.fileAnalysis || sub.type == ExecutionStepType.fileEdit)
                                          ? 'monospace'
                                          : null,
                                      fontWeight: FontWeight.w500,
                                      color: const Color(0xFFF4F4F5),
                                    ),
                                  ),
                                ),
                                if (sub.lineRange != null) ...[
                                  const SizedBox(width: 5),
                                  Text(
                                    sub.lineRange!,
                                    style: const TextStyle(
                                      fontSize: 11,
                                      fontFamily: 'monospace',
                                      color: Color(0xFF71717A),
                                    ),
                                  ),
                                ],
                                if (sub.diffAdded != null && sub.type == ExecutionStepType.search) ...[
                                  const SizedBox(width: 6),
                                  Text(
                                    sub.diffAdded!,
                                    style: const TextStyle(
                                      fontSize: 11,
                                      color: Color(0xFF71717A),
                                    ),
                                  ),
                                ] else if (sub.diffAdded != null) ...[
                                  const SizedBox(width: 6),
                                  Text(
                                    sub.diffAdded!,
                                    style: const TextStyle(
                                      fontSize: 11,
                                      fontFamily: 'monospace',
                                      fontWeight: FontWeight.w600,
                                      color: Color(0xFF4ADE80),
                                    ),
                                  ),
                                  const SizedBox(width: 4),
                                  Text(
                                    sub.diffRemoved ?? '-0',
                                    style: const TextStyle(
                                      fontSize: 11,
                                      fontFamily: 'monospace',
                                      fontWeight: FontWeight.w600,
                                      color: Color(0xFFF87171),
                                    ),
                                  ),
                                ],
                              ],
                            ),
                          ),
                      ],
                    ),
                  )
                : const SizedBox.shrink(),
          ),

          // Inset Box for Timers & Wait Events (e.g. "Check flutter test results" + "Status: Fired")
          if (isExpanded && item.type == ExecutionStepType.timer)
            Container(
              width: double.infinity,
              margin: const EdgeInsets.only(top: 4, bottom: 4, left: 14),
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
              decoration: BoxDecoration(
                color: isDark ? const Color(0xFF0E0F12) : scheme.surfaceContainerHighest.withValues(alpha: 0.35),
                borderRadius: BorderRadius.circular(6),
                border: Border.all(
                  color: isDark ? const Color(0xFF27272A) : scheme.outlineVariant.withValues(alpha: 0.5),
                  width: 0.8,
                ),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  if (item.timerPrompt != null && item.timerPrompt!.isNotEmpty)
                    SelectableText(
                      item.timerPrompt!,
                      style: TextStyle(
                        fontSize: 11.5,
                        fontFamily: 'monospace',
                        color: isDark ? const Color(0xFFD4D4D8) : scheme.onSurface,
                        height: 1.35,
                      ),
                    ),
                  if (item.timerStatus != null && item.timerStatus!.isNotEmpty) ...[
                    const SizedBox(height: 5),
                    Text(
                      item.timerStatus!,
                      style: TextStyle(
                        fontSize: 11,
                        fontWeight: FontWeight.w600,
                        color: isDark ? const Color(0xFF9E9FA8) : scheme.onSurfaceVariant,
                      ),
                    ),
                  ],
                ],
              ),
            ),

          // Inset Box for Task Output (Task Finished Details)
          if (isExpanded && item.type == ExecutionStepType.taskFinished && item.rawDetail != null && item.rawDetail!.isNotEmpty && item.rawDetail != item.title)
            Container(
              width: double.infinity,
              margin: const EdgeInsets.only(top: 4, bottom: 4, left: 14),
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
              decoration: BoxDecoration(
                color: isDark ? const Color(0xFF0E0F12) : scheme.surfaceContainerHighest.withValues(alpha: 0.35),
                borderRadius: BorderRadius.circular(6),
                border: Border.all(
                  color: isDark ? const Color(0xFF27272A) : scheme.outlineVariant.withValues(alpha: 0.5),
                  width: 0.8,
                ),
              ),
              child: SelectableText(
                item.rawDetail!,
                style: TextStyle(
                  fontSize: 11.5,
                  fontFamily: 'monospace',
                  color: isDark ? const Color(0xFFD4D4D8) : scheme.onSurface,
                  height: 1.35,
                ),
              ),
            ),

          // Console Terminal Box for Run command
          if (isExpanded && item.type == ExecutionStepType.command)
            Container(
              width: double.infinity,
              margin: const EdgeInsets.only(top: 4, bottom: 4),
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
              decoration: BoxDecoration(
                color: const Color(0xFF0E0F12),
                borderRadius: BorderRadius.circular(6),
                border: Border.all(color: const Color(0xFF27272A), width: 0.8),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  if (item.consolePrompt != null && item.consolePrompt!.isNotEmpty)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 6),
                      child: SelectableText(
                        item.consolePrompt!,
                        style: const TextStyle(
                          fontSize: 11,
                          fontFamily: 'monospace',
                          color: Color(0xFF71717A),
                          height: 1.35,
                        ),
                      ),
                    ),
                  if (item.consoleOutput != null && item.consoleOutput!.isNotEmpty)
                    SelectableText(
                      item.consoleOutput!,
                      style: const TextStyle(
                        fontSize: 11.5,
                        fontFamily: 'monospace',
                        color: Color(0xFFD4D4D8),
                        height: 1.35,
                      ),
                    ),
                ],
              ),
            ),

          // Thought Reasoned Detail Block (with Header & Token Highlights)
          if (isExpanded && isThoughtType && item.rawDetail != null)
            Padding(
              padding: const EdgeInsets.only(left: 4, top: 4, bottom: 6),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  if (item.thoughtTitle != null && item.thoughtTitle!.isNotEmpty)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 4),
                      child: Text(
                        item.thoughtTitle!,
                        style: const TextStyle(
                          fontSize: 12.5,
                          fontWeight: FontWeight.w600,
                          color: Color(0xFFF4F4F5),
                        ),
                      ),
                    ),
                  _buildFormattedThoughtText(item.rawDetail!),
                ],
              ),
            ),
        ],
      ),
    );
  }

  /// Builds thought text with subtle syntax highlighting on code tokens (gold/amber)
  Widget _buildFormattedThoughtText(String text) {
    final spans = <InlineSpan>[];
    final words = text.split(' ');

    for (int i = 0; i < words.length; i++) {
      final word = words[i];
      final isCodeToken = (word.contains('_') ||
              RegExp(r'^[a-zA-Z]+[A-Z][a-zA-Z0-9]*').hasMatch(word) ||
              word.startsWith('`') ||
              word.endsWith('`') ||
              word.startsWith('#L')) &&
          word.length > 2;

      if (isCodeToken) {
        final clean = word.replaceAll('`', '');
        spans.add(TextSpan(
          text: '$clean ',
          style: const TextStyle(
            fontFamily: 'monospace',
            fontSize: 11.5,
            fontWeight: FontWeight.w500,
            color: Color(0xFFFCD34D), // Antigravity 2.0 Gold token
          ),
        ));
      } else {
        spans.add(TextSpan(
          text: '$word ',
          style: const TextStyle(
            fontSize: 12,
            height: 1.45,
            color: Color(0xFFD4D4D8),
          ),
        ));
      }
    }

    return SelectableText.rich(
      TextSpan(children: spans),
    );
  }
}

/// Indicateur en direct "Working.." avec ellipse animée (. -> .. -> ...)
class _LiveWorkingIndicator extends StatefulWidget {
  const _LiveWorkingIndicator();

  @override
  State<_LiveWorkingIndicator> createState() => _LiveWorkingIndicatorState();
}

class _LiveWorkingIndicatorState extends State<_LiveWorkingIndicator> {
  int _dotCount = 2;
  Timer? _timer;

  @override
  void initState() {
    super.initState();
    _timer = Timer.periodic(const Duration(milliseconds: 550), (_) {
      if (mounted) {
        setState(() {
          _dotCount = (_dotCount % 3) + 1; // 1 -> 2 -> 3 -> 1
        });
      }
    });
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final dots = '.' * _dotCount;
    return Padding(
      padding: const EdgeInsets.only(top: 4, bottom: 4, left: 2),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(
            'Working$dots',
            style: const TextStyle(
              fontSize: 12,
              fontWeight: FontWeight.w400,
              color: Color(0xFF9E9FA8),
              letterSpacing: -0.1,
            ),
          ),
        ],
      ),
    );
  }
}
