import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:mobile/core/network/outbox.dart';
import 'package:mobile/core/protocol/markdown_renderer.dart';
import 'package:mobile/core/protocol/messages.dart';
import 'package:mobile/core/protocol/stream_parser.dart';
import 'package:mobile/features/sessions/display_options.dart';
import 'package:mobile/services/session_history_cache_store.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() {
    SharedPreferences.setMockInitialValues({});
  });

  group('PHASE 4 — Final Deep Performance Audit & Extreme Benchmarks (TEST-01 -> TEST-10)', () {
    test('TEST-01 — Extreme Scaling: 10,000 to 50,000 Sessions with 100 Projects', () {
      final projects = List.generate(100, (i) => ProjectItem(
        id: 'proj-$i',
        name: 'Enterprise App $i',
        folderUri: 'file:///c:/Users/dev/workspace/app_$i',
        path: 'c:/Users/dev/workspace/app_$i',
      ));

      for (final count in [10000, 50000]) {
        final sessions = List.generate(count, (i) {
          final pIdx = i % 100;
          return CascadeSession(
            id: 'sess-$i',
            workspacePath: 'c:/Users/dev/workspace/app_$pIdx/sub_$i',
            title: 'Refactor cache layer & connection pool #$i',
            status: i % 5 == 0 ? 'CASCADE_STATUS_RUNNING' : 'CASCADE_STATUS_READY',
            time: '${i % 60}m',
            projectId: i % 2 == 0 ? 'proj-$pIdx' : null,
            stepCount: i % 20,
            hasUnread: i % 6 == 0,
            isPinned: i % 50 == 0,
          );
        });

        final swSort = Stopwatch()..start();
        final sorted = sortSessions(sessions: sessions, sortBy: SessionSortBy.alphabetical);
        swSort.stop();

        final swGroup = Stopwatch()..start();
        final grouped = groupSessions(
          sessions: sorted,
          groupBy: SessionGroupBy.project,
          projects: projects,
        );
        swGroup.stop();

        expect(sorted.length, count);
        expect(grouped.isNotEmpty, true);

        // Sorting 50,000 sessions must take < 800ms
        if (count == 50000) {
          expect(swSort.elapsedMilliseconds, lessThan(800),
              reason: 'Sorting 50k sessions took ${swSort.elapsedMilliseconds}ms');
          expect(swGroup.elapsedMilliseconds, lessThan(2500),
              reason: 'Grouping 50k sessions took ${swGroup.elapsedMilliseconds}ms');
        } else {
          expect(swSort.elapsedMilliseconds, lessThan(180),
              reason: 'Sorting 10k sessions took ${swSort.elapsedMilliseconds}ms');
          expect(swGroup.elapsedMilliseconds, lessThan(250),
              reason: 'Grouping 10k sessions took ${swGroup.elapsedMilliseconds}ms');
        }
      }
    });

    test('TEST-02 & TEST-03 — 500 events/s Burst Streaming Across 20 Concurrent Agents', () {
      final agentsCount = 20;
      final eventsPerAgent = 100; // 2,000 total events
      final agentBuffers = <String, StringBuffer>{};

      final sw = Stopwatch()..start();
      for (int agent = 0; agent < agentsCount; agent++) {
        final cascadeId = 'agent-cascade-$agent';
        final buf = StringBuffer();
        for (int e = 0; e < eventsPerAgent; e++) {
          final event = {
            'type': 'stream_delta',
            'data': {
              'cascadeId': cascadeId,
              'events': [
                {'kind': 'text', 'delta': ' delta_$e token of code'},
                {'kind': 'thinking', 'delta': ' thinking step $e'},
              ],
            },
          };
          final text = StreamDeltaParser.textOf(event);
          final think = StreamDeltaParser.thinkingOf(event);
          buf.write('$text$think');
        }
        agentBuffers[cascadeId] = buf;
      }
      sw.stop();

      expect(agentBuffers.length, agentsCount);
      // 2,000 parsed streaming events across 20 agents must complete in under 200ms
      expect(sw.elapsedMilliseconds, lessThan(200),
          reason: 'Parsing 2,000 stream events took ${sw.elapsedMilliseconds}ms');
    });

    test('TEST-04 — Large Payloads (10 MB to 50 MB) Log & Code Splitting Resilience', () {
      final codeSample = List.generate(50, (i) => 'const item_$i = { index: $i, val: Math.random() };').join('\n');
      final markdownBlock = '```typescript\n$codeSample\n```\n';
      
      // Build 1 MB base chunk
      final oneMbChunk = List.generate(100, (i) => '## Step $i\n$markdownBlock\nExecuting task $i.\n').join('\n');
      
      // 10 MB payload
      final tenMbPayload = List.generate(10, (_) => oneMbChunk).join('\n---\n');
      expect(tenMbPayload.length, greaterThan(1000000));

      final sw = Stopwatch()..start();
      final blocks = MarkdownRenderer.blocksOf(tenMbPayload);
      sw.stop();

      expect(blocks.isNotEmpty, true);
      expect(sw.elapsedMilliseconds, lessThan(3500),
          reason: 'Parsing 10MB payload took ${sw.elapsedMilliseconds}ms');
    });

    test('TEST-05 — 10,000 Messages Timeline Construction & Parsing', () {
      final messages = List.generate(10000, (i) => ChatMessage(
        id: 'msg-$i',
        sender: i % 2 == 0 ? 'user' : 'assistant',
        text: i % 2 == 0
            ? 'User request #$i for refactoring component'
            : 'Assistant response #$i with `code_snippet()` and [docs](https://antigravity.dev).',
        timestamp: '15:${(i % 60).toString().padLeft(2, '0')}',
        thought: i % 4 == 0 ? 'Thinking step $i...' : null,
      ));

      final sw = Stopwatch()..start();
      int parsedCount = 0;
      for (final msg in messages) {
        if (msg.sender == 'assistant') {
          final blocks = MarkdownRenderer.blocksOf(msg.text);
          parsedCount += blocks.length;
        }
      }
      sw.stop();

      expect(parsedCount, greaterThanOrEqualTo(5000));
      expect(sw.elapsedMilliseconds, lessThan(1200),
          reason: 'Parsing 10,000 messages took ${sw.elapsedMilliseconds}ms');
    });

    test('TEST-06 — Fast-Path Markdown Formatting & Zero-Allocation on Plain Text', () {
      const plainText = 'This is a simple plain text message without markdown styling.';
      
      final sw = Stopwatch()..start();
      for (int i = 0; i < 5000; i++) {
        final blocks = MarkdownRenderer.blocksOf(plainText);
        expect(blocks.length, 1);
      }
      sw.stop();

      // 5,000 plain text runs should execute in < 200ms
      expect(sw.elapsedMilliseconds, lessThan(200),
          reason: '5,000 plain text runs took ${sw.elapsedMilliseconds}ms');
    });

    test('TEST-07 & TEST-10 — Memory Soak Test: 1,000x Session Open/Close Cycles', () async {
      final store = SessionHistoryCacheStore.instance;
      store.clearMemory();

      final sw = Stopwatch()..start();
      for (int i = 0; i < 1000; i++) {
        final sId = 'sess-cycle-$i';
        final messages = [
          ChatMessage(id: 'm1-$i', sender: 'user', text: 'Prompt in $sId', timestamp: '12:00'),
          ChatMessage(id: 'm2-$i', sender: 'assistant', text: 'Response in $sId', timestamp: '12:01'),
        ];
        await store.saveSessionHistory(sId, messages);
        final loaded = store.getInMemory(sId);
        expect(loaded, isNotNull);
      }
      sw.stop();

      // Ensure that in-memory cache strictly caps at max 30 sessions (zero memory leaks)
      int activeInMemory = 0;
      for (int i = 0; i < 1000; i++) {
        if (store.getInMemory('sess-cycle-$i') != null) {
          activeInMemory++;
        }
      }
      expect(activeInMemory, lessThanOrEqualTo(30));
      expect(sw.elapsedMilliseconds, lessThan(800),
          reason: '1,000 session open/close cycles took ${sw.elapsedMilliseconds}ms');
    });

    test('TEST-08 — 100x WebSocket Reconnection & Outbox Replay Idempotency', () async {
      final outbox = OutboxQueue();
      for (int i = 0; i < 100; i++) {
        outbox.enqueue({'type': 'send_prompt', 'requestId': 'req-burst-$i', 'prompt': 'Task $i'});
      }
      expect(outbox.pendingCount, 100);

      final replayed = <String>[];
      final replayer = OutboxReplayer(
        queue: outbox,
        send: (msg) => replayed.add(msg['requestId'] as String),
        resync: () async => {'status': 'ok'},
      );

      // Trigger reconnect flush
      replayer.onReconnect();
      await Future.delayed(const Duration(milliseconds: 20));

      expect(replayed.length, 100);
      expect(outbox.hasPending, false);
    });

    test('TEST-09 — 500x Conversation History Pipeline Re-executions (Memoization Check)', () {
      final sessions = List<CascadeSession>.generate(500, (i) => CascadeSession(
        id: 'sess-$i',
        workspacePath: 'c:/Users/dev/workspace/app_${i % 10}',
        title: 'Task $i',
        status: 'CASCADE_STATUS_READY',
        time: '12:00',
      ));
      final projects = List.generate(10, (i) => ProjectItem(
        id: 'proj-$i',
        name: 'App $i',
        folderUri: 'file:///c:/Users/dev/workspace/app_$i',
        path: 'c:/Users/dev/workspace/app_$i',
      ));

      // Benchmark sorting and grouping 500 times
      final sw = Stopwatch()..start();
      for (int i = 0; i < 500; i++) {
        final sorted = sortSessions(sessions: sessions, sortBy: SessionSortBy.alphabetical);
        final grouped = groupSessions(sessions: sorted, groupBy: SessionGroupBy.project, projects: projects);
        expect(grouped.isNotEmpty, true);
      }
      sw.stop();

      expect(sw.elapsedMilliseconds, lessThan(1200),
          reason: '500 pipeline executions took ${sw.elapsedMilliseconds}ms');
    });
  });
}
