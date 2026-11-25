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

export const HISTORY_TYPES = ['WALLET_TRANSFER', 'CASH_IN', 'CASH_OUT', 'CASH_TO_CASH'];
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
 CASE WHEN t.journal_id IS NOT NULL THEN posted.institution_id ELSE w.institution_id END AS institution_id, ARRAY[t.journal_id]::uuid[] AS journals,
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
      `${HISTORY_SQL} SELECT id,type,status,reference,created_at AS "createdAt",completed_at AS "completedAt",amount_minor AS "amountMinor",fee_minor AS "feeMinor",vat_minor AS "vatMinor",currency,institution_id AS "institutionId",investigation, CASE WHEN $5::boolean THEN journals ELSE NULL END AS journals FROM scoped WHERE type=$3 AND id=$4::uuid`,
      [...values, type, id, req.authorizationPrincipal!.scopes.includes('ledger.view')],
    );
    if (!rows.length) throw new NotFoundException('Transaction not found');
    return rows[0];
  }
}
