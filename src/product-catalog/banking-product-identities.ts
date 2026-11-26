/**
 * PR #27 — the single canonical identity for each bank direction.
 *
 * Before this module existed, the two bank directions had no agreed product identity:
 *
 *  - the catalogue seed listed `WALLET_TO_BANK` / `BANK_TO_WALLET` only as *out-of-scope guard*
 *    identifiers, so neither could ever carry a fee rule (`fee_rules.product_code` has a foreign key
 *    to `products.code`) and neither could be previewed by the effective-configuration preview
 *    (which resolves the product row first);
 *  - the outbound runtime passed two different, un-catalogued strings to limit enforcement —
 *    `WITHDRAWAL` for the customer lane and `EXTERNAL_BANK_TRANSFER` for the agent lane — neither of
 *    which is a `products.code`;
 *  - outbound pricing refused to name a product at all, and instead priced against "the one product
 *    in this currency that happens to have an active rule" (see `banking-fee-binding.service.ts`);
 *  - the inbound credit path had no product identity and therefore no limit, no preview and no
 *    declared fee treatment.
 *
 * Every one of those is the same defect seen from a different angle: **no canonical product**.
 * This module supplies it, and the runtime, the resolvers, the preview and Admin Web read it from
 * here rather than re-deriving it.
 *
 * ## Why one product per direction, and not one per principal type
 *
 * A customer-initiated wallet→bank transfer and an agent-initiated wallet→bank transfer are the same
 * commercial route: the same debit of a wallet, the same banking dispatch, the same settlement. PR #23
 * already records both under the single transaction-history type `WALLET_TO_BANK`, keyed by
 * `financial_commitments.id`, and states explicitly that there is "no second
 * agent-external-bank-transfer type". Introducing a second catalogue product (for example an
 * `AGENT_BANK_TRANSFER`) purely to mirror the legacy `EXTERNAL_BANK_TRANSFER` limit string would
 * duplicate that product identity and split one tariff across two codes. `EXTERNAL_BANK_TRANSFER`
 * therefore stays exactly what it always was — an agent **capability/service code** (see
 * `AgentService.EXTERNAL_BANK_TRANSFER`), never a product — and here it is declared a *legacy limit
 * alias* of `WALLET_TO_BANK` so that limit rules already authored against it keep resolving.
 *
 * ## Relationship to the capability registry (not a contradiction)
 *
 * The capability registry still lists `WALLET_TO_BANK` as `V2 / PLANNED / NOT_EXPOSED` with the
 * blocker "V2 out-of-scope: bank/provider integration", and that is correct — it measures something
 * different. A *capability* row describes end-to-end live execution (a real NIBSS/provider call,
 * external settlement); neither exists here. A *product* row describes whether the commercial
 * configuration for a route can be authored, priced and limited. The outbound route already executes
 * through the commitment + banking dispatch path, so its commercial configuration is V1 scope; the
 * live provider integration it would also need remains V2 and blocked. Both statements are true at
 * once, and this module is where the difference is stated.
 *
 * ## Why aliases rather than a data migration
 *
 * `limit_rules.product` is a free-text column with a format check and **no foreign key** to
 * `products.code` (migration `1785753600067-CreateLimitProfileCatalogue.ts`). Rows authored before
 * this change carry `WITHDRAWAL` / `EXTERNAL_BANK_TRANSFER`. Rewriting those rows would silently
 * change the meaning of an approved limit rule without a governance record; instead the shared
 * applicability module matches a rule against the canonical code **or** any declared alias, so old
 * and new rows are both honoured while every new authoring surface is constrained to the canonical
 * code. Enforcement, the customer/agent limit views and the effective preview all call the same
 * function, so they cannot disagree about which rows apply.
 */

export type BankingDirection = 'OUTGOING' | 'INCOMING';

/** How a direction's commercial configuration is treated at runtime. */
export type BankingFeeDisposition =
  /** The direction prices from an approved `fee_rules` row on the canonical product. */
  | 'APPROVED_RULE'
  /**
   * The direction moves money the customer never instructed us to spend, so no customer service fee is
   * charged. This is a DECISION, not a missing rule: a preview reports it as NOT_APPLICABLE rather
   * than NOT_CONFIGURED, and no placeholder rule is seeded. Changing it is a commercial decision made
   * by authoring a real `fee_rules` row on the product.
   */
  | 'NOT_APPLICABLE_INBOUND_CREDIT';

