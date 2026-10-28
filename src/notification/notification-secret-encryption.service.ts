import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export type ManagedNotificationChannel = 'SMS' | 'EMAIL';

export type NotificationSecretEncryptionErrorCode =
  | 'PROVIDER_ENCRYPTION_KEY_MISSING'
  | 'PROVIDER_ENCRYPTION_KEY_INVALID'
  | 'PROVIDER_ENCRYPTION_KEY_VERSION_MISSING'
  | 'PROVIDER_SECRET_ENVELOPE_INVALID'
  | 'PROVIDER_SECRET_DECRYPT_FAILED';

export class NotificationSecretEncryptionError extends Error {
  constructor(
    public readonly code: NotificationSecretEncryptionErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'NotificationSecretEncryptionError';
  }
}

export interface NotificationEncryptionStatus {
  available: boolean;
  mode: 'KEYRING_JSON' | 'SINGLE_KEY' | 'MISSING_KEY' | 'INVALID_KEY';
  activeKeyVersion: string | null;
  keyVersions: string[];
}

export interface EncryptedNotificationSecret {
  envelope: string;
  keyVersion: string;
  fingerprint: string;
  envelopeHash: string;
}

const ENVELOPE_PREFIX = 'MNNPS1';
const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;
const KEY_BYTES = 32;
const KEY_VERSION_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;

export function computeKeyFingerprint(secret: string): string {
  const safeTail = secret.replace(/[^A-Za-z0-9_-]/g, '');
  if (safeTail.length < 4) {
    throw new NotificationSecretEncryptionError(
      'PROVIDER_SECRET_ENVELOPE_INVALID',
      'Provider API credential is too short to derive a safe four-character fingerprint.',
    );
  }
  return `****${safeTail.slice(-4)}`;
}

function buildAad(channel: ManagedNotificationChannel, keyVersion: string): Buffer {
  return Buffer.from(
    `monienaija:notification-provider-secret:v1:${channel}:${keyVersion}`,
    'utf8',
  );
}

function parseBase64Key(raw: string, version: string): Buffer {
  const trimmed = raw.trim();
  const decoded = Buffer.from(trimmed, 'base64');
  if (decoded.length !== KEY_BYTES || decoded.toString('base64') !== trimmed) {
    throw new NotificationSecretEncryptionError(
      'PROVIDER_ENCRYPTION_KEY_INVALID',
      `Notification provider encryption key version "${version}" must be a 32-byte base64 key.`,
    );
  }
  return decoded;
}

@Injectable()
export class NotificationSecretEncryptionService {
  constructor(private readonly configService: ConfigService) {}

  getStatus(): NotificationEncryptionStatus {
    try {
      const keyring = this.loadKeyringOrNull();
      if (!keyring) {
        return {
          available: false,
          mode: 'MISSING_KEY',
          activeKeyVersion: null,
          keyVersions: [],
        };
      }
      return {
        available: true,
        mode: keyring.mode,
        activeKeyVersion: keyring.activeKeyVersion,
        keyVersions: Array.from(keyring.keys.keys()),
      };
    } catch {
      return {
        available: false,
        mode: 'INVALID_KEY',
        activeKeyVersion: null,
        keyVersions: [],
      };
    }
  }

  isAvailable(): boolean {
    return this.getStatus().available;
  }

