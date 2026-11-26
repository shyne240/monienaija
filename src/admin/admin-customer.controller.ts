import {
  Controller,
  Get,
  Header,
  NotFoundException,
  Param,
  Query,
  Req,
  Res,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, IsNull, Repository } from 'typeorm';

import { Customer } from '../customer/customer.entity';
import { CustomerContactMethod } from '../customer/customer-contact-method.entity';
import { ContactMethodType, CustomerStatus } from '../customer/customer.enums';
import {
  maskContactValue,
  maskCustomerReference,
  maskPhoneNumber,
} from '../customer/customer-privacy';
import type { AuthorizationPrincipal } from '../authorization/authorization.types';
import { CustomerDirectoryQueryDto } from './dto/customer-directory-query.dto';
import { AuthorizationService } from '../authorization/authorization.service';
import { CustomerTransactionHistoryService } from '../customer-app/customer-transaction-history.service';
import { CustomerActivationReadinessService } from '../customer-onboarding/customer-activation-readiness.service';
import { WalletService } from '../wallet/wallet.service';
import { SupportService } from '../support/support.service';
import { WalletAccount } from '../wallet/wallet-account.entity';
import { getRequestContext } from '../production/request-context';
import {
  maskWalletIdentifier,
  parseStatementPeriod,
} from './wallet-statement/wallet-statement.format';
import { WalletStatementRenderService } from './wallet-statement/wallet-statement-render.service';
import {
  financialOrUnavailable,
  WalletStatementService,
} from './wallet-statement/wallet-statement.service';

interface AuthenticatedRequest {
  headers: Record<string, string | string[] | undefined>;
  authorizationPrincipal?: AuthorizationPrincipal;
}

@Controller('internal/customers')
export class AdminCustomerController {
  constructor(
    @InjectRepository(Customer) private readonly repo: Repository<Customer>,
    @InjectRepository(WalletAccount) private readonly walletRepo: Repository<WalletAccount>,
    private readonly dataSource: DataSource,
    private readonly transactionHistoryService: CustomerTransactionHistoryService,
    private readonly walletService: WalletService,
    private readonly supportService: SupportService,
    private readonly auth: AuthorizationService,
    private readonly activationReadiness: CustomerActivationReadinessService,
    private readonly statementService: WalletStatementService,
    private readonly statementRenderer: WalletStatementRenderService,
  ) {}

