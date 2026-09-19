import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as dns from 'dns';
import {
  isLoopbackIp,
  isPrivateIp,
  pickBestAddress,
  resolveWithServer,
  resolveWithSystemDns,
  resolveGoogleIp,
  clearDnsCache,
  DNS_QUERY_TIMEOUT_MS,
} from '../proxy/dnsResolver';

// dns is heavily callback-based; we stub its methods per-test.
vi.mock('dns', async () => {
  const actual = await vi.importActual<typeof import('dns')>('dns');
  const resolve4Mock = vi.fn();
  const cancelMock = vi.fn();
  class FakeResolver {
    private servers: string[] = [];
    setServers(servers: string[]) {
      this.servers = servers;
    }
  }
  (FakeResolver.prototype as any).resolve4 = resolve4Mock;
  (FakeResolver.prototype as any).cancel = cancelMock;

  return {
    ...actual,
    Resolver: FakeResolver,
    lookup: vi.fn(),
    resolve4: vi.fn(),
  };
});

describe('isLoopbackIp', () => {
  it('detects IPv4 loopback', () => {
    expect(isLoopbackIp('127.0.0.1')).toBe(true);
    expect(isLoopbackIp('127.255.255.255')).toBe(true);
  });
  it('detects IPv6 loopback', () => {
    expect(isLoopbackIp('::1')).toBe(true);
  });
  it('rejects public addresses', () => {
    expect(isLoopbackIp('8.8.8.8')).toBe(false);
    expect(isLoopbackIp('142.250.80.46')).toBe(false);
    expect(isLoopbackIp('10.0.0.1')).toBe(false);
  });
});

describe('isPrivateIp', () => {
  it('detects RFC1918 addresses', () => {
    expect(isPrivateIp('10.0.0.1')).toBe(true);
    expect(isPrivateIp('172.16.0.1')).toBe(true);
    expect(isPrivateIp('192.168.1.1')).toBe(true);
  });
  it('detects link-local addresses', () => {
    expect(isPrivateIp('169.254.1.1')).toBe(true);
  });
  it('rejects public addresses', () => {
    expect(isPrivateIp('8.8.8.8')).toBe(false);
    expect(isPrivateIp('142.250.80.46')).toBe(false);
    expect(isPrivateIp('172.15.0.1')).toBe(false);
  });
});

describe('pickBestAddress', () => {
  it('prefers public addresses over loopback/private', () => {
    expect(pickBestAddress(['127.0.0.1', '8.8.8.8', '192.168.1.1'])).toBe('8.8.8.8');
  });
  it('prefers private over loopback when no public addresses exist', () => {
    expect(pickBestAddress(['127.0.0.1', '10.0.0.5'])).toBe('10.0.0.5');
  });
  it('returns undefined for empty list', () => {
    expect(pickBestAddress([])).toBeUndefined();
  });
});

describe('resolveWithServer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('resolves when the resolver returns addresses', async () => {
    const resolverProto = dns.Resolver.prototype as unknown as {
      resolve4: ReturnType<typeof vi.fn>;
    };
    resolverProto.resolve4.mockImplementation(
      (_hostname: string, cb: (err: null, addresses: string[]) => void) => {
        cb(null, ['142.250.80.46']);
      },
    );

    const promise = resolveWithServer('daily-cloudcode-pa.googleapis.com', '8.8.8.8');
    await vi.advanceTimersByTimeAsync(0);
    await expect(promise).resolves.toEqual(['142.250.80.46']);
  });

  it('times out if the resolver never answers', async () => {
    const resolverProto = dns.Resolver.prototype as unknown as {
      resolve4: ReturnType<typeof vi.fn>;
      cancel: ReturnType<typeof vi.fn>;
    };
    resolverProto.resolve4.mockImplementation(() => {
      /* never calls cb */
    });

    const promise = resolveWithServer('daily-cloudcode-pa.googleapis.com', '8.8.8.8');
    // Attach a no-op catch so the promise is never unhandled
    promise.catch(() => undefined);
    const expectPromise = expect(promise).rejects.toThrow('timed out');
    await vi.advanceTimersByTimeAsync(DNS_QUERY_TIMEOUT_MS + 100);
    await expectPromise;
    expect(resolverProto.cancel).toHaveBeenCalled();
  });


  it('rejects on resolver error', async () => {
    const resolverProto = dns.Resolver.prototype as unknown as {
      resolve4: ReturnType<typeof vi.fn>;
    };
    resolverProto.resolve4.mockImplementation(
      (_hostname: string, cb: (err: Error) => void) => {
        cb(new Error('SERVFAIL'));
      },
    );

    const promise = resolveWithServer('daily-cloudcode-pa.googleapis.com', '8.8.8.8');
    // Attach a no-op catch immediately so Node never marks this as unhandled
    promise.catch(() => undefined);
    const expectPromise = expect(promise).rejects.toThrow('SERVFAIL');
    await vi.advanceTimersByTimeAsync(0);
    await expectPromise;
  });

});

