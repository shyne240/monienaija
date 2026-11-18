import {
  evaluateTransferCommercial,
  type TransferCommercialFacts,
} from '../src/reconciliation/transfer-commercial-reconciliation';
import { paymentRequestHash } from '../src/payment/payment-support';
import type { TransferReconciliationTransferFact } from '../src/reconciliation/transfer-reconciliation.types';
import { TransferStatus } from '../src/transfer/transfer.enums';

const transfer: TransferReconciliationTransferFact = {
  id: 'transfer',
  commandId: 'cmd',
  status: TransferStatus.COMPLETED,
  sourceCustomerId: 'payer',
  destinationCustomerId: 'recipient',
  sourceWalletAccountId: 'source',
  destinationWalletAccountId: 'destination',
  sourceLedgerAccountId: 'payer-ledger',
  destinationLedgerAccountId: 'dest-ledger',
  amountMinor: '50000',
  currency: 'NGN',
  accountingUnit: 'CUSTOMER_FUNDS',
  journalId: 'principal-journal',
  requestHash: 'hash',
  correlationId: 'transfer:transfer',
  causationId: null,
  quoteSourceType: 'CUSTOMER',
  quoteSourceId: 'payer',
  quoteDestinationType: 'CUSTOMER',
  quoteDestinationId: 'recipient',
};
const feeDecision = {
  status: 'APPLIED',
  currency: 'NGN',
  amountMinor: '50000',
  feeMinor: '1000',
  vatMinor: '75',
  totalMinor: '51075',
  ruleRefs: [{ vatBps: 750 }],
  posting: { journalLegsPosted: false, reason: 'FEE_REVENUE_ACCOUNT_FAMILY_NOT_PROVISIONED' },
};
function facts(): TransferCommercialFacts {
  const feePosting = {
    journalLegsPosted: true,
    vatTreatment: 'EXCLUSIVE_ADD_ON',
    vatBasis: 'EXCLUSIVE',
    vatRateBps: 750,
    revenueMinor: '1000',
    vatMinorPosted: '75',
    vatMinorFromDecision: '75',
    payerDebitMinor: '1075',
    accountingJournalId: 'commercial',
    accountingJournalIdempotencyKey: 'transfer:transfer:commercial-accounting',
  };
  const legs = [
    { accountCode: 'WALLET:payer', direction: 'DEBIT', amountMinor: '1075' },
    { accountCode: 'FINANCE-FEE_REVENUE-NGN', direction: 'CREDIT', amountMinor: '1000' },
    { accountCode: 'FINANCE-VAT_PAYABLE-NGN', direction: 'CREDIT', amountMinor: '75' },
    { accountCode: 'FINANCE-COMMISSION_EXPENSE-NGN', direction: 'DEBIT', amountMinor: '100' },
    { accountCode: 'FINANCE-COMMISSION_PAYABLE-NGN', direction: 'CREDIT', amountMinor: '100' },
  ];
  const registry = [
    ['FEE_REVENUE', 'revenue', 'REVENUE', 'CREDIT'],
    ['VAT_PAYABLE', 'vat', 'LIABILITY', 'CREDIT'],
    ['COMMISSION_EXPENSE', 'expense', 'EXPENSE', 'DEBIT'],
    ['COMMISSION_PAYABLE', 'payable', 'LIABILITY', 'CREDIT'],
  ].map(([role, id, type, normal]) => ({
    family_code: role,
    account_id: id,
    account_code: `FINANCE-${role}-NGN`,
    ledger_code: `FINANCE-${role}-NGN`,
    account_type: type,
    ledger_type: type,
    normal_balance: normal,
    ledger_normal_balance: normal,
    currency: 'NGN',
    ledger_currency: 'NGN',
    accounting_unit: 'CUSTOMER_FUNDS',
    ledger_unit: 'CUSTOMER_FUNDS',
  }));
  const lines = [
    ['payer-ledger', 'DEBIT', '1075'],
    ['revenue', 'CREDIT', '1000'],
    ['vat', 'CREDIT', '75'],
    ['expense', 'DEBIT', '100'],
    ['payable', 'CREDIT', '100'],
  ].map(([id, direction, value]) => ({
    journal_id: 'commercial',
    account_id: id,
    direction,
    amount_minor: value,
    currency: 'NGN',
    accounting_unit: 'CUSTOMER_FUNDS',
  }));
  return {
    quotes: [
      {
        payment_type: 'TRANSFER',
        status: 'USED',
        used_at: 'time',
        currency: 'NGN',
        amount_minor: '50000',
        fee_minor: '1000',
        vat_minor: '75',
        total_minor: '51075',
        transfer_fee_minor: '1000',
        transfer_vat_minor: '75',
        source_wallet_id: 'source',
        destination_wallet_id: 'destination',
        source_ledger_id: 'payer-ledger',
        destination_ledger_id: 'dest-ledger',
        principal_type: 'CUSTOMER',
        principal_id: 'payer',
        recipient_type: 'CUSTOMER',
        recipient_id: 'recipient',
        pricing_hash: paymentRequestHash({
          amountMinor: '50000',
          currency: 'NGN',
          feeMinor: '1000',
          vatMinor: '75',
          totalDebitMinor: '51075',
          feeDecision,
        }),
      },
    ],
    snapshots: [
      {
        idempotency_key: 'transfer:transfer',
        transaction_reference: 'transfer',
        correlation_id: 'transfer:transfer',
        journal_id: 'principal-journal',
        product: 'WALLET_TRANSFER',
        direction: 'OUTGOING',
        decision_status: 'FINAL',
        finalized_at: 'time',
        principal_type: 'CUSTOMER',
        principal_id: 'payer',
        currency: 'NGN',
        principal_amount_minor: '50000',
        fee_decision: { ...feeDecision, posting: feePosting },
        commission_decision: {
          status: 'ALLOCATED',
          payable: true,
          commissionEvent: 'TRANSACTION_COMPLETION',
          ruleRefs: [{ ruleId: 'commission-rule', ruleVersion: 1 }],
          allocations: [
            {
              beneficiaryType: 'AGENT',
              beneficiaryId: 'agent',
              amountMinor: '100',
              currency: 'NGN',
              basis: 'FEE',
              baseAmountMinor: '1000',
              calculationModel: 'PERCENTAGE',
              calculationParameters: { percentageBps: 1000 },
              ruleId: 'commission-rule',
              ruleVersion: 1,
            },
          ],
          posting: {
            journalLegsPosted: true,
            treatment: 'EXPENSE_PAYABLE',
            timing: 'ACCRUE_NOW_SETTLE_LATER',
            expenseMinor: '100',
            payableMinor: '100',
            allocationCount: 1,
            accountingJournalId: 'commercial',
            accountingJournalIdempotencyKey: 'transfer:transfer:commercial-accounting',
          },
        },
      },
    ],
    journals: [
      {
        id: 'commercial',
        idempotency_key: 'transfer:transfer:commercial-accounting',
        correlation_id: 'transfer:transfer',
        currency: 'NGN',
        accounting_unit: 'CUSTOMER_FUNDS',
        status: 'POSTED',
        total_minor: '1175',
        metadata: {
          flow: 'WALLET_TRANSFER',
          transferId: 'transfer',
          productCode: 'WALLET_TRANSFER',
          accountingPurpose: 'FEE_REVENUE_AND_COMMISSION',
          snapshotIdempotencyKey: 'transfer:transfer',
          baseJournalIdempotencyKey: 'transfer:transfer',
          vatTreatment: 'EXCLUSIVE_ADD_ON',
          commissionTreatment: 'EXPENSE_PAYABLE',
          commissionTiming: 'ACCRUE_NOW_SETTLE_LATER',
          legs,
        },
      },
    ],
    lines,
    registry,
    wallets: [],
  };
}
function errs(f: TransferCommercialFacts) {
  return evaluateTransferCommercial(transfer, f).filter((x) => x.severity === 'ERROR');
}

