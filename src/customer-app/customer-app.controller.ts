import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { pbkdf2Sync, randomBytes, timingSafeEqual } from 'node:crypto';

import { Customer } from '../customer/customer.entity';
import { CustomerContactMethod } from '../customer/customer-contact-method.entity';
import { CustomerProfile } from '../customer/customer-profile.entity';
import { CustomerService } from '../customer/customer.service';
import { CustomerTransactionPinService } from '../customer/customer-transaction-pin.service';
import { WalletAccount } from '../wallet/wallet-account.entity';
import { WalletService } from '../wallet/wallet.service';
import { Transfer } from '../transfer/transfer.entity';
import { TransferService } from '../transfer/transfer.service';
import { AuthenticationSessionService, DEFAULT_SESSION_AUDIENCE } from '../customer-authentication/authentication-session.service';
import { AuthenticationExecutionService } from '../customer-authentication/authentication-execution.service';
import { RecipientResolutionService } from '../agent/recipient-resolution.service';
import type { AuthorizationPrincipal } from '../authorization/authorization.types';
import { CustomerLoginDto } from './dto/customer-login.dto';

interface AuthenticatedRequest {
  headers: Record<string, string | string[] | undefined>;
  authorizationPrincipal?: AuthorizationPrincipal;
}

@Controller()
export class CustomerAppController {
  constructor(
    @InjectRepository(Customer)
    private readonly customerRepository: Repository<Customer>,
    @InjectRepository(CustomerProfile)
    private readonly profileRepository: Repository<CustomerProfile>,
    @InjectRepository(CustomerContactMethod)
    private readonly contactRepository: Repository<CustomerContactMethod>,
    @InjectRepository(WalletAccount)
    private readonly walletRepository: Repository<WalletAccount>,
    @InjectRepository(Transfer)
    private readonly transferRepository: Repository<Transfer>,
    private readonly customerService: CustomerService,
    private readonly walletService: WalletService,
    private readonly transferService: TransferService,
    private readonly sessionService: AuthenticationSessionService,
    private readonly executionService: AuthenticationExecutionService,
    private readonly pinService: CustomerTransactionPinService,
    private readonly recipientService: RecipientResolutionService,
    private readonly dataSource: DataSource,
  ) {}

  // ──────────────────────────────────────────────
  // Authentication / Session / Me  (contract #1)
  // ──────────────────────────────────────────────

  @Post('customers/sessions')
  @HttpCode(200)
  async login(@Body() dto: CustomerLoginDto) {
    const result = await this.executionService.authenticate({
      customerId: dto.customerId,
      password: dto.password,
      actor: dto.customerId,
    });
    if (!result.authenticated) {
      throw new UnauthorizedException('Invalid credentials');
    }
    const session = await this.sessionService.issue({
      authentication: result,
      actor: result.customerId,
      audience: DEFAULT_SESSION_AUDIENCE,
    });
    return {
      accessToken: session.accessToken,
      tokenType: session.tokenType,
      expiresAt: session.expiresAt,
      customerId: session.principal.customerId,
      sessionId: session.sessionId,
    };
  }

  @Post('customers/login')
  @HttpCode(200)
  async loginAlias(@Body() dto: CustomerLoginDto) {
    return this.login(dto);
  }

  @Post('customers/sessions/logout')
  @HttpCode(200)
  async logout(@Req() req: AuthenticatedRequest) {
    const token = this.extractToken(req);
    if (!token) throw new UnauthorizedException('Authentication required');
    const principal = req.authorizationPrincipal;
    const actor = principal?.customerId ?? 'unknown-customer';
    await this.sessionService.revoke({ token, actor, reason: 'Customer logout' });
    return { revoked: true };
  }

  @Post('customers/logout')
  @HttpCode(200)
  async logoutAlias(@Req() req: AuthenticatedRequest) {
    return this.logout(req);
  }

  @Get('customers/me')
  async getMe(@Req() req: AuthenticatedRequest) {
    const principal = this.requireCustomerPrincipal(req);
    const customer = await this.customerRepository.findOne({ where: { id: principal.customerId } });
    if (!customer || customer.deletedAt !== null) throw new NotFoundException('Customer not found');
    return {
      id: customer.id,
      reference: customer.reference,
      type: customer.type,
      status: customer.status,
      kycLevel: customer.kycLevel,
      kycStatus: customer.kycStatus,
      createdAt: customer.createdAt,
      updatedAt: customer.updatedAt,
    };
  }

  // ──────────────────────────────────────────────
  // Profile  (contract #2)
  // ──────────────────────────────────────────────

