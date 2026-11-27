import { createHash } from 'node:crypto';
import type { DataSource, EntityManager } from 'typeorm';

import {
  maskBankAccountNumber,
  type AmbiguousMatchCandidate,
} from './settlement-reconciliation.types';

export type SqlQueryable = Pick<DataSource | EntityManager, 'query'>;

export interface OptionalArena9SchemaCapabilities {
  hasInboundBusinessColumns: boolean;
  hasBankToWalletCredits: boolean;
  hasBankToWalletExceptions: boolean;
  hasBankToWalletSettlements: boolean;
  hasBankToWalletResolutions: boolean;
  hasBankToWalletReturnRefunds: boolean;
}

export interface InternalInboundCandidate {
  sourceType: 'BANKING_INBOUND_PAYMENT' | 'BANK_TO_WALLET_EXCEPTION';
  id: string;
  institutionId: string | null;
  providerKey: string;
  environment: string;
  providerTransactionReference: string;
  providerPaymentReference: string | null;
  businessReference: string | null;
  maskedReceivingAccount: string | null;
  currency: string;
  grossAmountMinor: string;
  providerFeeMinor: string;
  merchantSettlementMinor: string;
  platformFeeMinor: string;
  customerCreditMinor: string;
  internalStatus: string;
  occurredAt: string | null;
  journalIds: string[];
  transactionHistoryPath: string | null;
  exceptionState: string | null;
}

export interface InternalOutboundCandidate {
  sourceType: 'BANKING_OUTBOUND_OPERATION';
  id: string;
  commitmentId: string | null;
  externalOperationId: string | null;
  institutionId: string;
  providerKey: string;
  environment: string;
  operationReference: string;
  providerTransactionReference: string | null;
  nipSessionId: string | null;
  maskedDestinationAccount: string | null;
  destinationBankCode: string;
  currency: string;
  amountMinor: string;
  providerFeeMinor: string;
  platformFeeMinor: string;
  internalStatus: string;
  occurredAt: string | null;
  journalIds: string[];
  transactionHistoryPath: string | null;
}

export interface InternalDisputeSummary {
  id: string;
  reference: string;
  transactionReference: string;
  channel: string;
  grounds: string;
  claimedAmountMinor: string;
  awardedAmountMinor: string | null;
  currency: string;
  status: string;
  outcome: string | null;
  openedAt: string;
}

export function eventFingerprint(parts: Array<string | null | undefined>): string {
  return createHash('sha256')
    .update(parts.map((p) => p ?? '').join('|'))
    .digest('hex');
}

export async function detectOptionalSchemaCapabilities(
  q: SqlQueryable,
): Promise<OptionalArena9SchemaCapabilities> {
  const cols = await q.query<Array<{ column_name: string }>>(
    `SELECT column_name
       FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'banking_inbound_payments'
        AND column_name IN ('business_reference', 'settlement_amount_minor', 'monienaija_fee_minor', 'customer_credit_minor', 'credit_journal_id', 'resolution_state')`,
  );

  const tables = await q.query<
    Array<{
      has_credits: boolean;
      has_exceptions: boolean;
      has_settlements: boolean;
      has_resolutions: boolean;
      has_return_refunds: boolean;
    }>
  >(
    `SELECT
       to_regclass('public.bank_to_wallet_credits') IS NOT NULL AS has_credits,
       to_regclass('public.bank_to_wallet_exceptions') IS NOT NULL AS has_exceptions,
       to_regclass('public.bank_to_wallet_settlements') IS NOT NULL AS has_settlements,
       to_regclass('public.bank_to_wallet_resolutions') IS NOT NULL AS has_resolutions,
       to_regclass('public.bank_to_wallet_return_refunds') IS NOT NULL AS has_return_refunds`,
  );

  const colSet = new Set(cols.map((c) => c.column_name));
  const row = tables[0];
  return {
    hasInboundBusinessColumns:
      colSet.has('business_reference') &&
      colSet.has('settlement_amount_minor') &&
      colSet.has('monienaija_fee_minor') &&
      colSet.has('customer_credit_minor') &&
      colSet.has('credit_journal_id') &&
      colSet.has('resolution_state'),
    hasBankToWalletCredits: Boolean(row?.has_credits),
    hasBankToWalletExceptions: Boolean(row?.has_exceptions),
    hasBankToWalletSettlements: Boolean(row?.has_settlements),
    hasBankToWalletResolutions: Boolean(row?.has_resolutions),
    hasBankToWalletReturnRefunds: Boolean(row?.has_return_refunds),
  };
}

