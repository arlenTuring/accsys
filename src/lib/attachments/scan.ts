import net from 'node:net';

export type ScanVerdict = 'clean' | 'infected' | 'scan_failed';
export type ScannerConfig = { mode: 'clamav'; host: string; port: number; timeoutMs: number } | { mode: 'disabled' };

export class ScannerUnavailable extends Error {}

/**
 * ATTACHMENT_SCAN=clamav (with CLAMAV_HOST / CLAMAV_PORT) sends every upload to
 * a local clamd; files are never sent to an external service. Production
 * refuses to accept uploads without a scanner; development may run with
 * ATTACHMENT_SCAN=disabled (files are then marked 'unscanned').
 */
export function scannerConfig(env: Record<string, string | undefined> = process.env): ScannerConfig {
  const mode = env.ATTACHMENT_SCAN?.trim() || (env.NODE_ENV === 'production' ? '' : 'disabled');
  if (mode === 'clamav') {
    const port = Number(env.CLAMAV_PORT?.trim() || '3310');
    if (!Number.isInteger(port) || port <= 0 || port > 65535) throw new ScannerUnavailable('CLAMAV_PORT is invalid');
    return { mode: 'clamav', host: env.CLAMAV_HOST?.trim() || '127.0.0.1', port, timeoutMs: 30_000 };
  }
  if (mode === 'disabled' && env.NODE_ENV !== 'production') return { mode: 'disabled' };
  throw new ScannerUnavailable('ATTACHMENT_SCAN=clamav is required in production');
}

/** clamd INSTREAM: length-prefixed chunks, zero-length terminator, one-line verdict. */
export function scanWithClamd(
  bytes: Uint8Array,
  cfg: { host: string; port: number; timeoutMs: number }
): Promise<ScanVerdict> {
  return new Promise((resolve) => {
    let settled = false;
    let reply = '';
    const done = (verdict: ScanVerdict) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(verdict);
    };
    const socket = net.createConnection({ host: cfg.host, port: cfg.port });
    socket.setTimeout(cfg.timeoutMs, () => done('scan_failed'));
    socket.on('error', () => done('scan_failed'));
    socket.on('data', (chunk) => {
      reply += chunk.toString('utf8');
      if (reply.includes('\0') || reply.includes('\n')) socket.end();
    });
    socket.on('close', () => {
      const line = reply.replace(/\0/g, '').trim();
      if (/^stream: OK$/.test(line)) done('clean');
      else if (/ FOUND$/.test(line)) done('infected');
      else done('scan_failed');
    });
    socket.on('connect', () => {
      socket.write('zINSTREAM\0');
      const CHUNK = 64 * 1024;
      for (let offset = 0; offset < bytes.length; offset += CHUNK) {
        const part = bytes.subarray(offset, offset + CHUNK);
        const size = Buffer.alloc(4);
        size.writeUInt32BE(part.length);
        socket.write(size);
        socket.write(part);
      }
      socket.write(Buffer.alloc(4));
    });
  });
}

export async function scanBytes(bytes: Uint8Array, cfg: ScannerConfig): Promise<ScanVerdict | 'unscanned'> {
  if (cfg.mode === 'disabled') return 'unscanned';
  return scanWithClamd(bytes, cfg);
}
