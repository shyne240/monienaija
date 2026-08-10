import { workforceConfiguration } from '../src/authorization/workforce-configuration';

const roles = [
  role('FINANCE_ADMIN', ['privileged:execute'], {
    administrativeCapability: true,
    makerEligible: true,
    applicableActions: ['FINANCE_ROLE_ASSIGN', 'FINANCE_ROLE_REVOKE'],
  }),
  role('FINANCE_PREPARER', ['finance:prepare'], {
    makerEligible: true,
    applicableActions: ['FINANCE_CONTROL_POLICY_ACTIVATE'],
  }),
  role('FINANCE_CONTROLLER', ['privileged:approve', 'privileged:execute'], {
    approvalCapability: true,
    checkerEligible: true,
    applicableActions: [
      'FINANCE_ROLE_ASSIGN',
      'FINANCE_ROLE_REVOKE',
      'FINANCE_CONTROL_POLICY_ACTIVATE',
    ],
  }),
  role('FINANCE_AUDITOR', ['finance:audit']),
];
const rules = ['FINANCE_ROLE_ASSIGN', 'FINANCE_ROLE_REVOKE', 'FINANCE_CONTROL_POLICY_ACTIVATE'].map(
  (action) => ({
    action,
    initiatingRoles: [
      action === 'FINANCE_CONTROL_POLICY_ACTIVATE' ? 'FINANCE_PREPARER' : 'FINANCE_ADMIN',
    ],
    approvingRoles: ['FINANCE_CONTROLLER'],
    minimumApprovals: 1,
    separationRequired: true,
    selfApprovalProhibited: true,
    mfaRequired: true,
    minimumAssurance: 'MFA',
    materialityRequired: false,
  }),
);
const rates = [
  'workforce-authentication',
  'workforce-bootstrap',
  'finance-role-administration',
  'privileged-approval',
].map((category) => ({ category, capacity: 10, refillRatePerSecond: 1, enabled: true }));
function role(roleKey: string, scopes: string[], overrides: Record<string, unknown> = {}) {
  return {
    roleKey,
    displayName: roleKey,
    description: `${roleKey} description`,
    enabled: true,
    scopes,
    applicableActions: [],
    mfaRequired: true,
    approvalCapability: false,
    makerEligible: false,
    checkerEligible: false,
    administrativeCapability: false,
    ...overrides,
  };
}
function valid(overrides: Record<string, string | undefined> = {}) {
  return {
    NODE_ENV: 'production',
    A2_WORKFORCE_ENABLED: 'true',
    A2_WORKFORCE_OIDC_ISSUER: 'https://identity.example',
    A2_WORKFORCE_OIDC_JWKS_URI: 'https://identity.example/jwks',
    A2_WORKFORCE_OIDC_AUDIENCE: 'workforce',
    A2_WORKFORCE_OIDC_CLIENT_ID: 'client',
    A2_WORKFORCE_INTERNAL_AUDIENCE: 'workforce-admin',
    A2_WORKFORCE_SESSION_TTL_SECONDS: '900',
    A2_BOOTSTRAP_ENABLED: 'false',
    A2_BOOTSTRAP_ADMIN_SCOPES_JSON: JSON.stringify(['privileged:execute']),
    A2_BOOTSTRAP_JWKS_JSON: '[]',
    A2_FINANCE_ROLES_JSON: JSON.stringify(roles),
    A2_MAKER_CHECKER_RULES_JSON: JSON.stringify(rules),
    A2_WORKFORCE_RATE_LIMITS_JSON: JSON.stringify(rates),
    A2_TRUSTED_PROXY_ADDRESSES_JSON: JSON.stringify(['127.0.0.1', '10.0.0.0/8', '::1/128']),
    ...overrides,
  };
}