  @Get()
  async list(@Req() req: AuthenticatedRequest, @Query() query: CustomerDirectoryQueryDto) {
    this.requireWorkforce(req);
    await this.requireFunction(req, 'customer.view');

    const principal = req.authorizationPrincipal;
    const canViewContactMethods = Boolean(
      principal?.scopes.includes('customer.view_contact_methods'),
    );
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const parameters: unknown[] = [];
    const predicates = ["(customer.deleted_at IS NULL OR customer.status = 'CLOSED')"];
    const addPredicate = (sql: string, value: unknown) => {
      parameters.push(value);
      predicates.push(sql.replace('?', `$${parameters.length}`));
    };

    if (query.status) addPredicate('customer.status = ?', query.status);
    if (query.type) addPredicate('customer.customer_type = ?', query.type);
    if (query.kycLevel) addPredicate('customer.kyc_level = ?', query.kycLevel);
    if (query.kycStatus) addPredicate('customer.kyc_status = ?', query.kycStatus);

    if (query.search) {
      const searchPattern = `%${query.search}%`;
      parameters.push(searchPattern);
      const searchParameter = `$${parameters.length}`;
      const searchFields = [
        `COALESCE(profile.display_name, '') ILIKE ${searchParameter}`,
        `COALESCE(profile.legal_name, '') ILIKE ${searchParameter}`,
        `customer.reference ILIKE ${searchParameter} AND customer.reference !~* '^mn-[0-9]{6,15}$'`,
      ];
      if (canViewContactMethods) {
        searchFields.push(
          `EXISTS (
            SELECT 1 FROM customer_contact_methods searched_contact
            WHERE searched_contact.customer_id = customer.id
              AND searched_contact.deleted_at IS NULL
              AND (searched_contact.value ILIKE ${searchParameter}
                OR searched_contact.normalized_value ILIKE ${searchParameter})
          )`,
        );
      }
      predicates.push(`(${searchFields.join(' OR ')})`);
    }

    const contactJoin = canViewContactMethods
      ? `LEFT JOIN LATERAL (
          SELECT contact.type, contact.value, contact.verified_at
          FROM customer_contact_methods contact
          WHERE contact.customer_id = customer.id
            AND contact.deleted_at IS NULL
            AND contact.is_primary = TRUE
          ORDER BY contact.is_primary DESC,
            CASE WHEN contact.type = 'PHONE' THEN 0 ELSE 1 END,
            contact.created_at DESC,
            contact.id DESC
          LIMIT 1
        ) primary_contact ON TRUE`
      : '';
    const contactProjection = canViewContactMethods
      ? `primary_contact.type AS "contactType",
        primary_contact.value AS "contactValue",
        primary_contact.verified_at AS "contactVerifiedAt"`
      : `NULL::text AS "contactType",
        NULL::text AS "contactValue",
        NULL::timestamptz AS "contactVerifiedAt"`;
    const fromAndJoins = `
      FROM customers customer
      LEFT JOIN customer_profiles profile
        ON profile.customer_id = customer.id
        AND profile.is_active = TRUE
        AND profile.deleted_at IS NULL
      ${contactJoin}
    `;
    const whereSql = predicates.join(' AND ');
    const countRows: Array<{ total: string }> = await this.dataSource.query(
      `SELECT COUNT(DISTINCT customer.id)::text AS total ${fromAndJoins} WHERE ${whereSql}`,
      parameters,
    );
    const total = Number(countRows[0]?.total ?? '0');
    const offset = (page - 1) * limit;
    const rows: Array<{
      id: string;
      reference: string;
      type: string;
      status: string;
      kycLevel: string;
      kycStatus: string;
      createdAt: Date;
      displayName: string | null;
      legalName: string | null;
      contactType: string | null;
      contactValue: string | null;
      contactVerifiedAt: Date | null;
    }> = await this.dataSource.query(
      `SELECT
        customer.id::text AS id,
        customer.reference AS reference,
        customer.customer_type AS type,
        customer.status AS status,
        customer.kyc_level AS "kycLevel",
        customer.kyc_status AS "kycStatus",
        customer.created_at AS "createdAt",
        profile.display_name AS "displayName",
        profile.legal_name AS "legalName",
        ${contactProjection}
      ${fromAndJoins}
      WHERE ${whereSql}
      ORDER BY customer.created_at DESC, customer.id DESC
      LIMIT $${parameters.length + 1} OFFSET $${parameters.length + 2}`,
      [...parameters, limit, offset],
    );

    const data = rows.map((row) => ({
      id: row.id,
      reference: maskCustomerReference(row.reference),
      type: row.type,
      status: row.status,
      kycLevel: row.kycLevel,
      kycStatus: row.kycStatus,
      createdAt: row.createdAt,
      displayName: row.displayName,
      legalName: row.legalName,
      primaryContact:
        canViewContactMethods && row.contactType && row.contactValue
          ? {
              type: row.contactType,
              maskedValue: maskContactValue(row.contactType, row.contactValue),
              isVerified: row.contactVerifiedAt !== null,
            }
          : null,
    }));

    return {
      data,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      hasNextPage: page * limit < total,
      hasPreviousPage: page > 1,
    };
  }

  @Get(':id')
  async getOne(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    this.requireWorkforce(req);
    await this.requireFunction(req, 'customer.view');
    this.assertUuid(id, 'id');
    const customer = await this.findVisibleCustomer(id);
    if (!customer) throw new NotFoundException('Customer not found');
    const profiles: Array<{ display_name: string | null; legal_name: string | null }> =
      await this.dataSource.query(
        `SELECT display_name, legal_name
       FROM customer_profiles
       WHERE customer_id = $1 AND is_active = TRUE AND deleted_at IS NULL
       LIMIT 1`,
        [id],
      );
    return {
      ...this.toSafeCustomer(customer),
      displayName: profiles[0]?.display_name ?? null,
      legalName: profiles[0]?.legal_name ?? null,
    };
  }

