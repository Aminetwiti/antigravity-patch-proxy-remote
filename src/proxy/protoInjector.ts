/**
 * Protobuf injection logic for the GetAvailableModels response.
 * Pure functions — no I/O, no side effects, fully testable.
 */

import {
  parseProto,
  encodeVarint,
  findModelEntryFieldTag,
  extractFieldMapping,
  encodeModelEntryForGetModels,
} from './protobuf';
import { generateModelPlaceholderId } from './idGenerator';
import log from 'electron-log';
import type { CustomModel } from './types';
import { isRecentModel } from './recentModelsStore';
import type { ModelHealthResult } from './modelHealthChecker';
import { expandModelsWithEffort } from './effortExpander';

/**
 * Result of injecting custom models into a GetAvailableModels protobuf response.
 */
export interface InjectionResult {
  /** The modified buffer (may be the same as input if no injection occurred). */
  buffer: Buffer;
  /** Number of models that were injected. */
  injectedCount: number;
  /** Whether the buffer was modified. */
  modified: boolean;
}

export function buildGrpcWebFrame(flags: number, body: Buffer): Buffer {
  const header = Buffer.alloc(5);
  header[0] = flags;
  header.writeUInt32BE(body.length, 1);
  return Buffer.concat([header, body]);
}

export function parseGrpcWebHeader(buf: Buffer): { flags: number; msgLen: number } | null {
  if (buf.length < 5) return null;
  return { flags: buf[0], msgLen: buf.readUInt32BE(1) };
}

/**
 * Formats a model's display name with Status Dot, Latency, and Favorite Star.
 */
export function formatModelDisplayName(m: CustomModel, health?: ModelHealthResult): string {
  const isFav = isRecentModel(m.name) || isRecentModel(m.displayName);
  const star = isFav ? '⭐ ' : '';
  const name = m.displayName || m.name;

  if (!health) {
    return `${star}🟢 | ${name}`;
  }

  if (health.status === 'unhealthy') {
    const errNotice = health.error ? ` [${health.error}]` : ' [Offline]';
    return `${star}🔴${errNotice} | ${name}`;
  }

  if (health.status === 'slow') {
    return `${star}🟡 ⚡ ${health.latencyMs}ms | ${name}`;
  }

  return `${star}🟢 ⚡ ${health.latencyMs}ms | ${name}`;
}

/**
 * Injects custom models into a Google GetAvailableModels protobuf response.
 *
 * @param responseBuf Raw gRPC-Web response buffer
 * @param customModels Custom models to inject
 * @param healthMap Optional health status map for custom models
 * @returns Injection result with modified buffer and metadata
 */
export function injectCustomModelsIntoResponse(
  responseBuf: Buffer,
  customModels: CustomModel[],
  healthMap?: Map<string, ModelHealthResult>,
): InjectionResult {
  // No injection if no custom models or buffer too small to contain header + body
  if (customModels.length === 0 || responseBuf.length <= 6) {
    return { buffer: responseBuf, injectedCount: 0, modified: false };
  }

  try {
    const flags = responseBuf[0];
    const msgLen = responseBuf.readUInt32BE(1);
    if (5 + msgLen > responseBuf.length) {
      return { buffer: responseBuf, injectedCount: 0, modified: false };
    }

    const msgBody = responseBuf.subarray(5, 5 + msgLen);
    const parsed = parseProto(msgBody, 0, msgBody.length);
    const modelTag = findModelEntryFieldTag(parsed);

    if (modelTag === null) {
      return { buffer: responseBuf, injectedCount: 0, modified: false };
    }

    const sampleEntry = parsed.find((f) => f.tag === modelTag && Array.isArray(f.value));
    if (!sampleEntry || !Array.isArray(sampleEntry.value)) {
      return { buffer: responseBuf, injectedCount: 0, modified: false };
    }

    const fieldMapping = extractFieldMapping(sampleEntry.value);
    const newParts: Buffer[] = [msgBody];

    let injectedCount = 0;

    const expandedModels = expandModelsWithEffort(customModels);

    for (const m of expandedModels) {
      const health = healthMap?.get(m.name);
      
      // Unhealthy models are still injected (with red dot status) so the user knows they are loaded.
      // Removed the filter that was skipping them.

      const placeholderId = generateModelPlaceholderId(m);
      const formattedName = formatModelDisplayName(m, health);
      const entry = encodeModelEntryForGetModels(
        `models/${placeholderId}`,
        formattedName,
        fieldMapping,
      );
      const tagBuf = encodeVarint(modelTag);
      const lenBuf = encodeVarint(entry.length);
      newParts.push(tagBuf, lenBuf, entry);
      injectedCount++;
    }

    if (injectedCount === 0) {
      return { buffer: responseBuf, injectedCount: 0, modified: false };
    }

    const newMsgBody = Buffer.concat(newParts);
    const newHeader = Buffer.alloc(5);
    newHeader[0] = flags;
    newHeader.writeUInt32BE(newMsgBody.length, 1);
    const modifiedBuf = Buffer.concat([newHeader, newMsgBody]);

    return { buffer: modifiedBuf, injectedCount, modified: true };
  } catch (err) {
    log.warn('[ProtoInjector] Injection failed, returning original buffer:', (err as Error).message);
    return { buffer: responseBuf, injectedCount: 0, modified: false };
  }
}
