import { createHash } from 'node:crypto';

/** Stable UUID surrogate for a textual profile key; the original code remains in audit values. */
export function limitProfileAuditEntityId(code: string): string {
  const digest = createHash('sha256')
    .update(`limit-profile:${code.trim().toUpperCase()}`)
    .digest('hex');
  return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-${digest.slice(12, 16)}-${digest.slice(16, 20)}-${digest.slice(20, 32)}`;
}