  // ──────────────────────────────────────────────
  // Admin Customer Investigation — unified transaction history (reuse authoritative service)
  // ──────────────────────────────────────────────
  @Get(':id/transactions')
  async listTransactions(
    @Param('id') id: string,
    @Req() req: AuthenticatedRequest,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('type') type?: string,
  ) {
    this.requireWorkforce(req);
    await this.requireFunction(req, 'customer.view_transactions');
    this.assertUuid(id, 'id');
    const customer = await this.findVisibleCustomer(id);
    if (!customer) throw new NotFoundException('Customer not found');
    // Reuse authoritative unified history, but remove raw counterparty contact values at this
    // workforce boundary. The shared history service is also used by customer self-service.
    const history = await this.transactionHistoryService.listUnified({
      customerId: id,
      page,
      limit,
      type,
    });
    return {
      ...history,
      items: history.items.map((item) => ({
        ...item,
        counterparty: this.maskCounterpartyContact(item.counterparty),
      })),
    };
  }

  // ──────────────────────────────────────────────
  // Admin Customer Investigation — wallet listing (safe, customer-scoped, no balance column)
  // ──────────────────────────────────────────────
  @Get(':id/wallets')
  async listWallets(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    this.requireWorkforce(req);
    await this.requireFunction(req, 'customer.view_wallets');
    this.assertUuid(id, 'id');
    const customer = await this.findVisibleCustomer(id);
    if (!customer) throw new NotFoundException('Customer not found');
    // Use existing wallet architecture (WalletAccount) — safe projection (no ledgerAccountId, no creationIdempotencyKey)
    const wallets: Array<{
      id: string;
      customer_id: string;
      currency: string;
      status: string;
      created_at: Date;
      updated_at: Date;
    }> = await this.dataSource.query(
      `SELECT id::text as id, customer_id::text as customer_id, currency::text as currency, status::text as status, created_at, updated_at FROM wallet_accounts WHERE customer_id=$1 ORDER BY currency ASC, created_at ASC`,
      [id],
    );
    // Safe projection — hide ledgerAccountId / creationIdempotencyKey, expose currency explicitly
    const items = wallets.map((w) => ({
      id: w.id,
      customerId: w.customer_id,
      currency: w.currency,
      status: w.status,
      createdAt: w.created_at,
      updatedAt: w.updated_at,
    }));
    return { data: items, total: items.length };
  }

  // ──────────────────────────────────────────────
  // Admin Customer Investigation — wallet balance (ledger-derived, ownership enforced, cross-customer denied)
  // ──────────────────────────────────────────────
  @Get(':id/wallets/:walletId/balance')
  async getWalletBalance(
    @Param('id') id: string,
    @Param('walletId') walletId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    this.requireWorkforce(req);
    await this.requireFunction(req, 'customer.view_wallets');
    this.assertUuid(id, 'id');
    this.assertUuid(walletId, 'walletId');
    const customer = await this.findVisibleCustomer(id);
    if (!customer) throw new NotFoundException('Customer not found');
    const wallet = await this.walletRepo.findOne({ where: { id: walletId } as never });
    if (!wallet || wallet.customerId !== id) {
      throw new NotFoundException('Wallet not found');
    }
    // Reuse authoritative ledger-derived balance (no fabricated/cached balance, no second ledger)
    const balance = await this.walletService.getWalletBalance(walletId);
    // Safe projection — hide ledgerAccountId, expose currency explicitly
    return {
      walletId: balance.walletId ?? walletId,
      customerId: id,
      currency: balance.currency ?? wallet.currency,
      balanceMinor: balance.balanceMinor,
      status: wallet.status,
    };
  }

