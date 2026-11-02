import { createHmac, timingSafeEqual } from 'node:crypto';
import type { ConfigService } from '@nestjs/config';

import type { Environment } from '../config/environment';
import type { ManagedNotificationChannel } from './notification-secret-encryption.service';

export type BoundCredentialSource = 'ENV_SECRET' | 'ENCRYPTED_DB';
export const CREDENTIAL_BINDING_SCHEME = 'HMAC_SHA256_V1';
const KEY_VERSION_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;
const MAC_PATTERN = /^[a-f0-9]{64}$/;
const DOMAIN = 'monienaija.notification.provider-credential.binding.v1';

/** Sensitive internal metadata. Never return, log, or audit the MAC or key material. */
export interface CredentialBinding {
  scheme: typeof CREDENTIAL_BINDING_SCHEME;
  keyVersion: string;
  mac: string;
}

/** All malformed keys, missing keys and mismatches deliberately share one safe boundary code. */
export class CredentialBindingError extends Error {
  constructor() {
    super('PROVIDER_CREDENTIAL_INTEGRITY_UNAVAILABLE');
    this.name = 'CredentialBindingError';
  }
}

/**
 * Versioned, independently provisioned HMAC keys. This service does not generate, persist,
 * fall back to or derive keys from the provider credential or the encryption keyring.
 */
export class NotificationCredentialBindingService {
  constructor(private readonly config: ConfigService<Environment, true>) {}

  create(
    channel: ManagedNotificationChannel,
    provider: string,
    source: BoundCredentialSource,
    effectiveSecret: string,
  ): CredentialBinding {
    const { active, keys } = this.loadKeyring();
    const key = keys.get(active);
    if (!key) throw new CredentialBindingError();
    return {
      scheme: CREDENTIAL_BINDING_SCHEME,
      keyVersion: active,
      mac: this.digest(key, channel, provider, source, effectiveSecret).toString('hex'),
    };
  }

  verify(
    binding: CredentialBinding | null,
    channel: ManagedNotificationChannel,
    provider: string,
    source: BoundCredentialSource,
    effectiveSecret: string,
  ): boolean {
    try {
      if (
        !binding ||
        binding.scheme !== CREDENTIAL_BINDING_SCHEME ||
        !KEY_VERSION_PATTERN.test(binding.keyVersion) ||
        !MAC_PATTERN.test(binding.mac)
      ) return false;
      const { keys } = this.loadKeyring();
      const key = keys.get(binding.keyVersion);
      if (!key) return false;
      const expected = Buffer.from(binding.mac, 'hex');
      const actual = this.digest(key, channel, provider, source, effectiveSecret);
      return expected.length === actual.length && timingSafeEqual(expected, actual);
    } catch {
      return false;
    }
  }

  private digest(
    key: Buffer,
    channel: ManagedNotificationChannel,
    provider: string,
    source: BoundCredentialSource,
    effectiveSecret: string,
  ): Buffer {
    const hmac = createHmac('sha256', key);
    // Each value is a UTF-8 byte string with an unsigned 32-bit byte length. The
    // caller must pass exactly the validated/normalized bytes used by the adapter.
    for (const part of [DOMAIN, channel, provider, source, effectiveSecret]) {
      const bytes = Buffer.from(part, 'utf8');
      const length = Buffer.alloc(4);
      length.writeUInt32BE(bytes.length);
      hmac.update(length).update(bytes);
    }
    return hmac.digest();
  }

  private loadKeyring(): { active: string; keys: Map<string, Buffer> } {
    const raw = this.config.get<string>('NOTIFICATION_PROVIDER_BINDING_KEYRING_JSON');
    const active = this.config.get<string>('NOTIFICATION_PROVIDER_BINDING_ACTIVE_KEY_VERSION') ?? 'v1';
    if (!raw || !KEY_VERSION_PATTERN.test(active)) throw new CredentialBindingError();
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new CredentialBindingError();
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new CredentialBindingError();
    }
    const entries = Object.entries(parsed as Record<string, unknown>);
    if (entries.length === 0) throw new CredentialBindingError();
    const keys = new Map<string, Buffer>();
    for (const [version, encoded] of entries) {
      if (!KEY_VERSION_PATTERN.test(version) || typeof encoded !== 'string') {
        throw new CredentialBindingError();
      }
      const key = Buffer.from(encoded, 'base64');
      if (key.length !== 32 || key.toString('base64') !== encoded) {
        throw new CredentialBindingError();
      }
      keys.set(version, key);
    }
    if (!keys.has(active)) throw new CredentialBindingError();
    this.assertDistinctFromEncryptionKeys(keys);
    return { active, keys };
  }

  /** Catch accidental key reuse; independent generation and custody still require operations controls. */
  private assertDistinctFromEncryptionKeys(bindingKeys: Map<string, Buffer>): void {
    const candidates: unknown[] = [];
    const single = this.config.get<string>('NOTIFICATION_PROVIDER_ENCRYPTION_KEY');
    if (single) candidates.push(single);
    const json = this.config.get<string>('NOTIFICATION_PROVIDER_ENCRYPTION_KEYRING_JSON');
    if (json) {
      try {
        const parsed: unknown = JSON.parse(json);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          candidates.push(...Object.values(parsed as Record<string, unknown>));
        }
      } catch {
        // An invalid encryption ring cannot supply an encryption key. Its own service fails
        // closed; do not prevent ENV_SECRET solely because an unrelated ring is malformed.
      }
    }
    for (const candidate of candidates) {
      if (typeof candidate !== 'string') continue;
      const text = candidate.trim();
      const encryptionKey = Buffer.from(text, 'base64');
      if (encryptionKey.length !== 32 || encryptionKey.toString('base64') !== text) continue;
      for (const bindingKey of bindingKeys.values()) {
        if (timingSafeEqual(encryptionKey, bindingKey)) throw new CredentialBindingError();
      }
    }
  }
}
