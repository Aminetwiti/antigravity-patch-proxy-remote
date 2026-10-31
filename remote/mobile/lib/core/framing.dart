import 'dart:typed_data';

/// Low-level gRPC-Web binary framing & varint helpers.
///
/// gRPC-Web frame structure:
/// [1 byte flag] + [4 bytes Big-Endian length] + [N bytes payload]
/// flag 0x00 = Data frame
/// flag 0x80 = Trailers frame
abstract class GrpcWebFraming {
  /// Encapsulate raw bytes into a gRPC-Web Data Frame (flag 0x00)
  static Uint8List frame(Uint8List payload) {
    final length = payload.length;
    final buffer = Uint8List(5 + length);
    buffer[0] = 0x00; // Data frame flag

    // 4-byte big-endian payload length
    buffer[1] = (length >> 24) & 0xFF;
    buffer[2] = (length >> 16) & 0xFF;
    buffer[3] = (length >> 8) & 0xFF;
    buffer[4] = length & 0xFF;

    buffer.setRange(5, 5 + length, payload);
    return buffer;
  }

  /// Parse incoming gRPC-Web framed buffer into data payload slices
  static List<Uint8List> unframe(Uint8List chunk) {
    final List<Uint8List> frames = [];
    int offset = 0;

    while (offset + 5 <= chunk.length) {
      final flag = chunk[offset];
      final length = (chunk[offset + 1] << 24) |
          (chunk[offset + 2] << 16) |
          (chunk[offset + 3] << 8) |
          chunk[offset + 4];

      if (offset + 5 + length > chunk.length) {
        break; // Partial frame, wait for next chunk
      }

      final payload = chunk.sublist(offset + 5, offset + 5 + length);
      if (flag == 0x00) {
        frames.add(payload);
      }
      offset += 5 + length;
    }

    return frames;
  }
}
