import { ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';

import type { AuthorizationPrincipal } from '../../authorization/authorization.types';
import { InstitutionWorkforceScopeService } from '../../institution/institution-workforce-scope.service';
import { AuditService } from '../../operations/audit.service';
import {
  maskWalletIdentifier,
  parseStatementPeriod,
  statementFileName,
  sanitizeNarration,
} from './wallet-statement.format';
import {
  defaultStatementAssets,
  renderWalletStatement,
  type RenderedStatement,
  type StatementAssets,
} from './wallet-statement.pdf';
import { WalletStatementService } from './wallet-statement.service';
import type { WalletStatementDocument } from './wallet-statement.types';

export interface StatementRequest {
  readonly customerId: string;
  readonly walletId: string;
  readonly from: string;
  readonly to: string;
  readonly principal: AuthorizationPrincipal | undefined;
}

export interface GeneratedStatement extends RenderedStatement {
  readonly fileName: string;
  readonly statementId: string;
  readonly rowCount: number;
  readonly walletLabel: string;
}

/**
 * Produces a customer wallet statement, enforcing scope and recording the attempt.
 *
 * ## Scope is decided here, on every request, from authoritative rows
 *
 * Three questions are answered in order, and any failure ends the request:
 *
 *  1. **Customer** — the customer must exist and be visible to the workforce surface at all.
 *  2. **Wallet** — the wallet must exist and must belong to that customer. A wallet id from
 *     another customer is a 404, exactly as on the balance endpoint, so a caller cannot use this
 *     route to discover which wallet ids exist.
 *  3. **Institution** — the wallet's institutional attribution decides who may read it, using the
 *     same {@link InstitutionWorkforceScopeService} the rest of the platform uses. A wallet
 *     attributed to an institution is reachable only by platform-level staff or by a principal
 *     holding a current ACTIVE assignment to that exact institution. An *unattributed* wallet has
 *     no institutional owner to check against, so it is treated as platform-only: guessing that it
 *     belongs to the caller's institution is exactly the assumption that would leak it.
 *
 * ## Every attempt is recorded, including the refusals
 *
 * A statement is a copy of a customer's financial record. Both the successes and the refusals are
 * written to the audit trail with the operator, the wallet, the requested period and the outcome —
 * a refusal is evidence that someone tried.
 */
@Injectable()
export class WalletStatementRenderService {
  private readonly logger = new Logger(WalletStatementRenderService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly statements: WalletStatementService,
    private readonly institutionScope: InstitutionWorkforceScopeService,
    private readonly audit: AuditService,
  ) {}

  async generate(
    request: StatementRequest,
    assets: StatementAssets = defaultStatementAssets(),
  ): Promise<GeneratedStatement> {
    const statementId = randomUUID();
    const period = parseStatementPeriod(request.from, request.to);
    const actor = request.principal?.principalId;
    if (!actor) throw new ForbiddenException('Authentication required');

    /*
     * `maskWalletIdentifier` is called on the requested id before it is validated, so the audit row
     * records the same label the document would have carried — never an internal id it did not need.
     */
    const walletLabel = /^[0-9a-f-]{36}$/i.test(request.walletId)
      ? maskWalletIdentifier(request.walletId)
      : '';

    try {
      const record = await this.authorize(request);
      const activity = await this.statements.read(record.context, period);
      const customerName = await this.customerDisplayName(request.customerId);

      const document: WalletStatementDocument = {
        header: {
          customerName,
          walletLabel: maskWalletIdentifier(record.context.walletId),
          currency: record.context.currency,
          walletStatus: record.context.status,
          periodFrom: period.from,
          periodTo: period.to,
          generatedAt: new Date().toISOString(),
          statementId,
        },
        balances: activity.balances,
        rows: activity.rows,
      };

      const rendered = await renderWalletStatement(document, assets);
      const fileName = statementFileName({
        walletId: record.context.walletId,
        from: period.from,
        to: period.to,
      });

      await this.record(statementId, actor, {
        outcome: 'SUCCEEDED',
        customerId: request.customerId,
        walletId: record.context.walletId,
        institutionId: record.context.institutionId,
        from: period.from,
        to: period.to,
        rowCount: activity.rows.length,
        pageCount: rendered.pageCount,
        fileName,
        balanceState: {
          openingAvailable: activity.balances.openingMinor !== null,
          closingAvailable: activity.balances.closingMinor !== null,
          runningAvailable: activity.rows.every((row) => row.runningMinor !== null),
        },
      });

      return {
        ...rendered,
        fileName,
        statementId,
        rowCount: activity.rows.length,
        walletLabel: document.header.walletLabel,
      };
    } catch (error) {
      await this.record(statementId, actor, {
        outcome: 'REFUSED',
        customerId: request.customerId,
        walletId: safeId(request.walletId),
        from: request.from,
        to: request.to,
        reason: error instanceof Error ? error.message.slice(0, 300) : 'Unknown statement failure',
        attemptedWalletLabel: walletLabel || null,
      });
      throw error;
    }
  }

  /**
   * Institution scope for a wallet already resolved to its institutional attribution.
   *
   * Exposed so the read-only preview enforces the identical rule as the downloadable document —
   * one implementation, two call sites, no chance of the preview being the softer of the two.
   */
  async assertInstitutionScope(
    principal: AuthorizationPrincipal | undefined,
    institutionId: string | null,
  ): Promise<void> {
    if (institutionId === null) {
      if (!this.institutionScope.hasPlatformAuthority(principal)) {
        // Fail closed and indistinguishable from a missing wallet: an unattributed wallet has no
        // institution to prove access to, so nobody but platform-level staff may read it.
        throw new NotFoundException('Wallet not found');
      }
      return;
    }
    await this.institutionScope.assertCanAccessInstitution(principal, institutionId);
  }

  /** Customer existence, wallet ownership, and institution scope — in that order. */
  private async authorize(request: StatementRequest) {
    const customers: Array<{ id: string }> = await this.dataSource.query(
      `SELECT id::text AS id FROM customers
        WHERE id = $1 AND (deleted_at IS NULL OR status = 'CLOSED')`,
      [request.customerId],
    );
    if (customers.length === 0) throw new NotFoundException('Customer not found');

    const context = await this.statements.loadContext(request.walletId);
    if (context.customerId !== request.customerId) {
      throw new NotFoundException('Wallet not found');
    }

    await this.assertInstitutionScope(request.principal, context.institutionId);

    return { context };
  }

  /**
   * Customer-facing name for the heading.
   *
   * Uses the active profile's display name, falling back to the legal name, then to the masked
   * customer reference. A statement addressed to "mn-••••1234" is worse than one addressed to a
   * name but far better than one addressed to an internal customer id.
   */
  private async customerDisplayName(customerId: string): Promise<string> {
    const rows: Array<{
      display_name: string | null;
      legal_name: string | null;
      reference: string | null;
    }> = await this.dataSource.query(
      `SELECT p.display_name, p.legal_name, c.reference
         FROM customers c
         LEFT JOIN LATERAL (
           SELECT display_name, legal_name FROM customer_profiles
            WHERE customer_id = c.id AND is_active = TRUE AND deleted_at IS NULL
            ORDER BY created_at DESC LIMIT 1
         ) p ON TRUE
        WHERE c.id = $1`,
      [customerId],
    );
    const row = rows[0];
    const name = row?.display_name?.trim() || row?.legal_name?.trim();
    if (name) return sanitizeNarration(name) ?? 'MonieNaija customer';
    const reference = row?.reference ?? '';
    const masked = reference.replace(
      /^(mn-)(\d{6,15})$/i,
      (_all, prefix: string, digits: string) => `${prefix}••••${digits.slice(-4)}`,
    );
    return masked.trim() || 'MonieNaija customer';
  }

  /**
   * Writes one audit row per attempt.
   *
   * The audit trail is why this action is accountable, so a failure to write it fails the request
   * rather than handing over a document nobody can account for.
   */
  private async record(
    statementId: string,
    actor: string,
    detail: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.dataSource.transaction(async (manager) => {
        await this.audit.record(manager, {
          entityType: 'CUSTOMER_WALLET_STATEMENT',
          entityId: statementId,
          action: 'CUSTOMER_WALLET_STATEMENT_GENERATED',
          actor: actor.slice(0, 160),
          newValues: { statementId, format: 'PDF', ...detail },
        });
      });
    } catch (error) {
      this.logger.error('Wallet statement could not be recorded in the audit trail');
      throw error;
    }
  }
}

/** Keeps a malformed wallet id out of the audit row's uuid-free text fields. */
function safeId(value: string): string | null {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value ?? '')
    ? value
    : null;
}