  // ──────────────────────────────────────────────
  // Admin Customer Investigation — wallet statement preview (same scope rules as the PDF)
  // ──────────────────────────────────────────────
  /**
   * JSON preview of exactly what the PDF will contain.
   *
   * The screen shows this before the operator downloads, so "the statement says X" and "the PDF
   * says X" are the same computation rather than two implementations that can drift. Balances the
   * ledger cannot support are returned as `null` with an `Unavailable` label — never as `0`.
   */
  @Get(':id/wallets/:walletId/statement')
  async getWalletStatementPreview(
    @Param('id') id: string,
    @Param('walletId') walletId: string,
    @Query('from') from: string,
    @Query('to') to: string,
    @Req() req: AuthenticatedRequest,
  ) {
    this.requireWorkforce(req);
    await this.requireFunction(req, 'customer.view_wallets');
    this.assertUuid(id, 'id');
    this.assertUuid(walletId, 'walletId');
    const principal = req.authorizationPrincipal;
    const period = parseStatementPeriod(from, to);

    const customer = await this.findVisibleCustomer(id);
    if (!customer) throw new NotFoundException('Customer not found');
    const context = await this.statementService.loadContext(walletId);
    if (context.customerId !== id) throw new NotFoundException('Wallet not found');
    await this.statementRenderer.assertInstitutionScope(principal, context.institutionId);

    const activity = await this.statementService.read(context, period);
    const currency = context.currency;
    return {
      walletId: context.walletId,
      walletLabel: maskWalletIdentifier(context.walletId),
      customerId: id,
      currency,
      walletStatus: context.status,
      periodFrom: period.from,
      periodTo: period.to,
      timeZone: 'Africa/Lagos',
      balances: {
        openingMinor: activity.balances.openingMinor,
        closingMinor: activity.balances.closingMinor,
        creditsMinor: activity.balances.creditsMinor,
        debitsMinor: activity.balances.debitsMinor,
        currentMinor: activity.balances.currentMinor,
        openingLabel: financialOrUnavailable(activity.balances.openingMinor, currency),
        closingLabel: financialOrUnavailable(activity.balances.closingMinor, currency),
        creditsLabel: financialOrUnavailable(activity.balances.creditsMinor, currency),
        debitsLabel: financialOrUnavailable(activity.balances.debitsMinor, currency),
        currentLabel: financialOrUnavailable(activity.balances.currentMinor, currency),
      },
      rows: activity.rows.map((row) => ({
        postedAt: row.postedAt,
        reference: row.reference,
        description: row.description,
        amountMinor: row.amountMinor,
        direction: row.direction,
        // Signed effect on the wallet, or `null` when the normal-balance convention is unknown.
        signedMinor: row.signedMinor,
        runningMinor: row.runningMinor,
        runningLabel: financialOrUnavailable(row.runningMinor, currency),
      })),
    };
  }

  // ──────────────────────────────────────────────
  // Admin Customer Investigation — branded wallet statement PDF
  // ──────────────────────────────────────────────
  /**
   * The printable statement.
   *
   * Authorization is the same as the balance read (`customer.view_wallets`, customer existence,
   * wallet ownership) plus the wallet's institutional scope, and it is re-checked in the service on
   * this request rather than trusted from the screen. Every attempt — success or refusal — is
   * audited with the operator, the wallet, the period and the outcome.
   */
  @Get(':id/wallets/:walletId/statement.pdf')
  @Header('Content-Type', 'application/pdf')
  @Header('Cache-Control', 'no-store')
  @Header('X-Content-Type-Options', 'nosniff')
  async downloadWalletStatement(
    @Param('id') id: string,
    @Param('walletId') walletId: string,
    @Query('from') from: string,
    @Query('to') to: string,
    @Req() req: AuthenticatedRequest,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    this.requireWorkforce(req);
    await this.requireFunction(req, 'customer.view_wallets');
    this.assertUuid(id, 'id');
    this.assertUuid(walletId, 'walletId');

    const result = await this.statementRenderer.generate({
      customerId: id,
      walletId,
      from,
      to,
      principal: req.authorizationPrincipal,
    });
    const context = getRequestContext(req as unknown as FastifyRequest);
    reply
      .header('X-Statement-Id', result.statementId)
      .header('X-Statement-Rows', String(result.rowCount))
      .header('X-Statement-Pages', String(result.pageCount))
      .header('X-Request-Id', context.requestId)
      .header(
        'Content-Disposition',
        `attachment; filename="${result.fileName}"; filename*=UTF-8''${encodeURIComponent(result.fileName)}`,
      )
      .send(result.pdf);
  }

