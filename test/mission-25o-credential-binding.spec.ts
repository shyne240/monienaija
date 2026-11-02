import { randomBytes } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import type { Environment } from '../src/config/environment';
import {
  CredentialBindingError,
  NotificationCredentialBindingService,
} from '../src/notification/notification-credential-binding.service';

describe('M25O independent credential binding', () => {
  const first = randomBytes(32).toString('base64');
  const second = randomBytes(32).toString('base64');
  const secret = `robe_${randomBytes(24).toString('hex')}last`;
  let config: ConfigService<Environment, true>;
  let binding: NotificationCredentialBindingService;
  const originalKeyring = process.env.NOTIFICATION_PROVIDER_BINDING_KEYRING_JSON;
  const originalActive = process.env.NOTIFICATION_PROVIDER_BINDING_ACTIVE_KEY_VERSION;
  const originalEncryptionRing = process.env.NOTIFICATION_PROVIDER_ENCRYPTION_KEYRING_JSON;
  const originalEncryptionKey = process.env.NOTIFICATION_PROVIDER_ENCRYPTION_KEY;

  afterEach(() => {
    if (originalKeyring === undefined) delete process.env.NOTIFICATION_PROVIDER_BINDING_KEYRING_JSON;
    else process.env.NOTIFICATION_PROVIDER_BINDING_KEYRING_JSON = originalKeyring;
    if (originalActive === undefined) delete process.env.NOTIFICATION_PROVIDER_BINDING_ACTIVE_KEY_VERSION;
    else process.env.NOTIFICATION_PROVIDER_BINDING_ACTIVE_KEY_VERSION = originalActive;
    if (originalEncryptionRing === undefined) delete process.env.NOTIFICATION_PROVIDER_ENCRYPTION_KEYRING_JSON;
    else process.env.NOTIFICATION_PROVIDER_ENCRYPTION_KEYRING_JSON = originalEncryptionRing;
    if (originalEncryptionKey === undefined) delete process.env.NOTIFICATION_PROVIDER_ENCRYPTION_KEY;
    else process.env.NOTIFICATION_PROVIDER_ENCRYPTION_KEY = originalEncryptionKey;
  });

  beforeEach(() => {
    config = new ConfigService<Environment, true>({
      NOTIFICATION_PROVIDER_BINDING_KEYRING_JSON: JSON.stringify({ v1: first }),
      NOTIFICATION_PROVIDER_BINDING_ACTIVE_KEY_VERSION: 'v1',
    });
    binding = new NotificationCredentialBindingService(config);
  });

  it('uses deterministic, versioned HMAC without exposing keys or credential', () => {
    const a = binding.create('SMS', 'robase', 'ENV_SECRET', secret);
    const b = binding.create('SMS', 'robase', 'ENV_SECRET', secret);
    expect(a).toEqual(b);
    expect(a.scheme).toBe('HMAC_SHA256_V1');
    expect(a.mac).toMatch(/^[a-f0-9]{64}$/);
    expect(a.mac.includes(secret)).toBe(false);
    expect(a.mac.includes(first)).toBe(false);
    expect(binding.verify(a, 'SMS', 'robase', 'ENV_SECRET', secret)).toBe(true);
  });

  it('binds the full secret, channel, provider and source with domain separation', () => {
    const a = binding.create('SMS', 'robase', 'ENV_SECRET', secret);
    const sameTail = `${randomBytes(24).toString('hex')}last`;
    for (const matches of [
      binding.verify(a, 'SMS', 'robase', 'ENV_SECRET', sameTail),
      binding.verify(a, 'EMAIL', 'robase', 'ENV_SECRET', secret),
      binding.verify(a, 'SMS', 'brevo', 'ENV_SECRET', secret),
      binding.verify(a, 'SMS', 'robase', 'ENCRYPTED_DB', secret),
      binding.verify({ ...a, mac: '0'.repeat(64) }, 'SMS', 'robase', 'ENV_SECRET', secret),
      binding.verify(null, 'SMS', 'robase', 'ENV_SECRET', secret),
    ]) expect(matches).toBe(false);
  });

  it('retains a previous verification version until it is explicitly removed', () => {
    const old = binding.create('SMS', 'robase', 'ENV_SECRET', secret);
    config.set('NOTIFICATION_PROVIDER_BINDING_KEYRING_JSON', JSON.stringify({ v1: first, v2: second }));
    config.set('NOTIFICATION_PROVIDER_BINDING_ACTIVE_KEY_VERSION', 'v2');
    expect(binding.verify(old, 'SMS', 'robase', 'ENV_SECRET', secret)).toBe(true);
    const next = binding.create('SMS', 'robase', 'ENV_SECRET', secret);
    expect(next.keyVersion).toBe('v2');
    expect(next.mac === old.mac).toBe(false);
    config.set('NOTIFICATION_PROVIDER_BINDING_KEYRING_JSON', JSON.stringify({ v2: second }));
    expect(binding.verify(old, 'SMS', 'robase', 'ENV_SECRET', secret)).toBe(false);
    expect(binding.verify(next, 'SMS', 'robase', 'ENV_SECRET', secret)).toBe(true);
  });

  it('rejects reuse of any encryption key from either supported configuration form', () => {
    const old = binding.create('SMS', 'robase', 'ENV_SECRET', secret);
    config.set('NOTIFICATION_PROVIDER_ENCRYPTION_KEY', first);
    expect(() => binding.create('SMS', 'robase', 'ENV_SECRET', secret)).toThrow(CredentialBindingError);
    expect(binding.verify(old, 'SMS', 'robase', 'ENV_SECRET', secret)).toBe(false);
    config.set('NOTIFICATION_PROVIDER_ENCRYPTION_KEY', '');
    config.set('NOTIFICATION_PROVIDER_ENCRYPTION_KEYRING_JSON', JSON.stringify({ retired: first, v2: second }));
    expect(binding.verify(old, 'SMS', 'robase', 'ENV_SECRET', secret)).toBe(false);
    config.set('NOTIFICATION_PROVIDER_ENCRYPTION_KEYRING_JSON', JSON.stringify({ v2: second }));
    expect(binding.verify(old, 'SMS', 'robase', 'ENV_SECRET', secret)).toBe(true);
  });

  it.each([
    ['', 'v1'],
    ['{}', 'v1'],
    ['{broken', 'v1'],
    ['[]', 'v1'],
    [JSON.stringify({ v1: 'short' }), 'v1'],
    [JSON.stringify({ v1: randomBytes(31).toString('base64') }), 'v1'],
    [JSON.stringify({ v1: randomBytes(33).toString('base64') }), 'v1'],
    [JSON.stringify({ v1: randomBytes(32).toString('base64').replace(/=+$/, '') }), 'v1'],
    [JSON.stringify({ 'bad/version': randomBytes(32).toString('base64') }), 'bad/version'],
    [JSON.stringify({ v1: 123 }), 'v1'],
    [JSON.stringify({ v2: randomBytes(32).toString('base64') }), 'v1'],
  ])('fails malformed or unavailable keyrings closed (case %#)', (keyring, active) => {
    const good = binding.create('SMS', 'robase', 'ENV_SECRET', secret);
    config.set('NOTIFICATION_PROVIDER_BINDING_KEYRING_JSON', keyring);
    config.set('NOTIFICATION_PROVIDER_BINDING_ACTIVE_KEY_VERSION', active);
    expect(() => binding.create('SMS', 'robase', 'ENV_SECRET', secret)).toThrow(CredentialBindingError);
    expect(binding.verify(good, 'SMS', 'robase', 'ENV_SECRET', secret)).toBe(false);
  });
});
