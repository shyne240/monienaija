import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { Readable } from 'node:stream';

import type { ProofOfAddressConfiguration } from '../src/customer-proof-of-address/customer-proof-of-address.config';
import { S3PrivateProofOfAddressStorage } from '../src/customer-proof-of-address/private-document-storage.adapters';

describe('S3PrivateProofOfAddressStorage', () => {
  afterEach(() => jest.restoreAllMocks());

  it('uses opaque private objects and returns only the encrypted payload without requiring credentials in tests', async () => {
    const ciphertext = Buffer.from('MNPOA1-encrypted-object');
    const send = jest.spyOn(S3Client.prototype, 'send').mockResolvedValue({} as never);
    const storage = new S3PrivateProofOfAddressStorage(configuration());
    const objectKey = 'ab'.repeat(32);

    await storage.put(objectKey, ciphertext);
    const putCommand = send.mock.calls[0]?.[0];
    expect(putCommand).toBeInstanceOf(PutObjectCommand);
    expect((putCommand as PutObjectCommand).input).toMatchObject({
      Bucket: 'private-customer-documents',
      Key: `customer-proof-of-address/v1/${objectKey}.poa`,
      Body: ciphertext,
      ContentType: 'application/octet-stream',
      CacheControl: 'no-store',
    });
    expect((putCommand as PutObjectCommand).input.ACL).toBeUndefined();

    send.mockResolvedValueOnce({ Body: Readable.from([ciphertext]) } as never);
    await expect(storage.get(objectKey)).resolves.toEqual(ciphertext);
    expect(send.mock.calls[1]?.[0]).toBeInstanceOf(GetObjectCommand);

    await storage.remove(objectKey);
    expect(send.mock.calls[2]?.[0]).toBeInstanceOf(DeleteObjectCommand);
    expect((send.mock.calls[2]?.[0] as DeleteObjectCommand).input.Key).toBe(
      `customer-proof-of-address/v1/${objectKey}.poa`,
    );
    expect(send).toHaveBeenCalledTimes(3);
  });
});

function configuration(): ProofOfAddressConfiguration {
  return {
    enabled: true,
    nodeEnv: 'production',
    maxUploadBytes: 10 * 1024 * 1024,
    storageProvider: 's3',
    localStorageRoot: './unused',
    encryptionKeyFile: './unused',
    encryptionActiveKeyVersion: 'v1',
    clamavHost: '127.0.0.1',
    clamavPort: 3310,
    clamavTimeoutMs: 1000,
    s3Bucket: 'private-customer-documents',
    s3Region: 'af-south-1',
    s3ForcePathStyle: false,
  };
}