describe('resolveWithSystemDns', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('resolves via dns.resolve4', async () => {
    const resolve4 = dns.resolve4 as unknown as ReturnType<typeof vi.fn>;
    resolve4.mockImplementation(
      (_hostname: string, cb: (err: null, addresses: string[]) => void) => {
        cb(null, ['172.217.16.46']);
      },
    );

    const promise = resolveWithSystemDns('daily-cloudcode-pa.googleapis.com');
    await vi.advanceTimersByTimeAsync(0);
    await expect(promise).resolves.toEqual(['172.217.16.46']);
  });

  it('rejects when dns.resolve4 fails', async () => {
    const resolve4 = dns.resolve4 as unknown as ReturnType<typeof vi.fn>;
    resolve4.mockImplementation(
      (_hostname: string, cb: (err: Error) => void) => {
        cb(new Error('ENOTFOUND'));
      },
    );

    const promise = resolveWithSystemDns('daily-cloudcode-pa.googleapis.com');
    // Attach a no-op catch immediately so Node never marks this as unhandled
    promise.catch(() => undefined);
    const expectPromise = expect(promise).rejects.toThrow('ENOTFOUND');
    await vi.advanceTimersByTimeAsync(0);
    await expectPromise;
  });

});

describe('resolveGoogleIp', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    clearDnsCache();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('uses fast-path in-memory DNS cache on subsequent queries without querying network', async () => {
    const resolverProto = dns.Resolver.prototype as unknown as {
      resolve4: ReturnType<typeof vi.fn>;
    };
    resolverProto.resolve4.mockImplementation(
      (_hostname: string, cb: (err: null, addresses: string[]) => void) => {
        cb(null, ['142.250.80.46']);
      },
    );

    // First call populates cache
    const first = resolveGoogleIp('daily-cloudcode-pa.googleapis.com');
    await vi.advanceTimersByTimeAsync(0);
    await expect(first).resolves.toBe('142.250.80.46');
    expect(resolverProto.resolve4).toHaveBeenCalled();

    // Reset mock call count
    resolverProto.resolve4.mockClear();

    // Second call must resolve immediately from cache with 0 network calls
    const second = resolveGoogleIp('daily-cloudcode-pa.googleapis.com');
    await vi.advanceTimersByTimeAsync(0);
    await expect(second).resolves.toBe('142.250.80.46');
    expect(resolverProto.resolve4).not.toHaveBeenCalled();
  });

  it('uses dns.lookup for non-googleapis hostnames', async () => {
    const lookup = dns.lookup as unknown as ReturnType<typeof vi.fn>;
    lookup.mockImplementation(
      (_hostname: string, _opts: unknown, cb: (err: null, address: string) => void) => {
        cb(null, '1.2.3.4');
      },
    );

    const promise = resolveGoogleIp('example.com');
    await vi.advanceTimersByTimeAsync(0);
    await expect(promise).resolves.toBe('1.2.3.4');
    expect(lookup).toHaveBeenCalledWith('example.com', { family: 4 }, expect.any(Function));
  });

  it('returns public DNS result when available', async () => {
    const resolverProto = dns.Resolver.prototype as unknown as {
      resolve4: ReturnType<typeof vi.fn>;
    };
    resolverProto.resolve4.mockImplementation(
      (_hostname: string, cb: (err: null, addresses: string[]) => void) => {
        cb(null, ['142.250.80.46']);
      },
    );

    const promise = resolveGoogleIp('daily-cloudcode-pa.googleapis.com');
    await vi.advanceTimersByTimeAsync(0);
    await expect(promise).resolves.toBe('142.250.80.46');
  });

  it('falls back to system DNS when public DNS fails', async () => {
    const resolverProto = dns.Resolver.prototype as unknown as {
      resolve4: ReturnType<typeof vi.fn>;
    };
    resolverProto.resolve4.mockImplementation(
      (_hostname: string, cb: (err: Error) => void) => {
        cb(new Error('SERVFAIL'));
      },
    );

    const resolve4 = dns.resolve4 as unknown as ReturnType<typeof vi.fn>;
    resolve4.mockImplementation(
      (_hostname: string, cb: (err: null, addresses: string[]) => void) => {
        cb(null, ['172.217.16.46']);
      },
    );

    const promise = resolveGoogleIp('daily-cloudcode-pa.googleapis.com');
    await vi.advanceTimersByTimeAsync(0);
    await expect(promise).resolves.toBe('172.217.16.46');
  });

  it('falls back to hardcoded IP when all DNS methods fail', async () => {
    const resolverProto = dns.Resolver.prototype as unknown as {
      resolve4: ReturnType<typeof vi.fn>;
    };
    resolverProto.resolve4.mockImplementation(
      (_hostname: string, cb: (err: Error) => void) => {
        cb(new Error('SERVFAIL'));
      },
    );

    const resolve4 = dns.resolve4 as unknown as ReturnType<typeof vi.fn>;
    resolve4.mockImplementation(
      (_hostname: string, cb: (err: Error) => void) => {
        cb(new Error('ENOTFOUND'));
      },
    );

    const promise = resolveGoogleIp('daily-cloudcode-pa.googleapis.com');
    await vi.advanceTimersByTimeAsync(0);
    const ip = await promise;
    expect(ip).toMatch(/^\d+\.\d+\.\d+\.\d+$/);
  });

  it('filters out loopback results from public DNS', async () => {
    const resolverProto = dns.Resolver.prototype as unknown as {
      resolve4: ReturnType<typeof vi.fn>;
    };
    resolverProto.resolve4.mockImplementation(
      (_hostname: string, cb: (err: null, addresses: string[]) => void) => {
        cb(null, ['127.0.0.1', '142.250.80.46']);
      },
    );

    const promise = resolveGoogleIp('daily-cloudcode-pa.googleapis.com');
    await vi.advanceTimersByTimeAsync(0);
    await expect(promise).resolves.toBe('142.250.80.46');
  });
});
