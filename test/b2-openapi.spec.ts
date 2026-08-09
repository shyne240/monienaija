import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const OPENAPI_PATH = join(__dirname, '..', 'docs', 'api', 'B2-OPENAPI-v1.yaml');
const CONTRACT_PATH = join(__dirname, '..', 'docs', 'B2-API-DOCUMENTATION-CONTRACT.md');

describe('B2 OpenAPI 3.1 specification (B2T07)', () => {
  const getYaml = (): string => {
    expect(existsSync(OPENAPI_PATH)).toBe(true);
    return readFileSync(OPENAPI_PATH, 'utf8');
  };

  it('is the single source of truth — OpenAPI 3.1, info 1.0.0, contracted file', () => {
    const yaml = getYaml();
    expect(yaml).toContain('openapi: 3.1.0');
    expect(yaml).toContain('title: MonieNaija B2 Public Commercial Platform');
    expect(yaml).toContain('version: 1.0.0');
    expect(yaml).toContain('B2-PUBLIC-API-CATALOG');
    expect(existsSync(CONTRACT_PATH)).toBe(true);
  });

  it('exactly matches the B2T02 route catalog — ten operations, no drift', () => {
    const yaml = getYaml();
    const expectedOps = [
      'b2.post-commercial-activations',
      'b2.get-commercial-activations-id',
      'b2.get-commercial-catalog',
      'b2.get-commercial-plans-planKey',
      'b2.get-commercial-tiers-tierKey',
      'b2.post-auth-token',
      'b2.post-webhooks-registrations',
      'b2.post-consents',
      'b2.get-health',
      'b2.get-support-read',
    ];
    for (const op of expectedOps) {
      expect(yaml).toContain(op);
    }
    // exactly ten operationId occurrences
    const count = (yaml.match(/operationId:/g) || []).length;
    expect(count).toBe(10);
  });

  it('documents the ten paths with /v1 prefix', () => {
    const yaml = getYaml();
    const paths = [
      '/v1/commercial/activations:',
      '/v1/commercial/activations/{activationReference}:',
      '/v1/commercial/catalog:',
      '/v1/commercial/plans/{planKey}:',
      '/v1/commercial/tiers/{tierKey}:',
      '/v1/auth/token:',
      '/v1/webhooks/registrations:',
      '/v1/consents:',
      '/v1/health:',
      '/v1/support/activations/{activationReference}:',
    ];
    for (const p of paths) {
      expect(yaml).toContain(p);
    }
  });

  it('freezes request/response schemas with examples and additionalProperties: false', () => {
    const yaml = getYaml();
    expect(yaml).toContain('B2ActivationCreateRequest:');
    expect(yaml).toContain('B2TokenRequest:');
    expect(yaml).toContain('B2WebhookRegistrationRequest:');
    expect(yaml).toContain('B2ConsentCreateRequest:');
    expect(yaml).toContain('B2Error:');
    expect(yaml).toContain('additionalProperties: false');
    expect(yaml).toContain('readinessOutcome:');
    expect(yaml).toContain('ATTESTED_READY');
  });

  it('freezes JWT bearer security and audience/scopes per operation', () => {
    const yaml = getYaml();
    expect(yaml).toContain('securitySchemes:');
    expect(yaml).toContain('bearerAuth:');
    expect(yaml).toContain('scheme: bearer');
    expect(yaml).toContain('bearerFormat: JWT');
    expect(yaml).toContain('public:commercial:activation:b2:inbound-funding:write');
    expect(yaml).toContain('public:commercial:activation:b2:inbound-funding:read');
    expect(yaml).toContain('public:webhooks:b2:manage');
    expect(yaml).toContain('public:consents:b2:manage');
    expect(yaml).toContain('public:support:b2:read');
    // anonymous routes have security: []
    expect(yaml).toContain('security: []');
  });

  it('freezes error models (15 B2_API_* codes) and rate limits/quotas/idempotency/headers', () => {
    const yaml = getYaml();
    expect(yaml).toContain('B2_API_MALFORMED');
    expect(yaml).toContain('B2_API_UNAUTHORIZED');
    expect(yaml).toContain('B2_API_FORBIDDEN');
    expect(yaml).toContain('B2_API_IDEMPOTENCY_CONFLICT');
    expect(yaml).toContain('B2_API_RATE_LIMITED');
    expect(yaml).toContain('B2_API_QUOTA_EXCEEDED');
    expect(yaml).toContain('X-RateLimit-Limit');
    expect(yaml).toContain('X-RateLimit-Remaining');
    expect(yaml).toContain('X-Quota-Limit');
    expect(yaml).toContain('X-Quota-Remaining');
    expect(yaml).toContain('Retry-After');
    expect(yaml).toContain('Idempotency-Key');
    expect(yaml).toContain('IdempotencyKey');
    // dedicated scopes per B2T02
    expect(yaml).toContain('b2:commercial:activations:create');
    expect(yaml).toContain('b2:webhooks:registrations:create');
    expect(yaml).toContain('b2:consents:create');
  });

  it('freezes version negotiation (v1 + Accept + B2-Api-Version + Deprecation/Sunset)', () => {
    const yaml = getYaml();
    expect(yaml).toContain('B2-Api-Version');
    expect(yaml).toContain('AcceptHeader');
    expect(yaml).toContain('application/vnd.monienaija.v1+json');
    expect(yaml).toContain('Deprecation');
    expect(yaml).toContain('Sunset');
    expect(yaml).toContain('B2ApiVersion');
  });

  it('documents tags, components, security schemes', () => {
    const yaml = getYaml();
    for (const tag of [
      'commercial-activations',
      'commercial-catalog',
      'authentication',
      'webhooks',
      'consents',
      'health',
      'support',
    ]) {
      expect(yaml).toContain(tag);
    }
    expect(yaml).toContain('components:');
    expect(yaml).toContain('securitySchemes:');
    expect(yaml).toContain('parameters:');
    expect(yaml).toContain('headers:');
    expect(yaml).toContain('responses:');
    expect(yaml).toContain('schemas:');
  });
});
