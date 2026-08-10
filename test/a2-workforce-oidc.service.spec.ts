import { generateKeyPairSync, sign } from 'node:crypto';
import { A2WorkforceOidcService } from '../src/authorization/workforce-oidc.service';
import type {
  A2TrustedJwkV1,
  A2WorkforceConfigurationV1,
} from '../src/authorization/workforce-authentication.types';
const pair = generateKeyPairSync('rsa', { modulusLength: 2048 }),
  other = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = {
  ...pair.publicKey.export({ format: 'jwk' }),
  kid: 'key-1',
  alg: 'RS256',
  use: 'sig',
} as A2TrustedJwkV1;
const config: A2WorkforceConfigurationV1 = {
  enabled: true,
  environment: 'test',
  oidcIssuer: 'https://workforce.test',
  oidcJwksUri: 'https://workforce.test/jwks',
  oidcAudience: 'a2-workforce',
  oidcClientId: 'a2-client',
  internalAudience: 'workforce-admin',
  sessionTtlSeconds: 900,
  mfaFreshnessSeconds: 300,
  oidcJwksCacheSeconds: 900,
  oidcJwksMaxStalenessSeconds: 3600,
  bootstrapEnabled: true,
  bootstrapIssuer: 'security-change',
  bootstrapAudience: 'a2-bootstrap',
  bootstrapKeys: [],
  bootstrapFinanceAdminScopes: [],
  roles: [],
  makerCheckerRules: [],
  rateLimits: [],
  trustedProxyAddresses: [],
};
const token = (
  claims: Record<string, unknown> = {},
  header: Record<string, unknown> = {},
  key = pair.privateKey,
) => {
  const now = Math.floor(Date.now() / 1000),
    h = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'key-1', typ: 'JWT', ...header })).toString(
      'base64url',
    ),
    p = Buffer.from(
      JSON.stringify({
        iss: config.oidcIssuer,
        sub: 'operator-1',
        aud: config.oidcAudience,
        iat: now,
        exp: now + 300,
        auth_time: now,
        amr: ['mfa'],
        email: 'old@example.test',
        ...claims,
      }),
    ).toString('base64url'),
    input = `${h}.${p}`;
  return `${input}.${sign('RSA-SHA256', Buffer.from(input), key).toString('base64url')}`;
};
describe('A2T11 workforce OIDC validation', () => {
  beforeEach(() => {
    global.fetch = jest
      .fn()
      .mockResolvedValue({ ok: true, json: () => Promise.resolve({ keys: [jwk] }) }) as never;
  });
  it('validates an RS256 ID token and derives stable issuer:subject identity', async () => {
    const e = await new A2WorkforceOidcService(config).validate(token());
    expect(e.principalId).toBe(`${config.oidcIssuer}:operator-1`);
    expect(e.assuranceLevel).toBe('MFA');
  });
  it('email changes do not change identity', async () => {
    const s = new A2WorkforceOidcService(config);
    expect((await s.validate(token({ email: 'new@example.test' }))).principalId).toBe(
      (await s.validate(token({ email: 'other@example.test' }))).principalId,
    );
  });
  it('different subjects produce different identities', async () => {
    const s = new A2WorkforceOidcService(config);
    expect((await s.validate(token({ sub: 'a' }))).principalId).not.toBe(
      (await s.validate(token({ sub: 'b' }))).principalId,
    );
  });
  it('does not trust role or scope claims', async () => {
    const e = await new A2WorkforceOidcService(config).validate(
      token({ roles: ['FINANCE_ADMIN'], scope: 'privileged:execute' }),
    );
    expect(e).not.toHaveProperty('roles');
    expect(e).not.toHaveProperty('scopes');
  });
  it('treats acr alone as PASSWORD', async () =>
    expect(
      (await new A2WorkforceOidcService(config).validate(token({ amr: [], acr: 'high' })))
        .assuranceLevel,
    ).toBe('PASSWORD'));
  it.each([
    ['wrong issuer', { iss: 'https://evil.test' }],
    ['wrong audience', { aud: 'other' }],
    ['expired', { exp: Math.floor(Date.now() / 1000) - 100 }],
    ['old assertion', { iat: Math.floor(Date.now() / 1000) - 400 }],
    ['future nbf', { nbf: Math.floor(Date.now() / 1000) + 120 }],
    ['missing subject', { sub: null }],
  ])('rejects %s', async (_n, claims) =>
    expect(new A2WorkforceOidcService(config).validate(token(claims))).rejects.toThrow(),
  );
  it('requires azp for multiple audiences', async () => {
    await expect(
      new A2WorkforceOidcService(config).validate(token({ aud: [config.oidcAudience, 'other'] })),
    ).rejects.toThrow('azp');
    expect(
      (
        await new A2WorkforceOidcService(config).validate(
          token({ aud: [config.oidcAudience, 'other'], azp: config.oidcClientId }),
        )
      ).principalId,
    ).toContain('operator-1');
  });
  it('rejects wrong algorithm before signature verification', async () =>
    expect(
      new A2WorkforceOidcService(config).validate(token({}, { alg: 'HS256' })),
    ).rejects.toThrow('Unsupported JWS header'));
  it('rejects invalid signature', async () =>
    expect(
      new A2WorkforceOidcService(config).validate(token({}, {}, other.privateKey)),
    ).rejects.toThrow('Invalid RS256 signature'));
  it('requires kid', async () =>
    expect(new A2WorkforceOidcService(config).validate(token({}, { kid: '' }))).rejects.toThrow(
      'Unsupported JWS header',
    ));
  it('refreshes once then fails closed for unknown kid', async () => {
    const f = global.fetch as jest.Mock;
    await expect(
      new A2WorkforceOidcService(config).validate(token({}, { kid: 'unknown' })),
    ).rejects.toThrow('Unknown signing key');
    expect(f).toHaveBeenCalledTimes(1);
  });
  it('fails closed when JWKS is unavailable', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('down'));
    await expect(new A2WorkforceOidcService(config).validate(token())).rejects.toThrow(
      'JWKS unavailable',
    );
  });
});