describe('quoted transfer commercial reconciliation', () => {
  it('reconciles quote, immutable snapshot, fee, VAT and expense/payable legs', () =>
    expect(evaluateTransferCommercial(transfer, facts())).toEqual([]));
  it.each([
    [
      'quote',
      (f: TransferCommercialFacts) => {
        f.quotes[0]!.fee_minor = '999';
      },
    ],
    [
      'pricing hash',
      (f: TransferCommercialFacts) => {
        f.quotes[0]!.pricing_hash = 'wrong';
      },
    ],
    [
      'malformed posting flag',
      (f: TransferCommercialFacts) => {
        const decision = f.snapshots[0]!.fee_decision as {
          posting: { journalLegsPosted: unknown };
        };
        decision.posting.journalLegsPosted = 'yes';
      },
    ],
    [
      'snapshot principal',
      (f: TransferCommercialFacts) => {
        f.snapshots[0]!.principal_id = 'other';
      },
    ],
    [
      'snapshot count',
      (f: TransferCommercialFacts) => {
        f.snapshots.push({ ...f.snapshots[0] });
      },
    ],
    [
      'journal count',
      (f: TransferCommercialFacts) => {
        f.journals.push({ ...f.journals[0] });
      },
    ],
    [
      'missing journal',
      (f: TransferCommercialFacts) => {
        f.journals = [];
      },
    ],
    [
      'amount',
      (f: TransferCommercialFacts) => {
        f.lines[1]!.amount_minor = '999';
      },
    ],
    [
      'account',
      (f: TransferCommercialFacts) => {
        f.lines[1]!.account_id = 'wrong';
      },
    ],
    [
      'direction',
      (f: TransferCommercialFacts) => {
        f.lines[1]!.direction = 'DEBIT';
      },
    ],
    [
      'currency',
      (f: TransferCommercialFacts) => {
        f.lines[1]!.currency = 'USD';
      },
    ],
    [
      'total',
      (f: TransferCommercialFacts) => {
        f.journals[0]!.total_minor = '1000';
      },
    ],
    [
      'metadata',
      (f: TransferCommercialFacts) => {
        (f.journals[0]!.metadata as Record<string, unknown>).transferId = 'wrong';
      },
    ],
    [
      'commission amount',
      (f: TransferCommercialFacts) => {
        const decision = f.snapshots[0]!.commission_decision as {
          allocations: Array<{ amountMinor: string }>;
        };
        decision.allocations[0]!.amountMinor = '101';
      },
    ],
  ])('detects altered %s', (_label, mutate) => {
    const f = facts();
    mutate(f);
    expect(errs(f).length).toBeGreaterThan(0);
  });
  it('rejects coherently changed commission amounts when the recorded calculation is unchanged', () => {
    const f = facts();
    const decision = f.snapshots[0]!.commission_decision as {
      allocations: Array<{
        amountMinor: string;
        beneficiaryId: string | null;
        calculationParameters?: unknown;
      }>;
      posting: { expenseMinor: string; payableMinor: string };
    };
    decision.allocations[0]!.amountMinor = '101';
    decision.posting.expenseMinor = '101';
    decision.posting.payableMinor = '101';
    f.lines[3]!.amount_minor = '101';
    f.lines[4]!.amount_minor = '101';
    f.journals[0]!.total_minor = '1176';
    const metadata = f.journals[0]!.metadata as { legs: Array<{ amountMinor: string }> };
    metadata.legs[3]!.amountMinor = '101';
    metadata.legs[4]!.amountMinor = '101';
    expect(
      errs(f).some((issue) =>
        /commission amount does not match its calculation/i.test(issue.message),
      ),
    ).toBe(true);
  });
  it('does not certify missing commission calculation or beneficiary evidence', () => {
    const f = facts();
    const decision = f.snapshots[0]!.commission_decision as {
      allocations: Array<{
        amountMinor: string;
        beneficiaryId: string | null;
        calculationParameters?: unknown;
      }>;
      posting: { expenseMinor: string; payableMinor: string };
    };
    delete decision.allocations[0]!.calculationParameters;
    decision.allocations[0]!.beneficiaryId = null;
    const warnings = evaluateTransferCommercial(transfer, f).filter(
      (issue) => issue.severity === 'WARNING',
    );
    expect(
      warnings.some((issue) => /calculation evidence is unavailable/i.test(issue.message)),
    ).toBe(true);
    expect(
      warnings.some((issue) => /beneficiary identity is unavailable/i.test(issue.message)),
    ).toBe(true);
  });

  it('rejects missing percentage parameters rather than implicitly treating them as zero', () => {
    const f = facts();
    const decision = f.snapshots[0]!.commission_decision as {
      allocations: Array<{ calculationParameters: Record<string, unknown> }>;
    };
    delete decision.allocations[0]!.calculationParameters.percentageBps;
    expect(errs(f).some((issue) => /calculation evidence is malformed/i.test(issue.message))).toBe(
      true,
    );
  });
  it('verifies marginal tier evidence using the existing calculator', () => {
    const f = facts();
    const decision = f.snapshots[0]!.commission_decision as {
      allocations: Array<{
        calculationModel: string;
        calculationParameters: Record<string, unknown>;
      }>;
    };
    decision.allocations[0]!.calculationModel = 'TIERED';
    decision.allocations[0]!.calculationParameters = {
      tiers: [
        {
          index: 0,
          fromMinor: '0',
          upToMinor: '500',
          sliceMinor: '500',
          flatMinor: '0',
          bps: 1000,
          bracketCommissionMinor: '50',
        },
        {
          index: 1,
          fromMinor: '500',
          upToMinor: null,
          sliceMinor: '500',
          flatMinor: '0',
          bps: 1000,
          bracketCommissionMinor: '50',
        },
      ],
    };
    expect(evaluateTransferCommercial(transfer, f)).toEqual([]);
    const tiers = decision.allocations[0]!.calculationParameters.tiers as Array<{
      sliceMinor: string;
    }>;
    tiers[0]!.sliceMinor = '499';
    expect(errs(f).some((issue) => /tier evidence is inconsistent/i.test(issue.message))).toBe(
      true,
    );
  });

  it('does not claim pass when the approved registry cannot be verified', () => {
    const f = facts();
    f.registry = [];
    expect(evaluateTransferCommercial(transfer, f)).toEqual(
      expect.arrayContaining([expect.objectContaining({ severity: 'WARNING' })]),
    );
  });
  it('reconciles netted commission to the beneficiary wallet, not an arbitrary account', () => {
    const f = facts();
    const s = f.snapshots[0]!.commission_decision as Record<string, unknown>;
    s.payable = false;
    s.posting = {
      journalLegsPosted: true,
      treatment: 'AGENT_WALLET_NETTING',
      timing: 'AT_COMPLETION',
      expenseMinor: '100',
      credits: [{ beneficiaryId: 'agent', amountMinor: '100' }],
      accountingJournalId: 'commercial',
      accountingJournalIdempotencyKey: 'transfer:transfer:commercial-accounting',
    };
    f.wallets = [
      {
        customer_id: 'agent',
        owner_class: 'AGENT',
        currency: 'NGN',
        ledger_account_id: 'agent-wallet',
      },
    ];
    f.lines[4]!.account_id = 'agent-wallet';
    const m = f.journals[0]!.metadata as {
      commissionTreatment: string;
      commissionTiming: string;
      legs: Array<{ accountCode: string }>;
    };
    m.commissionTreatment = 'AGENT_WALLET_NETTING';
    m.commissionTiming = 'AT_COMPLETION';
    m.legs[4]!.accountCode = 'WALLET:agent';
    expect(evaluateTransferCommercial(transfer, f)).toEqual([]);
    f.lines[4]!.account_id = 'other';
    expect(errs(f).length).toBeGreaterThan(0);
    f.wallets = [];
    expect(evaluateTransferCommercial(transfer, f)).toEqual(
      expect.arrayContaining([expect.objectContaining({ severity: 'WARNING' })]),
    );
  });
});
