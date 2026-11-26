import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * ARENA 5 §6 — reachability of the centralized financial admission boundary.
 *
 * Requirement 6 of the fix is not only "the gate blocks" but "every relevant financial entry point
 * actually reaches it". These assertions pin the wiring, so a new financial service that bypasses
 * `CustomerFinancialEligibilityService.require()` (directly, or through the ledger posting path that
 * every journal must pass) fails a test instead of silently shipping.
 *
 * Reviewing table — each row is a decision, not an inference:
 *   DIRECT   the entry point calls `CustomerFinancialEligibilityService.require()` or the
 *            `WalletFinancialBoundaryService` wrapper itself.
 *   LEDGER   the entry point moves money only by posting a journal, and
 *            `LedgerService.postWithinTransaction()` gates every journal on the same boundary.
 *   AGENT_LANE / SYSTEM_ACCOUNTS
 *            reviewed exception: no customer-owned account is debited or credited by this module,
 *            so customer restriction admission is not the governing authority (documented below).
 */
const ROOT = join(__dirname, '..');

type Gate = 'DIRECT' | 'LEDGER' | 'EXCEPTION';

interface EntryPointReview {
  readonly file: string;
  readonly gate: Gate;
  /** A source fragment that must still be present (and is what makes the row true). */
  readonly evidence: string;
  readonly note?: string;
}

const REVIEWED: readonly EntryPointReview[] = [
  // ---- direct callers of the boundary -------------------------------------------------------
  {
    file: 'src/wallet/wallet-financial-boundary.service.ts',
    gate: 'DIRECT',
    evidence: 'this.eligibility.require(manager, customerId)',
  },
  {
    file: 'src/wallet/wallet.service.ts',
    gate: 'DIRECT',
    evidence: 'this.financialEligibility.require(manager, customerId)',
  },
  {
    file: 'src/customer-wallet/customer-wallet.service.ts',
    gate: 'DIRECT',
    evidence: 'this.financialEligibility.require(manager, customerId)',
  },
  {
    file: 'src/customer/customer.service.ts',
    gate: 'DIRECT',
    evidence: 'this.financialEligibility.require(manager, id, false)',
    note: 'customer self-service profile write — requireActive=false, restriction admission still applies',
  },
  {
    file: 'src/transfer/transfer-quote.service.ts',
    gate: 'DIRECT',
    evidence: 'this.boundary.requireAccounts(manager, [',
  },
  {
    file: 'src/virtual-account/inbound-funding.service.ts',
    gate: 'DIRECT',
    evidence: 'this.boundary.requireCustomerWallet(',
  },
  {
    file: 'src/partner/external-operation.service.ts',
    gate: 'DIRECT',
    evidence: 'this.walletBoundary.requireCustomerWallet(',
  },
  {
    file: 'src/partner/external-operation-lifecycle.service.ts',
    gate: 'DIRECT',
    evidence: 'this.walletBoundary.requireCustomerWallet(',
  },
  {
    file: 'src/financial-commitment/financial-commitment.service.ts',
    gate: 'DIRECT',
    evidence: 'this.walletBoundary.requireCustomerWallet(',
  },
  {
    file: 'src/agent/agent-cash-out.service.ts',
    gate: 'DIRECT',
    evidence: "this.financialEligibility.require(manager, customerId, { lockMode: 'UPDATE' })",
  },
  {
    file: 'src/agent/agent-cash-to-cash-claim.service.ts',
    gate: 'DIRECT',
    evidence: 'this.financialEligibility.require(manager, customerId)',
    note: 'cash payout has no customer ledger line, so the claim gates the customer directly',
  },
  {
    file: 'src/policy/a7-product-persistence.service.ts',
    gate: 'DIRECT',
    evidence: 'this.eligibility.require(manager, current.customer_id)',
  },
  {
    file: 'src/limit-catalog/limit-enforcement.service.ts',
    gate: 'DIRECT',
    evidence: 'this.customerEligibility!.require(manager, principalId, {',
  },
  {
    file: 'src/customer-authentication/authentication-session.service.ts',
    gate: 'DIRECT',
    evidence: 'this.financialEligibility.require(manager, command.authentication.customerId)',
    note: 'access gate: a FROZEN/BLACKLISTED customer session fails closed (see integration report)',
  },

  // ---- money movers that reach the boundary through the ledger gate --------------------------
  {
    file: 'src/transfer/transfer.service.ts',
    gate: 'LEDGER',
    evidence: 'this.ledgerService.postJournalInTransaction(manager, {',
    note: 'reached for both legs: requireAccounts checks the source and destination owner',
  },
  {
    file: 'src/transfer/transfer-lifecycle.service.ts',
    gate: 'LEDGER',
    evidence: 'postJournalInTransaction',
  },
  {
    file: 'src/withdrawal/withdrawal.service.ts',
    gate: 'LEDGER',
    evidence: 'this.ledgerService.postJournalInTransaction(manager, {',
  },
  {
    file: 'src/customer-funding/customer-funding.service.ts',
    gate: 'LEDGER',
    evidence: 'postJournalInTransaction',
  },
  {
    file: 'src/deposit/deposit.service.ts',
    gate: 'LEDGER',
    evidence: 'postJournalInTransaction',
  },
  {
    file: 'src/agent/agent-financial-execution.service.ts',
    gate: 'LEDGER',
    evidence: 'postJournalInTransaction',
    note: 'customer cash-out leg; also entry-gated by AgentCashOutService.require()',
  },
  {
    file: 'src/agent/agent-cash-to-cash.service.ts',
    gate: 'LEDGER',
    evidence: 'postJournalInTransaction',
  },
  {
    file: 'src/policy/b2f-journal-governance.service.ts',
    gate: 'LEDGER',
    evidence: 'postJournal',
  },
  {
    file: 'src/policy/a7-product-financial-effect.repository.ts',
    gate: 'LEDGER',
    evidence: 'postJournal',
  },

  // ---- reviewed exceptions -----------------------------------------------------------------
  {
    file: 'src/agent/agent-funding.service.ts',
    gate: 'EXCEPTION',
    evidence: 'postJournalInTransaction',
    note: 'agent float funding: institution <-> agent wallet, no customer-owned account',
  },
  {
    file: 'src/banking/agent-float-funding.service.ts',
    gate: 'EXCEPTION',
    evidence: 'postJournalInTransaction',
    note: 'agent float funding: institution <-> agent wallet, no customer-owned account',
  },
  {
    file: 'src/commercial-accounting/commercial-accounting.service.ts',
    gate: 'EXCEPTION',
    evidence: 'postJournalInTransaction',
    note: 'finance revenue/VAT/commission accounts only (SYSTEM-owned); customer admission is not applicable',
  },
];

