import {
  BadRequestException,
  Controller,
  Get,
  Query,
  Req,
} from '@nestjs/common';
import { DataSource } from 'typeorm';

import { AuthorizationService } from '../authorization/authorization.service';
import type { AuthorizationPrincipal } from '../authorization/authorization.types';

interface AuthenticatedRequest {
  authorizationPrincipal?: AuthorizationPrincipal;
}

interface CashToCashOperationRow {
  id: string;
  agent_id: string;
  agent_reference: string | null;
  beneficiary_phone: string;
  principal_minor: string;
  fee_minor: string;
  vat_minor: string;
  total_minor: string;
  currency: string;
  status: string;
  journal_id: string;
  reference: string | null;
  claimant_customer_id: string | null;
  claim_journal_id: string | null;
  claim_reference: string | null;
  redemption_method: string | null;
  claimed_at: Date | string | null;
  expires_at: Date | string;
  expired_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ALLOWED_STATUSES = new Set(['UNCLAIMED', 'CLAIMED', 'EXPIRED']);
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

/**
 * Read-only workforce investigation surface for ordinary Agent V1 Cash-to-Cash transfers.
 * It deliberately exposes no bearer/code hashes, idempotency keys, request fingerprints, or
 * mutation/reversal commands. Cash settlement/recovery policy remains outside this screen.
 */
@Controller('internal/admin/cash-to-cash')
export class AgentCashToCashOperationsController {
  constructor(
    private readonly dataSource: DataSource,
    private readonly authorizationService: AuthorizationService,
  ) {}

  @Get('transfers')
  async listTransfers(
    @Req() req: AuthenticatedRequest,
    @Query('page') pageRaw?: string,
    @Query('limit') limitRaw?: string,
    @Query('status') statusRaw?: string,
    @Query('agentId') agentIdRaw?: string,
    @Query('transferId') transferIdRaw?: string,
    @Query('reference') referenceRaw?: string,
  ) {
    await this.authorizationService.requireFunction(
      req.authorizationPrincipal,
      'transaction.view',
      'agent-cash-to-cash-operations',
      ['OPERATOR', 'SERVICE', 'PRIVILEGED'],
    );

    const page = this.parsePositiveInteger(pageRaw, 1, 'page', 1_000_000);
    const limit = Math.min(
      MAX_PAGE_SIZE,
      this.parsePositiveInteger(limitRaw, DEFAULT_PAGE_SIZE, 'limit', MAX_PAGE_SIZE),
    );
    const status = statusRaw?.trim().toUpperCase();
    if (status && !ALLOWED_STATUSES.has(status)) {
      throw new BadRequestException('status must be UNCLAIMED, CLAIMED, or EXPIRED');
    }
    const agentId = this.validateOptionalUuid(agentIdRaw, 'agentId');
    const transferId = this.validateOptionalUuid(transferIdRaw, 'transferId');
    const reference = referenceRaw?.trim();
    if (reference && reference.length > 255) {
      throw new BadRequestException('reference must be at most 255 characters');
    }

    const filters: string[] = [];
    const values: unknown[] = [];
    const addFilter = (column: string, value: unknown) => {
      values.push(value);
      filters.push(`${column} = $${values.length}`);
    };
    if (status) addFilter('t.status', status);
    if (agentId) addFilter('t.agent_id', agentId);
    if (transferId) addFilter('t.id', transferId);
    if (reference) addFilter('t.reference', reference);
    const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';

    const countRows: Array<{ total: string }> = await this.dataSource.query(
      `SELECT count(*)::text AS total FROM cash_to_cash_transfers t ${where}`,
      values,
    );
    const total = Number(countRows[0]?.total ?? 0);
    const offset = (page - 1) * limit;
    const rows: CashToCashOperationRow[] = await this.dataSource.query(
      `SELECT t.id::text AS id,
              t.agent_id::text AS agent_id,
              a.reference AS agent_reference,
              t.beneficiary_phone,
              t.principal_minor::text AS principal_minor,
              t.fee_minor::text AS fee_minor,
              t.vat_minor::text AS vat_minor,
              t.total_minor::text AS total_minor,
              t.currency,
              t.status,
              t.journal_id::text AS journal_id,
              t.reference,
              t.claimant_customer_id::text AS claimant_customer_id,
              t.claim_journal_id::text AS claim_journal_id,
              t.claim_reference,
              (SELECT e.new_values->>'redemptionMethod'
                 FROM audit_events e
                WHERE e.entity_type = 'AGENT_CASH_TO_CASH_CLAIM'
                  AND e.action = 'CASH_TO_CASH_CLAIMED'
                  AND e.entity_id = t.claim_journal_id
                ORDER BY e.occurred_at DESC
                LIMIT 1) AS redemption_method,
              t.claimed_at,
              t.expires_at,
              t.expired_at,
              t.created_at,
              t.updated_at
         FROM cash_to_cash_transfers t
         LEFT JOIN agents a ON a.id = t.agent_id
         ${where}
        ORDER BY t.created_at DESC, t.id DESC
        LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
      [...values, limit, offset],
    );

    return {
      data: rows.map((row) => ({
        id: row.id,
        agentId: row.agent_id,
        agentReference: row.agent_reference,
        beneficiaryPhoneMasked: this.maskPhone(row.beneficiary_phone),
        principalMinor: row.principal_minor,
        feeMinor: row.fee_minor,
        vatMinor: row.vat_minor,
        totalMinor: row.total_minor,
        currency: row.currency,
        status: row.status,
        journalId: row.journal_id,
        reference: row.reference,
        claimantCustomerId: row.claimant_customer_id,
        claimJournalId: row.claim_journal_id,
        claimReference: row.claim_reference,
        redemptionMethod: this.safeRedemptionMethod(row.redemption_method),
        claimedAt: row.claimed_at,
        expiresAt: row.expires_at,
        expiredAt: row.expired_at,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      })),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  private parsePositiveInteger(
    raw: string | undefined,
    fallback: number,
    field: string,
    maximum: number,
  ): number {
    if (raw === undefined || raw.trim() === '') return fallback;
    if (!/^\d+$/.test(raw.trim())) {
      throw new BadRequestException(`${field} must be a positive integer`);
    }
    const parsed = Number(raw);
    if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > maximum) {
      throw new BadRequestException(`${field} must be between 1 and ${maximum}`);
    }
    return parsed;
  }

  private validateOptionalUuid(raw: string | undefined, field: string): string | undefined {
    const value = raw?.trim();
    if (!value) return undefined;
    if (!UUID_PATTERN.test(value)) throw new BadRequestException(`${field} must be a UUID`);
    return value;
  }

  private maskPhone(phone: string): string {
    const normalized = String(phone ?? '').replace(/\D/g, '');
    if (normalized.length <= 4) return '••••';
    return `${'•'.repeat(Math.max(4, normalized.length - 4))}${normalized.slice(-4)}`;
  }

  private safeRedemptionMethod(value: string | null): 'CUSTOMER_WALLET' | 'AGENT_CASH' | null {
    if (value === 'CUSTOMER_WALLET' || value === 'AGENT_CASH') return value;
    return null;
  }
}