  // ──────────────────────────────────────────────
  // Admin Customer Investigation — support-ticket alias (reuse existing Support capability)
  // ──────────────────────────────────────────────
  @Get(':id/support-tickets')
  async listSupportTickets(
    @Param('id') id: string,
    @Req() req: AuthenticatedRequest,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('status') status?: string,
  ) {
    this.requireWorkforce(req);
    await this.requireFunction(req, 'customer.manage_support_case');
    this.assertUuid(id, 'id');
    const customer = await this.findVisibleCustomer(id);
    if (!customer) throw new NotFoundException('Customer not found');
    const p = page ? Number.parseInt(page, 10) : 1;
    const l = limit ? Number.parseInt(limit, 10) : 20;
    // Reuse existing Support ticket query — preserves authorization, status, assignment, linkage, safe projection, internal-message filtering (list does not expose messages)
    return this.supportService.listForInternal(p, l, {
      customerId: id,
      status: status || undefined,
    });
  }

  /**
   * V1-CUSTOMER-ONBOARDING-02 — minimal activation-review read (workforce, read-only).
   * The one piece of review evidence not previously exposed to a workforce-authenticated
   * surface is the SUB-1 gate evidence itself: whether the customer carries a verified
   * primary Nigerian phone. Core customer/kyc fields are already covered by
   * GET /internal/customers/:id; transactions/wallets/support-tickets by the existing
   * investigation endpoints. Values are masked; nothing here mutates state or persists
   * audits (GET). Activation stays on the existing PATCH /customers/:id route.
   */
  @Get(':id/phone-verification')
  async getPhoneVerification(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    this.requireWorkforce(req);
    await this.requireFunction(req, 'customer.view');
    this.assertUuid(id, 'id');
    const customer = await this.findVisibleCustomer(id);
    if (!customer) throw new NotFoundException('Customer not found');
    const contacts = await this.dataSource.getRepository(CustomerContactMethod).find({
      where: { customerId: id, type: ContactMethodType.PHONE, deletedAt: IsNull() },
      order: { isPrimary: 'DESC', createdAt: 'DESC' } as never,
    });
    const primaryVerified = contacts.some(
      (contact) => contact.isPrimary && contact.verifiedAt !== null,
    );
    return {
      customerId: id,
      customerStatus: (customer as unknown as Customer).status,
      phones: contacts.map((contact) => ({
        isPrimary: contact.isPrimary,
        maskedValue: this.maskPhone(contact.normalizedValue),
        verifiedAt: contact.verifiedAt,
      })),
      activationGate: { verifiedPrimaryPhone: primaryVerified },
    };
  }

  /**
   * Admin-assisted registration review.
   *
   * Answers the two questions a workforce reviewer actually has when a customer was registered on
   * their behalf:
   *   1. what defaults the platform applied (customer class of service, KYC tier/assessment), and
   *   2. exactly what evidence is still outstanding before the account may be activated and given a
   *      wallet.
   *
   * Read-only and non-activating: it delegates to the same `CustomerActivationReadinessService` the
   * customer's own `/customers/me/activation` view uses, so the administrator and the customer can
   * never be shown two different requirement lists. It exposes masked references and status codes
   * only — never document numbers, credentials, PINs or provider payloads.
   */
  @Get(':id/registration-review')
  async getRegistrationReview(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    this.requireWorkforce(req);
    await this.requireFunction(req, 'customer.view');
    this.assertUuid(id, 'id');
    const customer = await this.findVisibleCustomer(id);
    const snapshot = await this.activationReadiness.evaluateOuter(id);
    return {
      customerId: snapshot.customerId,
      reference: maskCustomerReference((customer as unknown as Customer).reference),
      customerType: snapshot.customerType,
      customerStatus: snapshot.customerStatus,
      isSynthetic: snapshot.isSynthetic,
      defaults: {
        customerClass: snapshot.customerClass,
        kyc: snapshot.kyc,
      },
      onboardingWorkflow: snapshot.onboardingWorkflow,
      financialEligibility: snapshot.financialEligibility.eligible ? 'ELIGIBLE' : 'NOT_ELIGIBLE',
      restrictions: snapshot.restrictions,
      identityConflicts: snapshot.identityConflicts,
      trustedEvidence: snapshot.trustedEvidence,
      wallet: snapshot.wallet.provisioned
        ? {
            walletId: snapshot.wallet.walletId,
            currency: snapshot.wallet.currency,
            status: snapshot.wallet.status,
          }
        : null,
      requirements: snapshot.requirements,
      outstanding: snapshot.outstanding,
      activatable: snapshot.activatable,
      // Activation stays on the governed lifecycle route; this projection deliberately does not
      // offer an alternate mutation path.
      activationRoute: 'PATCH /api/v1/customers/:id',
      evaluatedAt: snapshot.evaluatedAt,
    };
  }

