import { lstat, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { ProofOfAddressConfiguration } from '../src/customer-proof-of-address/customer-proof-of-address.config';
import { LocalPrivateProofOfAddressStorage } from '../src/customer-proof-of-address/private-document-storage.adapters';

describe('LocalPrivateProofOfAddressStorage', () => {
  let temporaryRoot: string | undefined;

  afterEach(async () => {
    if (temporaryRoot) await rm(temporaryRoot, { recursive: true, force: true });
    temporaryRoot = undefined;
  });

  it('stores opaque encrypted objects as owner-only private files and supports retrieval/removal', async () => {
    temporaryRoot = await mkdtemp(join(tmpdir(), 'monienaija-poa-storage-'));
    const root = join(temporaryRoot, 'objects');
    const storage = new LocalPrivateProofOfAddressStorage(configuration(root));
    const key = 'ab'.repeat(32);
    const encryptedBytes = Buffer.from('MNPOA1-encrypted-document-payload');

    await storage.put(key, encryptedBytes);
    await expect(storage.get(key)).resolves.toEqual(encryptedBytes);
    expect(await readdir(root)).toEqual([`${key}.poa`]);
    if (process.platform !== 'win32') expect((await lstat(root)).mode & 0o077).toBe(0);

    await storage.remove(key);
    await expect(readdir(root)).resolves.toEqual([]);
  });

  it('rejects traversal keys and refuses to read symbolic links', async () => {
    if (process.platform === 'win32') return;
    temporaryRoot = await mkdtemp(join(tmpdir(), 'monienaija-poa-symlink-'));
    const root = join(temporaryRoot, 'objects');
    const storage = new LocalPrivateProofOfAddressStorage(configuration(root));
    await expect(storage.get('../outside')).rejects.toThrow(
      /Invalid internal Proof of Address object key/,
    );

    await storage.put('cd'.repeat(32), Buffer.from('safe-ciphertext'));
    const path = join(root, `${'ef'.repeat(32)}.poa`);
    const target = join(temporaryRoot, 'outside.bin');
    await writeFile(target, 'not-private-storage');
    await symlink(target, path);
    await expect(storage.get('ef'.repeat(32))).rejects.toThrow(/regular file/);
    expect(await readFile(target, 'utf8')).toBe('not-private-storage');
  });
});

function configuration(root: string): ProofOfAddressConfiguration {
  return {
    enabled: true,
    nodeEnv: 'test',
    maxUploadBytes: 10 * 1024 * 1024,
    storageProvider: 'local',
    localStorageRoot: root,
    encryptionKeyFile: join(root, '..', 'key'),
    encryptionActiveKeyVersion: 'v1',
    clamavHost: '127.0.0.1',
    clamavPort: 3310,
    clamavTimeoutMs: 1000,
    s3ForcePathStyle: false,
  };
}
