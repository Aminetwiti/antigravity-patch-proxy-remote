import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/core/protocol/messages.dart';

void main() {
  group('ChatSegment & ChatMessage segments serialization', () {
    test('ChatSegment round-trip toJson and fromJson', () {
      final seg = ChatSegment(
        type: ChatSegmentType.thought,
        content: 'Worked for 2m\nExplored 5 files',
        title: 'Exploration',
        isRunning: true,
      );

      final json = seg.toJson();
      expect(json['type'], 'thought');
      expect(json['content'], 'Worked for 2m\nExplored 5 files');
      expect(json['title'], 'Exploration');
      expect(json['isRunning'], true);

      final fromJson = ChatSegment.fromJson(json);
      expect(fromJson.type, ChatSegmentType.thought);
      expect(fromJson.content, seg.content);
      expect(fromJson.title, seg.title);
      expect(fromJson.isRunning, true);
    });

    test('ChatMessage with segments serializes and deserializes', () {
      final msg = ChatMessage(
        id: 'msg-1',
        sender: 'assistant',
        text: 'Paragraph 1\n\nParagraph 2',
        thought: 'Worked for 2m',
        segments: [
          const ChatSegment(type: ChatSegmentType.thought, content: 'Worked for 2m'),
          const ChatSegment(type: ChatSegmentType.text, content: 'Paragraph 1'),
          const ChatSegment(type: ChatSegmentType.thought, content: 'Timed 10s'),
          const ChatSegment(type: ChatSegmentType.text, content: 'Paragraph 2'),
        ],
        timestamp: '16:40',
      );

      final json = msg.toJson();
      expect(json['segments'], isA<List>());
      expect((json['segments'] as List).length, 4);

      final fromJson = ChatMessage.fromJson(json);
      expect(fromJson.segments.length, 4);
      expect(fromJson.segments[0].type, ChatSegmentType.thought);
      expect(fromJson.segments[0].content, 'Worked for 2m');
      expect(fromJson.segments[1].type, ChatSegmentType.text);
      expect(fromJson.segments[1].content, 'Paragraph 1');
      expect(fromJson.segments[2].type, ChatSegmentType.thought);
      expect(fromJson.segments[2].content, 'Timed 10s');
      expect(fromJson.segments[3].type, ChatSegmentType.text);
      expect(fromJson.segments[3].content, 'Paragraph 2');
    });

    test('ChatMessage backward compatibility without segments', () {
      final legacyJson = {
        'id': 'legacy-1',
        'sender': 'assistant',
        'text': 'Legacy answer',
        'thought': 'Legacy thought',
        'timestamp': '12:00',
      };

      final msg = ChatMessage.fromJson(legacyJson);
      expect(msg.segments, isEmpty);
      expect(msg.text, 'Legacy answer');
      expect(msg.thought, 'Legacy thought');
    });
  });
}
