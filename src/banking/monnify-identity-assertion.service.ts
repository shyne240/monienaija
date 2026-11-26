import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { ForbiddenException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';

import type { Environment } from '../config/environment';
import { KycTierEvidenceReader } from '../kyc-verification/kyc-tier-evidence.reader';

export interface IdentityAssertionInput {
  customerId: string;
  /** Re-presented by the customer; never stored by this journey. */
  bvn?: string;
  nin?: string;
}

export interface IdentityAssertion {
  providerBvn?: string;
  providerNin?: string;
  /** SHA-256 digests only. Raw identifiers are passed to the provider and then dropped. */
  bvnMac?: string;
  ninMac?: string;
  identityRevision: string;
}

function equalsConstantTime(a: string, b: string): boolean {
  const left = Buffer.from(a.toLowerCase(), 'hex');
  const right = Buffer.from(b.toLowerCase(), 'hex');
  if (left.length !== right.length || left.length === 0) {
    timingSafeEqual(left, left);
    return false;
  }
  return timingSafeEqual(left, right);
}

/**
 * Reuses the approved BVN/NIN verification flow without creating a second copy of the identifier.
 *
 * The claim store keeps an HMAC of the identifier, not the identifier itself. A customer may
 * re-present a previously verified BVN and/or NIN when asking for a reserved account; this service
 * recomputes the same HMAC with the KYC ownership key, compares it in constant time, and requires
 * current VERIFIED tier evidence. Only the raw value needed for the immediate provider request and
 * its digest for audit are held in memory. Nothing here writes the identifier to the journey's
 * tables.
 */
@Injectable()
export class MonnifyIdentityAssertionService {
  constructor(
    private readonly db: DataSource,
    private readonly config: ConfigService<Environment, true>,
    private readonly evidence: KycTierEvidenceReader,
  ) {}

  async assert(input: IdentityAssertionInput): Promise<IdentityAssertion> {
    const keyBase64 = this.config.get('KYC_OWNERSHIP_KEY_BASE64', { infer: true });
    if (!keyBase64) {
      throw new ForbiddenException('BVN/NIN assertion key is not configured');
    }
    const key = Buffer.from(keyBase64, 'base64');
    if (key.length < 32) {
      throw new ForbiddenException('BVN/NIN assertion key is too short');
    }
    const customerId = (input.customerId ?? '').trim().toLowerCase();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(customerId)) {
      throw new ForbiddenException('Customer identity is invalid');
    }
    const values: Array<['BVN' | 'NIN', string | undefined]> = [
      ['BVN', input.bvn?.trim()],
      ['NIN', input.nin?.trim()],
    ];
    const supplied = values.filter(([, value]) => value !== undefined && value !== '');
    if (supplied.length === 0) {
      throw new ForbiddenException('A verified BVN or NIN is required for a reserved account');
    }
    for (const [kind, value] of supplied) {
      if (!/^\d{11}$/.test(value!)) {
        throw new ForbiddenException(`${kind} must be 11 digits`);
      }
    }

    const snapshot = await this.db.transaction((manager) =>
      this.evidence.read(manager, customerId),
    );
    if (!snapshot) {
      throw new ForbiddenException('No current KYC identity evidence for this customer');
    }
    const result: IdentityAssertion = { identityRevision: snapshot.identityRevision };
    for (const [kind, value] of supplied) {
      const claimRows = await this.db.query<Array<{ identifier_mac: string }>>(
        `SELECT identifier_mac::text FROM kyc_identity_claims
          WHERE customer_id=$1::uuid AND kind=$2 AND status='VERIFIED'
          ORDER BY created_at DESC LIMIT 4`,
        [customerId, kind],
      );
      const expected = createHmac('sha256', key)
        .update('kyc-identifier-v1\0')
        .update(kind)
        .update('\0')
        .update(value!)
        .digest('hex');
      if (!claimRows.some((row) => equalsConstantTime(expected, row.identifier_mac))) {
        throw new ForbiddenException(`${kind} does not match verified KYC evidence`);
      }
      if (!snapshot.evidence.some((item) => item.type === kind && item.status === 'VERIFIED')) {
        throw new ForbiddenException(`${kind} evidence is not verified and current`);
      }
      const digest = createHash('sha256').update(value!).digest('hex');
      if (kind === 'BVN') {
        result.providerBvn = value;
        result.bvnMac = digest;
      } else {
        result.providerNin = value;
        result.ninMac = digest;
      }
    }
    return result;
  }
}