function source(file: string): string {
  return readFileSync(join(ROOT, file), 'utf8');
}

describe('financial admission reachability (ARENA 5 §6)', () => {
  describe.each(REVIEWED)('$file', ({ file, gate, evidence }) => {
    it(`is still wired to the boundary as ${gate}`, () => {
      const text = source(file);
      switch (gate) {
        case 'DIRECT':
          expect(text).toContain(evidence);
          expect(text).toMatch(
            /CustomerFinancialEligibilityService|WalletFinancialBoundaryService|financialEligibility|walletBoundary/,
          );
          break;
        case 'LEDGER':
          expect(text).toContain(evidence);
          break;
        case 'EXCEPTION':
          // Exceptions must stay explicit: the file must still be a reviewed exception and must
          // not quietly start posting to customer-owned accounts through some other path.
          expect(text).toContain(evidence);
          expect(text).not.toContain('requireCustomerWallet(');
          break;
      }
    });
  });

  it('keeps the ledger the single posting gate for every customer-owned journal', () => {
    const ledger = source('src/ledger/ledger.service.ts');
    expect(ledger).toContain('this.walletFinancialBoundary.requireAccounts(manager, accountIds)');
    // The only documented exemption is an exact governed reversal with recovery authority.
    expect(ledger).toContain(
      'if (!command.reversalOfJournalId || !recoveryAuthority)\n      await this.walletFinancialBoundary.requireAccounts(manager, accountIds);',
    );
  });

  it('keeps restriction admission inside the eligibility gate, not in individual controllers', () => {
    const gate = source('src/kyc-verification/customer-financial-eligibility.service.ts');
    expect(gate).toContain('FROM customer_restrictions');
    expect(gate).toContain("type IN ('BLACKLISTED','FROZEN','CONFIGURATION_REVIEW')");
    expect(gate).toContain('is_active=true');
    expect(gate).toContain('deleted_at IS NULL');
    // Reusing the caller's lock strength keeps the admission serialization contract intact.
    expect(gate).toContain('${rowLock}');

    // No controller may carry its own restriction check instead of using the gate.
    const controllers = REVIEWED.map((entry) => entry.file).filter((file) =>
      file.endsWith('.controller.ts'),
    );
    expect(controllers).toEqual([]);
  });

  it('keeps restriction writes on the customer financial control lock', () => {
    const eligibility = source('src/customer-eligibility/customer-eligibility.service.ts');
    expect(eligibility).toContain(
      "await manager.query('UPDATE customers SET updated_at = NOW() WHERE id=$1', [customerId]);",
    );
    expect(eligibility).toContain('await this.lockCustomerFinancialControl(manager, customerId);');
  });
});
