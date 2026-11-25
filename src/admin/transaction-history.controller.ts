import {
  BadRequestException,
  Controller,
  Get,
  NotFoundException,
  Param,
  Query,
  Req,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AuthorizationService } from '../authorization/authorization.service';
import type { AuthorizationPrincipal } from '../authorization/authorization.types';

export const HISTORY_TYPES = [
  'WALLET_TRANSFER',
  'CASH_IN',
  'CASH_OUT',
  'CASH_TO_CASH',
  'WALLET_TO_BANK',
  'BANK_TO_WALLET',
  'CUSTOMER_FUNDING',
  'AGENT_FUNDING',
  'AGENT_DEFUNDING',
];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function lagosBoundary(value: string): string {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    !Number.isFinite(Date.parse(`${value}T00:00:00Z`)) ||
    new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value
  )
    throw new BadRequestException('Dates must be valid YYYY-MM-DD');
  return new Date(`${value}T00:00:00+01:00`).toISOString();
}

// One source row per business operation. Never join journal lines into the history.
export const HISTORY_SQL = `WITH history AS (
 SELECT t.id, 'WALLET_TRANSFER'::text AS type, t.status::text, COALESCE(t.payment_reference,t.reference,t.id::text) AS reference,
 t.created_at, t.completed_at, t.amount_minor::text, t.fee_minor::text, t.vat_minor::text, t.currency,
 posted.institution_id AS institution_id, ARRAY[t.journal_id]::uuid[] AS journals,
 jsonb_build_object('sourceWalletId',t.source_wallet_id,'destinationWalletId',t.destination_wallet_id,'failureCode',t.failure_code,'failureMessage',t.failure_message) AS investigation
 FROM transfers t JOIN wallet_accounts w ON w.id=t.source_wallet_id LEFT JOIN ledger_journals posted ON posted.id=t.journal_id
 UNION ALL
 SELECT t.id, 'CASH_TO_CASH', t.status, COALESCE(t.reference,t.id::text), t.created_at,
 COALESCE(t.claimed_at,t.expired_at),t.principal_minor::text,t.fee_minor::text,t.vat_minor::text,t.currency,
 j.institution_id, ARRAY[t.journal_id,t.claim_journal_id]::uuid[],
 jsonb_build_object('agentId',t.agent_id,'beneficiaryPhoneMasked','••••••' || right(t.beneficiary_phone,4),
 'claimantCustomerId',t.claimant_customer_id,'claimReference',t.claim_reference,'claimedAt',t.claimed_at,
 'expiresAt',t.expires_at,'expiredAt',t.expired_at,'updatedAt',t.updated_at,'totalMinor',t.total_minor::text,
 'redemptionMethod',(SELECT e.new_values->>'redemptionMethod' FROM audit_events e WHERE e.entity_type='AGENT_CASH_TO_CASH_CLAIM' AND e.action='CASH_TO_CASH_CLAIMED' AND e.entity_id=t.claim_journal_id ORDER BY e.occurred_at DESC,e.id DESC LIMIT 1))
 FROM cash_to_cash_transfers t JOIN ledger_journals j ON j.id=t.journal_id
 UNION ALL
 SELECT j.id,j.metadata->>'canonicalService',j.status::text,COALESCE(j.reference,j.id::text),j.created_at,j.posted_at,
 j.metadata->>'amountMinor','0','0',j.currency,j.institution_id,ARRAY[j.id]::uuid[],
 jsonb_build_object('agentId',j.metadata->>'agentId','customerId',COALESCE(j.metadata->>'customerId',j.metadata->>'recipientCustomerId'))
 FROM ledger_journals j WHERE j.metadata->>'canonicalService' IN ('CASH_IN','CASH_OUT') AND j.reversal_of_journal_id IS NULL
 UNION ALL
 SELECT fc.id,'WALLET_TO_BANK',fc.state,COALESCE(bo.operation_reference,fc.id::text),fc.created_at,fc.resolved_at,
 COALESCE(fb.beneficiary_amount_minor,fa.amount_minor)::text,COALESCE(fb.service_fee_minor,0)::text,COALESCE(fb.tax_minor,0)::text,fa.currency,
 j.institution_id,ARRAY[fc.reservation_journal_id,fc.resolution_journal_id]::uuid[],
 jsonb_build_object('principalType',fa.principal_type,'partyId',fa.principal_id,'walletId',fa.wallet_account_id,'providerReference',bo.provider_transaction_reference,'providerState',bo.state,'externalOperationId',fc.external_operation_id,'totalDebitMinor',fb.customer_debit_minor::text)
 FROM financial_commitments fc JOIN financial_authorizations fa ON fa.id=fc.authorization_id
 JOIN ledger_journals j ON j.id=fc.reservation_journal_id
 LEFT JOIN LATERAL (SELECT b.* FROM banking_outbound_operations b WHERE b.external_operation_id=fc.external_operation_id ORDER BY b.created_at,b.id LIMIT 1) bo ON true
 LEFT JOIN banking_operation_fee_bindings fb ON fb.external_operation_id=fc.external_operation_id
 UNION ALL
 SELECT r.id,'BANK_TO_WALLET',r.status,COALESCE(o.provider_reference,r.id::text),r.created_at,j.posted_at,
 r.amount_minor::text,'0','0',r.currency,j.institution_id,ARRAY[r.journal_id]::uuid[],
 jsonb_build_object('walletId',r.wallet_account_id,'provider',r.provider_key,'providerObservedAt',r.provider_observed_at,'identitySource','LEGACY_RECEIPT_WITHOUT_ENVIRONMENT')
 FROM inbound_funding_receipts r JOIN ledger_journals j ON j.id=r.journal_id
 LEFT JOIN LATERAL (SELECT x.provider_reference FROM inbound_funding_observations x WHERE x.provider_key=r.provider_key AND x.provider_reference_hash=r.provider_reference_hash AND x.evidence_hash=r.evidence_hash ORDER BY x.created_at,x.id LIMIT 1) o ON true
 WHERE r.status='CREDITED'
 UNION ALL
 SELECT b.id,'BANK_TO_WALLET',CASE WHEN r.id IS NOT NULL THEN 'CREDITED' ELSE b.verification_state END,b.provider_transaction_reference,b.recorded_at,j.posted_at,
 b.credited_amount_minor::text,b.provider_fee_minor::text,'0',b.currency,b.institution_id,ARRAY[COALESCE(r.journal_id,b.ledger_transaction_id)]::uuid[],
 jsonb_build_object('provider',b.provider_key,'providerPaymentReference',b.provider_payment_reference,'grossAmountMinor',b.gross_amount_minor::text,'paidAt',b.paid_at,'postingState',CASE WHEN r.id IS NOT NULL THEN 'FLOAT_CREDITED' WHEN b.ledger_transaction_id IS NULL THEN 'NOT_POSTED' ELSE 'POSTED' END,'floatReceiptId',r.id,'walletId',r.wallet_account_id,'identitySource','BANK_INTAKE')
 FROM banking_inbound_payments b
 LEFT JOIN banking_inbound_float_links identity ON identity.payment_id=b.id
 LEFT JOIN agent_float_funding_receipts r ON r.id=identity.float_receipt_id
 LEFT JOIN ledger_journals j ON j.id=r.journal_id
 UNION ALL
 SELECT r.id,'AGENT_FUNDING','CREDITED',r.provider_transaction_reference,r.credited_at,j.posted_at,r.amount_minor::text,'0','0',r.currency,r.institution_id,ARRAY[r.journal_id]::uuid[],
 jsonb_build_object('agentId',r.agent_id,'walletId',r.wallet_account_id,'provider',r.provider_key,'policyId',r.policy_id,'providerObservedAt',r.provider_observed_at,'fundingSource','INSTITUTION_BANK_RECEIPT')
 FROM agent_float_funding_receipts r JOIN ledger_journals j ON j.id=r.journal_id
 WHERE NOT EXISTS (SELECT 1 FROM banking_inbound_float_links identity WHERE identity.float_receipt_id=r.id)
 UNION ALL
 SELECT r.id,'CUSTOMER_FUNDING',r.status::text,r.reference,r.created_at,COALESCE(r.approved_at,r.rejected_at),r.amount_minor::text,'0','0',r.currency,COALESCE(scope.institution_id,j.institution_id),ARRAY[r.journal_id]::uuid[],
 jsonb_build_object('customerId',r.customer_id,'channel',r.channel,'externalReference',r.external_reference,'makerId',r.maker_id,'checkerId',r.checker_id,'rejectionReason',r.rejection_reason,'scopeEvidenceId',scope.attribution_id,'scopeCapturedAt',scope.captured_at)
 FROM customer_funding_requests r LEFT JOIN ledger_journals j ON j.id=r.journal_id
 LEFT JOIN customer_funding_scope_evidence scope ON scope.request_id=r.id
 UNION ALL
 SELECT r.id,CASE r.direction WHEN 'FUND' THEN 'AGENT_FUNDING' ELSE 'AGENT_DEFUNDING' END,r.status,r.reference,r.created_at,COALESCE(r.executed_at,r.rejected_at),r.amount_minor::text,'0','0',r.currency,j.institution_id,ARRAY[r.journal_id]::uuid[],
 jsonb_build_object('agentId',r.agent_id,'approvalId',r.approval_id,'makerId',r.maker_principal_id,'checkerId',r.checker_principal_id,'rejectionReason',r.rejection_reason)
 FROM agent_funding_requests r LEFT JOIN ledger_journals j ON j.id=r.journal_id
), scoped AS (SELECT * FROM history h WHERE ($1::boolean OR EXISTS (
 SELECT 1 FROM workforce_institution_assignments a WHERE a.principal_id=$2 AND a.status='ACTIVE' AND a.institution_id=h.institution_id
)))`;

