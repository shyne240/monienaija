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
import { ContactMethodType } from '../customer/customer.enums';
import type { AuthorizationPrincipal } from '../authorization/authorization.types';
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
  ) {}

  @Get()
  async list(
    @Req() req: AuthenticatedRequest,
    @Query('page') pageRaw?: string,
    @Query('limit') limitRaw?: string,
    @Query('status') status?: string,
    @Query('type') type?: string,
  ) {
    this.requireWorkforce(req);
    const page = Math.max(1, Number.parseInt(pageRaw ?? '1', 10) || 1);
    const rawLimit = Number.parseInt(limitRaw ?? '20', 10) || 20;
    const limit = Math.min(100, Math.max(1, rawLimit));
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = {};
    if (status) where['status'] = status;
    if (type) where['type'] = type;

    const [data, total] = await this.repo.findAndCount({
      where: Object.keys(where).length ? (where as never) : {},
      order: { createdAt: 'DESC' } as never,
      skip,
      take: limit,
    });

    return { data, total, page, limit };
  }

  @Get(':id')
  async getOne(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    this.requireWorkforce(req);
    this.assertUuid(id, 'id');
    const customer = await this.repo.findOne({ where: { id } as never });
    if (!customer) throw new NotFoundException('Customer not found');
    return this.toSafeCustomer(customer);
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
    this.assertUuid(id, 'id');
    const customer = await this.repo.findOne({ where: { id } as never });
    if (!customer) throw new NotFoundException('Customer not found');
    // Reuse authoritative unified history — centralized aggregation, safe projection already enforced
    return this.transactionHistoryService.listUnified({ customerId: id, page, limit, type });
  }

  // ──────────────────────────────────────────────
  // Admin Customer Investigation — wallet listing (safe, customer-scoped, no balance column)
  // ──────────────────────────────────────────────
  @Get(':id/wallets')
  async listWallets(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    this.requireWorkforce(req);
    this.assertUuid(id, 'id');
    const customer = await this.repo.findOne({ where: { id } as never });
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
    this.assertUuid(id, 'id');
    this.assertUuid(walletId, 'walletId');
    const customer = await this.repo.findOne({ where: { id } as never });
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
    this.assertUuid(id, 'id');
    const customer = await this.repo.findOne({ where: { id } as never });
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
    this.assertUuid(id, 'id');
    const customer = await this.repo.findOne({ where: { id } as never });
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

  private maskPhone(normalizedValue: string): string {
    // Canonical 10-digit NSN → +234*****XXXX; non-canonical legacy values masked minimally.
    if (/^\d{10}$/.test(normalizedValue)) return `+234*****${normalizedValue.slice(-4)}`;
    if (normalizedValue.length <= 4) return '****';
    return `****${normalizedValue.slice(-4)}`;
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
      reference,
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
