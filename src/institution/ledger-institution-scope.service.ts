import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AuditService } from '../operations/audit.service';
import {
  FinancialInstitutionStatus,
  LedgerInstitutionalPurpose,
  LedgerInstitutionalScope,
} from './institution.enums';
import type {
  DesignatePlatformLedgerAccountCommand,
  InstitutionLedgerAccountView,
  OpenInstitutionLedgerAccountCommand,
  UnattributedFinancialAccountView,
} from './institution.types';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface LedgerAccountRow {
  id: string;
  code: string;
  name: string;
  account_type: string;
  normal_balance: string;
  currency: string;
  institutional_scope: LedgerInstitutionalScope;
  institution_id: string | null;
  institutional_purpose: LedgerInstitutionalPurpose | null;
  is_active: boolean;
}

const INSTITUTION_ONLY_PURPOSES: readonly LedgerInstitutionalPurpose[] = [
  LedgerInstitutionalPurpose.SETTLEMENT,
  LedgerInstitutionalPurpose.SUSPENSE,
  LedgerInstitutionalPurpose.CLEARING,
];

/**
 * Institutional ledger account administration and unattributed-account visibility.
 *
 * Two explicit administrative paths exist, and neither is an isolation bypass:
 *
 *  - an **institution-specific settlement / suspense / clearing** account is created directly under
 *    an operationally approved institution (`institutional_scope = 'INSTITUTION'`);
 *  - a **platform-level** account can be explicitly designated (`institutional_scope = 'PLATFORM'`)
 *    only while it has no wallet and no posted history.
 *
 * Customer-funds ledger accounts are attributed **only** through the governed wallet attribution
 * workflow. Historical accounts stay `UNATTRIBUTED` forever and are reported, never guessed.
 */
