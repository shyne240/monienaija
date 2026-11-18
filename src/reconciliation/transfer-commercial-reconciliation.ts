import { COMMERCIAL_ACCOUNTING_ACCOUNT_CODES } from '../commercial-accounting/commercial-accounting-registry.service';
import { CommercialAccountingFamilyRole } from '../commercial-accounting/commercial-accounting.enums';
import { paymentRequestHash } from '../payment/payment-support';
import { CommissionCalculator } from '../commission/commission.calculator';
import type {
  CommissionRuleDefinition,
  CommissionTier,
} from '../commission/commission-rule.entity';
import type { TransferReconciliationTransferFact } from './transfer-reconciliation.types';

/** Read-only rows from the same repeatable-read snapshot as principal reconciliation. */
export type CommercialRow = Record<string, unknown>;
export interface TransferCommercialFacts {
  quotes: CommercialRow[];
  snapshots: CommercialRow[];
  journals: CommercialRow[];
  lines: CommercialRow[];
  registry: CommercialRow[];
  wallets: CommercialRow[];
}
export interface CommercialIssue {
  severity: 'ERROR' | 'WARNING';
  message: string;
}

type Obj = Record<string, unknown>;
function obj(value: unknown): Obj | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Obj) : null;
}
function amount(value: unknown): bigint | null {
  return typeof value === 'string' && /^\d+$/.test(value) ? BigInt(value) : null;
}
function exact(left: unknown, right: unknown): boolean {
  return amount(left) !== null && amount(right) !== null && amount(left) === amount(right);
}
function evidenceKey(account: string, direction: string, value: bigint): string {
  return `${account}|${direction}|${value}`;
}

/**
 * Checks immutable quote and decision evidence against the actual linked accounting journal.
 * This is not a pricing engine: it never resolves rules or substitutes current configuration.
 * Unsupported/missing evidence is WARNING, contradictory evidence is ERROR; neither is PASS.
 */
