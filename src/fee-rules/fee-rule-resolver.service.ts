import { BadRequestException, Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';

/**
 * V1-COMMERCIAL-04 — Fee Rule RESOLUTION foundation (read-only).
 *
 * Answers ONE question: given (productCode, currency, at) — which fee rule row is
 * applicable right then, from the authoritative `fee_rules` registry?
 *
 * HARD BOUNDARIES:
 *  - READ-ONLY. Never calculates fees, charges anything, or writes any row
 *    (no wallets, ledger, limits, transfers, funding, snapshots).
 *  - Not wired into any financial flow; V1 stays fee-free.
 *  - Zero production fee rules exist; NOT_CONFIGURED is the normal answer today.
 *
 * Matching conditions (ALL required):
 *  - product_code exact match against the requested product (authoritative catalogue identity)
 *  - currency exact match (no conversion — V1 is NGN-only)
 *  - is_active = true
 *  - deleted_at IS NULL (soft-deleted rules are ignored)
 *  - effective_from <= at  AND  (effective_to IS NULL OR at < effective_to)
 *
 * Interval convention (single, documented, matches LimitProfileResolverService):
 *    effective_from <= at < effective_to    — a rule WITHOUT effective_to is open-ended.
 *
 * Priority convention (matches LimitProfileResolverService `ORDER BY precedence DESC`):
 *    among applicable rules the HIGHEST priority wins. Lower number does NOT win.
 *
 * Tie safety: if two or more applicable rules share the highest priority there is NO approved
 * business tie-break policy, so the resolver NEVER silently picks one. It returns an explicit,
 * deterministic AMBIGUOUS result listing the conflicting rule ids (sorted by id ASC — the sort
 * only makes the ambiguity report deterministic, it never selects a winner). The resolver must
 * never make commercial policy by accident.
 *
 * Version semantics: the result carries the exact applicable row — id + version + fee
 * parameters + effective window — captured in the SAME single query that selected it. There is
 * no second "current state" lookup after selection, so historical resolutions stay explainable
 * and enough information exists for the Commercial Decision Snapshot practice to later capture
 * ruleId + ruleVersion + effective values (snapshot code untouched here).
 *
 * NOT_CONFIGURED ≠ ZERO: NOT_CONFIGURED means "no applicable active rule exists". An approved
 * zero-fee policy is an explicit rule (flat_fee_minor = 0) that resolves as RESOLVED.
 */

export type FeeRuleResolutionStatus = 'RESOLVED' | 'NOT_CONFIGURED' | 'AMBIGUOUS';

export interface ResolvedFeeRule {
  ruleId: string;
  ruleVersion: number;
  flatFeeMinor: string | null;
  percentageBps: number | null;
  minimumFeeMinor: string | null;
  maximumFeeMinor: string | null;
  vatBps: number | null;
  effectiveFrom: Date;
  effectiveTo: Date | null;
  priority: number;
}

export interface FeeRuleResolution {
  status: FeeRuleResolutionStatus;
  productCode: string;
  currency: string;
  evaluatedAt: Date;
  /** Present only when status === 'RESOLVED'. */
  rule?: ResolvedFeeRule;
  /** Present only when status === 'AMBIGUOUS': conflicting rule ids, sorted ASC (deterministic report, never a selection). */
  ambiguousRuleIds?: string[];
  /** Present only when status === 'AMBIGUOUS': the shared priority of the conflicting rules. */
  ambiguousPriority?: number;
}

export interface FeeRuleResolveInput {
  productCode: string;
  currency?: string;
  /** Evaluation timestamp; defaults to now. Past timestamps are first-class (historical resolution). */
  at?: Date | string;
}

const PRODUCT_PATTERN = /^[A-Z0-9_]{3,80}$/;
const CURRENCY_PATTERN = /^[A-Z]{3}$/;

interface CandidateRow {
  id: string;
  version: string | number;
  flat_fee_minor: string | null;
  percentage_bps: number | string | null;
  minimum_fee_minor: string | null;
  maximum_fee_minor: string | null;
  vat_bps: number | string | null;
  effective_from: string;
  effective_to: string | null;
  priority: number | string;
}

const CANDIDATES_SQL = `
      SELECT id, version,
             flat_fee_minor::text AS flat_fee_minor,
             percentage_bps,
             minimum_fee_minor::text AS minimum_fee_minor,
             maximum_fee_minor::text AS maximum_fee_minor,
             vat_bps,
             effective_from, effective_to, priority
      FROM fee_rules
      WHERE product_code = $1
        AND currency = $2
        AND is_active = true
        AND deleted_at IS NULL
        AND effective_from <= $3
        AND (effective_to IS NULL OR $3 < effective_to)
      ORDER BY priority DESC, id ASC
`;

@Injectable()
export class FeeRuleResolverService {
  constructor(private readonly dataSource: DataSource) {}

  /**
   * Resolve the applicable fee rule for (productCode, currency) at `at`.
   * Never throws for "no fee configuration" — that is NOT_CONFIGURED.
   * Throws BadRequestException only for malformed input (validation convention).
   */
  async resolve(input: FeeRuleResolveInput): Promise<FeeRuleResolution> {
    const { productCode, currency, at } = this.normalize(input);
    const rows: CandidateRow[] = await this.dataSource.query(CANDIDATES_SQL, [productCode, currency, at]);
    return this.select({ productCode, currency, at }, rows);
  }

  /**
   * Manager-bound variant so a future flow integration can resolve inside its own
   * SERIALIZABLE transaction (same convention LimitProfileResolverService exposes).
   * Still strictly read-only.
   */
  async resolveWithManager(manager: EntityManager, input: FeeRuleResolveInput): Promise<FeeRuleResolution> {
    const { productCode, currency, at } = this.normalize(input);
    const rows: CandidateRow[] = await manager.query(CANDIDATES_SQL, [productCode, currency, at]);
    return this.select({ productCode, currency, at }, rows);
  }

  // ── internals ──

  private normalize(input: FeeRuleResolveInput): { productCode: string; currency: string; at: Date } {
    if (typeof input?.productCode !== 'string' || !input.productCode.trim()) {
      throw new BadRequestException('productCode is required');
    }
    const productCode = input.productCode.trim().toUpperCase();
    if (!PRODUCT_PATTERN.test(productCode)) {
      throw new BadRequestException('productCode must match ^[A-Z0-9_]{3,80}$');
    }
    const currencyRaw = input.currency ?? 'NGN';
    if (typeof currencyRaw !== 'string' || !CURRENCY_PATTERN.test(currencyRaw.trim().toUpperCase())) {
      throw new BadRequestException('currency must be a 3-letter uppercase ISO code');
    }
    const currency = currencyRaw.trim().toUpperCase();
    const atRaw = input.at ?? new Date();
    const at = atRaw instanceof Date ? atRaw : new Date(String(atRaw));
    if (Number.isNaN(at.getTime())) throw new BadRequestException('at must be a valid date');
    return { productCode, currency, at };
  }

  /**
   * Pure selection over the candidate rows. Single-pass, deterministic:
   *  - 0 candidates → NOT_CONFIGURED
   *  - exactly one top-priority candidate → RESOLVED
   *  - ≥2 candidates share the top priority → AMBIGUOUS (explicit, never silent)
   */
  private select(
    input: { productCode: string; currency: string; at: Date },
    rows: CandidateRow[],
  ): FeeRuleResolution {
    const base = { productCode: input.productCode, currency: input.currency, evaluatedAt: input.at };
    if (rows.length === 0) {
      return { status: 'NOT_CONFIGURED', ...base };
    }
    const top = Number(rows[0]!.priority);
    const winners = rows.filter((r) => Number(r.priority) === top);
    if (winners.length === 1) {
      const w = winners[0]!;
      return {
        status: 'RESOLVED',
        ...base,
        rule: {
          ruleId: w.id,
          ruleVersion: Number(w.version),
          flatFeeMinor: w.flat_fee_minor,
          percentageBps: w.percentage_bps === null ? null : Number(w.percentage_bps),
          minimumFeeMinor: w.minimum_fee_minor,
          maximumFeeMinor: w.maximum_fee_minor,
          vatBps: w.vat_bps === null ? null : Number(w.vat_bps),
          effectiveFrom: new Date(w.effective_from),
          effectiveTo: w.effective_to === null ? null : new Date(w.effective_to),
          priority: top,
        },
      };
    }
    return {
      status: 'AMBIGUOUS',
      ...base,
      ambiguousRuleIds: winners.map((w) => w.id).sort(),
      ambiguousPriority: top,
    };
  }
}