export async function findInboundCandidates(
  q: SqlQueryable,
  caps: OptionalArena9SchemaCapabilities,
  params: {
    institutionId: string | null;
    providerKey: string;
    providerTransactionReference: string | null;
    paymentReference: string | null;
    platformReference: string | null;
  },
): Promise<{
  candidates: InternalInboundCandidate[];
  matchedKeysByCandidateId: Map<string, string[]>;
}> {
  const refs = [
    params.providerTransactionReference,
    params.paymentReference,
    params.platformReference,
  ].filter((v): v is string => Boolean(v && v.trim()));
  if (refs.length === 0) {
    return { candidates: [], matchedKeysByCandidateId: new Map() };
  }

  const businessSelect = caps.hasInboundBusinessColumns
    ? `b.business_reference,
       COALESCE(b.settlement_amount_minor, b.credited_amount_minor)::text AS settlement_amount_minor,
       COALESCE(
         NULLIF(b.monienaija_fee_minor, 0),
         CASE WHEN wc.wallet_credit_minor IS NOT NULL
              THEN GREATEST(b.credited_amount_minor - wc.wallet_credit_minor, 0)
              ELSE 0
         END
       )::text AS monienaija_fee_minor,
       COALESCE(b.customer_credit_minor, wc.wallet_credit_minor, b.credited_amount_minor)::text AS customer_credit_minor,
       b.credit_journal_id::text AS credit_journal_id,
       b.resolution_state`
    : `NULL::text AS business_reference,
       b.credited_amount_minor::text AS settlement_amount_minor,
       (CASE WHEN wc.wallet_credit_minor IS NOT NULL
             THEN GREATEST(b.credited_amount_minor - wc.wallet_credit_minor, 0)
             ELSE 0
        END)::text AS monienaija_fee_minor,
       COALESCE(wc.wallet_credit_minor, b.credited_amount_minor)::text AS customer_credit_minor,
       NULL::text AS credit_journal_id,
       NULL::text AS resolution_state`;

  const sqlParams: unknown[] = [
    params.providerKey,
    params.institutionId,
    params.providerTransactionReference,
    params.paymentReference,
  ];
  let businessWhere = '';
  if (caps.hasInboundBusinessColumns) {
    sqlParams.push(params.platformReference);
    businessWhere = `OR ($5::text IS NOT NULL AND b.business_reference = $5)`;
  }

  const inboundRows = await q.query<
    Array<{
      id: string;
      institution_id: string | null;
      provider_key: string;
      environment: string;
      provider_transaction_reference: string;
      provider_payment_reference: string | null;
      receiving_account_number: string | null;
      currency: string;
      gross_amount_minor: string;
      provider_fee_minor: string;
      credited_amount_minor: string;
      paid_at: Date | null;
      recorded_at: Date | null;
      verification_state: string;
      ledger_transaction_id: string | null;
      float_journal_id: string | null;
      business_reference: string | null;
      settlement_amount_minor: string;
      monienaija_fee_minor: string;
      customer_credit_minor: string;
      credit_journal_id: string | null;
      resolution_state: string | null;
    }>
  >(
    `SELECT b.id::text AS id,
            b.institution_id::text AS institution_id,
            b.provider_key,
            b.environment,
            b.provider_transaction_reference,
            b.provider_payment_reference,
            b.receiving_account_number,
            b.currency,
            b.gross_amount_minor::text AS gross_amount_minor,
            b.provider_fee_minor::text AS provider_fee_minor,
            b.credited_amount_minor::text AS credited_amount_minor,
            b.paid_at,
            b.recorded_at,
            b.verification_state,
            b.ledger_transaction_id::text AS ledger_transaction_id,
            r.journal_id::text AS float_journal_id,
            ${businessSelect}
       FROM banking_inbound_payments b
       LEFT JOIN banking_inbound_float_links fl ON fl.payment_id = b.id
       LEFT JOIN agent_float_funding_receipts r ON r.id = fl.float_receipt_id
       LEFT JOIN LATERAL (
         SELECT SUM(ll.amount_minor) AS wallet_credit_minor
           FROM ledger_lines ll
           JOIN wallet_accounts wa ON wa.ledger_account_id = ll.ledger_account_id
          WHERE ll.journal_id = COALESCE(r.journal_id, b.ledger_transaction_id)
            AND ll.direction = 'CREDIT'
       ) wc ON COALESCE(r.journal_id, b.ledger_transaction_id) IS NOT NULL
      WHERE b.provider_key = $1
        AND ($2::uuid IS NULL OR b.institution_id = $2::uuid)
        AND (
             ($3::text IS NOT NULL AND b.provider_transaction_reference = $3)
          OR ($4::text IS NOT NULL AND b.provider_payment_reference = $4)
          ${businessWhere}
        )
      ORDER BY b.recorded_at ASC`,
    sqlParams,
  );

  const candidates: InternalInboundCandidate[] = [];
  const matchedKeysByCandidateId = new Map<string, string[]>();

  for (const row of inboundRows) {
    const journalIds = Array.from(
      new Set(
        [row.credit_journal_id, row.float_journal_id, row.ledger_transaction_id].filter(
          (j): j is string => Boolean(j),
        ),
      ),
    );
    const status =
      row.resolution_state === 'CREDITED' || row.float_journal_id
        ? 'CREDITED'
        : row.resolution_state && row.resolution_state !== 'PENDING'
          ? row.resolution_state
          : row.verification_state;

    const candidate: InternalInboundCandidate = {
      sourceType: 'BANKING_INBOUND_PAYMENT',
      id: row.id,
      institutionId: row.institution_id,
      providerKey: row.provider_key,
      environment: row.environment,
      providerTransactionReference: row.provider_transaction_reference,
      providerPaymentReference: row.provider_payment_reference,
      businessReference: row.business_reference,
      maskedReceivingAccount: maskBankAccountNumber(row.receiving_account_number),
      currency: row.currency,
      grossAmountMinor: row.gross_amount_minor,
      providerFeeMinor: row.provider_fee_minor,
      merchantSettlementMinor: row.settlement_amount_minor,
      platformFeeMinor: row.monienaija_fee_minor,
      customerCreditMinor: row.customer_credit_minor,
      internalStatus: status,
      occurredAt: (row.paid_at ?? row.recorded_at)?.toISOString() ?? null,
      journalIds,
      transactionHistoryPath: `#transaction-history/BANK_TO_WALLET/${row.id}`,
      exceptionState: null,
    };
    candidates.push(candidate);

    const keys: string[] = [];
    if (
      params.providerTransactionReference &&
      row.provider_transaction_reference === params.providerTransactionReference
    ) {
      keys.push('providerTransactionReference');
    }
    if (params.platformReference && row.business_reference === params.platformReference) {
      keys.push('businessReference');
    }
    if (params.paymentReference && row.provider_payment_reference === params.paymentReference) {
      keys.push('paymentReference');
    }
    matchedKeysByCandidateId.set(row.id, keys);
  }

  // Also check standalone Arena 9 bank_to_wallet_exceptions not already represented by inbound rows
  if (caps.hasBankToWalletExceptions) {
    const excRows = await q.query<
      Array<{
        id: string;
        institution_id: string | null;
        provider_key: string;
        environment: string;
        provider_transaction_reference: string;
        provider_payment_reference: string | null;
        business_reference: string | null;
        receiving_account_number: string | null;
        currency: string;
        gross_amount_minor: string;
        provider_fee_minor: string;
        settlement_amount_minor: string;
        monienaija_fee_minor: string;
        customer_credit_minor: string;
        state: string;
        reason: string | null;
        resolution_journal_id: string | null;
        created_at: Date;
      }>
    >(
      `SELECT e.id::text AS id,
              e.institution_id::text AS institution_id,
              e.provider_key,
              e.environment,
              e.provider_transaction_reference,
              e.provider_payment_reference,
              e.business_reference,
              e.receiving_account_number,
              e.currency,
              e.gross_amount_minor::text AS gross_amount_minor,
              e.provider_fee_minor::text AS provider_fee_minor,
              COALESCE(e.settlement_amount_minor, e.gross_amount_minor - e.provider_fee_minor)::text AS settlement_amount_minor,
              e.monienaija_fee_minor::text AS monienaija_fee_minor,
              e.customer_credit_minor::text AS customer_credit_minor,
              e.state,
              e.reason,
              e.resolution_journal_id::text AS resolution_journal_id,
              e.created_at
         FROM bank_to_wallet_exceptions e
        WHERE e.provider_key = $1
          AND ($2::uuid IS NULL OR e.institution_id = $2::uuid OR e.institution_id IS NULL)
          AND (
               ($3::text IS NOT NULL AND e.provider_transaction_reference = $3)
            OR ($4::text IS NOT NULL AND e.business_reference = $4)
            OR ($5::text IS NOT NULL AND e.provider_payment_reference = $5)
          )
        ORDER BY e.created_at ASC`,
      [
        params.providerKey,
        params.institutionId,
        params.providerTransactionReference,
        params.platformReference,
        params.paymentReference,
      ],
    );

    const seenTxRefs = new Set(candidates.map((c) => c.providerTransactionReference));
    for (const exc of excRows) {
      if (seenTxRefs.has(exc.provider_transaction_reference)) {
        // Enrich existing inbound candidate with exceptionState
        const existing = candidates.find(
          (c) => c.providerTransactionReference === exc.provider_transaction_reference,
        );
        if (existing) {
          existing.exceptionState = exc.state;
          if (exc.resolution_journal_id && !existing.journalIds.includes(exc.resolution_journal_id)) {
            existing.journalIds.push(exc.resolution_journal_id);
          }
        }
        continue;
      }

      const candidate: InternalInboundCandidate = {
        sourceType: 'BANK_TO_WALLET_EXCEPTION',
        id: exc.id,
        institutionId: exc.institution_id,
        providerKey: exc.provider_key,
        environment: exc.environment,
        providerTransactionReference: exc.provider_transaction_reference,
        providerPaymentReference: exc.provider_payment_reference,
        businessReference: exc.business_reference,
        maskedReceivingAccount: maskBankAccountNumber(exc.receiving_account_number),
        currency: exc.currency,
        grossAmountMinor: exc.gross_amount_minor,
        providerFeeMinor: exc.provider_fee_minor,
        merchantSettlementMinor: exc.settlement_amount_minor,
        platformFeeMinor: exc.monienaija_fee_minor,
        customerCreditMinor: exc.customer_credit_minor,
        internalStatus: `EXCEPTION:${exc.state}`,
        occurredAt: exc.created_at.toISOString(),
        journalIds: exc.resolution_journal_id ? [exc.resolution_journal_id] : [],
        transactionHistoryPath: null,
        exceptionState: exc.state,
      };
      candidates.push(candidate);
      const keys: string[] = [];
      if (
        params.providerTransactionReference &&
        exc.provider_transaction_reference === params.providerTransactionReference
      ) {
        keys.push('providerTransactionReference');
      }
      if (params.platformReference && exc.business_reference === params.platformReference) {
        keys.push('businessReference');
      }
      matchedKeysByCandidateId.set(exc.id, keys);
    }
  }

  return { candidates, matchedKeysByCandidateId };
}

