import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const PREFIX = 'MNKPS1';
const ALGORITHM = 'aes-256-gcm';
const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_VERSION = /^[A-Za-z0-9._-]{1,64}$/;
// eslint-disable-next-line no-control-regex -- Control bytes are invalid in stored API credentials.
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;
export type KycCredentialEnvironment = 'sandbox' | 'production';

export interface EncryptedKycCredential {
  envelope: string;
  keyVersion: string;
  fingerprint: string;
  envelopeHash: string;
}

export interface KycCredentialEncryptionStatus {
  available: boolean;
  activeKeyVersion: string | null;
  keyVersions: string[];
}

export class KycCredentialEncryptionError extends Error {
  constructor(readonly code: 'KEY_UNAVAILABLE' | 'ENVELOPE_INVALID' | 'DECRYPT_FAILED') {
    super(`KYC credential encryption: ${code}`);
    this.name = 'KycCredentialEncryptionError';
  }
}

function aad(environment: KycCredentialEnvironment, version: string): Buffer {
  return Buffer.from(`monienaija:kyc-provider-secret:v1:PREMBLY:${environment}:${version}`, 'utf8');
}

function parseKey(value: unknown): Buffer | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  const key = Buffer.from(normalized, 'base64');
  return key.length === KEY_BYTES && key.toString('base64') === normalized ? key : null;
}

function safeFingerprint(value: string): string {
  const normalized = value.replace(/[^A-Za-z0-9_-]/g, '');
  if (normalized.length < 4) throw new KycCredentialEncryptionError('ENVELOPE_INVALID');
  return `****${normalized.slice(-4)}`;
}

@Injectable()
export class KycProviderSecretEncryptionService {
  constructor(private readonly config: ConfigService) {}

  status(): KycCredentialEncryptionStatus {
    const keyring = this.keyring();
    if (!keyring) return { available: false, activeKeyVersion: null, keyVersions: [] };
    return {
      available: true,
      activeKeyVersion: keyring.active,
      keyVersions: [...keyring.keys.keys()],
    };
  }

  encrypt(secret: string, environment: KycCredentialEnvironment): EncryptedKycCredential {
    if (
      typeof secret !== 'string' ||
      secret.trim().length < 16 ||
      secret.length > 512 ||
      CONTROL_CHARACTERS.test(secret)
    )
      throw new KycCredentialEncryptionError('ENVELOPE_INVALID');
    const normalized = secret.trim();
    const keyring = this.requireKeyring();
    const key = keyring.keys.get(keyring.active);
    if (!key) throw new KycCredentialEncryptionError('KEY_UNAVAILABLE');

    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: TAG_BYTES });
    cipher.setAAD(aad(environment, keyring.active));
    const ciphertext = Buffer.concat([cipher.update(normalized, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    const envelope = [
      PREFIX,
      keyring.active,
      iv.toString('base64'),
      tag.toString('base64'),
      ciphertext.toString('base64'),
    ].join(':');
    return {
      envelope,
      keyVersion: keyring.active,
      fingerprint: safeFingerprint(normalized),
      envelopeHash: createHash('sha256').update(envelope, 'utf8').digest('hex'),
    };
  }

  decrypt(
    envelope: string,
    environment: KycCredentialEnvironment,
    expectedVersion?: string | null,
  ): string {
    const parts = typeof envelope === 'string' ? envelope.split(':') : [];
    if (parts.length !== 5 || parts[0] !== PREFIX || !KEY_VERSION.test(parts[1] ?? ''))
      throw new KycCredentialEncryptionError('ENVELOPE_INVALID');
    const [, version, ivText, tagText, ciphertextText] = parts;
    if (expectedVersion && expectedVersion !== version)
      throw new KycCredentialEncryptionError('ENVELOPE_INVALID');
    const key = this.requireKeyring().keys.get(version!);
    if (!key) throw new KycCredentialEncryptionError('KEY_UNAVAILABLE');
    const iv = Buffer.from(ivText!, 'base64');
    const tag = Buffer.from(tagText!, 'base64');
    const ciphertext = Buffer.from(ciphertextText!, 'base64');
    if (
      iv.length !== IV_BYTES ||
      tag.length !== TAG_BYTES ||
      ciphertext.length === 0 ||
      iv.toString('base64') !== ivText ||
      tag.toString('base64') !== tagText ||
      ciphertext.toString('base64') !== ciphertextText
    )
      throw new KycCredentialEncryptionError('ENVELOPE_INVALID');
    try {
      const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: TAG_BYTES });
      decipher.setAAD(aad(environment, version!));
      decipher.setAuthTag(tag);
      const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString(
        'utf8',
      );
      if (!plaintext || plaintext.length > 512) throw new Error('invalid');
      return plaintext;
    } catch {
      throw new KycCredentialEncryptionError('DECRYPT_FAILED');
    }
  }

  private keyring(): { active: string; keys: Map<string, Buffer> } | null {
    const raw = this.config.get<string>('KYC_PROVIDER_ENCRYPTION_KEYRING_JSON');
    const active = this.config.get<string>('KYC_PROVIDER_ENCRYPTION_ACTIVE_KEY_VERSION') ?? 'v1';
    if (!raw || !KEY_VERSION.test(active)) return null;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
      const entries = Object.entries(parsed as Record<string, unknown>);
      if (!entries.length) return null;
      const keys = new Map<string, Buffer>();
      for (const [version, encoded] of entries) {
        const key = parseKey(encoded);
        if (!KEY_VERSION.test(version) || !key) return null;
        keys.set(version, key);
      }
      if (!keys.has(active)) return null;
      return { active, keys };
    } catch {
      return null;
    }
  }

  private requireKeyring(): { active: string; keys: Map<string, Buffer> } {
    const keyring = this.keyring();
    if (!keyring) throw new KycCredentialEncryptionError('KEY_UNAVAILABLE');
    return keyring;
  }
}