  @Get('customers/me/profile')
  async getProfile(@Req() req: AuthenticatedRequest) {
    const principal = this.requireCustomerPrincipal(req);
    const customer = await this.customerRepository.findOne({ where: { id: principal.customerId } });
    if (!customer || customer.deletedAt !== null) throw new NotFoundException('Customer not found');
    let profile: CustomerProfile | null = null;
    try {
      profile = await this.customerService.getProfile(principal.customerId!);
    } catch {
      profile = null;
    }
    // Return safe projection - never include hashes / audit
    return {
      id: customer.id,
      reference: customer.reference,
      status: customer.status,
      type: customer.type,
      kycLevel: customer.kycLevel,
      kycStatus: customer.kycStatus,
      profile: profile
        ? {
            id: profile.id,
            customerId: profile.customerId,
            displayName: profile.displayName,
            legalName: profile.legalName,
            nationality: profile.nationality,
            isActive: profile.isActive,
            createdAt: profile.createdAt,
            updatedAt: profile.updatedAt,
          }
        : null,
      createdAt: customer.createdAt,
      updatedAt: customer.updatedAt,
    };
  }

  @Get('customers/me/status')
  async getStatus(@Req() req: AuthenticatedRequest) {
    const principal = this.requireCustomerPrincipal(req);
    const customer = await this.customerRepository.findOne({ where: { id: principal.customerId } });
    if (!customer || customer.deletedAt !== null) throw new NotFoundException('Customer not found');
    return {
      id: customer.id,
      reference: customer.reference,
      status: customer.status,
      kycLevel: customer.kycLevel,
      kycStatus: customer.kycStatus,
    };
  }

  // ──────────────────────────────────────────────
  // Wallet / Balance  (contract #4) — ledger-derived only
  // ──────────────────────────────────────────────

  @Get('customers/me/wallets')
  async listWallets(@Req() req: AuthenticatedRequest) {
    const principal = this.requireCustomerPrincipal(req);
    const wallets = await this.walletService.listWallets(principal.customerId!);
    // Never leak internal creationIdempotencyKey
    return wallets.map((w) => ({
      id: w.id,
      customerId: w.customerId,
      currency: w.currency,
      status: w.status,
      ledgerAccountId: w.ledgerAccountId,
      balanceMinor: w.balanceMinor,
      createdAt: w.createdAt,
      updatedAt: w.updatedAt,
    }));
  }

  @Get('customers/me/wallets/:walletId')
  async getWallet(@Param('walletId') walletId: string, @Req() req: AuthenticatedRequest) {
    const principal = this.requireCustomerPrincipal(req);
    const wallet = await this.walletService.getWallet(walletId);
    if (wallet.customerId !== principal.customerId) throw new NotFoundException('Wallet not found');
    return {
      id: wallet.id,
      customerId: wallet.customerId,
      currency: wallet.currency,
      status: wallet.status,
      ledgerAccountId: wallet.ledgerAccountId,
      balanceMinor: wallet.balanceMinor,
      createdAt: wallet.createdAt,
      updatedAt: wallet.updatedAt,
    };
  }

  @Get('customers/me/wallets/:walletId/balance')
  async getWalletBalance(@Param('walletId') walletId: string, @Req() req: AuthenticatedRequest) {
    const principal = this.requireCustomerPrincipal(req);
    const wallet = await this.walletService.getWallet(walletId);
    if (wallet.customerId !== principal.customerId) throw new NotFoundException('Wallet not found');
    const balance = await this.walletService.getWalletBalance(walletId);
    return {
      walletId: balance.walletId,
      currency: balance.currency,
      balanceMinor: balance.balanceMinor,
      // ledger-derived, not cached
    };
  }

  @Get('customers/me/financial-position')
  async getFinancialPosition(@Req() req: AuthenticatedRequest) {
    const principal = this.requireCustomerPrincipal(req);
    const wallets = await this.walletService.listWallets(principal.customerId!);
    const ngnWallet = wallets.find((w) => w.currency === 'NGN');
    if (!ngnWallet) {
      return {
        customerId: principal.customerId,
        currency: 'NGN',
        balanceMinor: '0',
        availableBalanceMinor: '0',
        walletExists: false,
        wallets: [],
      };
    }
    return {
      customerId: principal.customerId,
      currency: ngnWallet.currency,
      balanceMinor: ngnWallet.balanceMinor,
      availableBalanceMinor: ngnWallet.balanceMinor,
      walletExists: true,
      walletId: ngnWallet.id,
      ledgerAccountId: ngnWallet.ledgerAccountId,
      status: ngnWallet.status,
      wallets: wallets.map((w) => ({
        id: w.id,
        currency: w.currency,
        status: w.status,
        balanceMinor: w.balanceMinor,
      })),
    };
  }

