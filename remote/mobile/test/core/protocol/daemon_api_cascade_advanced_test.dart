import 'dart:async';
import 'dart:convert';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/core/protocol/daemon_api.dart';

void main() {
  group('DaemonApi Cascade Advanced Protocol RPC Tests', () {
    late StreamController<dynamic> incoming;
    late List<Map<String, dynamic>> sent;
    late DaemonApi api;

    setUp(() {
      incoming = StreamController<dynamic>.broadcast();
      sent = [];
      api = DaemonApi(
        incoming: incoming.stream,
        send: (msg) => sent.add(msg is String ? jsonDecode(msg) : Map<String, dynamic>.from(msg as Map)),
      );
    });

    tearDown(() {
      api.dispose();
      incoming.close();
    });

    test('getRevertPreview() sends get_revert_preview and returns diff data', () async {
      final future = api.getRevertPreview('casc-123', 4);

      expect(sent.length, equals(1));
      expect(sent.first['type'], equals('get_revert_preview'));
      expect(sent.first['cascadeId'], equals('casc-123'));
      expect(sent.first['stepIndex'], equals(4));
      final reqId = sent.first['requestId'];

      incoming.add(jsonEncode({
        'type': 'response',
        'requestId': reqId,
        'data': {
          'diff': '--- a/lib/main.dart\n+++ b/lib/main.dart\n@@ -1 +1 @@\n-hello\n+world',
          'actionType': 1,
        }
      }));

      final res = await future;
      expect(res['diff'], contains('--- a/lib/main.dart'));
    });

    test('revertToStep() sends revert_to_step and returns boolean success', () async {
      final future = api.revertToStep('casc-123', 4);

      expect(sent.length, equals(1));
      expect(sent.first['type'], equals('revert_to_step'));
      expect(sent.first['cascadeId'], equals('casc-123'));
      expect(sent.first['stepIndex'], equals(4));
      final reqId = sent.first['requestId'];

      incoming.add(jsonEncode({
        'type': 'response',
        'requestId': reqId,
        'data': {
          'status': 'reverted',
          'cascadeId': 'casc-123',
          'stepIndex': 4,
        }
      }));

      final success = await future;
      expect(success, isTrue);
    });

    test('sendStepsToBackground() sends send_steps_to_background and returns success', () async {
      final future = api.sendStepsToBackground('casc-123', [2, 3]);

      expect(sent.length, equals(1));
      expect(sent.first['type'], equals('send_steps_to_background'));
      expect(sent.first['conversationId'], equals('casc-123'));
      expect(sent.first['stepIndices'], equals([2, 3]));
      final reqId = sent.first['requestId'];

      incoming.add(jsonEncode({
        'type': 'response',
        'requestId': reqId,
        'data': {
          'status': 'sent_to_background',
          'conversationId': 'casc-123',
          'stepIndices': [2, 3],
        }
      }));

      final success = await future;
      expect(success, isTrue);
    });

    test('skipBrowserSubagent() sends skip_browser_subagent and returns success', () async {
      final future = api.skipBrowserSubagent('casc-123', 5);

      expect(sent.length, equals(1));
      expect(sent.first['type'], equals('skip_browser_subagent'));
      expect(sent.first['cascadeId'], equals('casc-123'));
      expect(sent.first['stepIndex'], equals(5));
      final reqId = sent.first['requestId'];

      incoming.add(jsonEncode({
        'type': 'response',
        'requestId': reqId,
        'data': {
          'status': 'skipped',
          'cascadeId': 'casc-123',
          'stepIndex': 5,
        }
      }));

      final success = await future;
      expect(success, isTrue);
    });

    test('getUserQuotaSummary() sends get_quota_summary and returns quota data', () async {
      final future = api.getUserQuotaSummary();

      expect(sent.length, equals(1));
      expect(sent.first['type'], equals('get_quota_summary'));
      final reqId = sent.first['requestId'];

      incoming.add(jsonEncode({
        'type': 'response',
        'requestId': reqId,
        'data': {
          'geminiQuotaPercent': 45.5,
          'claudeQuotaPercent': 80.0,
          'resetTime': '2026-08-15T00:00:00Z',
        }
      }));

      final quota = await future;
      expect(quota['geminiQuotaPercent'], equals(45.5));
      expect(quota['claudeQuotaPercent'], equals(80.0));
    });
  });
}