describe('A2T11 workforce configuration validation', () => {
  it('accepts a complete coherent configuration', () =>
    expect(workforceConfiguration(valid())).toMatchObject({
      enabled: true,
      sessionTtlSeconds: 900,
      roles,
      makerCheckerRules: rules,
      rateLimits: rates,
    }));
  it('keeps disabled configuration safely empty', () =>
    expect(workforceConfiguration({}).enabled).toBe(false));
  it('rejects missing required settings', () =>
    expect(() => workforceConfiguration(valid({ A2_WORKFORCE_OIDC_ISSUER: undefined }))).toThrow(
      'A2_WORKFORCE_OIDC_ISSUER',
    ));
  it('rejects malformed JSON without exposing its value', () =>
    expect(() => workforceConfiguration(valid({ A2_FINANCE_ROLES_JSON: '{secret' }))).toThrow(
      'A2_FINANCE_ROLES_JSON: malformed JSON',
    ));
  it('rejects wrong field types', () =>
    expect(() =>
      workforceConfiguration(valid({ A2_FINANCE_ROLES_JSON: JSON.stringify([{ roleKey: 1 }]) })),
    ).toThrow('A2_FINANCE_ROLES_JSON'));
  it('rejects duplicate role keys', () => {
    const changed = [...roles.slice(0, 3), roles[0]];
    expect(() =>
      workforceConfiguration(valid({ A2_FINANCE_ROLES_JSON: JSON.stringify(changed) })),
    ).toThrow('duplicate role key');
  });
  it('rejects duplicate role scopes', () => {
    const changed = roles.map((item, index) => (index ? item : { ...item, scopes: ['x', 'x'] }));
    expect(() =>
      workforceConfiguration(valid({ A2_FINANCE_ROLES_JSON: JSON.stringify(changed) })),
    ).toThrow('must be unique');
  });
  it('rejects undefined role references', () => {
    const changed = rules.map((item, index) =>
      index ? item : { ...item, initiatingRoles: ['UNKNOWN'] },
    );
    expect(() =>
      workforceConfiguration(valid({ A2_MAKER_CHECKER_RULES_JSON: JSON.stringify(changed) })),
    ).toThrow('undefined role');
  });
  it('rejects disabled referenced roles', () => {
    const changed = roles.map((item) =>
      item.roleKey === 'FINANCE_CONTROLLER' ? { ...item, enabled: false } : item,
    );
    expect(() =>
      workforceConfiguration(valid({ A2_FINANCE_ROLES_JSON: JSON.stringify(changed) })),
    ).toThrow('disabled role');
  });
  it('rejects invalid approval counts', () => {
    const changed = rules.map((item, index) => (index ? item : { ...item, minimumApprovals: 0 }));
    expect(() =>
      workforceConfiguration(valid({ A2_MAKER_CHECKER_RULES_JSON: JSON.stringify(changed) })),
    ).toThrow('minimumApprovals');
  });
  it('rejects inconsistent separation', () => {
    const changed = rules.map((item, index) =>
      index ? item : { ...item, selfApprovalProhibited: false },
    );
    expect(() =>
      workforceConfiguration(valid({ A2_MAKER_CHECKER_RULES_JSON: JSON.stringify(changed) })),
    ).toThrow('selfApprovalProhibited');
  });
  it('rejects invalid rate-limit values', () => {
    const changed = rates.map((item, index) => (index ? item : { ...item, capacity: 0 }));
    expect(() =>
      workforceConfiguration(valid({ A2_WORKFORCE_RATE_LIMITS_JSON: JSON.stringify(changed) })),
    ).toThrow('capacity');
  });
  it('requires every protected rate-limit category', () =>
    expect(() =>
      workforceConfiguration(
        valid({ A2_WORKFORCE_RATE_LIMITS_JSON: JSON.stringify(rates.slice(1)) }),
      ),
    ).toThrow('A2_WORKFORCE_RATE_LIMITS_JSON'));
  it('rejects malformed bootstrap keys', () => {
    const item = bootstrapKey({ kty: 'EC' });
    expect(() =>
      workforceConfiguration(valid({ A2_BOOTSTRAP_JWKS_JSON: JSON.stringify([item]) })),
    ).toThrow('A2_BOOTSTRAP_JWKS_JSON');
  });
  it('rejects duplicate bootstrap key IDs', () => {
    const item = bootstrapKey();
    expect(() =>
      workforceConfiguration(valid({ A2_BOOTSTRAP_JWKS_JSON: JSON.stringify([item, item]) })),
    ).toThrow('duplicate key ID');
  });
  it('rejects bootstrap scope mismatch', () =>
    expect(() =>
      workforceConfiguration(valid({ A2_BOOTSTRAP_ADMIN_SCOPES_JSON: JSON.stringify(['other']) })),
    ).toThrow('must exactly match'));
  it('rejects malformed trusted proxies', () =>
    expect(() =>
      workforceConfiguration(
        valid({ A2_TRUSTED_PROXY_ADDRESSES_JSON: JSON.stringify(['not-an-ip']) }),
      ),
    ).toThrow('IP address or CIDR'));
  it.each(['0', '59', '3601', 'NaN'])('rejects unsafe session TTL %s', (ttl) =>
    expect(() => workforceConfiguration(valid({ A2_WORKFORCE_SESSION_TTL_SECONDS: ttl }))).toThrow(
      'A2_WORKFORCE_SESSION_TTL_SECONDS',
    ),
  );
  it('requires HTTPS OIDC endpoints in production', () =>
    expect(() =>
      workforceConfiguration(valid({ A2_WORKFORCE_OIDC_JWKS_URI: 'http://identity.example/jwks' })),
    ).toThrow('HTTPS required'));
});
function bootstrapKey(overrides: Record<string, unknown> = {}) {
  return {
    kid: 'k',
    kty: 'RSA',
    n: 'a'.repeat(64),
    e: 'AQAB',
    alg: 'RS256',
    use: 'sig',
    environment: 'production',
    ...overrides,
  };
}
