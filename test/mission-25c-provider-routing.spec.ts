/* eslint-disable @typescript-eslint/require-await */
import { randomBytes } from 'node:crypto';
import { Logger, ServiceUnavailableException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { DataSource } from 'typeorm';

import type { AuthorizationPrincipal } from '../src/authorization/authorization.types';
import type { Environment } from '../src/config/environment';
import { NotificationProviderConfigService, type ProviderHttpFetchFn } from '../src/notification/notification-provider-config.service';
import { NotificationSecretEncryptionService } from '../src/notification/notification-secret-encryption.service';
import type { NotificationSendRequest } from '../src/notification/notification.types';

const SMS_KEY = `robe_${'a1'.repeat(32)}`;
const EMAIL_KEY = `xkeysib-${'b2'.repeat(32)}`;
const RESEND_KEY = `re_${'c3'.repeat(20)}`;
const ENCRYPTION_KEY = randomBytes(32).toString('base64');
const SECRET_IN_DRIVER_ERROR = 'DRIVER_SECRET_SENTINEL_25C';

type Channel = 'SMS' | 'EMAIL';
function providerRow(channel: Channel, overrides: Record<string, unknown> = {}) {
  return {
    channel, provider: channel === 'SMS' ? 'robase' : 'brevo', enabled: true,
    base_url: channel === 'SMS' ? 'https://api.robase.dev' : 'https://api.brevo.com',
    request_timeout_ms: 1000, sender_id: null,
    from_email: channel === 'EMAIL' ? 'sender@example.test' : null,
    from_name: null, reply_to_email: null, credential_source: 'ENV_SECRET',
    encrypted_api_key: null, encryption_key_version: null, key_fingerprint: null,
    spf_configured: false, dkim_configured: false, dmarc_configured: false,
    verified_at: null, verified_by: null, verification_method: null, last_verification_error: null,
    delivery_tested_at: null, delivery_tested_by: null, last_test_status: null,
    last_test_destination_masked: null, last_test_provider_ref: null, last_test_error_code: null,
    last_test_at: null, version: 1, active_proposal_id: null, updated_by: 'maker',
    approved_by: 'checker', created_at: new Date(), updated_at: new Date(), ...overrides,
  };
}
function requestFor(channel: Channel): NotificationSendRequest {
  return {
    channel, destination: channel === 'SMS' ? '+2348012345678' : 'customer@example.test',
    message: 'Synthetic test message', subject: 'Synthetic update', payload: {},
    eventType: 'transfer.completed', eventKey: 'transfer.completed:test-1',
    recipientType: 'CUSTOMER', recipientId: 'a1b2c3d4-0000-4000-8000-000000000000',
  };
}

function setup(overrides: Record<string, unknown> = {}) {
  const values: Record<string, unknown> = {
    NODE_ENV: 'test', NOTIFICATION_SMS_PROVIDER: 'robase', NOTIFICATION_EMAIL_PROVIDER: 'brevo',
    ROBASE_API_KEY: SMS_KEY, BREVO_API_KEY: EMAIL_KEY, RESEND_API_KEY: RESEND_KEY,
    NOTIFICATION_EMAIL_FROM: 'sender@example.test', NOTIFICATION_PROVIDER_ENCRYPTION_KEY: ENCRYPTION_KEY,
    ...overrides,
  };
  const config = { get: (key: string) => values[key] } as unknown as ConfigService<Environment, true>;
  const state: { SMS: unknown; EMAIL: unknown; failure: boolean } = {
    SMS: providerRow('SMS'), EMAIL: providerRow('EMAIL'), failure: false,
  };
  const ds = {
    isInitialized: true,
    query: jest.fn(async (_sql: string, params?: unknown[]) => {
      if (state.failure) throw new Error(`SQL/credential ${SECRET_IN_DRIVER_ERROR}`);
      if (params?.[0] === 'SMS') return state.SMS === null ? [] : [state.SMS];
      if (params?.[0] === 'EMAIL') return state.EMAIL === null ? [] : [state.EMAIL];
      return [state.SMS, state.EMAIL].filter((row) => row !== null);
    }),
  };
  const transport = jest.fn<ReturnType<ProviderHttpFetchFn>, Parameters<ProviderHttpFetchFn>>(async () => ({
    ok: true, status: 201, json: async () => ({ id: 'fake-sms-id', messageId: 'fake-email-id' }),
  }));
  const service = new NotificationProviderConfigService(config, new NotificationSecretEncryptionService(config as unknown as ConfigService),
    ds as unknown as DataSource, undefined, undefined, transport);
  return { service, state, ds, transport, values, config };
}

describe('Mission 25C: governed provider routing fails closed', () => {
  it('does not advertise cached environment providers before governance has been read', () => {
    const { service } = setup();
    expect(service.getActiveSmsProviderNameSync()).toBe('none');
    expect(service.getActiveEmailProviderNameSync()).toBe('none');
  });

  it('disabled governed SMS and EMAIL win over valid legacy environment credentials', async () => {
    const { service, state, transport } = setup();
    state.SMS = providerRow('SMS', { enabled: false });
    state.EMAIL = providerRow('EMAIL', { enabled: false });
    await service.refreshRuntimeCache();
    expect(service.getActiveSmsProviderNameSync()).toBe('none');
    expect(service.getActiveEmailProviderNameSync()).toBe('none');
    expect(await service.sendSms(requestFor('SMS'))).toEqual({ success: false, error: 'SMS_PROVIDER_DISABLED' });
    expect(await service.sendEmail(requestFor('EMAIL'))).toEqual({ success: false, error: 'EMAIL_PROVIDER_DISABLED' });
    expect(transport).not.toHaveBeenCalled();
  });

  it('marks a console result as simulated even if the synchronous provider name is stale', async () => {
    const { service, state, transport } = setup();
    await service.refreshRuntimeCache();
    expect(service.getActiveSmsProviderNameSync()).toBe('robase');
    state.SMS = providerRow('SMS', { provider: 'console', credential_source: 'NONE' });
    const result = await service.sendSms(requestFor('SMS'));
    expect(result).toMatchObject({ success: true, simulated: true });
    expect(transport).not.toHaveBeenCalled();
  });

  it('does not use environment-only external credentials when a successfully read table has no governed row', async () => {
    const { service, state, transport } = setup();
    state.SMS = null;
    state.EMAIL = null;
    await service.refreshRuntimeCache();
    expect(service.getActiveSmsProviderNameSync()).toBe('none');
    expect(service.getActiveEmailProviderNameSync()).toBe('none');
    expect((await service.sendSms(requestFor('SMS'))).success).toBe(false);
    expect((await service.sendEmail(requestFor('EMAIL'))).success).toBe(false);
    const overview = await service.getOverview();
    expect(overview.sms).toMatchObject({ source: 'ENVIRONMENT', enabled: false, lifecycleState: 'NOT_CONFIGURED', gates: { configured: false, enabled: false } });
    expect(overview.email).toMatchObject({ source: 'ENVIRONMENT', enabled: false, lifecycleState: 'NOT_CONFIGURED', gates: { configured: false, enabled: false } });
    expect(transport).not.toHaveBeenCalled();
  });

  it('stops after a read failure, clears previously active cache, and exposes only a sanitized 503', async () => {
    const { service, state, transport } = setup();
    await service.refreshRuntimeCache();
    expect(service.getActiveSmsProviderNameSync()).toBe('robase');
    expect(service.getActiveEmailProviderNameSync()).toBe('brevo');
    state.failure = true;
    await expect(service.refreshRuntimeCache()).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(service.getActiveSmsProviderNameSync()).toBe('none');
    expect(service.getActiveEmailProviderNameSync()).toBe('none');
    expect(await service.sendSms(requestFor('SMS'))).toEqual({ success: false, error: 'SMS_PROVIDER_NOT_CONFIGURED' });
    expect(await service.sendEmail(requestFor('EMAIL'))).toEqual({ success: false, error: 'EMAIL_PROVIDER_NOT_CONFIGURED' });
    try {
      await service.getOverview();
      throw new Error('Expected a sanitized 503');
    } catch (error) {
      expect(error).toBeInstanceOf(ServiceUnavailableException);
      expect(JSON.stringify((error as ServiceUnavailableException).getResponse())).not.toContain(SECRET_IN_DRIVER_ERROR);
      expect(JSON.stringify((error as ServiceUnavailableException).getResponse())).not.toContain(SMS_KEY);
    }
    expect(transport).not.toHaveBeenCalled();
  });

  it.each([
    ['invalid boolean', { enabled: 'false' }],
    ['unknown provider', { provider: 'not-governed' }],
    ['invalid credential source', { credential_source: 'GARBAGE' }],
    ['invalid timeout', { request_timeout_ms: -1 }],
    ['missing encrypted envelope', { credential_source: 'ENCRYPTED_DB' }],
  ])('rejects a corrupt SMS row (%s) without falling back', async (_name, changes) => {
    const { service, state, transport } = setup();
    state.SMS = providerRow('SMS', changes);
    await expect(service.refreshRuntimeCache()).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect((await service.sendSms(requestFor('SMS'))).success).toBe(false);
    expect(transport).not.toHaveBeenCalled();
  });

  it('rejects a corrupt EMAIL row and an unreadable encrypted SMS secret with no environment fallback', async () => {
    const { service, state, transport } = setup();
    state.EMAIL = providerRow('EMAIL', { enabled: 'false' });
    expect((await service.sendEmail(requestFor('EMAIL'))).success).toBe(false);
    state.SMS = providerRow('SMS', { credential_source: 'ENCRYPTED_DB', encrypted_api_key: 'MNNPS1:invalid',
      encryption_key_version: 'v1', key_fingerprint: '****abcd' });
    expect((await service.sendSms(requestFor('SMS'))).success).toBe(false);
    expect(transport).not.toHaveBeenCalled();
  });

  it.each([
    ['SMS', 'ROBASE_API_KEY', 'malformed-rotated-sms-SENTINEL', 'robase'],
    ['EMAIL', 'RESEND_API_KEY', 'malformed-rotated-email-SENTINEL', 'resend'],
    ['EMAIL', 'BREVO_API_KEY', 'xsmtpsib-malformed-brevo-SENTINEL', 'brevo'],
  ] as const)(
    'rejects malformed rotated %s environment credentials for %s before any transport',
    async (channel, secretName, invalidSecret, provider) => {
      const { service, state, values, transport } = setup();
      values[secretName] = invalidSecret;
      if (provider === 'resend') {
        state.EMAIL = providerRow('EMAIL', { provider, base_url: 'https://api.resend.com' });
      }
      const result = channel === 'SMS'
        ? await service.sendSms(requestFor('SMS'))
        : await service.sendEmail(requestFor('EMAIL'));
      expect(result).toEqual({ success: false, error: 'PROVIDER_FAILURE' });
      const overview = await service.getOverview();
      const snapshot = channel === 'SMS' ? overview.sms : overview.email;
      expect(snapshot.gates.configured).toBe(false);
      expect(snapshot.misconfigurationCode).toBe('PROVIDER_FAILURE');
      expect(JSON.stringify({ result, overview })).not.toContain(invalidSecret);
      expect(transport).not.toHaveBeenCalled();
    },
  );

  it('rejects a decryptable but malformed database credential without exposing it', async () => {
    const { service, state, config, transport } = setup();
    const invalidSecret = 'malformed-decrypted-email-SENTINEL';
    const encrypted = new NotificationSecretEncryptionService(config as unknown as ConfigService)
      .encrypt(invalidSecret, 'EMAIL');
    state.EMAIL = providerRow('EMAIL', { credential_source: 'ENCRYPTED_DB',
      encrypted_api_key: encrypted.envelope, encryption_key_version: encrypted.keyVersion,
      key_fingerprint: encrypted.fingerprint });
    const result = await service.sendEmail(requestFor('EMAIL'));
    const overview = await service.getOverview();
    expect(result).toEqual({ success: false, error: 'PROVIDER_FAILURE' });
    expect(overview.email.gates.configured).toBe(false);
    expect(overview.email.misconfigurationCode).toBe('PROVIDER_FAILURE');
    expect(JSON.stringify({ result, overview })).not.toContain(invalidSecret);
    expect(JSON.stringify({ result, overview })).not.toContain(encrypted.envelope);
    expect(transport).not.toHaveBeenCalled();
  });

  it.each([
    ['SMS', { base_url: null }],
    ['EMAIL', { base_url: null }],
    ['EMAIL', { from_email: 'invalid-sender-SENTINEL' }],
    ['EMAIL', { reply_to_email: 'invalid-reply-SENTINEL' }],
  ] as const)('rejects incomplete or corrupt %s external routing metadata', async (channel, fields) => {
    const { service, state, transport } = setup();
    state[channel] = providerRow(channel, fields);
    const result = channel === 'SMS'
      ? await service.sendSms(requestFor('SMS'))
      : await service.sendEmail(requestFor('EMAIL'));
    expect(result.success).toBe(false);
    const overview = await service.getOverview();
    const snapshot = channel === 'SMS' ? overview.sms : overview.email;
    expect(snapshot.gates.configured).toBe(false);
    expect(transport).not.toHaveBeenCalled();
  });

  it.each([
    ['SMS', { base_url: null }, 'PROVIDER_NOT_CONFIGURED'],
    ['EMAIL', { base_url: null }, 'PROVIDER_NOT_CONFIGURED'],
    ['EMAIL', { from_email: 'invalid-sender-SENTINEL' }, 'EMAIL_SENDER_NOT_CONFIGURED'],
    ['EMAIL', { reply_to_email: 'invalid-reply-SENTINEL' }, 'EMAIL_SENDER_NOT_CONFIGURED'],
  ] as const)('rejects invalid %s metadata before verification or transport', async (channel, fields, errorCode) => {
    const { service, state, transport } = setup();
    state[channel] = providerRow(channel, fields);
    const principal: AuthorizationPrincipal = {
      type: 'PRIVILEGED', principalId: 'isolated-test', roles: [], scopes: [], customerAccess: 'NONE',
    };
    await expect(service.verifyChannelConfiguration(principal, channel)).rejects.toThrow(errorCode);
    expect(transport).not.toHaveBeenCalled();
  });

  it('treats non-boolean persisted DNS flags as corrupt configuration', async () => {
    const { service, state, transport } = setup();
    state.EMAIL = providerRow('EMAIL', { spf_configured: 'true' });
    await expect(service.getOverview()).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect((await service.sendEmail(requestFor('EMAIL'))).success).toBe(false);
    expect(transport).not.toHaveBeenCalled();
  });

  it('fails closed if the DataSource is missing or not initialized', async () => {
    const { config, ds, transport } = setup();
    for (const source of [undefined, { ...ds, isInitialized: false } as unknown as DataSource]) {
      const service = new NotificationProviderConfigService(config, new NotificationSecretEncryptionService(config as unknown as ConfigService),
        source, undefined, undefined, transport);
      await expect(service.refreshRuntimeCache()).rejects.toBeInstanceOf(ServiceUnavailableException);
      expect((await service.sendSms(requestFor('SMS'))).success).toBe(false);
      expect((await service.sendEmail(requestFor('EMAIL'))).success).toBe(false);
    }
    expect(transport).not.toHaveBeenCalled();
  });

  it('supports an enabled governed ENV_SECRET row with fake transport, and re-reads a subsequent disable', async () => {
    const { service, state, transport } = setup();
    const log = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    try {
      await service.refreshRuntimeCache();
      expect((await service.sendSms(requestFor('SMS'))).success).toBe(true);
      expect((await service.sendEmail(requestFor('EMAIL'))).success).toBe(true);
      expect(transport).toHaveBeenCalledTimes(2); // fake function, no network
      state.SMS = providerRow('SMS', { enabled: false });
      state.EMAIL = providerRow('EMAIL', { enabled: false });
      expect((await service.sendSms(requestFor('SMS'))).success).toBe(false);
      expect((await service.sendEmail(requestFor('EMAIL'))).success).toBe(false);
      expect(transport).toHaveBeenCalledTimes(2);
    } finally { log.mockRestore(); }
  });

  it('re-masks historical provider-test destinations and actor identifiers on authorized status projections', async () => {
    const { service, state } = setup();
    state.SMS = providerRow('SMS', { last_test_destination_masked: '+2348012345678',
      updated_by: 'email:person@example.test', approved_by: 'otp=123456' });
    state.EMAIL = providerRow('EMAIL', { last_test_destination_masked: 'secretperson@example.test' });
    const overview = await service.getOverview();
    expect(overview.sms.lastTest.destinationMasked).toBe('+**********678');
    expect(overview.email.lastTest.destinationMasked).toBe('se***@example.test');
    expect(overview.sms.updatedBy).toBe('[REDACTED]');
    expect(overview.sms.approvedBy).toBe('[REDACTED]');
    expect(JSON.stringify(overview)).not.toContain('person@example.test');
    expect(JSON.stringify(overview)).not.toContain('+2348012345678');
    expect(JSON.stringify(overview)).not.toContain('123456');
  });

  it('retains only non-production console simulation when the table is readable and empty', async () => {
    const test = setup({ NOTIFICATION_SMS_PROVIDER: 'console', NOTIFICATION_EMAIL_PROVIDER: 'console' });
    test.state.SMS = null; test.state.EMAIL = null;
    const output = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      await test.service.refreshRuntimeCache();
      expect((await test.service.sendSms(requestFor('SMS'))).success).toBe(true);
      expect((await test.service.sendEmail(requestFor('EMAIL'))).success).toBe(true);
      test.state.failure = true;
      expect((await test.service.sendSms(requestFor('SMS'))).success).toBe(false);
      expect((await test.service.sendEmail(requestFor('EMAIL'))).success).toBe(false);
      expect(test.transport).not.toHaveBeenCalled();
      const prod = setup({ NODE_ENV: 'production', NOTIFICATION_SMS_PROVIDER: 'console', NOTIFICATION_EMAIL_PROVIDER: 'console' });
      prod.state.SMS = null; prod.state.EMAIL = null;
      expect((await prod.service.sendSms(requestFor('SMS'))).success).toBe(false);
      expect((await prod.service.sendEmail(requestFor('EMAIL'))).success).toBe(false);
    } finally { output.mockRestore(); }
  });
});
