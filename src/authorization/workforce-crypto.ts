import { createHash, createPublicKey, verify } from 'node:crypto';
import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import type { A2TrustedJwkV1 } from './workforce-authentication.types';
export const sha256 = (v: string) => createHash('sha256').update(v, 'utf8').digest('hex');
export function canonical(v: unknown): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(v) ?? 'null';
}
const b64 = (v: string) => Buffer.from(v, 'base64url');
export function parseCompactJws(token: string) {
  const p = token.split('.');
  if (p.length !== 3 || p.some((x) => !x)) throw new UnauthorizedException('Malformed compact JWS');
  let header: Record<string, unknown>, payload: Record<string, unknown>;
  try {
    const hs = b64(p[0]!).toString('utf8'),
      ps = b64(p[1]!).toString('utf8');
    rejectDuplicateKeys(hs);
    rejectDuplicateKeys(ps);
    const parsedHeader: unknown = JSON.parse(hs),
      parsedPayload: unknown = JSON.parse(ps);
    if (
      parsedHeader === null ||
      typeof parsedHeader !== 'object' ||
      Array.isArray(parsedHeader) ||
      parsedPayload === null ||
      typeof parsedPayload !== 'object' ||
      Array.isArray(parsedPayload)
    )
      throw new UnauthorizedException('JWS header and payload must be objects');
    header = parsedHeader as Record<string, unknown>;
    payload = parsedPayload as Record<string, unknown>;
  } catch (e) {
    if (e instanceof UnauthorizedException) throw e;
    throw new UnauthorizedException('Malformed JWS JSON');
  }
  if (
    header.alg !== 'RS256' ||
    typeof header.kid !== 'string' ||
    !header.kid ||
    header.crit !== undefined
  )
    throw new UnauthorizedException('Unsupported JWS header');
  if (
    header.typ !== undefined &&
    (typeof header.typ !== 'string' || !['JWT', 'application/jwt'].includes(header.typ))
  )
    throw new UnauthorizedException('Invalid JWS typ');
  return { header, payload, signingInput: `${p[0]}.${p[1]}`, signature: b64(p[2]!) };
}
export function verifyRs256(
  jws: ReturnType<typeof parseCompactJws>,
  jwk: A2TrustedJwkV1,
  now = new Date(),
) {
  if (
    jwk.kty !== 'RSA' ||
    (jwk.alg && jwk.alg !== 'RS256') ||
    (jwk.use && jwk.use !== 'sig') ||
    jwk.revoked
  )
    throw new UnauthorizedException('Signing key is not trusted');
  if (
    (jwk.validFrom && new Date(jwk.validFrom) > now) ||
    (jwk.validTo && new Date(jwk.validTo) <= now)
  )
    throw new UnauthorizedException('Signing key outside validity');
  const ok = verify(
    'RSA-SHA256',
    Buffer.from(jws.signingInput),
    createPublicKey({ key: jwk as never, format: 'jwk' }),
    jws.signature,
  );
  if (!ok) throw new UnauthorizedException('Invalid RS256 signature');
}
export function instant(v: unknown, name: string) {
  if (typeof v !== 'string' && typeof v !== 'number')
    throw new UnauthorizedException(`Invalid ${name}`);
  const d = typeof v === 'number' ? new Date(v * 1000) : new Date(v);
  if (!Number.isFinite(d.getTime())) throw new UnauthorizedException(`Invalid ${name}`);
  return d;
}
export function text(v: unknown, name: string, max = 255) {
  if (typeof v !== 'string' || !v.trim() || v.length > max)
    throw new BadRequestException(`Invalid ${name}`);
  return v.trim();
}
function rejectDuplicateKeys(json: string) {
  let inString = false,
    escape = false,
    depth = 0;
  const seen: Array<Set<string>> = [];
  for (let i = 0; i < json.length; i++) {
    const c = json[i]!;
    if (inString) {
      if (escape) {
        escape = false;
        continue;
      }
      if (c === '\\') {
        escape = true;
        continue;
      }
      if (c === '"') inString = false;
      continue;
    }
    if (c === '"') {
      let j = i + 1,
        e = false;
      for (; j < json.length; j++) {
        const d = json[j]!;
        if (e) {
          e = false;
          continue;
        }
        if (d === '\\') {
          e = true;
          continue;
        }
        if (d === '"') break;
      }
      const raw = json.slice(i, j + 1);
      let k = j + 1;
      while (/\s/.test(json[k] ?? '')) k++;
      if (json[k] === ':' && seen[depth]) {
        const key = JSON.parse(raw) as string;
        if (seen[depth]!.has(key)) throw new UnauthorizedException('Duplicate JSON key');
        seen[depth]!.add(key);
      }
      inString = true;
      continue;
    }
    if (c === '{') {
      depth++;
      seen[depth] = new Set();
    }
    if (c === '}') {
      seen[depth] = new Set();
      depth--;
    }
  }
}
