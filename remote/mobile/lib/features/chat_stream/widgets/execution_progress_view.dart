import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../../../theme/app_colors.dart';
import '../../../widgets/md3_spinner.dart';
import '../../../widgets/antigravity_spinning_arc.dart';
import '../../../widgets/antigravity_dot_pulse_loader.dart';
import '../../../widgets/resolved_ask_question_card.dart';

/// Type d'étape d'exécution fidèle à Antigravity 2.0 Desktop.
enum ExecutionStepType {
  header,
  command,
  commandGroup,
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
  question,
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
  final bool isImage;

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
    this.isImage = false,
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
  final Set<String> _expandedSubIndices = {};
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

    void addRawItem(ExecutionStepItem item) {
      if (rawItems.isNotEmpty) {
        final last = rawItems.last;
        if (last.type == item.type &&
            last.action == item.action &&
            last.title == item.title &&
            last.lineRange == item.lineRange &&
            last.diffAdded == item.diffAdded &&
            last.diffRemoved == item.diffRemoved) {
          return; // Skip duplicate consecutive item
        }
      }
      rawItems.add(item);
    }

    void flushConsole() {
      if (currentCmdTitle.isNotEmpty) {
        final out = consoleBuffer.toString().trim();
        addRawItem(ExecutionStepItem(
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
        planName = planName.replaceAll('📄', '').replaceAll('`', '').replaceAll('"', '').replaceAll("'", '').trim();
        addRawItem(ExecutionStepItem(
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

        addRawItem(ExecutionStepItem(
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
        addRawItem(ExecutionStepItem(
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
        addRawItem(ExecutionStepItem(
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
        var rest = line.substring(prefixLen).trim();
        rest = rest.replaceAll('"', '').replaceAll("'", '').trim();
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
          fileName = parts[idx].replaceAll('"', '').replaceAll("'", '').trim();
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
        addRawItem(ExecutionStepItem(
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
        var rest = line.substring(prefixLen).trim();
        rest = rest.replaceAll('"', '').replaceAll("'", '').trim();
        final match = RegExp(r'^(?:(TS|JS|Dart|Go|Py|>_|JSON|MD|HTML|CSS|YAML|SQL)\s+)?(\S+)(?:\s+(#L\d+(?:-\d+)?))?', caseSensitive: false).firstMatch(rest);
        final extTag = match?.group(1);
        var fileName = match?.group(2) ?? rest;
        final lineRange = match?.group(3);
        fileName = fileName.replaceAll('"', '').replaceAll("'", '').trim();

        // Humanize scaled image names: scaled_1000134685.png -> Scaled 1000134685
        final lowerFile = fileName.toLowerCase();
        final isImg = lowerFile.endsWith('.png') ||
            lowerFile.endsWith('.jpg') ||
            lowerFile.endsWith('.jpeg') ||
            lowerFile.endsWith('.webp') ||
            lowerFile.endsWith('.gif') ||
            lowerFile.startsWith('scaled_') ||
            lowerFile.startsWith('scaled ');

        if (lowerFile.startsWith('scaled_') || lowerFile.startsWith('scaled ')) {
          final parts = fileName.split(RegExp(r'[_.]'));
          if (parts.length >= 2 && parts[0].toLowerCase() == 'scaled') {
            fileName = 'Scaled ${parts[1]}';
          }
        }

        addRawItem(ExecutionStepItem(
          type: ExecutionStepType.fileAnalysis,
          action: isAnalyzed ? 'Analyzed' : 'Viewed',
          title: extTag != null ? '$extTag $fileName' : fileName,
          lineRange: lineRange,
          isImage: isImg,
        ));
        continue;
      }

      // 6b. Searched / Search <query> <count> results
      if (lower.startsWith('searched ') || lower.startsWith('search ') || lower.startsWith('searching ')) {
        final prefixLen = lower.startsWith('searched ')
            ? 9
            : (lower.startsWith('searching ') ? 10 : 7);
        var rest = line.substring(prefixLen).trim();
        rest = rest.replaceAll('"', '').replaceAll("'", '').trim();
        final match = RegExp(r'^(.*?)(?:\s+(\d+)\s+results?)?$', caseSensitive: false).firstMatch(rest);
        final query = match?.group(1)?.trim() ?? rest;
        final count = match?.group(2);
        addRawItem(ExecutionStepItem(
          type: ExecutionStepType.search,
          action: 'Searched',
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
        addRawItem(ExecutionStepItem(
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
        addRawItem(ExecutionStepItem(
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
        var cleanTitle = line.replaceFirst(
            RegExp(r'^(ran|run|running command:|executed:)\s*', caseSensitive: false), '').trim();
        if ((cleanTitle.startsWith('"') && cleanTitle.endsWith('"')) ||
            (cleanTitle.startsWith("'") && cleanTitle.endsWith("'"))) {
          cleanTitle = cleanTitle.substring(1, cleanTitle.length - 1).trim();
        }
        currentCmdTitle = cleanTitle;
        currentCmdPrompt = '> $cleanTitle';
        if (i + 1 >= lines.length || !lines[i + 1].trim().startsWith('```')) {
          flushConsole();
        }
        continue;
      }

      // 10. Checked task / Task
      if (lower.startsWith('checked task ') || lower.startsWith('task ')) {
        final isChecked = lower.startsWith('checked task ');
        String action = 'Task';
        String title = line.substring(5).trim();
        if (isChecked) {
          action = 'Checked task';
          title = line.substring(13).trim();
        }
        if ((title.startsWith('"') && title.endsWith('"')) ||
            (title.startsWith("'") && title.endsWith("'"))) {
          title = title.substring(1, title.length - 1).trim();
        }
        addRawItem(ExecutionStepItem(
          type: ExecutionStepType.task,
          action: action,
          title: title,
          isExpandable: true,
        ));
        continue;
      }

      // 11. Error messages (e.g. "Error Individual quota reached... Resets in 3h57m11s. >")
      if (lower.startsWith('error') || lower.startsWith('resource_exhausted')) {
        var clean = line;
        if (clean.endsWith('>')) clean = clean.substring(0, clean.length - 1).trim();
        String? errId;
        int nextI = i + 1;
        if (nextI < lines.length &&
            (lines[nextI].trim().toLowerCase().startsWith('error id:') ||
             lines[nextI].trim().toLowerCase().startsWith('id:'))) {
          errId = lines[nextI].trim();
          i = nextI;
        }
        addRawItem(ExecutionStepItem(
          type: ExecutionStepType.task,
          action: '',
          title: clean,
          isExpandable: true,
          rawDetail: errId != null ? '$clean\n$errId' : clean,
          consolePrompt: errId,
        ));
        continue;
      }

      // 12. Question block: [?] 1 question or Question: ...
      if (line.startsWith('[?]') || line.startsWith('❓') || lower.startsWith('question:')) {
        String qTitle = line;
        String? ansText;
        int nextI = i + 1;
        while (nextI < lines.length) {
          final nextLine = lines[nextI].trim();
          if (nextLine.isEmpty) {
            nextI++;
            continue;
          }
          if (nextLine.startsWith('✓') || nextLine.startsWith('-') || nextLine.startsWith('*') || nextLine.toLowerCase().startsWith('answer:')) {
            ansText = nextLine.replaceFirst(RegExp(r'^[✓\-\*\s]+'), '').trim();
            nextI++;
          } else {
            break;
          }
        }
        if (ansText != null) {
          i = nextI - 1;
        }
        addRawItem(ExecutionStepItem(
          type: ExecutionStepType.question,
          action: '1 question',
          title: qTitle.replaceAll('[?]', '').replaceAll('❓', '').trim(),
          rawDetail: ansText ?? '',
          isExpandable: false,
        ));
        continue;
      }

      // 13. Narrative text from agent (e.g. "Vérification globale...", "Attente des résultats...")
      if (line.endsWith('...') || line.endsWith('…') || (!line.startsWith('#') && line.length < 100 && !line.contains('`'))) {
        addRawItem(ExecutionStepItem(
          type: ExecutionStepType.narrativeText,
          action: '',
          title: line,
          isExpandable: false,
        ));
        continue;
      }

      // 14. Output / thought text
      currentThoughtBuffer.writeln(lines[i]);
    }

    flushConsole();

    // Grouping: Si on a un exploredGroup suivi d'analyses, on les regroupe sous le groupe Explored
    final items = <ExecutionStepItem>[];
    for (int i = 0; i < rawItems.length; i++) {
      final current = rawItems[i];
      if (current.type == ExecutionStepType.exploredGroup) {
        final sub = <ExecutionStepItem>[];
        final seenSubKeys = <String>{};
        int j = i + 1;
        while (j < rawItems.length && (rawItems[j].type == ExecutionStepType.fileAnalysis || rawItems[j].type == ExecutionStepType.search)) {
          final sKey = '${rawItems[j].type}:${rawItems[j].action}:${rawItems[j].title}:${rawItems[j].lineRange}';
          if (seenSubKeys.add(sKey)) {
            sub.add(rawItems[j]);
          }
          j++;
        }
        if (sub.isNotEmpty && (current.title.isEmpty || RegExp(r'^\d+\s+(file|task|item)', caseSensitive: false).hasMatch(current.title))) {
          int fCount = 0;
          int sCount = 0;
          for (final s in sub) {
            if (s.type == ExecutionStepType.search) {
              sCount++;
            } else {
              fCount++;
            }
          }
          final pList = <String>[];
          if (fCount > 0) pList.add(fCount == 1 ? '1 file' : '$fCount files');
          if (sCount > 0) pList.add(sCount == 1 ? '1 search' : '$sCount searches');

          items.add(ExecutionStepItem(
            type: ExecutionStepType.exploredGroup,
            action: current.action,
            title: pList.isNotEmpty ? pList.join(', ') : (sub.length == 1 ? '1 file' : '${sub.length} files'),
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

      final displayTitle = thoughtTitle ?? (widget.isStreaming
          ? (_secondsElapsed > 0 ? 'for ${_formatDuration(_secondsElapsed)}' : '')
          : 'Reasoning');

      items.add(ExecutionStepItem(
        type: ExecutionStepType.thought,
        action: widget.isStreaming ? 'Thinking' : 'Thought',
        title: displayTitle.isNotEmpty ? displayTitle : 'Reasoning',
        thoughtTitle: thoughtTitle,
        rawDetail: body.isNotEmpty ? body : thoughtContent,
        isExpandable: true,
        isRunning: widget.isStreaming,
      ));
    }

    return _groupSteps(items);
  }

  List<ExecutionStepItem> _groupSteps(List<ExecutionStepItem> source) {
    if (source.isEmpty) return source;

    final result = <ExecutionStepItem>[];
    final explorationGroup = <ExecutionStepItem>[];
    final commandGroup = <ExecutionStepItem>[];

    bool isExplorationStep(ExecutionStepType type) {
      return type == ExecutionStepType.fileAnalysis ||
          type == ExecutionStepType.search ||
          type == ExecutionStepType.exploredGroup;
    }

    void flushExploration(bool isLastGroup) {
      if (explorationGroup.isEmpty) return;

      // Deduplicate explorationGroup items by unique signature
      final uniqueExploration = <ExecutionStepItem>[];
      final seen = <String>{};
      for (final item in explorationGroup) {
        final key = '${item.type}:${item.action}:${item.title}:${item.lineRange}';
        if (seen.add(key)) {
          uniqueExploration.add(item);
        }
      }

      int fileCount = 0;
      int searchCount = 0;
      for (final item in uniqueExploration) {
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
        subItems: uniqueExploration,
        isExpandable: true,
        isRunning: isRunning,
      ));

      explorationGroup.clear();
    }

    void flushCommands(bool isLastGroup) {
      if (commandGroup.isEmpty) return;

      if (commandGroup.length == 1) {
        result.add(commandGroup.first);
        commandGroup.clear();
        return;
      }

      final bool isRunning = widget.isStreaming && isLastGroup;
      final action = isRunning ? 'Running' : 'Ran';
      final title = '${commandGroup.length} commands';

      result.add(ExecutionStepItem(
        type: ExecutionStepType.commandGroup,
        action: action,
        title: title,
        subItems: List.from(commandGroup),
        isExpandable: true,
        isRunning: isRunning,
      ));

      commandGroup.clear();
    }

    for (int i = 0; i < source.length; i++) {
      final item = source[i];

      if (isExplorationStep(item.type)) {
        flushCommands(false);
        explorationGroup.add(item);
      } else if (item.type == ExecutionStepType.command) {
        flushExploration(false);
        commandGroup.add(item);
      } else {
        flushExploration(false);
        flushCommands(false);
        result.add(item);
      }
    }
    flushExploration(true);
    flushCommands(true);

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
        color: isDark ? AppColors.surfaceRaised : scheme.primaryContainer.withValues(alpha: 0.25),
        gradient: AppGradients.cardCool(isDark: isDark),
        borderRadius: BorderRadius.circular(AppRadius.md),
        border: Border.all(
          color: isDark ? AppColors.accentBlue.withValues(alpha: 0.35) : scheme.primary.withValues(alpha: 0.25),
          width: 0.8,
        ),
      ),
      child: Row(
        children: [
          if (widget.isStreaming)
            const AntigravitySpinningArc(size: 13, color: AppColors.accentBlueBright)
          else
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
                    color: isDark ? AppColors.surfaceInput : scheme.surfaceContainerHighest,
                    borderRadius: BorderRadius.circular(AppRadius.xs),
                    border: Border.all(
                      color: isDark ? AppColors.borderSubtle : scheme.outlineVariant.withValues(alpha: 0.5),
                      width: 0.5,
                    ),
                  ),
                  child: Text(
                    _formatDuration(_secondsElapsed),
                    style: TextStyle(
                      fontSize: 10.5,
                      fontFamily: 'monospace',
                      fontWeight: FontWeight.w600,
                      color: isDark ? AppColors.inkSecondary : scheme.onSurfaceVariant,
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
                        color: isDark ? AppColors.inkMuted : scheme.outline,
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
                borderRadius: BorderRadius.circular(AppRadius.xs),
                child: Semantics(
                  button: true,
                  label: 'Arrêter l\'exécution de l\'agent',
                  child: Container(
                    constraints: const BoxConstraints(minHeight: 44, minWidth: 44),
                    alignment: Alignment.center,
                    child: Container(
                      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                      decoration: BoxDecoration(
                        color: isDark ? AppColors.dangerSubtle : const Color(0xFFFEE2E2),
                        borderRadius: BorderRadius.circular(AppRadius.xs),
                        border: Border.all(
                          color: AppColors.danger.withValues(alpha: 0.5),
                          width: 0.8,
                        ),
                      ),
                      child: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Icon(
                            Icons.stop_rounded,
                            size: 12,
                            color: isDark ? AppColors.danger : const Color(0xFFDC2626),
                          ),
                          const SizedBox(width: 4),
                          Text(
                            'Stop',
                            style: TextStyle(
                              fontSize: 11,
                              fontWeight: FontWeight.w700,
                              color: isDark ? AppColors.danger : const Color(0xFFDC2626),
                            ),
                          ),
                        ],
                      ),
                    ),
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
                      AntigravityDotPulseLoader(
                        dotSize: 4.5,
                        spacing: 3.0,
                        color: isDark ? AppColors.accentBlue : scheme.primary,
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
                if (widget.isStreaming) ...[
                  AntigravitySpinningArc(
                    size: 11.5,
                    color: isDark ? AppColors.accentBlueBright : scheme.primary,
                  ),
                  const SizedBox(width: 6),
                ],
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
            color: isDark ? AppColors.executionCardBg : scheme.surfaceContainerHighest.withValues(alpha: 0.5),
            borderRadius: BorderRadius.circular(AppRadius.md),
            border: Border.all(
              color: isDark ? AppColors.executionBorder : scheme.outlineVariant.withValues(alpha: 0.6),
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

    // 3. Cas particulier : Question résolue (AskQuestion) inline
    if (item.type == ExecutionStepType.question) {
      return ResolvedAskQuestionCard(
        question: item.title,
        selectedAnswer: item.rawDetail ?? '',
        questionCountLabel: item.action.isNotEmpty ? item.action : '1 question',
        isWriteIn: (item.rawDetail ?? '').contains('write-in'),
      );
    }

    final isExploredGroup = item.type == ExecutionStepType.exploredGroup;
    final isCommandGroup = item.type == ExecutionStepType.commandGroup;
    final isExpanded = _expandedIndices.contains(index) ||
        ((isExploredGroup || isCommandGroup) && item.isRunning) ||
        (widget.initiallyExpanded &&
            (item.type == ExecutionStepType.thought ||
             item.type == ExecutionStepType.timer ||
             item.type == ExecutionStepType.processingGroup ||
             item.type == ExecutionStepType.exploredGroup ||
             item.type == ExecutionStepType.commandGroup));

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

                  // File Edit Badge (emerald pencil icon)
                  if (item.type == ExecutionStepType.fileEdit) ...[
                    const Padding(
                      padding: EdgeInsets.only(right: 5),
                      child: Icon(
                        Icons.edit_note_rounded,
                        size: 14,
                        color: AppColors.executionFileEdit,
                      ),
                    ),
                  ],

                  // File Read Badge (Image photo icon or Document icon)
                  if (item.type == ExecutionStepType.fileAnalysis) ...[
                    Padding(
                      padding: const EdgeInsets.only(right: 5),
                      child: Icon(
                        item.isImage ? Icons.photo_outlined : Icons.insert_drive_file_outlined,
                        size: item.isImage ? 14 : 13.5,
                        color: item.isImage ? const Color(0xFF9E9FA8) : AppColors.executionFileAnalysis,
                      ),
                    ),
                  ],

                  // Search Icon Badge (teal search icon)
                  if (item.type == ExecutionStepType.search) ...[
                    const Padding(
                      padding: EdgeInsets.only(right: 5),
                      child: Icon(
                        Icons.search_rounded,
                        size: 13.5,
                        color: AppColors.executionSearch,
                      ),
                    ),
                  ],

                  // Subagent Icon Badge (purple agent icon)
                  if (item.type == ExecutionStepType.subagent) ...[
                    const Padding(
                      padding: EdgeInsets.only(right: 5),
                      child: Icon(
                        Icons.smart_toy_outlined,
                        size: 13.5,
                        color: AppColors.executionSubagent,
                      ),
                    ),
                  ],

                  // Command / Task Finished Icon Badge (terminal icon)
                  if (item.type == ExecutionStepType.command || item.type == ExecutionStepType.taskFinished) ...[
                    const Padding(
                      padding: EdgeInsets.only(right: 5),
                      child: Icon(
                        Icons.terminal_rounded,
                        size: 13.5,
                        color: AppColors.executionTerminal,
                      ),
                    ),
                  ],

                  // Timer Icon Badge (amber timer icon)
                  if (item.type == ExecutionStepType.timer) ...[
                    const Padding(
                      padding: EdgeInsets.only(right: 5),
                      child: Icon(
                        Icons.timer_outlined,
                        size: 13.5,
                        color: AppColors.executionTimer,
                      ),
                    ),
                  ],

                  // Thought / Reasoning Icon Badge (gold lightbulb icon)
                  if (item.type == ExecutionStepType.thought) ...[
                    const Padding(
                      padding: EdgeInsets.only(right: 5),
                      child: Icon(
                        Icons.lightbulb_outline_rounded,
                        size: 13.5,
                        color: AppColors.executionThought,
                      ),
                    ),
                  ],

                  // Step title (Filename / Duration / Command / Task status / Error)
                  Flexible(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Text(
                          isExpanded && item.rawDetail != null && !isThoughtType && item.type != ExecutionStepType.timer && !item.title.toLowerCase().startsWith('error')
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
                            color: item.title.toLowerCase().startsWith('error')
                                ? const Color(0xFFF87171)
                                : (isThoughtType
                                    ? const Color(0xFF9E9FA8)
                                    : (item.type == ExecutionStepType.taskFinished
                                        ? const Color(0xFF9E9FA8)
                                        : const Color(0xFFF4F4F5))),
                          ),
                        ),
                        if (item.consolePrompt != null && item.title.toLowerCase().startsWith('error')) ...[
                          const SizedBox(height: 2),
                          Text(
                            item.consolePrompt!,
                            style: const TextStyle(
                              fontSize: 10.5,
                              fontFamily: 'monospace',
                              color: Color(0xFF71717A),
                            ),
                          ),
                        ],
                      ],
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
                        color: isDark ? AppColors.executionSearchBg : scheme.surfaceContainerHighest,
                        borderRadius: BorderRadius.circular(AppRadius.xs),
                        border: Border.all(
                          color: isDark ? AppColors.executionSearchBorder : scheme.outlineVariant,
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
                        color: AppColors.executionDiffAdded,
                      ),
                    ),
                    const SizedBox(width: 4),
                    Text(
                      item.diffRemoved ?? '-0',
                      style: const TextStyle(
                        fontSize: 11,
                        fontFamily: 'monospace',
                        fontWeight: FontWeight.w600,
                        color: AppColors.executionDiffRemoved,
                      ),
                    ),
                  ],

                  // Running Spinner (MD3 double-track fluid spinner) or Expand Chevron
                  if (item.isRunning) ...[
                    const SizedBox(width: 6),
                    const Md3DoubleTrackSpinner(size: 12, strokeWidth: 1.5),
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

          // Sub-items for Explored Group and Command Group (Indented Children with Timeline Track)
          AnimatedSize(
            duration: AppMotion.base,
            curve: Curves.fastOutSlowIn,
            alignment: Alignment.topLeft,
            child: (isExpanded && item.subItems != null && item.subItems!.isNotEmpty)
                ? Container(
                    margin: const EdgeInsets.only(left: 6),
                    padding: const EdgeInsets.only(left: 12, top: 2, bottom: 2),
                    decoration: BoxDecoration(
                      border: Border(
                        left: BorderSide(
                          color: isDark ? AppColors.executionBorder : scheme.outlineVariant.withValues(alpha: 0.4),
                          width: 1.0,
                        ),
                      ),
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        for (int subIdx = 0; subIdx < item.subItems!.length; subIdx++) ...[
                          Builder(
                            builder: (context) {
                              final sub = item.subItems![subIdx];
                              final subKey = '$index-$subIdx';
                              final isSubExpanded = _expandedSubIndices.contains(subKey);
                              final isSubCommand = sub.type == ExecutionStepType.command;

                              return Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  InkWell(
                                    onTap: isSubCommand
                                        ? () {
                                            HapticFeedback.selectionClick();
                                            setState(() {
                                              if (_expandedSubIndices.contains(subKey)) {
                                                _expandedSubIndices.remove(subKey);
                                              } else {
                                                _expandedSubIndices.add(subKey);
                                              }
                                            });
                                          }
                                        : null,
                                    borderRadius: BorderRadius.circular(AppRadius.xs),
                                    child: Padding(
                                      padding: const EdgeInsets.symmetric(vertical: 2.5, horizontal: 2),
                                      child: Row(
                                        mainAxisSize: MainAxisSize.min,
                                        children: [
                                          if (sub.action.isNotEmpty) ...[
                                            Text(
                                              sub.action,
                                              style: const TextStyle(
                                                fontSize: 12,
                                                color: Color(0xFF9E9FA8),
                                                fontWeight: FontWeight.w400,
                                              ),
                                            ),
                                            const SizedBox(width: 5),
                                          ],
                                          if (sub.type == ExecutionStepType.search) ...[
                                            const Padding(
                                              padding: EdgeInsets.only(right: 5),
                                              child: Icon(
                                                Icons.search_rounded,
                                                size: 13.5,
                                                color: AppColors.executionSearch,
                                              ),
                                            ),
                                          ] else if (sub.type == ExecutionStepType.fileAnalysis) ...[
                                            Padding(
                                              padding: const EdgeInsets.only(right: 5),
                                              child: Icon(
                                                sub.isImage ? Icons.photo_outlined : Icons.insert_drive_file_outlined,
                                                size: sub.isImage ? 14 : 13.5,
                                                color: sub.isImage ? const Color(0xFF9E9FA8) : AppColors.executionFileAnalysis,
                                              ),
                                            ),
                                          ] else if (sub.type == ExecutionStepType.fileEdit) ...[
                                            const Padding(
                                              padding: EdgeInsets.only(right: 5),
                                              child: Icon(
                                                Icons.edit_note_rounded,
                                                size: 14,
                                                color: AppColors.executionFileEdit,
                                              ),
                                            ),
                                          ] else if (isSubCommand) ...[
                                            const Padding(
                                              padding: EdgeInsets.only(right: 5),
                                              child: Icon(
                                                Icons.terminal_rounded,
                                                size: 13.5,
                                                color: AppColors.executionTerminal,
                                              ),
                                            ),
                                          ],
                                          Flexible(
                                            child: Text(
                                              sub.title,
                                              style: TextStyle(
                                                fontSize: 12,
                                                fontFamily: (sub.type == ExecutionStepType.fileAnalysis ||
                                                        sub.type == ExecutionStepType.fileEdit ||
                                                        isSubCommand)
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
                                            Container(
                                              padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 1.5),
                                              decoration: BoxDecoration(
                                                color: isDark ? AppColors.executionSearchBg : scheme.surfaceContainerHighest,
                                                borderRadius: BorderRadius.circular(AppRadius.xs),
                                                border: Border.all(
                                                  color: isDark ? AppColors.executionSearchBorder : scheme.outlineVariant,
                                                  width: 0.5,
                                                ),
                                              ),
                                              child: Text(
                                                sub.diffAdded!,
                                                style: const TextStyle(
                                                  fontSize: 10.5,
                                                  fontFamily: 'monospace',
                                                  fontWeight: FontWeight.w500,
                                                  color: Color(0xFF9E9FA8),
                                                ),
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
                                                color: AppColors.executionDiffAdded,
                                              ),
                                            ),
                                            const SizedBox(width: 4),
                                            Text(
                                              sub.diffRemoved ?? '-0',
                                              style: const TextStyle(
                                                fontSize: 11,
                                                fontFamily: 'monospace',
                                                fontWeight: FontWeight.w600,
                                                color: AppColors.executionDiffRemoved,
                                              ),
                                            ),
                                          ],
                                          if (isSubCommand) ...[
                                            const SizedBox(width: 4),
                                            Icon(
                                              isSubExpanded
                                                  ? Icons.keyboard_arrow_down_rounded
                                                  : Icons.chevron_right_rounded,
                                              size: 13,
                                              color: const Color(0xFF71717A),
                                            ),
                                          ],
                                        ],
                                      ),
                                    ),
                                  ),
                                  if (isSubCommand && isSubExpanded)
                                    Container(
                                      width: double.infinity,
                                      margin: const EdgeInsets.only(top: 3, bottom: 6, left: 4),
                                      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                                      decoration: BoxDecoration(
                                        color: isDark ? AppColors.executionTerminalBg : scheme.surfaceContainerHighest,
                                        borderRadius: BorderRadius.circular(AppRadius.sm),
                                        border: Border.all(
                                          color: isDark ? AppColors.executionBorder : scheme.outlineVariant,
                                          width: 0.8,
                                        ),
                                      ),
                                      child: Column(
                                        crossAxisAlignment: CrossAxisAlignment.start,
                                        children: [
                                          if (sub.consolePrompt != null && sub.consolePrompt!.isNotEmpty)
                                            Padding(
                                              padding: const EdgeInsets.only(bottom: 6),
                                              child: SelectableText(
                                                sub.consolePrompt!,
                                                style: const TextStyle(
                                                  fontSize: 11,
                                                  fontFamily: 'monospace',
                                                  color: Color(0xFF71717A),
                                                  height: 1.35,
                                                ),
                                              ),
                                            ),
                                          if (sub.consoleOutput != null && sub.consoleOutput!.isNotEmpty)
                                            SelectableText(
                                              sub.consoleOutput!,
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
                                ],
                              );
                            },
                          ),
                        ],
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
            Container(
              width: double.infinity,
              margin: const EdgeInsets.only(left: 4, top: 4, bottom: 6),
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
              decoration: BoxDecoration(
                color: isDark ? const Color(0xFF0E0F12) : scheme.surfaceContainerHighest.withValues(alpha: 0.35),
                borderRadius: BorderRadius.circular(6),
                border: Border.all(
                  color: isDark ? const Color(0xFF2E2415) : const Color(0xFFF59E0B).withValues(alpha: 0.3),
                  width: 0.8,
                ),
              ),
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
    final isDark = Theme.of(context).brightness == Brightness.dark;
    return Padding(
      padding: const EdgeInsets.only(top: 4, bottom: 4, left: 4),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.center,
        children: [
          const Md3DoubleTrackSpinner(size: 13, strokeWidth: 1.6),
          const SizedBox(width: 7),
          Text(
            'Working$dots',
            style: TextStyle(
              fontSize: 12,
              fontWeight: FontWeight.w400,
              color: isDark ? const Color(0xFF9E9FA8) : const Color(0xFF5F6368),
              letterSpacing: -0.1,
            ),
          ),
        ],
      ),
    );
  }
}
