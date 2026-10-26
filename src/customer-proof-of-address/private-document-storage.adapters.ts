import { Inject, Injectable } from '@nestjs/common';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { chmod, lstat, mkdir, open, readFile, unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import {
  PROOF_OF_ADDRESS_CONFIG,
  type ProofOfAddressConfiguration,
} from './customer-proof-of-address.config';
import {
  assertOpaqueProofOfAddressObjectKey,
  type PrivateProofOfAddressStorage,
} from './proof-of-address-storage.interface';

@Injectable()
export class LocalPrivateProofOfAddressStorage implements PrivateProofOfAddressStorage {
  private readonly root: string;

  constructor(
    @Inject(PROOF_OF_ADDRESS_CONFIG)
    private readonly config: ProofOfAddressConfiguration,
  ) {
    this.root = resolve(this.config.localStorageRoot);
  }

  async put(objectKey: string, encryptedBytes: Buffer): Promise<void> {
    assertOpaqueProofOfAddressObjectKey(objectKey);
    await this.ensurePrivateRoot();
    const objectPath = join(this.root, `${objectKey}.poa`);
    const handle = await open(objectPath, 'wx', 0o600);
    try {
      await handle.writeFile(encryptedBytes);
      await handle.sync();
    } catch (error) {
      await unlink(objectPath).catch(() => undefined);
      throw error;
    } finally {
      await handle.close();
    }
  }

  async get(objectKey: string): Promise<Buffer> {
    assertOpaqueProofOfAddressObjectKey(objectKey);
    await this.ensurePrivateRoot();
    const objectPath = join(this.root, `${objectKey}.poa`);
    const info = await lstat(objectPath);
    if (!info.isFile() || info.isSymbolicLink()) {
      throw new Error('Private Proof of Address object is not a regular file');
    }
    if (info.size > this.config.maxUploadBytes + 256) {
      throw new Error('Private Proof of Address object exceeds the encrypted-size limit');
    }
    return readFile(objectPath);
  }

  async remove(objectKey: string): Promise<void> {
    assertOpaqueProofOfAddressObjectKey(objectKey);
    await this.ensurePrivateRoot();
    await unlink(join(this.root, `${objectKey}.poa`)).catch((error: unknown) => {
      if (!isNodeError(error, 'ENOENT')) throw error;
    });
  }

  private async ensurePrivateRoot(): Promise<void> {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    const info = await lstat(this.root);
    if (!info.isDirectory() || info.isSymbolicLink()) {
      throw new Error('Private Proof of Address storage root must be a real directory');
    }
    if (process.platform !== 'win32') {
      await chmod(this.root, 0o700);
    }
  }
}

/** S3-compatible storage adapter. The payload is already AES-GCM encrypted by the application. */
@Injectable()
export class S3PrivateProofOfAddressStorage implements PrivateProofOfAddressStorage {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(
    @Inject(PROOF_OF_ADDRESS_CONFIG)
    config: ProofOfAddressConfiguration,
  ) {
    if (!config.s3Bucket || !config.s3Region) {
      throw new Error('POA_S3_BUCKET and POA_S3_REGION are required for S3-compatible storage');
    }
    this.bucket = config.s3Bucket;
    this.client = new S3Client({
      region: config.s3Region,
      ...(config.s3Endpoint ? { endpoint: config.s3Endpoint } : {}),
      forcePathStyle: config.s3ForcePathStyle,
    });
  }

  async put(objectKey: string, encryptedBytes: Buffer): Promise<void> {
    assertOpaqueProofOfAddressObjectKey(objectKey);
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: `customer-proof-of-address/v1/${objectKey}.poa`,
        Body: encryptedBytes,
        ContentType: 'application/octet-stream',
        CacheControl: 'no-store',
      }),
    );
  }

  async get(objectKey: string): Promise<Buffer> {
    assertOpaqueProofOfAddressObjectKey(objectKey);
    const result = await this.client.send(
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: `customer-proof-of-address/v1/${objectKey}.poa`,
      }),
    );
    if (!result.Body) throw new Error('Private Proof of Address object is missing');
    const chunks: Buffer[] = [];
    let total = 0;
    for await (const chunk of result.Body as AsyncIterable<Uint8Array>) {
      total += chunk.byteLength;
      if (total > 10 * 1024 * 1024 + 256) {
        throw new Error('Private Proof of Address object exceeds the encrypted-size limit');
      }
      chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks, total);
  }

  async remove(objectKey: string): Promise<void> {
    assertOpaqueProofOfAddressObjectKey(objectKey);
    await this.client.send(
      new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: `customer-proof-of-address/v1/${objectKey}.poa`,
      }),
    );
  }
}

function isNodeError(error: unknown, code: string): error is NodeJS.ErrnoException {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as NodeJS.ErrnoException).code === code
  );
}
