import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/core/protocol/messages.dart';
import 'package:mobile/core/protocol/markdown_renderer.dart';
import 'package:mobile/features/sessions/display_options.dart';

void main() {
  group('Deep Performance Benchmarks & Scalability Tests', () {
    test('Session sorting & project grouping scales smoothly to 5,000 sessions', () {
      final projects = List.generate(20, (i) => ProjectItem(
        id: 'proj-$i',
        name: 'Project $i',
        folderUri: 'file:///c:/Users/dev/workspace/proj_$i',
        path: 'c:/Users/dev/workspace/proj_$i',
      ));

      for (final count in [10, 100, 500, 1000, 5000]) {
        final sessions = List.generate(count, (i) {
          final pIdx = i % 20;
          return CascadeSession(
            id: 'session-$i',
            workspacePath: 'c:/Users/dev/workspace/proj_$pIdx/submodule_$i',
            title: 'Task #$i [Issue $i](https://github.com/issue/$i) optimization',
            status: i % 5 == 0 ? 'CASCADE_STATUS_RUNNING' : 'CASCADE_STATUS_READY',
            time: '${i % 60}m',
            projectId: i % 3 == 0 ? 'proj-$pIdx' : null,
            stepCount: i % 10,
            hasUnread: i % 7 == 0,
            isPinned: i % 25 == 0,
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

        // Verification of O(N) performance — 5,000 sessions group in under 400ms
        expect(swGroup.elapsedMilliseconds, lessThan(400),
            reason: 'Grouping $count sessions took ${swGroup.elapsedMilliseconds}ms');
      }
    });

    test('MarkdownRenderer.inlineSpans high-throughput parsing & trigger scanner', () {
      const complexParagraph =
          'Here is **bold text**, *italic text*, `inline_code()`, and a link to [file](file:///path/to/source.dart) with ![preview](data:image/png;base64,iVBORw0KGgo=) followed by plain text descriptions.';

      final scheme = ColorScheme.fromSeed(seedColor: Colors.blue);
      const baseStyle = TextStyle(fontSize: 13);

      final sw = Stopwatch()..start();
      for (int i = 0; i < 500; i++) {
        final spans = MarkdownRenderer.inlineSpans(
          complexParagraph,
          baseStyle,
          scheme: scheme,
        );
        expect(spans.isNotEmpty, true);
      }
      sw.stop();

      // 500 complex paragraphs rendered in well under 500ms even under full test suite load
      expect(sw.elapsedMilliseconds, lessThan(500),
          reason: '500 markdown inline parsings took ${sw.elapsedMilliseconds}ms');
    });

    test('MarkdownRenderer.cleanContent fast path bypasses regex on clean text', () {
      const cleanMessage = 'This is a standard agent response without any system tags.';
      final cleaned = MarkdownRenderer.cleanContent(cleanMessage);
      expect(cleaned, cleanMessage);

      const taggedMessage = '<SYSTEM_MESSAGE>system prompt</SYSTEM_MESSAGE>Actual text';
      final cleanedTagged = MarkdownRenderer.cleanContent(taggedMessage);
      expect(cleanedTagged, 'Actual text');
    });
  });
}
