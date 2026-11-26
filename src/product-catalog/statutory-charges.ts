import type { EntityManager } from 'typeorm';

import {
  bankingIdentityFor,
  type BankingProductIdentity,
} from '../product-catalog/banking-product-identities';

/**
 * Statutory charges — what is modelled, and what is deliberately not.
 *
 * The mission asks for "applicable statutory charges" per direction. The honest answer in this
 * repository is short, and this module exists so that the short answer is *stated and checkable*
 * rather than implied by a missing field.
 *
 * ## What IS modelled
 *
 * **VAT on our own service fee.** A `fee_rules` row may carry `vat_bps`; the fee engines compute VAT on
 * the clamped fee (`fee-rules/fee-rule-calculator.service.ts`, `fee/fee.engine.ts`) and the banking
 * binding stores it separately as `banking_operation_fee_bindings.tax_minor`. It is a rate the
 * operator authors on the rule — nothing here supplies a rate, and no rate is seeded.
 *
 * ## What is NOT modelled
 *
 * There is no column, table, resolver or engine for any other statutory charge — no stamp duty, no
 * levy, no excise, no regulatory duty, and no per-transfer regulatory ceiling expressed as a charge.
 * Those are not "zero because we decided they are zero"; they are **absent from the data model**.
 * Reporting them as a zero charge would be fabricating a legal position, and reporting them as a
 * missing configuration would invite an operator to "fix" it by authoring a number nobody approved.
 *
 * ## Why the distinction matters for the two bank directions
 *
 * - `WALLET_TO_BANK` can carry VAT, because it prices from an approved `fee_rules` row.
 * - `BANK_TO_WALLET` can carry **no** statutory charge at all, because it carries no customer service
 *   fee for VAT to attach to (its fee disposition is `NOT_APPLICABLE_INBOUND_CREDIT`). That is a
 *   consequence of the fee decision, not a second, independent one.
 *
 * The returned structure is what the effective-configuration preview reports verbatim, so an operator
 * reading the Studio cannot mistake "no statutory charge is modelled" for "no statutory charge applies
 * to you".
 */

export type StatutoryChargeBasis = 'APPROVED_FEE_RULE_VAT' | 'NONE_MODELLED';

export interface StatutoryChargeLine {
  /** Stable identifier for the line, e.g. `VAT_ON_SERVICE_FEE`. */
  charge: string;
  /** The rate IN BASIS POINTS the operator authored on the rule, or `null` when no rule applies. */
  rateBps: number | null;
  /** The amount in minor units, or `null` when it could not be computed. */
  amountMinor: string | null;
  /** `AUTHORED` when a rate came from an approved rule; `NOT_MODELLED` when no concept exists. */
  provenance: 'AUTHORED' | 'NOT_MODELLED';
  note: string;
}

export interface StatutoryChargesSection {
  status: 'RESOLVED' | 'NOT_APPLICABLE';
  /** Plain-English statement of what this section is and is not. */
  note: string;
  lines: StatutoryChargeLine[];
  /**
   * Charges the data model does not represent at all. Listed so the absence is explicit; never
   * reported with a zero rate, because a zero rate would be an invented legal position.
   */
  notModelled: Array<{ charge: string; reason: string }>;
  /** Always false: a preview never posts a leg. */
  postsJournalLegs: false;
}

/** Charges with no representation anywhere in the schema, resolver or engine layer. */
const NOT_MODELLED: Array<{ charge: string; reason: string }> = [
  {
    charge: 'STAMP_DUTY',
    reason:
      'No column, table, resolver or engine represents stamp duty. It is not modelled, not zero, and no rate is asserted here.',
  },
  {
    charge: 'REGULATORY_LEVY',
    reason:
      'No levy concept exists in the commercial model. Levies are set by regulation, not by product configuration, so none is seeded or inferred.',
  },
  {
    charge: 'PROVIDER_FEE',
    reason:
      "A provider's own charge is external COST, not a statutory charge. On the outbound route it is not known at authorization and is never added to the customer debit; on the inbound route it is preserved as receipt evidence (provider_fee_minor) and never charged to the customer by us.",
  },
];

/**
 * Build the statutory-charge section for a direction.
 *
 * This function reads nothing but the identity and the fee decision already taken by the caller, so it
 * cannot disagree with the fee section it sits beside.
 */
export function statutoryChargesFor(
  productCode: string,
  fee: { status: string; vatBps: number | null; vatMinor: string | null },
): StatutoryChargesSection {
  const identity: BankingProductIdentity | null = bankingIdentityFor(productCode);
  const noneModelled = NOT_MODELLED;
  const base = 'No statutory charge other than VAT on our own service fee is modelled.';

  // Inbound: the fee decision removes the base that VAT would attach to.
  if (identity?.feeDisposition === 'NOT_APPLICABLE_INBOUND_CREDIT') {
    return {
      status: 'NOT_APPLICABLE',
      note: `${base} This direction charges no customer service fee, so there is no fee for VAT to attach to. No statutory charge applies to a bank credit.`,
      lines: [],
      notModelled: noneModelled,
      postsJournalLegs: false,
    };
  }

  // Outbound: VAT exists only if an approved rule carries a rate.
  if (fee.status === 'RESOLVED' && fee.vatBps !== null && fee.vatBps > 0) {
    return {
      status: 'RESOLVED',
      note: `${base} The approved fee rule in force carries a VAT rate, which is the only statutory charge this direction can express.`,
      lines: [
        {
          charge: 'VAT_ON_SERVICE_FEE',
          rateBps: fee.vatBps,
          amountMinor: fee.vatMinor,
          provenance: 'AUTHORED',
          note: 'Rate and amount come from the approved fee rule in force; nothing here supplies a rate.',
        },
      ],
      notModelled: noneModelled,
      postsJournalLegs: false,
    };
  }

  // Outbound with no VAT-bearing rule: an explicit ZERO from an authored rule, or nothing at all.
  if (fee.status === 'RESOLVED') {
    return {
      status: 'RESOLVED',
      note: `${base} The approved fee rule in force carries no VAT rate, which is an authored zero — distinct from a missing rule.`,
      lines: [
        {
          charge: 'VAT_ON_SERVICE_FEE',
          rateBps: fee.vatBps,
          amountMinor: fee.vatMinor,
          provenance: 'AUTHORED',
          note: 'An approved rule is in force and states no VAT. This is an explicit zero, not missing configuration.',
        },
      ],
      notModelled: noneModelled,
      postsJournalLegs: false,
    };
  }

  return {
    status: 'NOT_APPLICABLE',
    note: `${base} No approved fee rule is in force for this product, so VAT cannot be computed — a missing rule, not a zero charge.`,
    lines: [],
    notModelled: noneModelled,
    postsJournalLegs: false,
  };
}

/** Convenience wrapper for callers that already hold a manager (kept for symmetry with resolvers). */
export function statutoryChargesForManager(
  _manager: EntityManager,
  productCode: string,
  fee: { status: string; vatBps: number | null; vatMinor: string | null },
): StatutoryChargesSection {
  return statutoryChargesFor(productCode, fee);
}
