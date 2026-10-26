/* eslint-disable @typescript-eslint/unbound-method */

import { randomBytes } from 'node:crypto';
import { lstat, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { DataSource } from 'typeorm';

import type { ProofOfAddressConfiguration } from '../src/customer-proof-of-address/customer-proof-of-address.config';
import { PrivateDocumentEncryptionService } from '../src/customer-proof-of-address/private-document-encryption.service';

describe('PrivateDocumentEncryptionService', () => {
  let temporaryRoot: string | undefined;

  afterEach(async () => {
    if (temporaryRoot) await rm(temporaryRoot, { recursive: true, force: true });
    temporaryRoot = undefined;
  });

  it('encrypts and authenticates document bytes with an operator-managed versioned keyring', async () => {
    const keyV1 = randomBytes(32).toString('base64');
    const keyV2 = randomBytes(32).toString('base64');
    const dataSource = makeDataSource();
    const service = new PrivateDocumentEncryptionService(
      dataSource.mock,
      keyringConfig({ v1: keyV1, v2: keyV2 }, 'v2'),
    );
    const plaintext = Buffer.from('%PDF-1.7 private address evidence %%EOF', 'ascii');

    const encrypted = await service.encrypt(plaintext);
    expect(encrypted.keyVersion).toBe('v2');
    expect(encrypted.bytes.includes(plaintext)).toBe(false);
    await expect(service.decrypt(encrypted.bytes, 'v2')).resolves.toEqual(plaintext);
    await expect(service.decrypt(encrypted.bytes, 'v1')).rejects.toThrow(/metadata does not match/);

    const tampered = Buffer.from(encrypted.bytes);
    tampered[tampered.length - 1] = (tampered[tampered.length - 1] ?? 0) ^ 1;
    await expect(service.decrypt(tampered, 'v2')).rejects.toThrow();
    expect(dataSource.query).not.toHaveBeenCalled();
  });

  it('persists a development key with restrictive permissions and reuses it across service instances', async () => {
    temporaryRoot = await mkdtemp(join(tmpdir(), 'monienaija-poa-key-'));
    const keyFile = join(temporaryRoot, 'private', 'poa.key');
    const dataSource = makeDataSource().mock;
    const config = localConfig(keyFile);
    const firstService = new PrivateDocumentEncryptionService(dataSource, config);
    const first = await firstService.encrypt(Buffer.from('persistent-test-payload'));
    const savedKeyFile = await readFile(keyFile, 'utf8');
    const mode = (await lstat(keyFile)).mode;

    const secondService = new PrivateDocumentEncryptionService(dataSource, config);
    await expect(secondService.decrypt(first.bytes, first.keyVersion)).resolves.toEqual(
      Buffer.from('persistent-test-payload'),
    );
    expect(await readFile(keyFile, 'utf8')).toBe(savedKeyFile);
    expect(dataSource.query).toHaveBeenCalledTimes(1);
    if (process.platform !== 'win32') expect(mode & 0o077).toBe(0);
  });

  it('refuses to generate a replacement local key when encrypted document rows exist', async () => {
    temporaryRoot = await mkdtemp(join(tmpdir(), 'monienaija-poa-missing-key-'));
    const keyFile = join(temporaryRoot, 'private', 'missing.key');
    const source = makeDataSource([{ has_documents: true }]);
    const service = new PrivateDocumentEncryptionService(source.mock, localConfig(keyFile));

    await expect(
      service.encrypt(Buffer.from('must-not-be-encrypted-with-a-new-key')),
    ).rejects.toThrow(/stored documents exist; restore the original key/);
    await expect(lstat(keyFile)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(source.mock.query).toHaveBeenCalledTimes(1);
  });

  it('rejects missing or malformed active key versions instead of falling back', async () => {
    const service = new PrivateDocumentEncryptionService(
      makeDataSource().mock,
      keyringConfig({ v1: randomBytes(32).toString('base64') }, 'v2'),
    );
    await expect(service.encrypt(Buffer.from('document'))).rejects.toThrow(
      /active Proof of Address encryption key version is missing/,
    );

    const malformed = new PrivateDocumentEncryptionService(
      makeDataSource().mock,
      keyringConfig({ v1: 'not-a-32-byte-key' }, 'v1'),
    );
    await expect(malformed.encrypt(Buffer.from('document'))).rejects.toThrow(/32-byte base64 keys/);
  });
});

function makeDataSource(rows: Array<{ has_documents: boolean }> = [{ has_documents: false }]) {
  const query = jest.fn().mockResolvedValue(rows);
  return {
    mock: { query } as unknown as DataSource,
    query,
  };
}

function keyringConfig(
  keys: Record<string, string>,
  activeVersion: string,
): ProofOfAddressConfiguration {
  return {
    enabled: true,
    nodeEnv: 'production',
    maxUploadBytes: 10 * 1024 * 1024,
    storageProvider: 's3',
    localStorageRoot: './unused',
    encryptionKeyFile: './unused',
    encryptionKeyringJson: JSON.stringify(keys),
    encryptionActiveKeyVersion: activeVersion,
    clamavHost: '127.0.0.1',
    clamavPort: 3310,
    clamavTimeoutMs: 1000,
    s3Bucket: 'private-documents',
    s3Region: 'af-south-1',
    s3ForcePathStyle: false,
  };
}

function localConfig(keyFile: string): ProofOfAddressConfiguration {
  return {
    enabled: true,
    nodeEnv: 'test',
    maxUploadBytes: 10 * 1024 * 1024,
    storageProvider: 'local',
    localStorageRoot: join(tmpdir(), 'monienaija-poa-objects'),
    encryptionKeyFile: keyFile,
    encryptionActiveKeyVersion: 'v1',
    clamavHost: '127.0.0.1',
    clamavPort: 3310,
    clamavTimeoutMs: 1000,
    s3ForcePathStyle: false,
  };
}
