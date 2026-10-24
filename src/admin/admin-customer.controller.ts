import {
  Controller,
  Get,
  NotFoundException,
  Param,
  Query,
  Req,
  UnauthorizedException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, IsNull, Repository } from 'typeorm';

import { Customer } from '../customer/customer.entity';
import { CustomerContactMethod } from '../customer/customer-contact-method.entity';
import { ContactMethodType, CustomerStatus } from '../customer/customer.enums';
import { maskContactValue, maskCustomerReference, maskPhoneNumber } from '../customer/customer-privacy';
import type { AuthorizationPrincipal } from '../authorization/authorization.types';
import { CustomerDirectoryQueryDto } from './dto/customer-directory-query.dto';
import { AuthorizationService } from '../authorization/authorization.service';
import { CustomerTransactionHistoryService } from '../customer-app/customer-transaction-history.service';
import { WalletService } from '../wallet/wallet.service';
import { SupportService } from '../support/support.service';
import { WalletAccount } from '../wallet/wallet-account.entity';

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
    const countRows = (await this.dataSource.query(
      `SELECT COUNT(DISTINCT customer.id)::text AS total ${fromAndJoins} WHERE ${whereSql}`,
      parameters,
    )) as Array<{ total: string }>;
    const total = Number(countRows[0]?.total ?? '0');
    const offset = (page - 1) * limit;
    const rows = (await this.dataSource.query(
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
    )) as Array<{
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
    }>;

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
    const profiles = (await this.dataSource.query(
      `SELECT display_name, legal_name
       FROM customer_profiles
       WHERE customer_id = $1 AND is_active = TRUE AND deleted_at IS NULL
       LIMIT 1`,
      [id],
    )) as Array<{ display_name: string | null; legal_name: string | null }>;
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
    if (!wallet || (wallet as any).customerId !== id) {
      throw new NotFoundException('Wallet not found');
    }
    // Reuse authoritative ledger-derived balance (no fabricated/cached balance, no second ledger)
    const balance = await this.walletService.getWalletBalance(walletId);
    // Safe projection — hide ledgerAccountId, expose currency explicitly
    return {
      walletId: (balance as any).walletId ?? walletId,
      customerId: id,
      currency: (balance as any).currency ?? (wallet as any).currency,
      balanceMinor: (balance as any).balanceMinor,
      status: (wallet as any).status,
    };
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
    return this.auth.requireFunction(req.authorizationPrincipal, functionCode, 'internal-customers', [
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
    ]);
  }

  private toSafeCustomer(customer: any): any {
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
    } = customer as any;
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