  private async findVisibleCustomer(id: string): Promise<Customer> {
    const customer = await this.repo.findOne({ where: { id } as never, withDeleted: true });
    if (!customer || (customer.deletedAt && customer.status !== CustomerStatus.CLOSED)) {
      throw new NotFoundException('Customer not found');
    }
    return customer;
  }

  private maskCounterpartyContact(counterparty: unknown): Record<string, unknown> | null {
    if (!counterparty || typeof counterparty !== 'object' || Array.isArray(counterparty)) {
      return null;
    }

    const safe = { ...(counterparty as Record<string, unknown>) };
    const sensitiveFields = [
      'phone',
      'phoneNumber',
      'email',
      'emailAddress',
      'contactValue',
      'receivingNumber',
      'beneficiaryPhone',
      'accountNumber',
      'receiving_number',
      'beneficiary_phone',
      'account_number',
    ];
    let maskedContact: string | null = null;

    for (const field of sensitiveFields) {
      const value = safe[field];
      if (maskedContact === null && typeof value === 'string') {
        if (field === 'accountNumber' || field === 'account_number') {
          const digits = value.replace(/\D/g, '');
          maskedContact = digits.length >= 4 ? `••••••${digits.slice(-4)}` : '••••';
        } else if (field === 'email' || field === 'emailAddress') {
          maskedContact = maskContactValue('EMAIL', value);
        } else {
          maskedContact = maskPhoneNumber(value);
        }
      }
      delete safe[field];
    }

    if (maskedContact) safe.maskedContact = maskedContact;
    return safe;
  }

  private maskPhone(normalizedValue: string): string {
    return maskPhoneNumber(normalizedValue);
  }

  private requireWorkforce(req: AuthenticatedRequest): string {
    const principal = req.authorizationPrincipal;
    if (!principal) throw new UnauthorizedException('Authentication required');
    if (
      principal.type === 'AGENT' ||
      principal.type === 'CUSTOMER' ||
      (principal.type as string) === 'AGGREGATOR'
    ) {
      throw new UnauthorizedException('Privileged access required');
    }
    return principal.principalId;
  }

  private requireFunction(req: AuthenticatedRequest, functionCode: string): Promise<string> {
    return this.auth.requireFunction(
      req.authorizationPrincipal,
      functionCode,
      'internal-customers',
      [
        // SUPPORT is an intended read-side principal of the customer investigation surface
        // (V1-HARDENING-06 tests 1-4 assert SUPPORT/OPERATOR/SERVICE/PRIVILEGED allowed on
        // transactions/wallets/balance/support-tickets; V1-CUSTOMER-ONBOARDING-02 asserts SUPPORT
        // may read the phone-verification review surface; UAT-SEC-005/UAT-ADMIN-011: SUPPORT =
        // read + funding-maker + support-queue). This controller is exclusively read/inspection
        // plus the support-tickets alias — lifecycle writes live on their own controllers and
        // remain OPERATOR/SERVICE/PRIVILEGED only.
        'SUPPORT',
        'OPERATOR',
        'SERVICE',
        'PRIVILEGED',
      ],
    );
  }

  private toSafeCustomer(customer: Customer) {
    // Safe projection — hide internal fields, expose identity only (no credential hashes)
    // Customer entity: id, reference, type, status, kycLevel, kycStatus, version, createdAt, updatedAt, deletedAt
    const {
      id,
      reference,
      type,
      status,
      kycLevel,
      kycStatus,
      version,
      createdAt,
      updatedAt,
      deletedAt,
    } = customer;
    return {
      id,
      reference: maskCustomerReference(reference),
      type,
      status,
      kycLevel,
      kycStatus,
      version,
      createdAt,
      updatedAt,
      deletedAt,
    };
  }

  private assertUuid(value: string, field: string): void {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
      throw new BadRequestException(`${field} must be a UUID`);
    }
  }
}
