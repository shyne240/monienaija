import { once } from 'node:events';
import { createServer, type Server } from 'node:net';

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
    [Buffer.concat([Buffer.from('stream: OK', 'ascii'), Buffer.from([0])]), 'CLEAN'],
    [
      Buffer.concat([Buffer.from('stream: Eicar-Test-Signature FOUND', 'ascii'), Buffer.from([0])]),
      'INFECTED',
    ],
  ] as const)('parses an explicit ClamAV response', async (reply, expected) => {
    server = createServer((socket) => {
      let request = Buffer.alloc(0);
      socket.on('data', (chunk) => {
        request = Buffer.concat([request, chunk]);
        if (isCompleteInstreamRequest(request)) socket.end(reply);
      });
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string')
      throw new Error('Expected a TCP test-server address');

    const scanner = new ClamAvMalwareScanner(configuration(address.port));
    await expect(scanner.scan(Buffer.from('small-document'))).resolves.toBe(expected);
  });

  it('fails closed when the ClamAV service is unavailable', async () => {
    server = createServer();
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string')
      throw new Error('Expected a TCP test-server address');
    await new Promise<void>((resolve, reject) => {
      server?.close((error) => (error ? reject(error) : resolve()));
    });

    const scanner = new ClamAvMalwareScanner(configuration(address.port));
    await expect(scanner.scan(Buffer.from('small-document'))).resolves.toBe('UNAVAILABLE');
  });
});

function configuration(port: number): ProofOfAddressConfiguration {
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
    clamavTimeoutMs: 1000,
    s3ForcePathStyle: false,
  };
}

function isCompleteInstreamRequest(request: Buffer): boolean {
  const marker = Buffer.concat([Buffer.from('nINSTREAM', 'ascii'), Buffer.from([0])]);
  const markerOffset = request.indexOf(marker);
  if (markerOffset < 0) return false;
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