  // ──────────────────────────────────────────────
  // Receiving Identity  (contract #5) — reuse phone contact
  // ──────────────────────────────────────────────

  @Get('customers/me/receiving-identity')
  async getReceivingIdentity(@Req() req: AuthenticatedRequest) {
    const principal = this.requireCustomerPrincipal(req);
    const contacts = await this.contactRepository.find({ where: { customerId: principal.customerId } });
    const primaryPhone = contacts.find((c) => c.type === 'PHONE' && c.isPrimary) ?? contacts.find((c) => c.type === 'PHONE') ?? null;
    if (!primaryPhone) {
      return { customerId: principal.customerId, receivingIdentity: null, status: 'NONE' };
    }
    return {
      customerId: principal.customerId,
      receivingIdentity: primaryPhone.normalizedValue ?? primaryPhone.value,
      type: primaryPhone.type,
      isPrimary: primaryPhone.isPrimary,
      status: 'ACTIVE',
    };
  }

  @Get('customers/me/receiving-number')
  async getReceivingNumberAlias(@Req() req: AuthenticatedRequest) {
    const identity = await this.getReceivingIdentity(req);
    return {
      customerId: identity.customerId,
      receivingNumber: identity.receivingIdentity,
      status: identity.status,
    };
  }

  // ──────────────────────────────────────────────
  // Recipient Resolution  (contract #6) — reuse RecipientResolutionService
  // ──────────────────────────────────────────────

  @Get('customers/me/recipient')
  async resolveRecipient(
    @Query('identifier') identifier: string,
    @Req() req: AuthenticatedRequest,
  ) {
    this.requireCustomerPrincipal(req);
    if (!identifier || typeof identifier !== 'string' || identifier.trim().length === 0) {
      throw new BadRequestException('identifier is required');
    }
    // Delegate to existing service (thin, no second ledger)
    return this.recipientService.resolve(identifier.trim());
  }

  // ──────────────────────────────────────────────
  // Wallet→Wallet  (contract #7) — reuse TransferService engine
  // ──────────────────────────────────────────────

  @Post('customers/me/transfers')
  @HttpCode(201)
  async createTransfer(
    @Req() req: AuthenticatedRequest,
    @Body() dto: { sourceWalletId: string; destinationWalletId: string; amountMinor: string; currency: string; reference?: string; narration?: string },
  ) {
    const principal = this.requireCustomerPrincipal(req);
    const rawHeaders = req.headers as Record<string, unknown>;
    const idempotencyKey = (rawHeaders['idempotency-key'] as string | undefined) ?? (rawHeaders['Idempotency-Key'] as string | undefined);
    const key = (idempotencyKey ?? '').trim();
    if (!key) throw new BadRequestException('Idempotency-Key header is required');
    // Ensure source wallet belongs to SELF
    const source = await this.walletService.getWallet(dto.sourceWalletId);
    if (source.customerId !== principal.customerId) throw new NotFoundException('Source wallet not found');
    // Note: destination wallet ownership is not restricted — can be any customer/agent wallet
    // Do not perform direct ledger mutation; delegate to TransferService (preserves PIN/MFA/idempotency/concurrency/double-entry)
    return this.transferService.createTransfer({
      sourceWalletId: dto.sourceWalletId,
      destinationWalletId: dto.destinationWalletId,
      amountMinor: dto.amountMinor,
      currency: dto.currency,
      idempotencyKey: key,
      reference: dto.reference,
      narration: dto.narration,
    });
  }