  encrypt(
    plaintextSecret: string,
    channel: ManagedNotificationChannel,
  ): EncryptedNotificationSecret {
    const trimmed = plaintextSecret.trim();
    if (!trimmed) {
      throw new NotificationSecretEncryptionError(
        'PROVIDER_SECRET_ENVELOPE_INVALID',
        'Provider API credential must not be empty.',
      );
    }

    const keyring = this.requireKeyring();
    const keyVersion = keyring.activeKeyVersion;
    const key = keyring.keys.get(keyVersion);
    if (!key) {
      throw new NotificationSecretEncryptionError(
        'PROVIDER_ENCRYPTION_KEY_VERSION_MISSING',
        'Active notification encryption key version is not present in the configured keyring.',
      );
    }

    const fingerprint = computeKeyFingerprint(trimmed);
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_BYTES });
    cipher.setAAD(buildAad(channel, keyVersion));

    const ciphertext = Buffer.concat([cipher.update(trimmed, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    const envelope = [
      ENVELOPE_PREFIX,
      keyVersion,
      iv.toString('base64'),
      authTag.toString('base64'),
      ciphertext.toString('base64'),
    ].join(':');
    const envelopeHash = createHash('sha256').update(envelope, 'utf8').digest('hex');

    return {
      envelope,
      keyVersion,
      fingerprint,
      envelopeHash,
    };
  }

  decrypt(
    envelope: string,
    channel: ManagedNotificationChannel,
    expectedKeyVersion?: string | null,
  ): string {
    const keyring = this.requireKeyring();
    const parts = envelope.split(':');
    if (parts.length !== 5 || parts[0] !== ENVELOPE_PREFIX) {
      throw new NotificationSecretEncryptionError(
        'PROVIDER_SECRET_ENVELOPE_INVALID',
        'Stored notification credential envelope format is invalid.',
      );
    }

    const [, keyVersion, ivB64, tagB64, ciphertextB64] = parts;
    if (!keyVersion || !KEY_VERSION_PATTERN.test(keyVersion)) {
      throw new NotificationSecretEncryptionError(
        'PROVIDER_SECRET_ENVELOPE_INVALID',
        'Stored notification credential envelope carries an invalid key version.',
      );
    }
    if (expectedKeyVersion && expectedKeyVersion !== keyVersion) {
      throw new NotificationSecretEncryptionError(
        'PROVIDER_SECRET_DECRYPT_FAILED',
        'Stored notification credential key version does not match row metadata.',
      );
    }

    const key = keyring.keys.get(keyVersion);
    if (!key) {
      throw new NotificationSecretEncryptionError(
        'PROVIDER_ENCRYPTION_KEY_VERSION_MISSING',
        `Notification encryption key version "${keyVersion}" is missing from the server keyring.`,
      );
    }

    let iv: Buffer;
    let authTag: Buffer;
    let ciphertext: Buffer;
    try {
      iv = Buffer.from(ivB64!, 'base64');
      authTag = Buffer.from(tagB64!, 'base64');
      ciphertext = Buffer.from(ciphertextB64!, 'base64');
    } catch {
      throw new NotificationSecretEncryptionError(
        'PROVIDER_SECRET_ENVELOPE_INVALID',
        'Stored notification credential envelope base64 encoding is invalid.',
      );
    }

    if (iv.length !== IV_BYTES || authTag.length !== AUTH_TAG_BYTES || ciphertext.length === 0) {
      throw new NotificationSecretEncryptionError(
        'PROVIDER_SECRET_ENVELOPE_INVALID',
        'Stored notification credential envelope segment lengths are invalid.',
      );
    }

    try {
      const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_BYTES });
      decipher.setAAD(buildAad(channel, keyVersion));
      decipher.setAuthTag(authTag);
      const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString(
        'utf8',
      );
      if (!plaintext) {
        throw new Error('empty');
      }
      return plaintext;
    } catch {
      throw new NotificationSecretEncryptionError(
        'PROVIDER_SECRET_DECRYPT_FAILED',
        'Failed to authenticate and decrypt stored notification provider credential.',
      );
    }
  }

  private requireKeyring(): {
    mode: 'KEYRING_JSON' | 'SINGLE_KEY';
    activeKeyVersion: string;
    keys: Map<string, Buffer>;
  } {
    const keyring = this.loadKeyringOrNull();
    if (!keyring) {
      throw new NotificationSecretEncryptionError(
        'PROVIDER_ENCRYPTION_KEY_MISSING',
        'Server-side notification provider encryption key is not configured (set NOTIFICATION_PROVIDER_ENCRYPTION_KEYRING_JSON or NOTIFICATION_PROVIDER_ENCRYPTION_KEY).',
      );
    }
    return keyring;
  }

  private loadKeyringOrNull(): {
    mode: 'KEYRING_JSON' | 'SINGLE_KEY';
    activeKeyVersion: string;
    keys: Map<string, Buffer>;
  } | null {
    const keyringJson = this.configService.get<string>(
      'NOTIFICATION_PROVIDER_ENCRYPTION_KEYRING_JSON',
    );
    const singleKey = this.configService.get<string>('NOTIFICATION_PROVIDER_ENCRYPTION_KEY');
    const activeVersion =
      this.configService.get<string>('NOTIFICATION_PROVIDER_ENCRYPTION_ACTIVE_KEY_VERSION') ??
      'v1';

    if (!KEY_VERSION_PATTERN.test(activeVersion)) {
      throw new NotificationSecretEncryptionError(
        'PROVIDER_ENCRYPTION_KEY_INVALID',
        'Active notification encryption key version format is invalid.',
      );
    }

    if (keyringJson && keyringJson.trim()) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(keyringJson);
      } catch {
        throw new NotificationSecretEncryptionError(
          'PROVIDER_ENCRYPTION_KEY_INVALID',
          'NOTIFICATION_PROVIDER_ENCRYPTION_KEYRING_JSON is not valid JSON.',
        );
      }
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new NotificationSecretEncryptionError(
          'PROVIDER_ENCRYPTION_KEY_INVALID',
          'NOTIFICATION_PROVIDER_ENCRYPTION_KEYRING_JSON must be a JSON object.',
        );
      }
      const keys = new Map<string, Buffer>();
      for (const [version, encoded] of Object.entries(parsed as Record<string, unknown>)) {
        if (!KEY_VERSION_PATTERN.test(version) || typeof encoded !== 'string') {
          throw new NotificationSecretEncryptionError(
            'PROVIDER_ENCRYPTION_KEY_INVALID',
            `Invalid notification encryption key entry for version "${version}".`,
          );
        }
        keys.set(version, parseBase64Key(encoded, version));
      }
      if (!keys.has(activeVersion)) {
        throw new NotificationSecretEncryptionError(
          'PROVIDER_ENCRYPTION_KEY_VERSION_MISSING',
          `Active notification encryption key version "${activeVersion}" is missing from keyring.`,
        );
      }
      return {
        mode: 'KEYRING_JSON',
        activeKeyVersion: activeVersion,
        keys,
      };
    }

    if (singleKey && singleKey.trim()) {
      const keys = new Map<string, Buffer>();
      keys.set(activeVersion, parseBase64Key(singleKey, activeVersion));
      return {
        mode: 'SINGLE_KEY',
        activeKeyVersion: activeVersion,
        keys,
      };
    }

    return null;
  }
}
