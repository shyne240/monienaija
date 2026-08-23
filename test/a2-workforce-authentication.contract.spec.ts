import { generateKeyPairSync, sign } from 'node:crypto';
import { getMetadataArgsStorage } from 'typeorm';
import { RoutePolicyRegistry } from '../src/authorization/route-policy-registry';
import {
  A2FinanceRoleAssignment,
  A2SecurityRateBucket,
  A2WorkforceBootstrapConsumption,
  A2WorkforceSession,
} from '../src/authorization/workforce-authentication.entity';
import type { A2TrustedJwkV1 } from '../src/authorization/workforce-authentication.types';
import { workforceConfiguration } from '../src/authorization/workforce-configuration';
import { canonical, parseCompactJws, verifyRs256 } from '../src/authorization/workforce-crypto';
import { CreateA2WorkforceAuthenticationTables1785753600052 } from '../src/migrations/1785753600052-CreateA2WorkforceAuthenticationTables';
const pair = generateKeyPairSync('rsa', { modulusLength: 2048 }),
  jwk = {
    ...pair.publicKey.export({ format: 'jwk' }),
    kid: 'bootstrap-1',
    alg: 'RS256',
    use: 'sig',
    environment: 'test',
  } as A2TrustedJwkV1;
const compact = (payload: Record<string, unknown>, header: Record<string, unknown> = {}) => {
  const h = Buffer.from(
      JSON.stringify({ alg: 'RS256', kid: 'bootstrap-1', typ: 'JWT', ...header }),
    ).toString('base64url'),
    p = Buffer.from(canonical(payload)).toString('base64url'),
    input = `${h}.${p}`;
  return `${input}.${sign('RSA-SHA256', Buffer.from(input), pair.privateKey).toString('base64url')}`;
};
describe('A2T11 workforce trust boundary contract', () => {
  it('canonicalizes bootstrap payload recursively and preserves array order', () =>
    expect(canonical({ z: null, a: { y: 2, x: 1 }, s: ['b', 'a'] })).toBe(
      '{"a":{"x":1,"y":2},"s":["b","a"],"z":null}',
    ));
  it('verifies compact RS256 bootstrap JWS', () => {
    const j = parseCompactJws(compact({ schemaVersion: 1 }));
    expect(() => verifyRs256(j, jwk, new Date())).not.toThrow();
  });
  it('rejects unsupported bootstrap algorithms', () =>
    expect(() => parseCompactJws(compact({}, { alg: 'HS256' }))).toThrow('Unsupported JWS header'));
  it('rejects duplicate JSON claims', () => {
    const h = Buffer.from('{"alg":"RS256","kid":"bootstrap-1"}').toString('base64url'),
      p = Buffer.from('{"a":1,"a":2}').toString('base64url');
    expect(() => parseCompactJws(`${h}.${p}.x`)).toThrow('Duplicate JSON key');
  });
  it('rejects revoked bootstrap keys', () =>
    expect(() =>
      verifyRs256(parseCompactJws(compact({})), { ...jwk, revoked: true }, new Date()),
    ).toThrow('not trusted'));
  it('keeps workforce and customer authentication modes separate', () => {
    const r = new RoutePolicyRegistry();
    expect(
      r.resolve({ method: 'POST', url: '/api/v1/internal/a2/workforce/sessions' })
        .authenticationMode,
    ).toBe('WORKFORCE_ASSERTION');
    expect(
      r.resolve({ method: 'POST', url: '/api/v1/internal/a2/workforce/bootstrap' })
        .authenticationMode,
    ).toBe('WORKFORCE_SESSION');
    expect(
      r.resolve({ method: 'GET', url: '/api/v1/customers/abc' }).authenticationMode,
    ).toBeUndefined();
  });
  it('fails enabled configuration without provider and role evidence', () =>
    expect(() => workforceConfiguration({ A2_WORKFORCE_ENABLED: 'true' })).toThrow(
      'A2_FINANCE_ROLES_JSON',
    ));
  it('does not enable workforce authentication by default', () =>
    expect(workforceConfiguration({}).enabled).toBe(false));
  it('registers four bounded A2T11 persistence aggregates', () => {
    const names = getMetadataArgsStorage()
      .tables.filter((t) =>
        [
          A2WorkforceSession,
          A2FinanceRoleAssignment,
          A2WorkforceBootstrapConsumption,
          A2SecurityRateBucket,
        ].includes(t.target as never),
      )
      .map((t) => t.name)
      .sort();
    expect(names).toEqual([
      'a2_finance_role_assignments',
      'a2_security_rate_buckets',
      'a2_workforce_bootstrap_consumptions',
      'a2_workforce_sessions',
    ]);
  });
  it('migration creates no policy, ledger, B1, mapping, or AR table', async () => {
    const sql: string[] = [];
    await new CreateA2WorkforceAuthenticationTables1785753600052().up({
      query: (q: string) => {
        sql.push(q);
        return Promise.resolve();
      },
    } as never);
    const all = sql.join('\n');
    expect(all).toContain('a2_workforce_sessions');
    expect(all).toContain('a2_finance_role_assignments');
    expect(all).not.toMatch(/b2f_finance_control|ledger_accounts|b1_payment|receivable/);
  });
  it('uses deterministic canonical signatures for identical statements', () =>
    expect(compact({ b: 2, a: 1 })).toBe(compact({ a: 1, b: 2 })));
});
