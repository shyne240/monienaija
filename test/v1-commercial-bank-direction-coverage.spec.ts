/**
 * PR #27 — V1 COMMERCIAL COVERAGE CONTRACT: WALLET→BANK and BANK→WALLET.
 *
 * The mission requires both bank directions to appear explicitly in the commercial coverage table
 * with (a) the product code that would price each direction, (b) whether a fee preview exists,
 * (c) whether a limit preview exists, and (d) whether a RUNTIME decision exists — and, for every
 * "no", the specific missing integration rather than "not configured".
 *
 * This suite pins those answers to the repository, so the coverage table in the PR body cannot
 * drift from the code:
 *
 *  - the seeded product catalogue does NOT contain `WALLET_TO_BANK` / `BANK_TO_WALLET`; those
 *    identifiers exist only in the capability registry as V2/PLANNED and in the seed's
 *    out-of-scope guard list. Their exclusion is a CARRY-OVER of the foundation seed, not a
 *    release-scope decision about V1 (see docs/commercial/PR27-W2B-B2W-COVERAGE.md).
 *  - the outbound (wallet→bank) runtime DOES price and limit — but under a DIFFERENT product
 *    identity than the excluded catalogue code: fee binding is product-agnostic (single active
 *    effective product for the currency) and limit enforcement runs the `WITHDRAWAL` /
 *    `EXTERNAL_BANK_TRANSFER` products. That mismatch is the real gap, and it is asserted here.
 *  - the inbound (bank→wallet) runtime has no fee-rule or limit decision at all: it records
 *    provider fee evidence only. That is the specific missing integration.
 *
 * Everything is asserted against real files/services in this repository, so a future change that
 * closes a gap makes this suite fail loudly instead of leaving a stale claim in the PR.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  OUT_OF_SCOPE_PRODUCT_CODES,
  PRODUCT_CATALOG_SEED,
  V1_PRODUCT_CODES,
} from '../src/product-catalog/product-catalog.seed';

const ROOT = join(__dirname, '..');
const read = (relative: string): string => readFileSync(join(ROOT, relative), 'utf8');

describe('PR27 V1 commercial coverage — Wallet to Bank / Bank to Wallet', () => {
  describe('catalogue identity', () => {
    it('does not seed WALLET_TO_BANK or BANK_TO_WALLET, and keeps them in the out-of-scope guard list', () => {
      expect(V1_PRODUCT_CODES).not.toContain('WALLET_TO_BANK');
      expect(V1_PRODUCT_CODES).not.toContain('BANK_TO_WALLET');
      expect(PRODUCT_CATALOG_SEED.map((product) => product.code)).toContain('WALLET_TRANSFER');
      expect(OUT_OF_SCOPE_PRODUCT_CODES).toEqual(
        expect.arrayContaining(['WALLET_TO_BANK', 'BANK_TO_WALLET']),
      );
    });

    it('registers both directions as V2/PLANNED capability rows, not as V1 catalogue products', () => {
      const registry = read('src/capability-registry/capability.seed.ts');
      const walletToBank = registry.slice(registry.indexOf("capabilityCode: 'WALLET_TO_BANK'"));
      const block = walletToBank.slice(0, walletToBank.indexOf('},'));
      expect(block).toMatch(/productScope: CapabilityProductScope\.V2/);
      expect(block).toMatch(/lifecycle: CapabilityLifecycle\.PLANNED/);
      expect(block).toMatch(/blockerDescription: 'V2 out-of-scope: bank\/provider integration'/);
      // Bank to Wallet is not a capability row at all.
      expect(registry).not.toContain("capabilityCode: 'BANK_TO_WALLET'");
    });
  });

  describe('Wallet to Bank (outbound)', () => {
    it('has a customer/agent fee PREVIEW bound to the resolved approved rule', () => {
      const controller = read('src/banking/banking-transfer-pricing.controller.ts');
      expect(controller).toContain("@Get('customers/me/banking/bank-transfer-preview')");
      expect(controller).toContain("@Get('agents/me/banking/bank-transfer-preview')");
      expect(controller).toContain("pricingSource: 'APPROVED_RULE'");
      expect(controller).toContain("pricingSource: 'AMBIGUOUS_PRICING'");
    });

    it('GAP: fee binding and preview are product-agnostic, so WALLET_TO_BANK is never the product that prices the direction', () => {
      const binding = read('src/banking/banking-fee-binding.service.ts');
      expect(binding).toContain('SELECT DISTINCT r.product_code FROM fee_rules r');
      // The single-product-for-the-currency rule IS the missing product identity: there is no
      // WALLET_TO_BANK fee rule and no approved mapping from the direction to a product code.
      expect(binding).toContain('if (products.length !== 1)');
      const preview = read('src/banking/banking-transfer-pricing.controller.ts');
      expect(preview).toContain('SELECT DISTINCT r.product_code FROM fee_rules r');
    });

    it('has a runtime LIMIT decision, but under WITHDRAWAL / EXTERNAL_BANK_TRANSFER rather than a bank product code', () => {
      const commitment = read('src/financial-commitment/financial-commitment.service.ts');
      expect(commitment).toContain("product: 'WITHDRAWAL'");
      expect(commitment).toContain("product: 'EXTERNAL_BANK_TRANSFER'");
      expect(commitment).toContain('this.limits.enforceWithManager(manager, {');
      expect(V1_PRODUCT_CODES).not.toContain('WITHDRAWAL');
      expect(V1_PRODUCT_CODES).not.toContain('EXTERNAL_BANK_TRANSFER');
    });

    it('has a runtime FEE decision at commitment: bound inside the authorization transaction and refused on mismatch', () => {
      const commitment = read('src/financial-commitment/financial-commitment.service.ts');
      expect(commitment).toContain('bindForCommittedOperationInTransaction(manager, {');
      expect(commitment).toContain(
        'Committed amount does not match the authorized customer debit for this operation',
      );
    });
  });

  describe('Bank to Wallet (inbound)', () => {
    it('GAP: has no fee-rule preview and no runtime fee decision — provider fee evidence only', () => {
      const inbound = read('src/banking/banking-inbound.service.ts');
      // The only "fee" inbound understands is the provider's own charge, evidenced on the receipt.
      expect(inbound).toContain('provider_fee_minor');
      expect(inbound).not.toContain('fee_rules');
      expect(inbound).not.toContain('FeeRuleResolverService');
      expect(inbound).not.toContain('limit-rules');
    });

    it('GAP: has no limit preview or limit enforcement on the inbound posting path', () => {
      const inbound = read('src/banking/banking-inbound.service.ts');
      expect(inbound).not.toContain('LimitEnforcementService');
      expect(inbound).not.toContain('enforceWithManager');
    });

    it('has no product code to author against: BANK_TO_WALLET is neither seeded nor a capability row', () => {
      expect(V1_PRODUCT_CODES).not.toContain('BANK_TO_WALLET');
      expect(read('src/capability-registry/capability.seed.ts')).not.toContain(
        "capabilityCode: 'BANK_TO_WALLET'",
      );
    });
  });
});
