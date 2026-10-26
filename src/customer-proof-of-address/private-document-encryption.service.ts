import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { lstat, mkdir, open, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import { Inject, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

import {
  PROOF_OF_ADDRESS_CONFIG,
  type ProofOfAddressConfiguration,
} from './customer-proof-of-address.config';

const ENVELOPE_MAGIC = Buffer.from('MNPOA1', 'ascii');
const ENVELOPE_IV_BYTES = 12;
const ENVELOPE_TAG_BYTES = 16;
const LOCAL_KEY_FILE_MAGIC = 'MNPOA-KEY-V1';

export interface EncryptedProofOfAddressObject {
  keyVersion: string;
  bytes: Buffer;
}

/** AES-256-GCM envelope encryption with versioned, persistent key material. */
@Injectable()
export class PrivateDocumentEncryptionService {
  private keys?: Map<string, Buffer>;
  private activeKeyVersion?: string;
  private loading?: Promise<void>;

  constructor(
    private readonly dataSource: DataSource,
    @Inject(PROOF_OF_ADDRESS_CONFIG)
    private readonly config: ProofOfAddressConfiguration,
  ) {}

  async encrypt(plainBytes: Buffer): Promise<EncryptedProofOfAddressObject> {
    await this.ensureKeysLoaded();
    const keyVersion = this.activeKeyVersion;
    if (!keyVersion) throw new Error('Proof of Address encryption key is unavailable');
    const key = this.keys?.get(keyVersion);
    if (!key) throw new Error('Configured active Proof of Address encryption key is unavailable');

    const iv = randomBytes(ENVELOPE_IV_BYTES);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(Buffer.from(`monienaija:customer-poa:${keyVersion}`, 'utf8'));
    const encrypted = Buffer.concat([cipher.update(plainBytes), cipher.final()]);
    const tag = cipher.getAuthTag();
    const versionBytes = Buffer.from(keyVersion, 'utf8');
    if (versionBytes.length < 1 || versionBytes.length > 64) {
      throw new Error('Invalid Proof of Address encryption key version');
    }

    const header = Buffer.concat([
      ENVELOPE_MAGIC,
      Buffer.from([versionBytes.length]),
      versionBytes,
      iv,
      tag,
    ]);
    return { keyVersion, bytes: Buffer.concat([header, encrypted]) };
  }

  async decrypt(encryptedBytes: Buffer, expectedKeyVersion: string): Promise<Buffer> {
    await this.ensureKeysLoaded();
    if (
      !Buffer.isBuffer(encryptedBytes) ||
      encryptedBytes.length < ENVELOPE_MAGIC.length + 1 + ENVELOPE_IV_BYTES + ENVELOPE_TAG_BYTES
    ) {
      throw new Error('Encrypted Proof of Address object is malformed');
    }
    if (!encryptedBytes.subarray(0, ENVELOPE_MAGIC.length).equals(ENVELOPE_MAGIC)) {
      throw new Error('Encrypted Proof of Address object has an unsupported envelope');
    }
    const versionLength = encryptedBytes[ENVELOPE_MAGIC.length] ?? 0;
    if (versionLength < 1 || versionLength > 64) {
      throw new Error('Encrypted Proof of Address object has an invalid key version');
    }
    const versionStart = ENVELOPE_MAGIC.length + 1;
    const ivStart = versionStart + versionLength;
    const tagStart = ivStart + ENVELOPE_IV_BYTES;
    const encryptedStart = tagStart + ENVELOPE_TAG_BYTES;
    if (encryptedBytes.length < encryptedStart) {
      throw new Error('Encrypted Proof of Address object is truncated');
    }
    const keyVersion = encryptedBytes.subarray(versionStart, ivStart).toString('utf8');
    if (keyVersion !== expectedKeyVersion) {
      throw new Error('Proof of Address encryption-key version metadata does not match the object');
    }
    const key = this.keys?.get(keyVersion);
    if (!key) {
      throw new Error(
        `Required Proof of Address encryption key version ${keyVersion} is not configured`,
      );
    }

    const iv = encryptedBytes.subarray(ivStart, tagStart);
    const tag = encryptedBytes.subarray(tagStart, encryptedStart);
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAAD(Buffer.from(`monienaija:customer-poa:${keyVersion}`, 'utf8'));
    decipher.setAuthTag(tag);
    return Buffer.concat([
      decipher.update(encryptedBytes.subarray(encryptedStart)),
      decipher.final(),
    ]);
  }

  private async ensureKeysLoaded(): Promise<void> {
    if (this.keys) return;
    this.loading ??= this.loadKeys();
    await this.loading;
  }

  private async loadKeys(): Promise<void> {
    if (this.config.encryptionKeyringJson) {
      const parsed: unknown = JSON.parse(this.config.encryptionKeyringJson);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('Proof of Address encryption keyring must be a JSON object');
      }
      const entries = Object.entries(parsed as Record<string, unknown>);
      const keys = new Map<string, Buffer>();
      for (const [version, encoded] of entries) {
        if (!/^[A-Za-z0-9._-]{1,64}$/.test(version) || typeof encoded !== 'string') {
          throw new Error('Proof of Address encryption keyring contains an invalid entry');
        }
        const decoded = Buffer.from(encoded, 'base64');
        if (decoded.length !== 32 || decoded.toString('base64') !== encoded) {
          throw new Error(
            'Proof of Address encryption keyring entries must be 32-byte base64 keys',
          );
        }
        keys.set(version, decoded);
      }
      if (!keys.has(this.config.encryptionActiveKeyVersion)) {
        throw new Error(
          'The active Proof of Address encryption key version is missing from the keyring',
        );
      }
      this.keys = keys;
      this.activeKeyVersion = this.config.encryptionActiveKeyVersion;
      return;
    }

    if (
      this.config.storageProvider !== 'local' ||
      !['development', 'test'].includes(this.config.nodeEnv)
    ) {
      throw new Error('An operator-managed Proof of Address encryption keyring is required');
    }

    const keyFile = resolve(this.config.encryptionKeyFile);
    try {
      const info = await lstat(keyFile);
      if (!info.isFile() || info.size > 256) {
        throw new Error('Persistent Proof of Address key file is not a valid regular key file');
      }
      if (process.platform !== 'win32' && (info.mode & 0o077) !== 0) {
        throw new Error(
          'Persistent Proof of Address key file permissions must be owner-only (0600)',
        );
      }
      const fileContent = (await readFile(keyFile, { encoding: 'utf8' })).trim().split(/\r?\n/);
      const [magic, version, encodedKey] = fileContent;
      if (magic !== LOCAL_KEY_FILE_MAGIC || !version || !encodedKey) {
        throw new Error(
          'Persistent Proof of Address key file is malformed; refusing to replace it',
        );
      }
      if (version !== this.config.encryptionActiveKeyVersion) {
        throw new Error(
          `Persistent Proof of Address key version ${version} does not match configured active version ${this.config.encryptionActiveKeyVersion}; perform an explicit key rotation`,
        );
      }
      const key = Buffer.from(encodedKey, 'base64');
      if (key.length !== 32 || key.toString('base64') !== encodedKey) {
        throw new Error(
          'Persistent Proof of Address key file does not contain a valid 32-byte key',
        );
      }
      this.keys = new Map([[version, key]]);
      this.activeKeyVersion = version;
      return;
    } catch (error) {
      if (!isNodeError(error, 'ENOENT')) throw error;
    }

    const hasStoredDocuments = await this.hasEncryptedDocuments();
    if (hasStoredDocuments) {
      throw new Error(
        'Proof of Address key file is missing while stored documents exist; restore the original key instead of generating a replacement',
      );
    }

    const newKey = randomBytes(32);
    const parent = dirname(keyFile);
    await mkdir(parent, { recursive: true, mode: 0o700 });
    if (process.platform !== 'win32')
      await import('node:fs/promises').then(({ chmod }) => chmod(parent, 0o700));
    const keyFileBody = `${LOCAL_KEY_FILE_MAGIC}\n${this.config.encryptionActiveKeyVersion}\n${newKey.toString('base64')}\n`;
    let handle;
    try {
      handle = await open(
        keyFile,
        fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY,
        0o600,
      );
      await handle.writeFile(keyFileBody, { encoding: 'utf8' });
      await handle.sync();
      await handle.close();
    } catch (error) {
      await handle?.close().catch(() => undefined);
      if (!isNodeError(error, 'EEXIST')) throw error;
      // Another process won the O_EXCL race. Read its persisted key; never overwrite it.
      return this.loadKeys();
    }
    this.keys = new Map([[this.config.encryptionActiveKeyVersion, newKey]]);
    this.activeKeyVersion = this.config.encryptionActiveKeyVersion;
  }

  private async hasEncryptedDocuments(): Promise<boolean> {
    try {
      const rows: Array<{ has_documents: boolean | string }> = await this.dataSource.query(
        `SELECT EXISTS (
           SELECT 1 FROM customer_proof_of_address_submissions
            WHERE storage_object_key IS NOT NULL
         ) AS has_documents`,
      );
      return rows[0]?.has_documents === true || rows[0]?.has_documents === 't';
    } catch {
      // If the migration/database cannot be checked, do not create a key: it could make
      // previously encrypted content permanently unreadable.
      throw new Error(
        'Cannot verify whether encrypted Proof of Address documents already exist; refusing to create a key',
      );
    }
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