export function evaluateTransferCommercial(
  transfer: TransferReconciliationTransferFact,
  facts: TransferCommercialFacts,
): CommercialIssue[] {
  const issues: CommercialIssue[] = [];
  const error = (message: string) => issues.push({ severity: 'ERROR', message });
  const incomplete = (message: string) => issues.push({ severity: 'WARNING', message });
  if (facts.quotes.length !== 1) {
    error('Expected exactly one consumed transfer quote');
    return issues;
  }
  const q = facts.quotes[0]!;
  if (
    q.payment_type !== 'TRANSFER' ||
    q.status !== 'USED' ||
    !q.used_at ||
    q.source_wallet_id !== transfer.sourceWalletAccountId ||
    q.destination_wallet_id !== transfer.destinationWalletAccountId ||
    q.source_ledger_id !== transfer.sourceLedgerAccountId ||
    q.destination_ledger_id !== transfer.destinationLedgerAccountId ||
    q.principal_type !== transfer.quoteSourceType ||
    q.principal_id !== transfer.quoteSourceId ||
    q.recipient_type !== transfer.quoteDestinationType ||
    q.recipient_id !== transfer.quoteDestinationId ||
    q.currency !== transfer.currency ||
    !exact(q.amount_minor, transfer.amountMinor) ||
    !exact(q.fee_minor, q.transfer_fee_minor) ||
    !exact(q.vat_minor, q.transfer_vat_minor)
  )
    error('Quote and completed transfer do not agree');
  const principal = amount(q.amount_minor),
    fee = amount(q.fee_minor),
    vat = amount(q.vat_minor),
    total = amount(q.total_minor);
  if (
    principal === null ||
    fee === null ||
    vat === null ||
    total === null ||
    total !== principal + fee + vat
  )
    error('Quote totals are invalid');
  if (facts.snapshots.length !== 1) {
    error('Expected exactly one correlated commercial decision snapshot');
    return issues;
  }
  const s = facts.snapshots[0]!;
  const key = `transfer:${transfer.id}`;
  if (
    s.idempotency_key !== key ||
    s.transaction_reference !== transfer.id ||
    s.correlation_id !== key ||
    s.journal_id !== transfer.journalId ||
    s.product !== 'WALLET_TRANSFER' ||
    s.direction !== 'OUTGOING' ||
    s.decision_status !== 'FINAL' ||
    !s.finalized_at ||
    s.principal_type !== transfer.quoteSourceType ||
    s.principal_id !== transfer.quoteSourceId ||
    s.currency !== transfer.currency ||
    !exact(s.principal_amount_minor, transfer.amountMinor)
  )
    error('Commercial decision identity does not match the transfer');
  const fd = obj(s.fee_decision),
    cd = obj(s.commission_decision);
  if (!fd || !cd) {
    error('Commercial decisions are malformed');
    return issues;
  }
  const rawFee = amount(fd.feeMinor),
    rawVat = amount(fd.vatMinor);
  if (
    rawFee === null ||
    rawVat === null ||
    fd.currency !== transfer.currency ||
    !exact(fd.amountMinor, transfer.amountMinor) ||
    !exact(
      fd.totalMinor,
      principal !== null && rawFee !== null && rawVat !== null
        ? (principal + rawFee + rawVat).toString()
        : null,
    )
  )
    error('Fee decision economics are invalid');
  // Posting annotations replace the calculator's original posting field after the quote was
  // priced. Reconstruct only the original documented calculator shapes; unsupported shapes
  // cannot be certified. The hash itself is the existing quote pricing authority.
  if (fd.status === 'APPLIED' || fd.status === 'ZERO' || fd.status === 'NOT_CONFIGURED') {
    const originalFeeDecision = { ...fd };
    if (fd.status === 'NOT_CONFIGURED') delete originalFeeDecision.posting;
    else
      originalFeeDecision.posting = {
        journalLegsPosted: false,
        reason: 'FEE_REVENUE_ACCOUNT_FAMILY_NOT_PROVISIONED',
      };
    if (
      q.pricing_hash !==
      paymentRequestHash({
        amountMinor: q.amount_minor,
        currency: q.currency,
        feeMinor: q.fee_minor,
        vatMinor: q.vat_minor,
        totalDebitMinor: q.total_minor,
        feeDecision: originalFeeDecision,
      })
    )
      error('Quoted pricing hash does not match the commercial decision');
  } else incomplete('Cannot verify pricing hash for unsupported fee decision');
  const fp = obj(fd.posting),
    cp = obj(cd.posting);
  if (fd.posting != null && (!fp || typeof fp.journalLegsPosted !== 'boolean'))
    error('Fee posting evidence is malformed');
  if (cd.posting != null && (!cp || typeof cp.journalLegsPosted !== 'boolean'))
    error('Commission posting evidence is malformed');
  const expected: string[] = [],
    expectedEvidence: string[] = [];
  const add = (id: string, code: string, direction: 'DEBIT' | 'CREDIT', n: bigint) => {
    if (n > 0n) {
      expected.push(evidenceKey(id, direction, n));
      expectedEvidence.push(evidenceKey(code, direction, n));
    }
  };
  const account = (role: CommercialAccountingFamilyRole): { id: string; code: string } | null => {
    const rows = facts.registry.filter((r) => r.family_code === role);
    const r = rows[0];
    if (
      rows.length !== 1 ||
      !r ||
      typeof r.account_id !== 'string' ||
      r.account_code !== COMMERCIAL_ACCOUNTING_ACCOUNT_CODES[role] ||
      r.account_code !== r.ledger_code ||
      r.account_type !== r.ledger_type ||
      r.normal_balance !== r.ledger_normal_balance ||
      r.currency !== r.ledger_currency ||
      r.accounting_unit !== r.ledger_unit ||
      r.currency !== transfer.currency ||
      r.accounting_unit !== transfer.accountingUnit
    ) {
      incomplete(`Accounting registry evidence for ${role} is missing or inconsistent`);
      return null;
    }
    return { id: r.account_id, code: String(r.account_code) };
  };
  let feePosted = false;
  if (fd.status === 'APPLIED' && rawFee !== null && rawFee > 0n) {
    if (!fp || fp.journalLegsPosted !== true)
      error('Applied fee has no posted accounting evidence');
    else {
      feePosted = true;
      const revenue = amount(fp.revenueMinor),
        postedVat = amount(fp.vatMinorPosted),
        debit = amount(fp.payerDebitMinor);
      const rate = fp.vatRateBps;
      const rule = Array.isArray(fd.ruleRefs) ? obj(fd.ruleRefs[0]) : null;
      if (
        !Number.isSafeInteger(rate) ||
        typeof rate !== 'number' ||
        rate < 0 ||
        !rule ||
        rule.vatBps !== rate ||
        revenue === null ||
        postedVat === null ||
        debit === null ||
        fee === null ||
        vat === null ||
        revenue !== fee ||
        postedVat !== vat ||
        debit !== fee + vat ||
        !exact(fp.vatMinorFromDecision, fd.vatMinor)
      ) {
        error('Fee and VAT posting evidence does not match quote or fee decision');
      } else if (fp.vatTreatment === 'EXCLUSIVE_ADD_ON') {
        if (
          fp.vatBasis !== 'EXCLUSIVE' ||
          revenue !== rawFee ||
          postedVat !== rawVat ||
          rawVat !== (rawFee * BigInt(rate)) / 10000n
        )
          error('Exclusive VAT evidence is inconsistent');
      } else if (fp.vatTreatment === 'INCLUSIVE_IN_FEE') {
        if (
          fp.vatBasis !== 'INCLUSIVE' ||
          revenue + postedVat !== rawFee ||
          postedVat !== (rawFee * BigInt(rate)) / (10000n + BigInt(rate)) ||
          rawVat !== (rawFee * BigInt(rate)) / 10000n
        )
          error('Inclusive VAT evidence is inconsistent');
      } else incomplete('Unsupported VAT treatment in posting evidence');
      if (
        revenue !== null &&
        postedVat !== null &&
        debit !== null &&
        transfer.sourceLedgerAccountId &&
        transfer.quoteSourceId
      ) {
        add(transfer.sourceLedgerAccountId, `WALLET:${transfer.quoteSourceId}`, 'DEBIT', debit);
        const rev = account(CommercialAccountingFamilyRole.FEE_REVENUE);
        if (rev) add(rev.id, rev.code, 'CREDIT', revenue);
        if (postedVat > 0n) {
          const v = account(CommercialAccountingFamilyRole.VAT_PAYABLE);
          if (v) add(v.id, v.code, 'CREDIT', postedVat);
        }
      } else error('Fee payer ledger evidence is unavailable');
    }
  } else if (
    (fd.status === 'ZERO' || fd.status === 'NOT_CONFIGURED') &&
    rawFee === 0n &&
    rawVat === 0n
  ) {
    if (fee !== 0n || vat !== 0n || fp?.journalLegsPosted === true)
      error('Zero fee has inconsistent posting or quote');
  } else incomplete('Unsupported fee decision evidence');

  let commissionPosted = false;
  const allocations = Array.isArray(cd.allocations) ? cd.allocations : null;
  if (!allocations) error('Commission allocations are malformed');
  else if (cd.status === 'NONE' && allocations.length === 0) {
    if (cp?.journalLegsPosted === true) error('No commission has posted legs');
  } else if (cd.status === 'ALLOCATED' && allocations.length > 0) {
    const parsed = allocations.map(obj);
    if (
      parsed.some(
        (a) =>
          !a ||
          amount(a.amountMinor) === null ||
          (a.currency != null && a.currency !== transfer.currency),
      )
    )
      error('Commission allocation is malformed');
    else {
      const nonzero = parsed.filter((a): a is Obj => !!a && (amount(a.amountMinor) ?? 0n) > 0n);
      // Reuse the existing commission calculator with the immutable snapshot parameters;
      // do not re-resolve today's rules or invent a second pricing policy. Missing historical
      // calculation evidence cannot be certified, while contradictions are errors.
      if (cd.commissionEvent === undefined) incomplete('Commission event evidence is unavailable');
      else if (cd.commissionEvent !== 'TRANSACTION_COMPLETION')
        error('Commission event is inconsistent with transfer completion');
      for (const allocation of parsed) {
        if (!allocation) continue;
        const id = allocation.beneficiaryId;
        if (allocation.beneficiaryType === 'AGENT' && (!id || typeof id !== 'string'))
          incomplete('Commission beneficiary identity is unavailable');
        else if (
          allocation.beneficiaryType === 'AGENT' &&
          transfer.quoteSourceType === 'AGENT' &&
          id !== transfer.quoteSourceId
        )
          error('Commission beneficiary does not match the acting agent');
        const params = obj(allocation.calculationParameters);
        const model = allocation.calculationModel;
        const basis = allocation.basis;
        const refs = Array.isArray(cd.ruleRefs) ? cd.ruleRefs.map(obj) : [];
        if (
          !params ||
          typeof model !== 'string' ||
          typeof basis !== 'string' ||
          typeof allocation.ruleId !== 'string' ||
          !Number.isSafeInteger(allocation.ruleVersion)
        ) {
          incomplete('Commission calculation evidence is unavailable');
          continue;
        }
        if (
          !refs.some(
            (ref) =>
              ref?.ruleId === allocation.ruleId && ref?.ruleVersion === allocation.ruleVersion,
          )
        )
          error('Commission allocation rule identity does not match its snapshot references');
        const expectedBase =
          basis === 'PRINCIPAL'
            ? principal
            : basis === 'FEE'
              ? rawFee
              : basis === 'NET' && principal !== null && rawFee !== null && principal >= rawFee
                ? principal - rawFee
                : null;
        if (expectedBase === null) {
          incomplete('Commission calculation basis is unsupported or unavailable');
          continue;
        }
        if (!exact(allocation.baseAmountMinor, expectedBase.toString()))
          error('Commission calculation base does not match the transfer');
        const supported = [
          'FIXED',
          'PERCENTAGE',
          'PERCENTAGE_MIN',
          'PERCENTAGE_MAX',
          'PERCENTAGE_MIN_MAX',
          'FLAT_PLUS_PERCENTAGE',
          'TIERED',
        ];
        if (!supported.includes(model)) {
          incomplete('Commission calculation model is unsupported');
          continue;
        }
        try {
          const requiredAmounts: string[] = [];
          if (model === 'FIXED' || model === 'FLAT_PLUS_PERCENTAGE')
            requiredAmounts.push('flatCommissionMinor');
          if (model === 'PERCENTAGE_MIN' || model === 'PERCENTAGE_MIN_MAX')
            requiredAmounts.push('minimumCommissionMinor');
          if (model === 'PERCENTAGE_MAX' || model === 'PERCENTAGE_MIN_MAX')
            requiredAmounts.push('maximumCommissionMinor');
          if (requiredAmounts.some((name) => amount(params[name]) === null))
            throw new Error('invalid amount parameter');
          if (model.startsWith('PERCENTAGE') || model === 'FLAT_PLUS_PERCENTAGE') {
            if (
              typeof params.percentageBps !== 'number' ||
              !Number.isInteger(params.percentageBps) ||
              params.percentageBps < 0 ||
              params.percentageBps > 10000
            )
              throw new Error('invalid percentage parameter');
          }
          if (
            model === 'PERCENTAGE_MIN_MAX' &&
            amount(params.minimumCommissionMinor)! > amount(params.maximumCommissionMinor)!
          )
            throw new Error('invalid bounds');
          const tiers: CommissionTier[] | null =
            model === 'TIERED' && Array.isArray(params.tiers)
              ? params.tiers.map((entry) => {
                  const tier = obj(entry);
                  if (
                    !tier ||
                    !(tier.upToMinor === null || typeof tier.upToMinor === 'string') ||
                    !(tier.bps === null || typeof tier.bps === 'number') ||
                    typeof tier.flatMinor !== 'string'
                  )
                    throw new Error('invalid tier evidence');
                  return { upToMinor: tier.upToMinor, bps: tier.bps, flatMinor: tier.flatMinor };
                })
              : null;
          const rule = {
            calculationBasis: basis,
            calculationModel: model,
            flatCommissionMinor: params.flatCommissionMinor,
            percentageBps: params.percentageBps,
            minimumCommissionMinor: params.minimumCommissionMinor,
            maximumCommissionMinor: params.maximumCommissionMinor,
            tiers,
          } as CommissionRuleDefinition;
          const calculated = new CommissionCalculator().calculate(
            rule,
            expectedBase,
            expectedBase.toString(),
          );
          if (!exact(calculated.amountMinor, allocation.amountMinor))
            error('Commission amount does not match its calculation evidence');
          if (model === 'TIERED') {
            const computedTiers = calculated.appliedParameters.tiers;
            if (
              !Array.isArray(computedTiers) ||
              !Array.isArray(params.tiers) ||
              computedTiers.length !== params.tiers.length ||
              computedTiers.some((entry, index) => {
                const left = obj(entry),
                  right = obj((params.tiers as unknown[])[index]);
                return (
                  !left ||
                  !right ||
                  [
                    'index',
                    'fromMinor',
                    'upToMinor',
                    'sliceMinor',
                    'flatMinor',
                    'bps',
                    'bracketCommissionMinor',
                  ].some((key) => left[key] !== right[key])
                );
              })
            )
              error('Commission tier evidence is inconsistent');
          }
        } catch {
          error('Commission calculation evidence is malformed');
        }
      }
      const commission = nonzero.reduce((sum, a) => sum + amount(a.amountMinor)!, 0n);
      if (!nonzero.length) {
        if (cp?.journalLegsPosted === true) error('Zero commission has posted legs');
      } else if (!cp || cp.journalLegsPosted !== true)
        error('Allocated commission has no posted accounting evidence');
      else {
        commissionPosted = true;
        if (
          nonzero.some((a) => a.beneficiaryType !== 'AGENT') ||
          !exact(cp.expenseMinor, commission.toString())
        )
          error('Commission allocation and expense do not agree');
        const expense = account(CommercialAccountingFamilyRole.COMMISSION_EXPENSE);
        if (expense) add(expense.id, expense.code, 'DEBIT', commission);
        if (cp.treatment === 'EXPENSE_PAYABLE') {
          if (
            cp.timing !== 'ACCRUE_NOW_SETTLE_LATER' ||
            !exact(cp.payableMinor, commission.toString()) ||
            cp.allocationCount !== nonzero.length ||
            cd.payable !== true
          )
            error('Commission payable evidence is inconsistent');
          const payable = account(CommercialAccountingFamilyRole.COMMISSION_PAYABLE);
          if (payable) add(payable.id, payable.code, 'CREDIT', commission);
        } else if (cp.treatment === 'AGENT_WALLET_NETTING') {
          if (cp.timing !== 'AT_COMPLETION' || cd.payable !== false || !Array.isArray(cp.credits))
            error('Commission netting evidence is inconsistent');
          const expectedCredits: string[] = [];
          for (const a of nonzero) {
            const id = a.beneficiaryId,
              n = amount(a.amountMinor)!;
            if (typeof id !== 'string' || !id) {
              error('Commission beneficiary identity is missing');
              continue;
            }
            expectedCredits.push(evidenceKey(id, 'CREDIT', n));
            const ws = facts.wallets.filter(
              (w) =>
                w.customer_id === id &&
                w.owner_class === 'AGENT' &&
                w.currency === transfer.currency,
            );
            if (ws.length !== 1 || typeof ws[0]!.ledger_account_id !== 'string')
              incomplete('Commission beneficiary wallet ownership is unavailable or ambiguous');
            else add(ws[0]!.ledger_account_id, `WALLET:${id}`, 'CREDIT', n);
          }
          const credits = Array.isArray(cp.credits) ? cp.credits.map(obj) : [];
          const creditKeys = credits.map((c) =>
            c && typeof c.beneficiaryId === 'string' && amount(c.amountMinor) !== null
              ? evidenceKey(c.beneficiaryId, 'CREDIT', amount(c.amountMinor)!)
              : 'INVALID',
          );
          if (JSON.stringify(creditKeys.sort()) !== JSON.stringify(expectedCredits.sort()))
            error('Commission netting credits do not match allocations');
        } else incomplete('Unsupported commission treatment in posting evidence');
      }
    }
  } else incomplete('Unsupported commission decision evidence');

  const posted = feePosted || commissionPosted;
  if (!posted) {
    if (facts.journals.length !== 0 || facts.lines.length !== 0)
      error('Unexpected commercial accounting journal');
    return issues;
  }
  if (facts.journals.length !== 1) {
    error('Expected exactly one commercial accounting journal');
    return issues;
  }
  const j = facts.journals[0]!,
    meta = obj(j.metadata),
    jkey = `${key}:commercial-accounting`;
  if (
    typeof j.id !== 'string' ||
    j.idempotency_key !== jkey ||
    j.correlation_id !== key ||
    j.currency !== transfer.currency ||
    j.accounting_unit !== transfer.accountingUnit ||
    j.status !== 'POSTED' ||
    !meta ||
    meta.accountingPurpose !== 'FEE_REVENUE_AND_COMMISSION' ||
    meta.transferId !== transfer.id ||
    meta.flow !== 'WALLET_TRANSFER' ||
    meta.productCode !== 'WALLET_TRANSFER' ||
    meta.snapshotIdempotencyKey !== key ||
    meta.baseJournalIdempotencyKey !== key
  )
    error('Commercial journal identity is inconsistent');
  for (const posting of [feePosted ? fp : null, commissionPosted ? cp : null])
    if (
      posting &&
      (posting.accountingJournalId !== j.id || posting.accountingJournalIdempotencyKey !== jkey)
    )
      error('Commercial decision posting points to a different journal');
  if (feePosted && meta?.vatTreatment !== fp?.vatTreatment)
    error('Journal VAT treatment differs from decision');
  if (
    commissionPosted &&
    (meta?.commissionTreatment !== cp?.treatment || meta?.commissionTiming !== cp?.timing)
  )
    error('Journal commission treatment differs from decision');
  const actual: string[] = [];
  let dr = 0n,
    cr = 0n;
  for (const line of facts.lines) {
    const n = amount(line.amount_minor);
    if (
      !n ||
      typeof line.account_id !== 'string' ||
      line.journal_id !== j.id ||
      line.currency !== transfer.currency ||
      line.accounting_unit !== transfer.accountingUnit ||
      (line.direction !== 'DEBIT' && line.direction !== 'CREDIT')
    ) {
      error('Commercial journal line is invalid');
      continue;
    }
    actual.push(evidenceKey(line.account_id, line.direction, n));
    if (line.direction === 'DEBIT') dr += n;
    else cr += n;
  }
  if (dr !== cr || !exact(j.total_minor, dr.toString()))
    error('Commercial journal is unbalanced or has an incorrect total');
  if (
    !issues.some((i) => i.severity === 'WARNING') &&
    JSON.stringify(actual.sort()) !== JSON.stringify(expected.sort())
  )
    error('Commercial journal lines do not match the expected accounting legs');
  const evidence = Array.isArray(meta?.legs) ? meta.legs.map(obj) : [];
  const evidenceKeys = evidence.map((e) =>
    e &&
    typeof e.accountCode === 'string' &&
    typeof e.direction === 'string' &&
    amount(e.amountMinor) !== null
      ? evidenceKey(e.accountCode, e.direction, amount(e.amountMinor)!)
      : 'INVALID',
  );
  if (
    !issues.some((i) => i.severity === 'WARNING') &&
    JSON.stringify(evidenceKeys.sort()) !== JSON.stringify(expectedEvidence.sort())
  )
    error('Journal leg metadata does not match accounting evidence');
  return issues;
}
