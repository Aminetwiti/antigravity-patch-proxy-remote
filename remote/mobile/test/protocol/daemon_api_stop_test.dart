import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/core/protocol/daemon_api.dart';
import 'package:mobile/core/protocol/messages.dart';

void main() {
  test('DaemonApi.stopGeneration sends cancel_generation message', () async {
    ClientMessage? sentMsg;
    final api = DaemonApi(sendRaw: (msg) {
      sentMsg = msg;
    });

    api.stopGeneration(cascadeId: 's3_session');

    expect(sentMsg, isNotNull);
    expect(sentMsg!.type, equals('cancel_generation'));
    expect(sentMsg!.cascadeId, equals('s3_session'));
  });
}
