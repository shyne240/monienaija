import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import type {
  A2TrustedJwkV1,
  A2WorkforceAssertionEvidenceV1,
  A2WorkforceConfigurationV1,
} from './workforce-authentication.types';
import { instant, parseCompactJws, text, verifyRs256 } from './workforce-crypto';
export const A2_WORKFORCE_CONFIG = 'A2_WORKFORCE_CONFIG';
type Cache = { keys: A2TrustedJwkV1[]; confirmedAt: number; refreshAt: number };
@Injectable()
export class A2WorkforceOidcService {
  private cache: Cache = { keys: [], confirmedAt: 0, refreshAt: 0 };
  private flight: Promise<void> | null = null;
  private unknown = new Map<string, number>();
  constructor(@Inject(A2_WORKFORCE_CONFIG) private readonly config: A2WorkforceConfigurationV1) {}
  async validate(token: string, now = new Date()): Promise<A2WorkforceAssertionEvidenceV1> {
    if (!this.config.enabled) throw new UnauthorizedException('Workforce authentication disabled');
    const j = parseCompactJws(token),
      kid = String(j.header.kid);
    let key = this.cache.keys.find((k) => k.kid === kid);
    if (!key) {
      const cooldown = this.unknown.get(kid) ?? 0;
      if (cooldown > now.getTime()) throw new UnauthorizedException('Unknown signing key');
      try {
        await this.refresh(now);
      } catch {
        this.suppress(kid, now);
        throw new UnauthorizedException('JWKS unavailable');
      }
      key = this.cache.keys.find((k) => k.kid === kid);
      if (!key) {
        this.suppress(kid, now);
        throw new UnauthorizedException('Unknown signing key');
      }
    } else if (now.getTime() - this.cache.confirmedAt > 3_600_000)
      throw new UnauthorizedException('JWKS cache stale');
    else if (now.getTime() >= this.cache.refreshAt) void this.refresh(now).catch(() => undefined);
    verifyRs256(j, key, now);
    return this.claims(j.payload, kid, now);
  }
  private claims(
    p: Record<string, unknown>,
    kid: string,
    now: Date,
  ): A2WorkforceAssertionEvidenceV1 {
    const iss = text(p.iss, 'iss', 2048),
      sub = text(p.sub, 'sub'),
      aud =
        typeof p.aud === 'string'
          ? [p.aud]
          : Array.isArray(p.aud) && p.aud.every((x) => typeof x === 'string')
            ? p.aud
            : [];
    if (iss !== this.config.oidcIssuer || !aud.includes(this.config.oidcAudience))
      throw new UnauthorizedException('OIDC issuer or audience mismatch');
    if (aud.length > 1 && p.azp !== this.config.oidcClientId)
      throw new UnauthorizedException('OIDC azp mismatch');
    const iat = instant(p.iat, 'iat'),
      exp = instant(p.exp, 'exp'),
      auth = instant(p.auth_time, 'auth_time'),
      nbf = p.nbf === undefined ? null : instant(p.nbf, 'nbf'),
      skew = 60_000;
    if (
      iat.getTime() > now.getTime() + skew ||
      now.getTime() - iat.getTime() > 300_000 + skew ||
      exp.getTime() <= now.getTime() - skew ||
      (nbf && nbf.getTime() > now.getTime() + skew)
    )
      throw new UnauthorizedException('OIDC token outside validity');
    const amr = Array.isArray(p.amr) && p.amr.every((x) => typeof x === 'string') ? p.amr : [],
      mfa =
        amr.includes('mfa') &&
        now.getTime() - auth.getTime() <= 300_000 + skew &&
        auth.getTime() <= now.getTime() + skew;
    const principalId = `${iss}:${sub}`;
    if (principalId.length > 160)
      throw new UnauthorizedException('Workforce principal ID too long');
    return {
      issuer: iss,
      subject: sub,
      principalId,
      audience: aud,
      issuedAt: iat.toISOString(),
      expiresAt: exp.toISOString(),
      authenticatedAt: auth.toISOString(),
      assuranceLevel: mfa ? 'MFA' : 'PASSWORD',
      amr,
      acr: typeof p.acr === 'string' ? p.acr : null,
      signingKeyId: kid,
    };
  }
  private async refresh(now: Date) {
    if (this.flight) return this.flight;
    this.flight = (async () => {
      const response = await fetch(this.config.oidcJwksUri, {
        headers: { accept: 'application/json' },
      });
      if (!response.ok) throw new Error('JWKS fetch failed');
      const body = (await response.json()) as { keys?: A2TrustedJwkV1[] };
      const keys = (body.keys ?? [])
        .filter(
          (k) => k.kty === 'RSA' && (!k.alg || k.alg === 'RS256') && (!k.use || k.use === 'sig'),
        )
        .slice(-32);
      if (!keys.length) throw new Error('No trusted JWKS keys');
      this.cache = {
        keys,
        confirmedAt: now.getTime(),
        refreshAt: now.getTime() + this.config.oidcJwksCacheSeconds * 1000,
      };
    })().finally(() => {
      this.flight = null;
    });
    return this.flight;
  }
  private suppress(kid: string, now: Date) {
    if (this.unknown.size >= 256)
      this.unknown.delete(
        [...this.unknown.entries()].sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]))[0]![0],
      );
    this.unknown.set(kid, now.getTime() + 30_000);
  }
}
