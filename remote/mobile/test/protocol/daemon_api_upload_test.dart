import 'dart:async';
import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/core/protocol/daemon_api.dart';
import 'package:mobile/core/protocol/messages.dart';

void main() {
  test('DaemonApi.uploadMedia sends binary attachment payload and completes on response', () async {
    ClientMessage? sentMsg;
    final inController = StreamController<dynamic>.broadcast();
    Map<String, dynamic>? outgoingJson;

    final api = DaemonApi(
      incoming: inController.stream,
      send: (raw) {
        if (raw is Map<String, dynamic>) outgoingJson = raw;
      },
      sendRaw: (msg) => sentMsg = msg,
    );

    final future = api.uploadMedia(
      cascadeId: 's3',
      fileName: 'screenshot.png',
      mimeType: 'image/png',
      base64Data: 'iVBORw0KGgoAAAANSUhEUgAA...',
    );

    expect(sentMsg, isNotNull);
    expect(sentMsg!.type, equals('upload_media'));
    expect(sentMsg!.data?['fileName'], equals('screenshot.png'));
    expect(outgoingJson?['type'], equals('upload_media'));
    expect(outgoingJson?['cascadeId'], equals('s3'));

    final reqId = outgoingJson?['requestId'] as String;
    inController.add(jsonEncode({
      'type': 'response',
      'requestId': reqId,
      'data': {
        'filePath': '/tmp/upload_123.png',
        'markdownRef': '![Uploaded Image](file:///tmp/upload_123.png)',
        'status': 'ok',
      },
    }));

    final res = await future;
    expect(res['filePath'], equals('/tmp/upload_123.png'));
    expect(res['markdownRef'], contains('![Uploaded Image]'));
  });

  test('DaemonApi.uploadChunk sends chunk payload with metadata', () async {
    final inController = StreamController<dynamic>.broadcast();
    Map<String, dynamic>? outgoingJson;

    final api = DaemonApi(
      incoming: inController.stream,
      send: (raw) {
        if (raw is Map<String, dynamic>) outgoingJson = raw;
      },
    );

    final future = api.uploadChunk(
      uploadId: 'up_999',
      cascadeId: 's3',
      fileName: 'code.dart',
      chunkIndex: 0,
      totalChunks: 2,
      totalBytes: 500000,
      base64Data: 'dm9pZCBtYWluKCkge30=',
    );

    expect(outgoingJson?['type'], equals('upload_chunk'));
    expect(outgoingJson?['uploadId'], equals('up_999'));
    expect(outgoingJson?['chunkIndex'], equals(0));
    expect(outgoingJson?['totalChunks'], equals(2));

    final reqId = outgoingJson?['requestId'] as String;
    inController.add(jsonEncode({
      'type': 'response',
      'requestId': reqId,
      'data': {'status': 'ok'},
    }));

    final res = await future;
    expect(res['status'], equals('ok'));
  });
}
