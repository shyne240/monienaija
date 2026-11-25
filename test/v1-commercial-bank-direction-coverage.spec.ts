/**
 * PR #27 — V1 COMMERCIAL COVERAGE CONTRACT: WALLET→BANK and BANK→WALLET.
 *
 * This suite used to pin the GAPS: it asserted that neither direction had a catalogue product, that
 * the outbound runtime used the uncatalogued strings `WITHDRAWAL` / `EXTERNAL_BANK_TRANSFER`, that
 * the fee binding refused to name a product, and that the inbound credit path had no limit decision
 * at all. It now pins the opposite — the canonical mapping and the wiring that closed those gaps —
 * for the same reason it existed: so the coverage table in the PR cannot drift from the code.
 *
 * What must hold, and is asserted below:
 *
 *  1. ONE canonical product per direction. `WALLET_TO_BANK` is the identity for a wallet→bank
 *     transfer from a CUSTOMER or an AGENT. There is no second agent-bank-transfer product, because
 *     PR #23 records both under the single history type `WALLET_TO_BANK` keyed by
 *     `financial_commitments.id`.
 *  2. The catalogue is the source of that identity, so fee rules (FK to `products.code`) and the
 *     effective preview (which resolves the product row) can both express it.
 *  3. Runtime, the two limit views, the fee binding, the pricing preview and the effective preview
 *     all read the identity from the same module, and the fee binding and preview share ONE selector.
 *  4. `limit_rules.product` rows authored against the legacy strings keep matching, through the
 *     shared applicability module rather than a data migration of approved rules.
 *  5. The inbound credit path enforces the canonical `BANK_TO_WALLET` limit.
 *  6. Unsupported execution paths stay visibly unavailable and say what they need.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  BANK_TO_WALLET,
  BANKING_PRODUCT_IDENTITIES,
  WALLET_TO_BANK,
  bankingIdentityFor,
  limitProductKeys,
} from '../src/product-catalog/banking-product-identities';
import {
  OUT_OF_SCOPE_PRODUCT_CODES,
  PRODUCT_CATALOG_SEED,
  V1_PRODUCT_CODES,
} from '../src/product-catalog/product-catalog.seed';

const ROOT = join(__dirname, '..');
const read = (relative: string): string => readFileSync(join(ROOT, relative), 'utf8');

describe('PR27 V1 commercial coverage — Wallet to Bank / Bank to Wallet', () => {
  describe('canonical identity', () => {
    it('declares exactly one canonical product per direction', () => {
      expect(BANKING_PRODUCT_IDENTITIES.map((i) => i.productCode).sort()).toEqual([
        'BANK_TO_WALLET',
        'WALLET_TO_BANK',
      ]);
      expect(WALLET_TO_BANK.direction).toBe('OUTGOING');
      expect(BANK_TO_WALLET.direction).toBe('INCOMING');
    });

    it('covers both principal types for outbound through the ONE wallet→bank product', () => {
      expect(WALLET_TO_BANK.principalTypes).toEqual(['CUSTOMER', 'AGENT']);
      // The product an agent's outbound transfer uses is the customer's product, not a new code.
      expect(bankingIdentityFor('EXTERNAL_BANK_TRANSFER')?.productCode).toBe('WALLET_TO_BANK');
      expect(bankingIdentityFor('WITHDRAWAL')?.productCode).toBe('WALLET_TO_BANK');
    });

    it('records the authoritative banking record per direction, per PR #23', () => {
      expect(WALLET_TO_BANK.authoritativeRecord).toContain('financial_commitments.id');
      expect(BANK_TO_WALLET.authoritativeRecord).toContain('inbound_funding_receipts.id');
    });

    it('resolves legacy aliases and rejects strings that are not a product', () => {
      expect(bankingIdentityFor('wallet_to_bank')?.productCode).toBe('WALLET_TO_BANK');
      expect(bankingIdentityFor('NIBSS')).toBeNull();
      expect(bankingIdentityFor('WALLET_TRANSFER')).toBeNull();
      // Aliases are limit-rule spellings only; the canonical code always comes first.
      expect(limitProductKeys(WALLET_TO_BANK)[0]).toBe('WALLET_TO_BANK');
    });
  });

  describe('product catalogue', () => {
    it('seeds both bank directions and drops them from the out-of-scope guard list', () => {
      expect(V1_PRODUCT_CODES).toContain('WALLET_TO_BANK');
      expect(V1_PRODUCT_CODES).toContain('BANK_TO_WALLET');
      expect(OUT_OF_SCOPE_PRODUCT_CODES).not.toContain('WALLET_TO_BANK');
      expect(OUT_OF_SCOPE_PRODUCT_CODES).not.toContain('BANK_TO_WALLET');
    });

    it('keeps the outbound product chargeable and the inbound product visibly disabled', () => {
      const outbound = PRODUCT_CATALOG_SEED.find((p) => p.code === 'WALLET_TO_BANK')!;
      expect(outbound.enabled).toBe(true);
      expect(outbound.status).toBe('ACTIVE');
      const inbound = PRODUCT_CATALOG_SEED.find((p) => p.code === 'BANK_TO_WALLET')!;
      // Disabled because production binds UnavailableA7InboundExecutionAuthority: a bank credit
      // cannot post, so the product must not pretend to be priced.
      expect(inbound.enabled).toBe(false);
      expect(inbound.status).toBe('DISABLED');
    });

    it('never invents a commercial rate in the seed', () => {
      for (const code of ['WALLET_TO_BANK', 'BANK_TO_WALLET']) {
        const entry = PRODUCT_CATALOG_SEED.find((p) => p.code === code)!;
        expect(entry.configurationStatus).not.toBe('CONFIGURED');
      }
    });
  });

  describe('Wallet to Bank (outbound)', () => {
    it('enforces the canonical product for BOTH principal lanes', () => {
      const commitment = read('src/financial-commitment/financial-commitment.service.ts');
      // Both lanes pass the canonical code, imported from the identity module.
      expect(commitment).toContain("from '../product-catalog/banking-product-identities'");
      expect(commitment.match(/product: WALLET_TO_BANK\.productCode/g)).toHaveLength(2);
      // The uncatalogued spellings are gone from the runtime call sites.
      expect(commitment).not.toContain("product: 'WITHDRAWAL'");
      expect(commitment).not.toContain("product: 'EXTERNAL_BANK_TRANSFER'");
    });

    it('binds pricing through ONE selector shared with the preview', () => {
      const binding = read('src/banking/banking-fee-binding.service.ts');
      const preview = read('src/banking/banking-transfer-pricing.controller.ts');
      expect(binding).toContain('selectCurrentWalletToBankFeeRule(manager');
      expect(preview).toContain('selectCurrentWalletToBankFeeRule(this.dataSource.manager');
      // The old product-agnostic scope (and its ambiguity refusal) is retired in both.
      expect(binding).not.toContain('SELECT DISTINCT r.product_code');
      expect(preview).not.toContain('SELECT DISTINCT r.product_code');
      // The preview can no longer emit AMBIGUOUS_PRICING: with a canonical product there is no
      // "which product is this?" question left to be ambiguous. The string survives only as a
      // commented historical note, and the mobile pricing types still accept it so an older client
      // cannot break on an unexpected value.
      expect(preview).not.toContain("pricingSource: 'AMBIGUOUS_PRICING'");
    });

    it('reports the direction in the customer limit view, under the canonical product', () => {
      const customerView = read('src/limit-catalog/customer-limit-view.service.ts');
      expect(customerView).toContain(
        "{ product: WALLET_TO_BANK.productCode, direction: 'OUTGOING' }",
      );
      // The customer lane enforces a limit, so the customer must be able to see it.
      expect(customerView).not.toContain("product: 'WITHDRAWAL'");
    });

    it('reports the direction in the agent limit view, under the canonical product', () => {
      const agentView = read('src/agent/agent-limit-view.service.ts');
      expect(agentView).toContain("{ product: WALLET_TO_BANK.productCode, direction: 'OUTGOING' }");
      expect(agentView).not.toContain("{ product: 'EXTERNAL_BANK_TRANSFER'");
    });
  });

  describe('Bank to Wallet (inbound)', () => {
    it('enforces the canonical bank-credit limit inside the poster transaction', () => {
      const inbound = read('src/virtual-account/inbound-funding.service.ts');
      expect(inbound).toContain('enforceWithManager(manager, {');
      expect(inbound).toContain('product: BANK_TO_WALLET.productCode');
      expect(inbound).toContain("direction: 'INCOMING'");
      // The limit decision must live in the SAME serializable transaction as the credit.
      expect(inbound).toContain('if (!manager.queryRunner?.isTransactionActive)');
    });

    it('is wired to the one limit engine, not a second one', () => {
      const module = read('src/policy/a7-product-command.module.ts');
      expect(module).toContain('LimitCatalogModule');
      const inbound = read('src/virtual-account/inbound-funding.service.ts');
      expect(inbound).toContain("from '../limit-catalog/limit-enforcement.service'");
    });

    it('charges no customer service fee on a bank credit, and says why', () => {
      expect(BANK_TO_WALLET.feeDisposition).toBe('NOT_APPLICABLE_INBOUND_CREDIT');
      expect(BANK_TO_WALLET.feeNote).toContain('provider_fee_minor');
      // The inbound poster understands the PROVIDER fee on the receipt, not a tariff.
      const inbound = read('src/virtual-account/inbound-funding.service.ts');
      expect(inbound).not.toContain('FeeEngine');
      expect(inbound).not.toContain('fee_rules');
    });

    it('keeps the credit path visibly unavailable with the exact missing integrations', () => {
      expect(BANK_TO_WALLET.executionBlockers.length).toBeGreaterThan(0);
      expect(BANK_TO_WALLET.executionBlockers.join(' ')).toContain(
        'UnavailableA7InboundExecutionAuthority',
      );
      const module = read('src/policy/a7-product-command.module.ts');
      expect(module).toContain(
        '{ provide: A7_INBOUND_EXECUTION_AUTHORITY, useClass: UnavailableA7InboundExecutionAuthority }',
      );
      expect(module).toContain(
        '{ provide: INBOUND_SUSPENSE_POLICY, useClass: UnavailableInboundSuspensePolicy }',
      );
    });
  });

  describe('legacy limit rules keep governing', () => {
    it('matches alias spellings in the single shared applicability module', () => {
      const applicability = read('src/limit-catalog/limit-rule-applicability.ts');
      expect(applicability).toContain('upper(product) = ANY($2::varchar[])');
      expect(applicability).toContain('limitProductKeysFor');
      // No caller re-implements alias matching.
      for (const file of [
        'src/limit-catalog/limit-enforcement.service.ts',
        'src/agent/agent-limit-view.service.ts',
        'src/commercial-configuration/effective-configuration-preview.service.ts',
      ]) {
        expect(read(file)).not.toContain('legacyLimitAliases');
      }
    });

    it('does not rewrite approved rules to migrate them', () => {
      // Aliases are honoured at read time; changing an approved rule's product in place would be a
      // governed change, not a code deploy.
      const migrations = read('src/limit-catalog/limit-rule-applicability.ts');
      expect(migrations).not.toContain('UPDATE limit_rules');
    });
  });

  describe('all-nine-product coverage checklist', () => {
    it('covers every seeded product, with both bank directions named explicitly', () => {
      // The checklist the mission asks for: nine products, not seven-plus-an-exception.
      expect(V1_PRODUCT_CODES).toHaveLength(9);
      expect([...V1_PRODUCT_CODES].sort()).toEqual([
        'AGENT_DEFUNDING',
        'AGENT_FUNDING',
        'BANK_TO_WALLET',
        'CASH_TO_CASH',
        'CASH_TO_WALLET',
        'CUSTOMER_FUNDING',
        'WALLET_TO_BANK',
        'WALLET_TO_CASH',
        'WALLET_TRANSFER',
      ]);
    });

    it('still lists the two open authoring items against this PR', () => {
      // Limit-profile editing and tier-ceiling alignment with Onboarding are NOT closed by the
      // product wiring; they are recorded on the draft checklist in docs/commercial.
      const coverage = read('docs/commercial/PR27-W2B-B2W-COVERAGE.md');
      expect(coverage).toMatch(/Limit-profile authoring/i);
      expect(coverage).toMatch(/PR #24 tier-ceiling alignment/i);
      expect(coverage).toMatch(/WALLET_TO_BANK/);
      expect(coverage).toMatch(/BANK_TO_WALLET/);
    });
  });

  describe('commission and statutory charges — the recorded gaps', () => {
    it('declares that neither bank direction evaluates commission at runtime', () => {
      expect(WALLET_TO_BANK.commissionDisposition).toBe('NONE');
      expect(BANK_TO_WALLET.commissionDisposition).toBe('NONE');
      // The commitment service is where that would happen, and it does not.
      const commitment = read('src/financial-commitment/financial-commitment.service.ts');
      expect(commitment).not.toContain('CommissionEngine');
      expect(commitment).not.toContain('agentCommissionMinor');
      // And the live snapshot path confirms what a wired route looks like.
      expect(read('src/transfer/transfer.service.ts')).toContain('CommissionEngine');
    });

    it('names the statutory charges that are not modelled instead of zeroing them', () => {
      const statutory = read('src/product-catalog/statutory-charges.ts');
      for (const charge of ['STAMP_DUTY', 'REGULATORY_LEVY', 'PROVIDER_FEE']) {
        expect(statutory).toContain(charge);
      }
      // A not-modelled charge must never be given a numeric rate: the type allows the marker, and no
      // code path produces such a line with a rate attached.
      expect(statutory).toContain("'NOT_MODELLED'");
      expect(statutory).toContain('not zero, and no rate is asserted');
      // Every authored line comes from a real fee rule, never from this module.
      expect(statutory).toContain("provenance: 'AUTHORED'");
    });
  });

  describe('no live provider calls and no invented values', () => {
    it('wires no provider into the identity module', () => {
      const source = read('src/product-catalog/banking-product-identities.ts');
      // Providers may be NAMED in prose that explains what is still blocked; what must not exist is a
      // reference to one — an import, a call, a configured key — that would imply a live integration.
      for (const provider of ['NIBSS', 'WEMA', 'PROVIDUS', 'NINEPSB', 'MONNIFY']) {
        expect(source).not.toMatch(new RegExp(`\\b${provider}\\b\\s*[:.,)]`));
      }
      expect(source).not.toMatch(/^import .*(partner|banking-config|provider)/m);
    });

    it('documents every direction’s fee disposition instead of leaving it implicit', () => {
      for (const identity of BANKING_PRODUCT_IDENTITIES) {
        expect(identity.feeNote.length).toBeGreaterThan(40);
        expect(['APPROVED_RULE', 'NOT_APPLICABLE_INBOUND_CREDIT']).toContain(
          identity.feeDisposition,
        );
      }
    });
  });
});
