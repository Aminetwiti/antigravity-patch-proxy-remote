import http from 'http';
import https from 'https';
import { ProtoWriter } from './protobuf.js';

/**
 * gRPC-Web client — matches the validated protocol in remote/PROTOCOL.md.
 * Endpoint: POST http://127.0.0.1:<port>/exa.language_server_pb.LanguageServerService/<Method>
 * Headers: x-codeium-csrf-token (NOT X-CSRF-Token), Connect-Protocol-Version: 1, X-Grpc-Web: 1
 * Framing: 1 byte flags + 4 bytes BE length + protobuf payload.
 */

const FRAME_HEADER = 5;

export interface GrpcResponse {
  statusCode: number;
  contentType: string;
  frames: Buffer[]; // each entry = one protobuf message
  trailers?: Buffer;
}

export class GrpcWebClient {
  constructor(
    private port: number,
    private csrfToken: string,
    private useTls = false,
    private host = process.env.AG_BIND_HOST || '127.0.0.1'
  ) {}

  private frame(payload: Buffer): Buffer {
    const buf = Buffer.alloc(FRAME_HEADER + payload.length);
    buf[0] = 0; // flags: no compression
    buf.writeUInt32BE(payload.length, 1);
    payload.copy(buf, FRAME_HEADER);
    return buf;
  }

  public call(method: string, payload: Buffer = Buffer.alloc(0)): Promise<GrpcResponse> {
    const body = this.frame(payload);
    const path = `/exa.language_server_pb.LanguageServerService/${method}`;

    return new Promise((resolve, reject) => {
      const mod = this.useTls ? https : http;
      const req = mod.request(
        {
          host: this.host,
          port: this.port,
          path,
          method: 'POST',
          headers: {
            'Content-Type': 'application/grpc-web+proto',
            Accept: 'application/grpc-web+proto,application/grpc-web-text',
            'x-codeium-csrf-token': this.csrfToken,
            'Connect-Protocol-Version': '1',
            'X-Grpc-Web': '1',
            'Content-Length': body.length,
          },
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (c: Buffer) => chunks.push(c));
          res.on('end', () => {
            const raw = Buffer.concat(chunks);
            const frames: Buffer[] = [];
            let offset = 0;
            while (offset + FRAME_HEADER <= raw.length) {
              const flags = raw[offset];
              const len = raw.readUInt32BE(offset + 1);
              offset += FRAME_HEADER;
              if (offset + len > raw.length) break; // truncated trailer
              frames.push(raw.subarray(offset, offset + len));
              offset += len;
            }
            resolve({
              statusCode: res.statusCode || 0,
              contentType: res.headers['content-type'] || '',
              frames,
              trailers: raw.subarray(offset),
            });
          });
        }
      );
      req.on('error', reject);
      req.write(body);
      req.end();
    });
  }
}

// ── High-level builders for the validated schemas ────────────────────────────

/** StartCascadeRequest: field 4 source=1, 5 trajectory_type=1, 8 workspace_uris, 14 requested_model=190 */
export function buildStartCascade(workspaceUri: string, requestedModel = 190): Buffer {
  const w = new ProtoWriter();
  w.varintField(4, 1);
  w.varintField(5, 1);
  w.stringField(8, workspaceUri);
  w.varintField(14, requestedModel);
  return w.toBuffer();
}

/** SendUserCascadeMessageRequest: field 1 cascade_id, field 2 items[].chunk.text */
export function buildSendMessage(cascadeId: string, text: string): Buffer {
  const item = new ProtoWriter().stringField(1, text).toBuffer();
  const w = new ProtoWriter();
  w.stringField(1, cascadeId);
  w.bytesField(2, item);
  return w.toBuffer();
}
