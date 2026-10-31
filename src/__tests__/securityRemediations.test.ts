import { describe, it, expect } from 'vitest';
import type http from 'http';
import { isAllowedOrigin } from '../proxy';

describe('Security Remediations', () => {
  describe('isAllowedOrigin - Strict Host Header & DNS Rebinding Protection', () => {
    function mockReq(host: string, origin?: string, referer?: string): http.IncomingMessage {
      return {
        headers: {
          host,
          ...(origin ? { origin } : {}),
          ...(referer ? { referer } : {}),
        },
      } as unknown as http.IncomingMessage;
    }

    it('allows legitimate local loopback Host headers with port', () => {
      expect(isAllowedOrigin(mockReq('127.0.0.1:51074'))).toBe(true);
      expect(isAllowedOrigin(mockReq('localhost:51074'))).toBe(true);
      expect(isAllowedOrigin(mockReq('[::1]:51074'))).toBe(true);
    });

    it('allows legitimate local loopback Host headers without port', () => {
      expect(isAllowedOrigin(mockReq('127.0.0.1'))).toBe(true);
      expect(isAllowedOrigin(mockReq('localhost'))).toBe(true);
      expect(isAllowedOrigin(mockReq('::1'))).toBe(true);
      expect(isAllowedOrigin(mockReq('[::1]'))).toBe(true);
    });

    it('allows googleapis upstream hosts', () => {
      expect(isAllowedOrigin(mockReq('daily-cloudcode-pa.googleapis.com'))).toBe(true);
      expect(isAllowedOrigin(mockReq('googleapis.com'))).toBe(true);
    });

    it('rejects spoofed Host headers attempting DNS rebinding', () => {
      expect(isAllowedOrigin(mockReq('127.0.0.1.attacker.com'))).toBe(false);
      expect(isAllowedOrigin(mockReq('127.0.0.1.attacker.com:51074'))).toBe(false);
      expect(isAllowedOrigin(mockReq('localhost.attacker.com'))).toBe(false);
      expect(isAllowedOrigin(mockReq('localhost.attacker.com:51074'))).toBe(false);
      expect(isAllowedOrigin(mockReq('attacker.com'))).toBe(false);
      expect(isAllowedOrigin(mockReq('notgoogleapis.com'))).toBe(false);
    });

    it('validates Origin header when provided', () => {
      expect(isAllowedOrigin(mockReq('127.0.0.1:51074', 'http://127.0.0.1:51074'))).toBe(true);
      expect(isAllowedOrigin(mockReq('localhost:51074', 'http://localhost:51074'))).toBe(true);
      expect(isAllowedOrigin(mockReq('127.0.0.1:51074', 'https://attacker.com'))).toBe(false);
      expect(isAllowedOrigin(mockReq('127.0.0.1:51074', 'http://127.0.0.1.attacker.com'))).toBe(false);
      // P0 CSRF protection: Reject external origins even under googleapis.com domains
      expect(isAllowedOrigin(mockReq('127.0.0.1:51074', 'https://storage.googleapis.com'))).toBe(false);
      expect(isAllowedOrigin(mockReq('127.0.0.1:51074', 'https://attacker.storage.googleapis.com'))).toBe(false);
      expect(isAllowedOrigin(mockReq('127.0.0.1:51074', 'https://firebase.googleapis.com'))).toBe(false);
    });

    it('rejects external socket remoteAddress spoofing loopback Host header', () => {
      const spoofedReq = {
        headers: { host: '127.0.0.1:51074' },
        socket: { remoteAddress: '192.168.1.50' },
      } as unknown as http.IncomingMessage;
      expect(isAllowedOrigin(spoofedReq)).toBe(false);

      const legitimateReq = {
        headers: { host: '127.0.0.1:51074' },
        socket: { remoteAddress: '127.0.0.1' },
      } as unknown as http.IncomingMessage;
      expect(isAllowedOrigin(legitimateReq)).toBe(true);

      const ipv6LoopbackReq = {
        headers: { host: 'localhost:51074' },
        socket: { remoteAddress: '::ffff:127.0.0.1' },
      } as unknown as http.IncomingMessage;
      expect(isAllowedOrigin(ipv6LoopbackReq)).toBe(true);
    });
  });
});
