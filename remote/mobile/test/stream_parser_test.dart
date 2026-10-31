import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/core/protocol/stream_parser.dart';

void main() {
  group('StreamDeltaParser command extraction', () {
    ToolApproval makeApproval(String detail) {
      return ToolApproval(
        callId: 'test',
        tool: 'run_command',
        detail: detail,
        cascadeId: 'test',
      );
    }

    test('extracts command_line correctly with normal casing', () {
      final detail = '{"command_line": "npm run build", "cwd": "/app"}';
      expect(makeApproval(detail).command, 'npm run build');
    });

    test('extracts commandline correctly without underscore', () {
      final detail = '{"commandline": "flutter test", "cwd": "/app"}';
      expect(makeApproval(detail).command, 'flutter test');
    });

    test('extracts command_line correctly with mixed casing (caseSensitive: false check)', () {
      final detail = '{"CommandLine": "dart run", "cwd": "/app"}';
      expect(makeApproval(detail).command, 'dart run');
    });

    test('returns empty if no command is found and no fallback line exists', () {
      final detail = '{}';
      expect(makeApproval(detail).command, '');
    });
  });

  group('StreamDeltaParser live tool execution in thinkingOf', () {
    test('extracts run_command as Ran <cmd>', () {
      final msg = {
        'type': 'stream_delta',
        'data': {
          'events': [
            {
              'kind': 'tool_call',
              'tool': 'run_command',
              'detail': '{"command": "go test ./..."}',
            }
          ]
        }
      };
      expect(StreamDeltaParser.thinkingOf(msg), contains('Ran go test ./...'));
    });

    test('extracts read_file as Analyzed <file>', () {
      final msg = {
        'type': 'stream_delta',
        'data': {
          'events': [
            {
              'kind': 'tool_call',
              'tool': 'read_file',
              'detail': '{"filePath": "lib/main.dart"}',
            }
          ]
        }
      };
      expect(StreamDeltaParser.thinkingOf(msg), contains('Analyzed lib/main.dart'));
    });

    test('extracts search_files as Searched <query>', () {
      final msg = {
        'type': 'stream_delta',
        'data': {
          'events': [
            {
              'kind': 'tool_call',
              'tool': 'search_files',
              'detail': '{"query": "stream_delta"}',
            }
          ]
        }
      };
      expect(StreamDeltaParser.thinkingOf(msg), contains('Searched stream_delta'));
    });
  });
}