export interface BankingProductIdentity {
  /** `products.code` — the single commercial identity for this direction. */
  readonly productCode: string;
  readonly direction: BankingDirection;
  /** Where the operation's authoritative record lives (see PR #23 transaction-history mapping). */
  readonly authoritativeRecord: string;
  /** Legacy `limit_rules.product` strings that must keep matching this identity. */
  readonly legacyLimitAliases: readonly string[];
  /** Who can price/limit this direction. */
  readonly principalTypes: readonly ('CUSTOMER' | 'AGENT')[];
  readonly feeDisposition: BankingFeeDisposition;
  /**
   * Which commission machinery, if any, evaluates this direction at runtime.
   *
   *  - `COMMISSION_ENGINE` — the operation records a governed commercial decision snapshot through
   *    `CommissionEngine` inside its own transaction.
   *  - `NONE` — no commission decision exists on this route at all. Commission rules are perfectly
   *    authorable against the product (the resolver and preview will find them), but nothing would
   *    ever evaluate them, because the route has no snapshot step and no commission settlement.
   */
  readonly commissionDisposition: 'COMMISSION_ENGINE' | 'NONE';
  /** Plain-English statement of the commission situation, surfaced in the preview. */
  readonly commissionNote: string;
  /** Plain-English reason, surfaced verbatim in previews and the coverage document. */
  readonly feeNote: string;
  /** The execution entry point that actually performs the movement today, or null when unavailable. */
  readonly executionEntryPoint: string | null;
  /** What is still required before this direction can execute live. Empty means "wired". */
  readonly executionBlockers: readonly string[];
}

export const WALLET_TO_BANK: BankingProductIdentity = Object.freeze({
  productCode: 'WALLET_TO_BANK',
  direction: 'OUTGOING',
  authoritativeRecord: 'financial_commitments.id',
  // Both are pre-existing limit-rule strings. Neither is, or ever becomes, a catalogue product.
  legacyLimitAliases: Object.freeze(['WITHDRAWAL', 'EXTERNAL_BANK_TRANSFER'] as string[]),
  principalTypes: Object.freeze(['CUSTOMER', 'AGENT'] as const),
  feeDisposition: 'APPROVED_RULE',
  feeNote:
    'Outbound bank transfers price from the approved fee rule in force for WALLET_TO_BANK. No rule means no charge is bound, and the commitment proceeds without one — never a default fee.',
  // PR #27: commission IS now evaluated on this route — but at SETTLEMENT, not at authorization.
  // A commitment is authorized (RESERVED) long before the money provably leaves, so accruing at
  // authorization would pay commission on transfers that are later released or rejected. The decision
  // is therefore taken in `external-settlement.service.ts` immediately after the commitment becomes
  // SETTLED, bound to that commitment as the canonical transaction reference. A RESERVED commitment
  // has no commission decision, and a RELEASED one never gets one.
  commissionDisposition: 'COMMISSION_ENGINE',
  commissionNote:
    'Commission is decided once, at settlement, for the agent who initiated the transfer. Pending and released transfers carry no commission decision, and a replayed settlement cannot record a second one. When no commission rule is configured the transfer records an explicit NONE decision rather than a zero.',
  executionEntryPoint: 'financial-commitment/financial-commitment.service.ts',
  executionBlockers: Object.freeze([] as string[]),
});

export const BANK_TO_WALLET: BankingProductIdentity = Object.freeze({
  productCode: 'BANK_TO_WALLET',
  direction: 'INCOMING',
  authoritativeRecord: 'inbound_funding_receipts.id (bank intake UUID)',
  legacyLimitAliases: Object.freeze([] as string[]),
  principalTypes: Object.freeze(['CUSTOMER'] as const),
  feeDisposition: 'NOT_APPLICABLE_INBOUND_CREDIT',
  commissionDisposition: 'NONE',
  commissionNote:
    'No commission is evaluated on a bank credit. The recipient never instructed the movement, no commission settlement exists on the inbound path, and the credit path runs no commercial decision snapshot.',
  feeNote:
    'A bank credit is money the customer did not instruct us to spend, so no customer service fee is charged on it. This is a commercial decision, not a missing rule: no fee rule is seeded and none is invented. The only fee inbound evidence carries is the PROVIDER charge on the receipt (provider_fee_minor), which is external cost, not revenue.',
  executionEntryPoint: 'virtual-account/inbound-funding.service.ts',
  executionBlockers: Object.freeze([
    'A7_INBOUND_EXECUTION_AUTHORITY is bound to UnavailableA7InboundExecutionAuthority in production, so no bank credit can be posted until an approved execution authority is implemented and registered.',
    'INBOUND_SUSPENSE_POLICY is deliberately unavailable: there is no approved accounting treatment for received funds that cannot be credited.',
  ]),
});

export const BANKING_PRODUCT_IDENTITIES: readonly BankingProductIdentity[] = Object.freeze([
  WALLET_TO_BANK,
  BANK_TO_WALLET,
]);

const BY_CODE = new Map(BANKING_PRODUCT_IDENTITIES.map((i) => [i.productCode, i]));

/** Every string a `limit_rules.product` row may carry for this canonical product. */
export function limitProductKeys(identity: BankingProductIdentity): readonly string[] {
  return [identity.productCode, ...identity.legacyLimitAliases];
}

/** Accepts a canonical code or one of its legacy aliases and returns the canonical identity. */
export function bankingIdentityFor(value: string): BankingProductIdentity | null {
  const upper = value.trim().toUpperCase();
  const direct = BY_CODE.get(upper);
  if (direct) return direct;
  return (
    BANKING_PRODUCT_IDENTITIES.find((identity) => identity.legacyLimitAliases.includes(upper)) ??
    null
  );
}
