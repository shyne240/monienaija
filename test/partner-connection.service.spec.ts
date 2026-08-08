import { ConfigService } from '@nestjs/config';

import { validateEnvironment } from '../src/config/environment';
import { PartnerCapabilityRegistry } from '../src/partner/partner-capability.registry';
import { PartnerConnectionAuditService } from '../src/partner/partner-connection-audit.service';
import { PartnerConnectionService } from '../src/partner/partner-connection.service';
import {
  EnvironmentPartnerCredentialLoader,
  PartnerConfigurationException,
} from '../src/partner/partner-credentials.service';
import { PartnerRequestSigningService } from '../src/partner/partner-request-signing.service';

const BASE_ENVIRONMENT = {
  NODE_ENV: 'test',
  A6_PARTNER_ENABLED: false,
  A6_PARTNER_ENVIRONMENT: 'sandbox',
  A6_PARTNER_KEY: 'NIBSS_NIP',
  A6_PARTNER_CAPABILITY: 'external.wallet.withdrawal.settlement',
  A6_PARTNER_OPERATION_TYPE: 'OUTBOUND_BANK_SETTLEMENT',
  A6_PARTNER_API_VERSION: 'v1',
  A6_PARTNER_ADAPTER_VERSION: 'a6-adapter-1',
  A6_PARTNER_SIGNING_ALGORITHM: 'HMAC_SHA256',
  A6_PARTNER_REQUEST_TIMEOUT_MS: 10_000,
  A6_PARTNER_CONNECT_TIMEOUT_MS: 3_000,
};

function createService(overrides: Record<string, unknown> = {}) {
  const config = new ConfigService({ ...BASE_ENVIRONMENT, ...overrides });
  const credentials = new EnvironmentPartnerCredentialLoader(config);
  const signer = new PartnerRequestSigningService();
  return new PartnerConnectionService(config, new PartnerCapabilityRegistry(), credentials, signer);
}

describe('PartnerConnectionService', () => {
  it('keeps the selected partner disabled without attempting transport configuration', () => {
    const service = createService();

    expect(service.getStatus()).toMatchObject({
      status: 'DISABLED',
      enabled: false,
      partnerKey: 'NIBSS_NIP',
      capabilityKey: 'external.wallet.withdrawal.settlement',
      environment: 'sandbox',
      baseUrlConfigured: false,
      credentialReferenceConfigured: false,
      signingReferenceConfigured: false,
    });
    expect(() => service.assertReadyForTransport()).toThrow('partner capability is disabled');
  });

  it('loads only sandbox credential and signing references for an enabled sandbox profile', () => {
    const service = createService({
      A6_PARTNER_ENABLED: true,
      A6_PARTNER_SANDBOX_BASE_URL: 'https://sandbox.partner.invalid',
      A6_PARTNER_PRODUCTION_BASE_URL: 'https://production.partner.invalid',
      A6_PARTNER_SANDBOX_CREDENTIAL_REFERENCE: 'secret://partner/sandbox/client',
      A6_PARTNER_PRODUCTION_CREDENTIAL_REFERENCE: 'secret://partner/production/client',
      A6_PARTNER_SANDBOX_SIGNING_KEY_REFERENCE: 'secret://partner/sandbox/signing',
      A6_PARTNER_PRODUCTION_SIGNING_KEY_REFERENCE: 'secret://partner/production/signing',
    });

    const profile = service.getProfile();
    expect(profile).toMatchObject({
      enabled: true,
      environment: 'sandbox',
      baseUrl: 'https://sandbox.partner.invalid',
      credentialReference: {
        environment: 'sandbox',
        reference: 'secret://partner/sandbox/client',
      },
      signingKeyReference: {
        environment: 'sandbox',
        reference: 'secret://partner/sandbox/signing',
      },
    });
    expect(profile.credentialReference).not.toHaveProperty('secret');
    expect(profile.signingKeyReference).not.toHaveProperty('secret');
    expect(service.getStatus().status).toBe('READY_FOR_TRANSPORT');
  });

  it('rejects production partner selection outside a production process', () => {
    const service = createService({
      A6_PARTNER_ENVIRONMENT: 'production',
      A6_PARTNER_PRODUCTION_BASE_URL: 'https://production.partner.invalid',
      A6_PARTNER_PRODUCTION_CREDENTIAL_REFERENCE: 'secret://partner/production/client',
      A6_PARTNER_PRODUCTION_SIGNING_KEY_REFERENCE: 'secret://partner/production/signing',
    });

    expect(() => service.getProfile()).toThrow(PartnerConfigurationException);
    expect(service.getStatus()).toMatchObject({
      status: 'PRODUCTION_CONFIGURATION_FORBIDDEN',
      environment: 'production',
    });
  });

  it('fails closed when an enabled environment lacks a credential or signing reference', () => {
    const service = createService({
      A6_PARTNER_ENABLED: true,
      A6_PARTNER_SANDBOX_BASE_URL: 'https://sandbox.partner.invalid',
    });

    expect(service.getStatus()).toMatchObject({
      status: 'CREDENTIAL_REFERENCE_MISSING',
      enabled: false,
    });
  });

  it('prepares a signing context without exposing signing material or contacting a provider', () => {
    const service = createService({
      A6_PARTNER_ENABLED: true,
      A6_PARTNER_SANDBOX_BASE_URL: 'https://sandbox.partner.invalid',
      A6_PARTNER_SANDBOX_CREDENTIAL_REFERENCE: 'secret://partner/sandbox/client',
      A6_PARTNER_SANDBOX_SIGNING_KEY_REFERENCE: 'secret://partner/sandbox/signing',
    });

    const prepared = service.prepareSigning(
      'A'.repeat(64),
      'request-1',
      'correlation-1',
      '2026-08-08T00:00:00.000Z',
    );

    expect(prepared.status).toBe('PREPARED');
    expect(prepared.input).toMatchObject({
      partnerKey: 'NIBSS_NIP',
      environment: 'sandbox',
      algorithm: 'HMAC_SHA256',
      canonicalPayloadHash: 'a'.repeat(64),
      requestId: 'request-1',
      correlationId: 'correlation-1',
    });
    expect(prepared.input.keyReference.reference).toBe('secret://partner/sandbox/signing');
    expect(prepared).not.toHaveProperty('secret');
  });

  it('rejects an invalid signing payload hash before any transport boundary', () => {
    const service = createService({
      A6_PARTNER_ENABLED: true,
      A6_PARTNER_SANDBOX_BASE_URL: 'https://sandbox.partner.invalid',
      A6_PARTNER_SANDBOX_CREDENTIAL_REFERENCE: 'secret://partner/sandbox/client',
      A6_PARTNER_SANDBOX_SIGNING_KEY_REFERENCE: 'secret://partner/sandbox/signing',
    });

    expect(() => service.prepareSigning('not-a-hash', 'request-1', 'correlation-1')).toThrow(
      'payload hash is invalid',
    );
  });
});