export async function findOutboundCandidates(
  q: SqlQueryable,
  params: {
    institutionId: string | null;
    providerKey: string;
    operationReference: string | null;
    providerTransactionReference: string | null;
    nipSessionId: string | null;
  },
): Promise<{
  candidates: InternalOutboundCandidate[];
  matchedKeysByCandidateId: Map<string, string[]>;
}> {
  const refs = [
    params.operationReference,
    params.providerTransactionReference,
    params.nipSessionId,
  ].filter((v): v is string => Boolean(v && v.trim()));
  if (refs.length === 0) {
    return { candidates: [], matchedKeysByCandidateId: new Map() };
  }

  const rows = await q.query<
    Array<{
      id: string;
      institution_id: string;
      provider_key: string;
      environment: string;
      operation_reference: string;
      external_operation_id: string | null;
      currency: string;
      amount_minor: string;
      destination_bank_code: string;
      destination_account_number: string | null;
      state: string;
      provider_status: string | null;
      provider_transaction_reference: string | null;
      submitted_at: Date | null;
      resolved_at: Date | null;
      created_at: Date;
      commitment_id: string | null;
      reservation_journal_id: string | null;
      resolution_journal_id: string | null;
      bound_provider_fee_minor: string;
      platform_fee_minor: string;
      nip_session_id: string | null;
    }>
  >(
    `SELECT bo.id::text AS id,
            bo.institution_id::text AS institution_id,
            bo.provider_key,
            bo.environment,
            bo.operation_reference,
            bo.external_operation_id::text AS external_operation_id,
            bo.currency,
            bo.amount_minor::text AS amount_minor,
            bo.destination_bank_code,
            bo.destination_account_number,
            bo.state,
            bo.provider_status,
            bo.provider_transaction_reference,
            bo.submitted_at,
            bo.resolved_at,
            bo.created_at,
            fc.id::text AS commitment_id,
            fc.reservation_journal_id::text AS reservation_journal_id,
            fc.resolution_journal_id::text AS resolution_journal_id,
            COALESCE(fb.provider_fee_minor, 0)::text AS bound_provider_fee_minor,
            (COALESCE(fb.service_fee_minor, 0) + COALESCE(fb.tax_minor, 0))::text AS platform_fee_minor,
            nip.reference_value AS nip_session_id
       FROM banking_outbound_operations bo
       LEFT JOIN financial_commitments fc
         ON fc.external_operation_id = bo.external_operation_id
       LEFT JOIN banking_operation_fee_bindings fb
         ON fb.external_operation_id = bo.external_operation_id
       LEFT JOIN LATERAL (
         SELECT eor.reference_value
           FROM external_operation_references eor
          WHERE eor.external_operation_id = bo.external_operation_id
            AND eor.partner_key = 'NIBSS_NIP'
          ORDER BY eor.observed_at DESC, eor.id DESC
          LIMIT 1
       ) nip ON true
      WHERE bo.provider_key = $1
        AND ($2::uuid IS NULL OR bo.institution_id = $2::uuid)
        AND (
             ($3::text IS NOT NULL AND bo.operation_reference = $3)
          OR ($4::text IS NOT NULL AND bo.provider_transaction_reference = $4)
          OR ($5::text IS NOT NULL AND EXISTS (
               SELECT 1
                 FROM external_operation_references eor2
                WHERE eor2.external_operation_id = bo.external_operation_id
                  AND eor2.partner_key = 'NIBSS_NIP'
                  AND eor2.reference_value = $5
             ))
        )
      ORDER BY bo.created_at ASC`,
    [
      params.providerKey,
      params.institutionId,
      params.operationReference,
      params.providerTransactionReference,
      params.nipSessionId,
    ],
  );

  const candidates: InternalOutboundCandidate[] = [];
  const matchedKeysByCandidateId = new Map<string, string[]>();

  for (const row of rows) {
    const journalIds = Array.from(
      new Set(
        [row.reservation_journal_id, row.resolution_journal_id].filter(
          (j): j is string => Boolean(j),
        ),
      ),
    );
    const candidate: InternalOutboundCandidate = {
      sourceType: 'BANKING_OUTBOUND_OPERATION',
      id: row.id,
      commitmentId: row.commitment_id,
      externalOperationId: row.external_operation_id,
      institutionId: row.institution_id,
      providerKey: row.provider_key,
      environment: row.environment,
      operationReference: row.operation_reference,
      providerTransactionReference: row.provider_transaction_reference,
      nipSessionId: row.nip_session_id,
      maskedDestinationAccount: maskBankAccountNumber(row.destination_account_number),
      destinationBankCode: row.destination_bank_code,
      currency: row.currency,
      amountMinor: row.amount_minor,
      providerFeeMinor: row.bound_provider_fee_minor,
      platformFeeMinor: row.platform_fee_minor,
      internalStatus: row.state,
      occurredAt: (row.resolved_at ?? row.submitted_at ?? row.created_at).toISOString(),
      journalIds,
      transactionHistoryPath: row.commitment_id
        ? `#transaction-history/WALLET_TO_BANK/${row.commitment_id}`
        : null,
    };
    candidates.push(candidate);

    const keys: string[] = [];
    if (params.operationReference && row.operation_reference === params.operationReference) {
      keys.push('operationReference');
    }
    if (
      params.providerTransactionReference &&
      row.provider_transaction_reference === params.providerTransactionReference
    ) {
      keys.push('providerTransactionReference');
    }
    if (params.nipSessionId && row.nip_session_id === params.nipSessionId) {
      keys.push('nipSessionId');
    }
    matchedKeysByCandidateId.set(row.id, keys);
  }

  return { candidates, matchedKeysByCandidateId };
}

