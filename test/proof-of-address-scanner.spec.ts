import { once } from 'node:events';
import { createServer, type Server, type Socket } from 'node:net';

import type { ProofOfAddressConfiguration } from '../src/customer-proof-of-address/customer-proof-of-address.config';
import { ClamAvMalwareScanner } from '../src/customer-proof-of-address/clamav-malware-scanner.service';

describe('ClamAvMalwareScanner', () => {
  let server: Server | undefined;

  afterEach(async () => {
    if (server?.listening) {
      await new Promise<void>((resolve, reject) => {
        server?.close((error) => (error ? reject(error) : resolve()));
      });
    }
    server = undefined;
  });

  it.each([
    [Buffer.from('stream: OK\0', 'ascii'), 'CLEAN'],
    [Buffer.from('stream: Eicar-Test-Signature FOUND\0', 'ascii'), 'INFECTED'],
  ] as const)(
    'returns the result from an explicit null-terminated response',
    async (reply, expected) => {
      server = createServer((socket) => {
        let request = Buffer.alloc(0);
        socket.on('data', (chunk) => {
          request = Buffer.concat([request, chunk]);
          if (isCompleteInstreamRequest(request)) socket.end(reply);
        });
      });
      const port = await listen(server);

      const scanner = new ClamAvMalwareScanner(configuration(port));
      await expect(scanner.scan(Buffer.from('small-document'))).resolves.toBe(expected);
    },
  );

  it('waits for the complete null-terminated response before returning clean', async () => {
    server = createServer({ allowHalfOpen: true }, (socket) => {
      let request = Buffer.alloc(0);
      let responseStarted = false;
      socket.on('data', (chunk) => {
        request = Buffer.concat([request, chunk]);
        if (!responseStarted && isCompleteInstreamRequest(request)) {
          responseStarted = true;
          socket.write(Buffer.from('stream: OK', 'ascii'));
          setTimeout(() => socket.end(Buffer.from([0])), 30);
        }
      });
    });
    const port = await listen(server);
    const scanner = new ClamAvMalwareScanner(configuration(port));

    let settled = false;
    const result = scanner.scan(Buffer.from('small-document')).then((value) => {
      settled = true;
      return value;
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(settled).toBe(false);
    await expect(result).resolves.toBe('CLEAN');
  });

  it('fails closed when the ClamAV service is unavailable', async () => {
    server = createServer();
    const port = await listen(server);
    await new Promise<void>((resolve, reject) => {
      server?.close((error) => (error ? reject(error) : resolve()));
    });

    const scanner = new ClamAvMalwareScanner(configuration(port));
    await expect(scanner.scan(Buffer.from('small-document'))).resolves.toBe('UNAVAILABLE');
  });

  it('fails closed when ClamAV does not respond before the timeout', async () => {
    let completeRequestReceived = false;
    let peerSocket: Socket | undefined;
    server = createServer({ allowHalfOpen: true }, (socket) => {
      peerSocket = socket;
      let request = Buffer.alloc(0);
      socket.on('data', (chunk) => {
        request = Buffer.concat([request, chunk]);
        completeRequestReceived = isCompleteInstreamRequest(request);
        // Deliberately leave the response unanswered after consuming the full request.
      });
    });
    const port = await listen(server);
    const scanner = new ClamAvMalwareScanner(configuration(port, 50));

    await expect(scanner.scan(Buffer.from('small-document'))).resolves.toBe('UNAVAILABLE');
    expect(completeRequestReceived).toBe(true);
    peerSocket?.destroy();
  });

  it('rejects malformed null-terminated responses', async () => {
    server = createServer((socket) => {
      let request = Buffer.alloc(0);
      socket.on('data', (chunk) => {
        request = Buffer.concat([request, chunk]);
        if (isCompleteInstreamRequest(request)) socket.end(Buffer.from('stream: MAYBE\0', 'ascii'));
      });
    });
    const port = await listen(server);

    const scanner = new ClamAvMalwareScanner(configuration(port));
    await expect(scanner.scan(Buffer.from('small-document'))).resolves.toBe('ERROR');
  });

  it('rejects an incomplete clean-looking response without its null terminator', async () => {
    server = createServer((socket) => {
      let request = Buffer.alloc(0);
      socket.on('data', (chunk) => {
        request = Buffer.concat([request, chunk]);
        if (isCompleteInstreamRequest(request)) socket.end(Buffer.from('stream: OK', 'ascii'));
      });
    });
    const port = await listen(server);

    const scanner = new ClamAvMalwareScanner(configuration(port));
    await expect(scanner.scan(Buffer.from('small-document'))).resolves.toBe('ERROR');
  });
});

async function listen(testServer: Server): Promise<number> {
  testServer.listen(0, '127.0.0.1');
  await once(testServer, 'listening');
  const address = testServer.address();
  if (!address || typeof address === 'string')
    throw new Error('Expected a TCP test-server address');
  return address.port;
}

function configuration(port: number, clamavTimeoutMs = 1000): ProofOfAddressConfiguration {
  return {
    enabled: true,
    nodeEnv: 'test',
    maxUploadBytes: 10 * 1024 * 1024,
    storageProvider: 'local',
    localStorageRoot: './unused',
    encryptionKeyFile: './unused',
    encryptionActiveKeyVersion: 'v1',
    clamavHost: '127.0.0.1',
    clamavPort: port,
    clamavTimeoutMs,
    s3ForcePathStyle: false,
  };
}

function isCompleteInstreamRequest(request: Buffer): boolean {
  const marker = Buffer.from('zINSTREAM\0', 'ascii');
  const markerOffset = request.indexOf(marker);
  if (markerOffset !== 0) return false;

  let offset = markerOffset + marker.length;
  while (offset + 4 <= request.length) {
    const length = request.readUInt32BE(offset);
    offset += 4;
    if (length === 0) return true;
    offset += length;
    if (offset > request.length) return false;
  }
  return false;
}