  @Get('customers/me/transfers')
  async listTransfers(
    @Req() req: AuthenticatedRequest,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const principal = this.requireCustomerPrincipal(req);
    const wallets = await this.walletRepository.find({ where: { customerId: principal.customerId } });
    const walletIds = wallets.map((w) => w.id);
    if (walletIds.length === 0) {
      return { items: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 0, hasNextPage: false } };
    }
    const p = page ? parseInt(page, 10) : 1;
    const l = limit ? parseInt(limit, 10) : 20;
    const normalizedPage = Number.isSafeInteger(p) && p >= 1 ? p : 1;
    const normalizedLimit = Number.isSafeInteger(l) && l >= 1 && l <= 100 ? l : 20;
    const qb = this.transferRepository
      .createQueryBuilder('transfer')
      .where('transfer.sourceWalletId IN (:...ids) OR transfer.destinationWalletId IN (:...ids)', { ids: walletIds })
      .orderBy('transfer.createdAt', 'DESC')
      .addOrderBy('transfer.id', 'DESC')
      .skip((normalizedPage - 1) * normalizedLimit)
      .take(normalizedLimit);
    const [transfers, total] = await qb.getManyAndCount();
    const totalPages = total === 0 ? 0 : Math.ceil(total / normalizedLimit);
    const items = transfers.map((t) => {
      const isSource = walletIds.includes(t.sourceWalletId);
      const isDest = walletIds.includes(t.destinationWalletId);
      let direction: string = 'UNKNOWN';
      let counterpartyWalletId: string | null = null;
      if (isSource && !isDest) {
        direction = 'SENT';
        counterpartyWalletId = t.destinationWalletId;
      } else if (!isSource && isDest) {
        direction = 'RECEIVED';
        counterpartyWalletId = t.sourceWalletId;
      } else if (isSource && isDest) {
        // internal transfer between own wallets
        direction = 'INTERNAL';
        counterpartyWalletId = t.destinationWalletId;
      }
      return {
        transferId: t.id,
        id: t.id,
        sourceWalletId: t.sourceWalletId,
        destinationWalletId: t.destinationWalletId,
        counterpartyWalletId,
        direction,
        amountMinor: t.amountMinor,
        currency: t.currency,
        status: t.status,
        journalId: t.journalId,
        paymentReference: t.paymentReference,
        reference: t.reference,
        narration: t.narration,
        createdAt: t.createdAt,
        completedAt: t.completedAt,
      };
    });
    return {
      items,
      pagination: {
        page: normalizedPage,
        limit: normalizedLimit,
        total,
        totalPages,
        hasNextPage: normalizedPage < totalPages,
      },
    };
  }

  // Alias for history read-only list
  @Get('customers/me/transactions')
  async listTransactions(@Req() req: AuthenticatedRequest, @Query('page') page?: string, @Query('limit') limit?: string) {
    return this.listTransfers(req, page, limit);
  }

  @Get('customers/me/transfers/:transferId')
  async getTransferDetail(@Param('transferId') transferId: string, @Req() req: AuthenticatedRequest) {
    const principal = this.requireCustomerPrincipal(req);
    const wallets = await this.walletRepository.find({ where: { customerId: principal.customerId } });
    const walletIds = new Set(wallets.map((w) => w.id));
    const transfer = await this.transferService.getTransfer(transferId);
    // SELF check: transfer must involve one of customer's wallets, otherwise 404 (no leakage)
    if (!walletIds.has(transfer.sourceWalletId) && !walletIds.has(transfer.destinationWalletId)) {
      throw new NotFoundException('Transfer not found');
    }
    // Return safe projection - exclude no ledger/PIN/OTP/session/audit
    const isSource = transfer.sourceWalletId && walletIds.has(transfer.sourceWalletId);
    const direction = isSource ? 'SENT' : 'RECEIVED';
    return {
      id: transfer.id,
      transferId: transfer.id,
      sourceWalletId: transfer.sourceWalletId,
      destinationWalletId: transfer.destinationWalletId,
      direction,
      amountMinor: transfer.amountMinor,
      currency: transfer.currency,
      status: transfer.status,
      reference: transfer.reference,
      narration: transfer.narration,
      paymentReference: transfer.paymentReference,
      journalReference: (transfer as any).journalReference ?? null,
      failureCode: transfer.failureCode,
      failureMessage: transfer.failureMessage,
      createdAt: transfer.createdAt,
      completedAt: transfer.completedAt,
    };
  }

  @Get('customers/me/transactions/:transferId')
  async getTransactionDetailAlias(@Param('transferId') transferId: string, @Req() req: AuthenticatedRequest) {
    return this.getTransferDetail(transferId, req);
  }

  // ──────────────────────────────────────────────
  // Dashboard  (identity/status/balance/receiving number/recent transactions)
  // ──────────────────────────────────────────────

  @Get('customers/me/dashboard')
  async getDashboard(@Req() req: AuthenticatedRequest) {
    const principal = this.requireCustomerPrincipal(req);
    const customer = await this.customerRepository.findOne({ where: { id: principal.customerId } });
    if (!customer || customer.deletedAt !== null) throw new NotFoundException('Customer not found');
    let profile: CustomerProfile | null = null;
    try {
      profile = await this.customerService.getProfile(principal.customerId!);
    } catch {
      profile = null;
    }
    const wallets = await this.walletService.listWallets(principal.customerId!);
    const receiving = await this.getReceivingIdentity(req);
    // Recent transactions: last 5
    let recent: any = { items: [], pagination: { page: 1, limit: 5, total: 0, totalPages: 0, hasNextPage: false } };
    if (wallets.length > 0) {
      recent = await this.listTransfers(req, '1', '5');
    }
    return {
      identity: {
        id: customer.id,
        reference: customer.reference,
        type: customer.type,
        status: customer.status,
        kycLevel: customer.kycLevel,
        kycStatus: customer.kycStatus,
        createdAt: customer.createdAt,
      },
      profile: profile
        ? {
            id: profile.id,
            displayName: profile.displayName,
            legalName: profile.legalName,
          }
        : null,
      balance: {
        wallets: wallets.map((w) => ({
          id: w.id,
          currency: w.currency,
          status: w.status,
          balanceMinor: w.balanceMinor,
        })),
        primary: wallets.find((w) => w.currency === 'NGN') ?? null,
      },
      receivingIdentity: receiving.receivingIdentity,
      receivingNumber: receiving.receivingIdentity,
      recentTransactions: recent,
    };
  }

  // ──────────────────────────────────────────────
  // PIN / Security  (contract #10) — via existing lifecycle
  // ──────────────────────────────────────────────

  @Post('customers/me/transaction-pin')
  @HttpCode(200)
  async setTransactionPin(@Req() req: AuthenticatedRequest, @Body() dto: { pin: string }) {
    const principal = this.requireCustomerPrincipal(req);
    if (!dto?.pin || typeof dto.pin !== 'string' || !/^\d{4,12}$/.test(dto.pin)) {
      throw new BadRequestException('pin must be 4-12 digits');
    }
    const salt = randomBytes(16);
    const iterations = 10000;
    const derived = pbkdf2Sync(dto.pin, salt, iterations, 32, 'sha256');
    const pinHash = `PBKDF2$sha256$${iterations}$${salt.toString('base64url')}$${derived.toString('base64url')}`;
    const result = await this.pinService.setTransactionPin(principal.customerId!, {
      pinHash,
      hashAlgorithm: 'PBKDF2',
      pinVersion: 1,
      actor: principal.customerId!,
    });
    return {
      customerId: result.customerId,
      pinVersion: result.pinVersion,
      updatedAt: result.lastChangedAt,
    };
  }

  @Post('customers/me/transaction-pin/verify')
  @HttpCode(200)
  async verifyTransactionPin(@Req() req: AuthenticatedRequest, @Body() dto: { pin: string }) {
    const principal = this.requireCustomerPrincipal(req);
    if (!dto?.pin || typeof dto.pin !== 'string' || !/^\d{4,12}$/.test(dto.pin)) {
      return { verified: false, reason: 'INVALID_FORMAT' };
    }
    const verifier = {
      verify: (pin: string, _alg: string, hash: string) => {
        try {
          const parts = hash.split('$');
          if (parts.length !== 5 || parts[0]?.toUpperCase() !== 'PBKDF2') return { verified: false };
          const digest = parts[1]?.toLowerCase() as 'sha256' | 'sha512';
          const iter = Number(parts[2]);
          const salt = Buffer.from(parts[3] ?? '', 'base64url');
          const expected = Buffer.from(parts[4] ?? '', 'base64url');
          if (!salt.length || !expected.length) return { verified: false };
          const derived = pbkdf2Sync(pin, salt, iter, expected.length, digest);
          if (derived.length !== expected.length) return { verified: false };
          return { verified: timingSafeEqual(derived, expected) };
        } catch {
          return { verified: false };
        }
      },
    };
    const outcome = await this.pinService.verifyTransactionPin(
      principal.customerId!,
      { pin: dto.pin, actor: principal.customerId! },
      verifier as any,
    );
    if (outcome.verified) return { verified: true };
    return { verified: false, reason: outcome.failureReason ?? 'MISMATCH', locked: outcome.locked ?? false };
  }

  // ──────────────────────────────────────────────
  // Helpers
  // ──────────────────────────────────────────────

  private requireCustomerPrincipal(req: AuthenticatedRequest): AuthorizationPrincipal {
    const principal = req.authorizationPrincipal;
    if (!principal || principal.type !== 'CUSTOMER' || !principal.customerId) {
      throw new UnauthorizedException('Customer authentication required');
    }
    return principal;
  }

  private extractToken(req: AuthenticatedRequest): string | undefined {
    const header = req.headers.authorization;
    if (typeof header !== 'string') return undefined;
    const match = /^Bearer\s+(\S+)$/i.exec(header);
    return match?.[1];
  }
}