export function toAmbiguousInboundCandidate(
  c: InternalInboundCandidate,
  keys: string[],
): AmbiguousMatchCandidate {
  return {
    sourceType: c.sourceType,
    sourceId: c.id,
    businessReference: c.businessReference,
    providerReference: c.providerTransactionReference,
    grossAmountMinor: c.grossAmountMinor,
    providerFeeMinor: c.providerFeeMinor,
    netAmountMinor: c.merchantSettlementMinor,
    status: c.internalStatus,
    occurredAt: c.occurredAt,
    reason: `Matched on ${keys.join(', ') || 'reference'}`,
  };
}

export function toAmbiguousOutboundCandidate(
  c: InternalOutboundCandidate,
  keys: string[],
): AmbiguousMatchCandidate {
  return {
    sourceType: c.sourceType,
    sourceId: c.id,
    businessReference: c.operationReference,
    providerReference: c.providerTransactionReference,
    grossAmountMinor: c.amountMinor,
    providerFeeMinor: c.providerFeeMinor,
    netAmountMinor: (BigInt(c.amountMinor) + BigInt(c.providerFeeMinor)).toString(),
    status: c.internalStatus,
    occurredAt: c.occurredAt,
    reason: `Matched on ${keys.join(', ') || 'reference'}`,
  };
}