@Injectable()
export class LedgerInstitutionScopeService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly auditService: AuditService,
  ) {}

  async openInstitutionAccount(
    command: OpenInstitutionLedgerAccountCommand,
  ): Promise<InstitutionLedgerAccountView> {
    const institutionId = this.uuid(command.institutionId, 'institutionId');
    const code = this.requiredText(command.code, 'code', 100);
    const name = this.requiredText(command.name, 'name', 160);
    if (!INSTITUTION_ONLY_PURPOSES.includes(command.purpose)) {
      throw new BadRequestException(
        'Institution ledger accounts must be SETTLEMENT, SUSPENSE or CLEARING accounts',
      );
    }
    if (!['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE'].includes(command.accountType)) {
      throw new BadRequestException('accountType is not registered');
    }
    if (!['DEBIT', 'CREDIT'].includes(command.normalBalance)) {
      throw new BadRequestException('normalBalance is not registered');
    }
    if (!/^[A-Z]{3}$/.test(command.currency ?? '')) {
      throw new BadRequestException('currency must be an ISO-4217 code');
    }

    return this.dataSource.transaction(async (manager) => {
      const institutions: Array<{ status: FinancialInstitutionStatus }> = await manager.query(
        `SELECT status FROM financial_institutions WHERE id = $1 AND deleted_at IS NULL`,
        [institutionId],
      );
      if (institutions.length === 0) throw new NotFoundException('Institution not found');
      if (institutions[0]!.status !== FinancialInstitutionStatus.APPROVED) {
        throw new ConflictException(
          `Institution is ${institutions[0]!.status} and cannot open institutional ledger accounts`,
        );
      }
      const existing: Array<{ id: string }> = await manager.query(
        `SELECT id FROM ledger_accounts WHERE code = $1 LIMIT 1`,
        [code],
      );
      if (existing.length > 0) throw new ConflictException('Ledger account code already exists');

      const rows: LedgerAccountRow[] = await manager.query(
        `INSERT INTO ledger_accounts
           (id, code, name, account_type, normal_balance, currency, accounting_unit,
            allow_negative_balance, is_active, institutional_scope, institution_id,
            institutional_purpose)
         VALUES (gen_random_uuid(),$1::varchar,$2::varchar,$3::varchar,$4::varchar,$5::varchar,
                 'CUSTOMER_FUNDS',$6::boolean,true,'INSTITUTION',$7::uuid,$8::varchar)
         RETURNING *`,
        [
          code,
          name,
          command.accountType,
          command.normalBalance,
          command.currency,
          command.allowNegativeBalance ?? false,
          institutionId,
          command.purpose,
        ],
      );
      const account = rows[0]!;
      await this.auditService.record(manager, {
        entityType: 'LEDGER_ACCOUNT',
        entityId: account.id,
        action: 'INSTITUTION_LEDGER_ACCOUNT_OPENED',
        actor: command.principal.principalId,
        newValues: {
          code,
          institutionId,
          purpose: command.purpose,
          accountType: command.accountType,
          currency: command.currency,
        },
      });
      return this.toView(account);
    });
  }

  async designatePlatformAccount(
    command: DesignatePlatformLedgerAccountCommand,
  ): Promise<InstitutionLedgerAccountView> {
    const ledgerAccountId = this.uuid(command.ledgerAccountId, 'ledgerAccountId');
    return this.dataSource.transaction(async (manager) => {
      const rows: LedgerAccountRow[] = await manager.query(
        `WITH changed AS (
           UPDATE ledger_accounts
              SET institutional_scope = 'PLATFORM',
                  institutional_purpose = 'PLATFORM_OPERATIONS',
                  updated_at = clock_timestamp()
            WHERE id = $1 AND institutional_scope = 'UNATTRIBUTED'
            RETURNING *
         ) SELECT * FROM changed`,
        [ledgerAccountId],
      );
      if (rows.length !== 1) {
        const existing: Array<{ institutional_scope: string }> = await manager.query(
          `SELECT institutional_scope FROM ledger_accounts WHERE id = $1`,
          [ledgerAccountId],
        );
        if (existing.length === 0) throw new NotFoundException('Ledger account not found');
        throw new ConflictException(
          `Only an UNATTRIBUTED ledger account can be designated platform-level (current: ${existing[0]!.institutional_scope})`,
        );
      }
      const account = rows[0]!;
      await this.auditService.record(manager, {
        entityType: 'LEDGER_ACCOUNT',
        entityId: account.id,
        action: 'PLATFORM_LEDGER_ACCOUNT_DESIGNATED',
        actor: command.principal.principalId,
        previousValues: { institutionalScope: 'UNATTRIBUTED' },
        newValues: {
          institutionalScope: 'PLATFORM',
          purpose: LedgerInstitutionalPurpose.PLATFORM_OPERATIONS,
        },
      });
      return this.toView(account);
    });
  }

  async listAccounts(institutionId: string): Promise<InstitutionLedgerAccountView[]> {
    const rows: LedgerAccountRow[] = await this.dataSource.query(
      `SELECT * FROM ledger_accounts WHERE institution_id = $1 ORDER BY code ASC`,
      [this.uuid(institutionId, 'institutionId')],
    );
    return rows.map((row) => this.toView(row));
  }

  /** Read-only: financial accounts with no authoritative institutional owner. */
  async listUnattributed(options: { limit?: number; entity?: 'WALLET' | 'LEDGER_ACCOUNT' } = {}) {
    const limit = this.limit(options.limit);
    const entity = options.entity ?? null;
    const rows: Array<{
      entity: string;
      entity_id: string;
      owner_class: string | null;
      owner_reference: string | null;
      currency: string;
      status: string;
      ledger_account_id: string;
      ledger_line_count: string;
      balance_minor: string;
    }> = await this.dataSource.query(
      `SELECT entity, entity_id, owner_class, owner_reference, currency, status,
              ledger_account_id, ledger_line_count::text AS ledger_line_count, balance_minor
         FROM unattributed_financial_accounts
        WHERE ($1::text IS NULL OR entity = $1::text)
        ORDER BY entity ASC, entity_id ASC
        LIMIT $2`,
      [entity, limit],
    );
    return rows.map(
      (row): UnattributedFinancialAccountView => ({
        entity: row.entity as 'WALLET' | 'LEDGER_ACCOUNT',
        entityId: row.entity_id,
        ownerClass: row.owner_class,
        ownerReference: row.owner_reference,
        currency: row.currency,
        status: row.status,
        ledgerAccountId: row.ledger_account_id,
        ledgerLineCount: Number(row.ledger_line_count),
        balanceMinor: row.balance_minor,
      }),
    );
  }

  async coverage(): Promise<
    Array<{
      institutionId: string;
      code: string;
      institutionStatus: string;
      activeEnrolments: number;
      activeAffiliations: number;
      attributedWallets: number;
      institutionalLedgerAccounts: number;
    }>
  > {
    const rows: Array<{
      institution_id: string;
      code: string;
      institution_status: string;
      active_enrolments: string;
      active_affiliations: string;
      attributed_wallets: string;
      institutional_ledger_accounts: string;
    }> = await this.dataSource.query(
      `SELECT institution_id, code, institution_status, active_enrolments::text,
              active_affiliations::text, attributed_wallets::text,
              institutional_ledger_accounts::text
         FROM institution_financial_coverage
        ORDER BY code ASC`,
    );
    return rows.map((row) => ({
      institutionId: row.institution_id,
      code: row.code,
      institutionStatus: row.institution_status,
      activeEnrolments: Number(row.active_enrolments),
      activeAffiliations: Number(row.active_affiliations),
      attributedWallets: Number(row.attributed_wallets),
      institutionalLedgerAccounts: Number(row.institutional_ledger_accounts),
    }));
  }

  private toView(row: LedgerAccountRow): InstitutionLedgerAccountView {
    return {
      id: row.id,
      code: row.code,
      name: row.name,
      accountType: row.account_type,
      normalBalance: row.normal_balance,
      currency: row.currency,
      institutionalScope: row.institutional_scope,
      institutionId: row.institution_id,
      institutionalPurpose: row.institutional_purpose,
      isActive: row.is_active,
    };
  }

  private limit(value: number | undefined): number {
    if (value === undefined || value === null) return 200;
    if (!Number.isInteger(value) || value < 1 || value > 500) {
      throw new BadRequestException('limit must be an integer between 1 and 500');
    }
    return value;
  }

  private uuid(value: string, field: string): string {
    const normalized = value?.trim().toLowerCase();
    if (!normalized || !UUID_PATTERN.test(normalized)) {
      throw new BadRequestException(`${field} must be a UUID`);
    }
    return normalized;
  }

  private requiredText(value: string | undefined | null, field: string, max: number): string {
    const trimmed = typeof value === 'string' ? value.trim() : '';
    if (!trimmed || trimmed.length > max) {
      throw new BadRequestException(`${field} is required and must be at most ${max} characters`);
    }
    return trimmed;
  }
}