describe('A6 partner capability and environment contracts', () => {
  it('registers only the selected NIBSS/NIP capability', () => {
    const registry = new PartnerCapabilityRegistry();

    expect(registry.list()).toHaveLength(1);
    expect(registry.list()[0]).toMatchObject({
      partnerKey: 'NIBSS_NIP',
      capabilityKey: 'external.wallet.withdrawal.settlement',
      operationType: 'OUTBOUND_BANK_SETTLEMENT',
      supportedCurrencies: ['NGN'],
      supportedTargetTypes: ['BANK_ACCOUNT'],
      environments: ['sandbox', 'production'],
    });
    expect(() =>
      registry.assertCompatible(
        'NIBSS_NIP',
        'external.wallet.withdrawal.settlement',
        'OUTBOUND_BANK_SETTLEMENT',
        'USD',
      ),
    ).toThrow('does not support the currency');
  });

  it('requires distinct sandbox and production endpoints and references when enabled', () => {
    const valid = {
      DB_HOST: 'localhost',
      DB_NAME: 'monienaija',
      DB_USER: 'monienaija',
      DB_PASSWORD: 'local-password',
      NODE_ENV: 'test',
      A6_PARTNER_ENABLED: 'true',
      A6_PARTNER_ENVIRONMENT: 'sandbox',
      A6_PARTNER_SANDBOX_BASE_URL: 'https://sandbox.partner.invalid',
      A6_PARTNER_PRODUCTION_BASE_URL: 'https://production.partner.invalid',
      A6_PARTNER_SANDBOX_CREDENTIAL_REFERENCE: 'secret://partner/sandbox/client',
      A6_PARTNER_PRODUCTION_CREDENTIAL_REFERENCE: 'secret://partner/production/client',
      A6_PARTNER_SANDBOX_SIGNING_KEY_REFERENCE: 'secret://partner/sandbox/signing',
      A6_PARTNER_PRODUCTION_SIGNING_KEY_REFERENCE: 'secret://partner/production/signing',
      A6_PARTNER_SANDBOX_CALLBACK_SECRET: 'sandbox-callback-secret-123',
      A6_PARTNER_PRODUCTION_CALLBACK_SECRET: 'production-callback-secret-123',
    };

    expect(validateEnvironment(valid)).toMatchObject({
      A6_PARTNER_ENABLED: true,
      A6_PARTNER_ENVIRONMENT: 'sandbox',
    });
    expect(() =>
      validateEnvironment({
        ...valid,
        A6_PARTNER_SANDBOX_BASE_URL: 'https://same.partner.invalid',
        A6_PARTNER_PRODUCTION_BASE_URL: 'https://same.partner.invalid',
      }),
    ).toThrow('Sandbox and production partner endpoints must be different');
  });
});

describe('PartnerConnectionAuditService', () => {
  it('uses the shared Operations audit contract with safe configuration metadata', async () => {
    const auditService = { record: jest.fn().mockResolvedValue(undefined) };
    const service = new PartnerConnectionAuditService(auditService as never);

    await service.record({} as never, {
      action: 'PARTNER_CONFIGURATION_VALIDATED',
      partnerKey: 'NIBSS_NIP',
      capabilityKey: 'external.wallet.withdrawal.settlement',
      operationType: 'OUTBOUND_BANK_SETTLEMENT',
      environment: 'sandbox',
      status: 'READY_FOR_TRANSPORT',
      adapterVersion: 'a6-adapter-1',
      apiVersion: 'v1',
      correlationId: 'correlation-1',
      requestId: 'request-1',
    });

    expect(auditService.record).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        entityType: 'A6_PARTNER_CONNECTION',
        action: 'PARTNER_CONFIGURATION_VALIDATED',
      }),
    );
    const calls = auditService.record.mock.calls as unknown as Array<
      [unknown, { newValues?: Record<string, unknown> }]
    >;
    const newValues = calls[0]?.[1].newValues;
    expect(newValues?.partnerKey).toBe('NIBSS_NIP');
    expect(newValues?.environment).toBe('sandbox');
    expect(newValues?.status).toBe('READY_FOR_TRANSPORT');
    expect(newValues).not.toHaveProperty('secret');
  });
});
