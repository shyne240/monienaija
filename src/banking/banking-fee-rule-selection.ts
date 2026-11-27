import type { EntityManager } from 'typeorm';

import { WALLET_TO_BANK } from '../product-catalog/banking-product-identities';
import { QuotePaymentType } from '../quote/quote.enums';

/**
 * The one query that decides which approved fee rule prices a wallet→bank transfer *right now*.
 *
 * Before PR #27 the commitment's binding and the customer/agent pricing preview each had their own
 * "which product is this?" logic, and they were different: the binding demanded exactly one priced
 * product in the currency, the preview demanded the same but computed a fee anyway, and the binding
 * additionally refused rules whose product was disabled while the preview did not check the product
 * row at all. Two expressions of one decision is exactly the drift the Studio exists to prevent, so
 * both now call this.
 *
 * Selection rules, in words:
 *  - the product is `WALLET_TO_BANK` — the canonical identity for this direction for BOTH customer
 *    and agent principals (see `banking-product-identities.ts`);
 *  - the currency matches exactly;
 *  - the rule is active, undeleted, and its effective window contains now
 *    (`effective_from <= now < effective_to`, open-ended when `effective_to` is null — the same
 *    interval convention as `FeeRuleResolverService` and `LimitProfileResolverService`);
 *  - the product itself is enabled and ACTIVE. A rule attached to a disabled product is not an
 *    approved charge, so it is invisible here rather than silently chargeable;
 *  - most recent `effective_from` wins, then highest version. There is at most one live row per
 *    (product, currency, targets, effective_from) thanks to `uq_fee_rules_identity`, so this ordering
 *    is deterministic rather than a tie-break between competing tariffs.
 *
 * Both callers bind/quote the FIRST row and nothing else.
 *
 * PR #27 also fixed a latent defect here: the previous preview query selected `r.payment_type`, a
 * column `fee_rules` does not have (migration `1785753600072-CreateFeeRules.ts`). Every call to the
 * customer/agent bank-transfer pricing preview therefore failed with a SQL error rather than showing
 * a fee — the direction had no working preview at all, which is why nothing caught the product
 * mismatch at the surface a customer actually sees. The engine's payment type is a property of the
 * KIND of movement, not of the rule, so it is supplied by the caller below as `WITHDRAWAL`: a
 * wallet→bank transfer debits the customer's wallet exactly as a withdrawal does.
 */
export const CURRENT_WALLET_TO_BANK_FEE_RULE_SQL = `
  SELECT r.id::text AS id,
         r.product_code,
         r.version,
         r.flat_fee_minor::text AS flat_fee_minor,
         r.percentage_bps,
         r.minimum_fee_minor::text AS minimum_fee_minor,
         r.maximum_fee_minor::text AS maximum_fee_minor,
         r.vat_bps
    FROM fee_rules r
    JOIN products p ON p.code = r.product_code
   WHERE r.product_code = $1
     AND r.currency = $2
     AND r.is_active
     AND r.deleted_at IS NULL
     AND r.effective_from <= clock_timestamp()
     AND (r.effective_to IS NULL OR r.effective_to > clock_timestamp())
     AND p.enabled
     AND p.status = 'ACTIVE'
   ORDER BY r.effective_from DESC, r.version DESC
   LIMIT 1
`;

export interface CurrentFeeRuleRow {
  id: string;
  product_code: string;
  version: number | string;
  flat_fee_minor: string | null;
  percentage_bps: number | string | null;
  minimum_fee_minor: string | null;
  maximum_fee_minor: string | null;
  vat_bps: number | string | null;
}

/**
 * The movement kind a wallet→bank transfer is priced as. It is a constant of the route, not a column:
 * the rule carries the tariff, the route carries the kind. Exported so the preview and the binding
 * cannot disagree about it.
 */
export const WALLET_TO_BANK_PAYMENT_TYPE = QuotePaymentType.WITHDRAWAL;

/**
 * Returns the rule that prices a wallet→bank transfer in `currency`, or `null` when none is in force.
 *
 * Null means "no approved pricing", never "free": callers must decide between refusing to charge
 * (the binding records nothing) and previewing zero with `NO_FEE_RULE` (the pricing preview). Neither
 * invents a number.
 */
export async function selectCurrentWalletToBankFeeRule(
  manager: EntityManager,
  currency: string,
): Promise<CurrentFeeRuleRow | null> {
  const rows = await manager.query<CurrentFeeRuleRow[]>(CURRENT_WALLET_TO_BANK_FEE_RULE_SQL, [
    WALLET_TO_BANK.productCode,
    currency.trim().toUpperCase(),
  ]);
  return rows[0] ?? null;
}