type Request = { authorizationPrincipal?: AuthorizationPrincipal };
@Controller('internal/admin/transaction-history')
export class TransactionHistoryController {
  constructor(
    private readonly db: DataSource,
    private readonly auth: AuthorizationService,
  ) {}
  private async scope(req: Request) {
    await this.auth.requireFunction(
      req.authorizationPrincipal,
      'transaction.view',
      'transaction-history',
      ['OPERATOR', 'SERVICE', 'PRIVILEGED'],
    );
    return [
      Boolean(req.authorizationPrincipal?.scopes.includes('institution.attribution.view')),
      req.authorizationPrincipal!.principalId,
    ];
  }
  @Get()
  async list(@Req() req: Request, @Query() q: Record<string, string>) {
    const values: unknown[] = await this.scope(req);
    if (Object.values(q).some((value) => typeof value !== 'string')) {
      throw new BadRequestException('Query parameters must be single strings');
    }
    const conditions: string[] = [];
    const add = (sql: string, value: unknown) => {
      values.push(value);
      conditions.push(sql.replace('?', `$${values.length}`));
    };
    if (q.type) {
      if (!HISTORY_TYPES.includes(q.type))
        throw new BadRequestException('Unsupported transaction type');
      add('type = ?', q.type);
    }
    if (q.status) {
      if (!/^[A-Z_]{2,40}$/.test(q.status)) throw new BadRequestException('Invalid status');
      add('status = ?', q.status);
    }
    if (q.reference) {
      if (q.reference.length > 255) throw new BadRequestException('Reference too long');
      add('reference = ?', q.reference.trim());
    }
    if (q.from) add('created_at >= ?::timestamptz', lagosBoundary(q.from));
    if (q.to) {
      const end = lagosBoundary(q.to);
      add("created_at < (?::timestamptz + interval '1 day')", end);
    }
    if (q.from && q.to && q.from > q.to) throw new BadRequestException('Date range is reversed');
    const limit = q.limit === undefined ? 20 : Number(q.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100)
      throw new BadRequestException('limit must be 1–100');
    if (q.cursor) {
      let cursor: { at: string; type: string; id: string };
      try {
        cursor = JSON.parse(Buffer.from(q.cursor, 'base64url').toString()) as typeof cursor;
      } catch {
        throw new BadRequestException('Invalid cursor');
      }
      if (
        !cursor ||
        typeof cursor.id !== 'string' ||
        typeof cursor.type !== 'string' ||
        typeof cursor.at !== 'string' ||
        !UUID.test(cursor.id) ||
        !HISTORY_TYPES.includes(cursor.type) ||
        !Number.isFinite(Date.parse(cursor.at))
      )
        throw new BadRequestException('Invalid cursor');
      values.push(cursor.at, cursor.type, cursor.id);
      conditions.push(
        `(created_at,type,id) < ($${values.length - 2}::timestamptz,$${values.length - 1},$${values.length}::uuid)`,
      );
    }
    values.push(limit + 1);
    const rows: Record<string, unknown>[] = await this.db.query(
      `${HISTORY_SQL} SELECT id,type,status,reference,to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "cursorAt",created_at AS "createdAt",amount_minor AS "amountMinor",fee_minor AS "feeMinor",currency FROM scoped ${conditions.length ? 'WHERE ' + conditions.join(' AND ') : ''} ORDER BY created_at DESC,type DESC,id DESC LIMIT $${values.length}`,
      values,
    );
    const more = rows.length > limit;
    const items = rows.slice(0, limit);
    const last = items[items.length - 1]!;
    return {
      items,
      nextCursor: more
        ? Buffer.from(JSON.stringify({ at: last.cursorAt, type: last.type, id: last.id })).toString(
            'base64url',
          )
        : null,
    };
  }
  @Get(':type/:id')
  async detail(@Req() req: Request, @Param('type') type: string, @Param('id') id: string) {
    const values = await this.scope(req);
    if (!HISTORY_TYPES.includes(type) || !UUID.test(id))
      throw new BadRequestException('Invalid transaction key');
    const rows: Record<string, unknown>[] = await this.db.query(
      `${HISTORY_SQL} SELECT id,type,status,reference,created_at AS "createdAt",completed_at AS "completedAt",amount_minor AS "amountMinor",fee_minor AS "feeMinor",vat_minor AS "vatMinor",currency,institution_id AS "institutionId",investigation, CASE WHEN $5::boolean THEN journals ELSE NULL END AS journals FROM scoped WHERE (type=$3 AND id=$4::uuid) OR
 ($3='AGENT_FUNDING' AND type='BANK_TO_WALLET' AND EXISTS (
 SELECT 1 FROM banking_inbound_float_links identity WHERE identity.payment_id=scoped.id AND identity.float_receipt_id=$4::uuid))`,
      [...values, type, id, req.authorizationPrincipal!.scopes.includes('ledger.view')],
    );
    if (!rows.length) throw new NotFoundException('Transaction not found');
    return rows[0];
  }
}