export async function findMatchingInternalDisputes(
  q: SqlQueryable,
  params: {
    institutionId: string | null;
    references: string[];
  },
): Promise<InternalDisputeSummary[]> {
  const cleaned = Array.from(
    new Set(params.references.map((r) => r.trim()).filter((r) => r.length > 0)),
  );
  if (cleaned.length === 0) return [];

  const rows = await q.query<
    Array<{
      id: string;
      reference: string;
      transaction_reference: string;
      channel: string;
      grounds: string;
      claimed_amount_minor: string;
      awarded_amount_minor: string | null;
      currency: string;
      status: string;
      outcome: string | null;
      opened_at: Date;
    }>
  >(
    `SELECT td.id::text AS id,
            td.reference,
            td.transaction_reference,
            td.channel,
            td.grounds,
            td.claimed_amount_minor::text AS claimed_amount_minor,
            td.awarded_amount_minor::text AS awarded_amount_minor,
            td.currency,
            td.status,
            td.outcome,
            td.opened_at
       FROM transaction_disputes td
      WHERE td.transaction_reference = ANY($1::text[])
        AND (
          $2::uuid IS NULL
          OR EXISTS (
            SELECT 1
              FROM customer_institution_enrolments cie
             WHERE cie.customer_id = td.customer_id
               AND cie.institution_id = $2::uuid
          )
        )
      ORDER BY td.opened_at DESC`,
    [cleaned, params.institutionId],
  );

  return rows.map((r) => ({
    id: r.id,
    reference: r.reference,
    transactionReference: r.transaction_reference,
    channel: r.channel,
    grounds: r.grounds,
    claimedAmountMinor: r.claimed_amount_minor,
    awardedAmountMinor: r.awarded_amount_minor,
    currency: r.currency,
    status: r.status,
    outcome: r.outcome,
    openedAt: r.opened_at.toISOString(),
  }));
}
