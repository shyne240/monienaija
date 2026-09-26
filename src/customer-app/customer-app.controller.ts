import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
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
import { CustomerAuthenticationService } from '../customer-authentication/customer-authentication.service';
import { PasswordHashVerificationService } from '../customer-authentication/password-hash-verification.service';
import { AuditService } from '../operations/audit.service';
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
    private readonly customerAuthService: CustomerAuthenticationService,
    private readonly passwordVerificationService: PasswordHashVerificationService,
    private readonly auditService: AuditService,
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
  // Profile PATCH (A26) — only displayName mutable, SELF, thin
  // ──────────────────────────────────────────────

  @Patch('customers/me/profile')
  async patchProfile(@Req() req: AuthenticatedRequest, @Body() dto: Record<string, unknown>) {
    const principal = this.requireCustomerPrincipal(req);
    // Whitelist: only displayName is mutable via normal profile PATCH
    const allowed = new Set(['displayName']);
    const immutable = ['id', 'customerId', 'reference', 'status', 'type', 'kycLevel', 'kycStatus', 'legalName', 'nationality', 'dateOfBirth', 'isActive', 'createdAt', 'updatedAt', 'deletedAt', 'walletId', 'ledgerAccountId', 'balanceMinor', 'passwordHash', 'pinHash', 'kyc_approval', 'agentStatus', 'roles'];
    for (const key of Object.keys(dto ?? {})) {
      if (!allowed.has(key)) {
        // If they try to set an immutable/security-sensitive field, fail closed
        if (immutable.includes(key) || ['kycLevel', 'kycStatus', 'status', 'reference', 'type', 'legalName', 'nationality', 'dateOfBirth', 'isActive', 'customerId', 'id', 'passwordHash', 'pinHash', 'wallet', 'ledger', 'audit'].includes(key)) {
          throw new BadRequestException(`Field '${key}' is not mutable via profile update`);
        }
        // Unknown field also rejected (prevent mass assignment)
        throw new BadRequestException(`Field '${key}' is not allowed`);
      }
    }
    const raw = (dto as any)?.displayName;
    if (typeof raw !== 'string') throw new BadRequestException('displayName must be a string');
    const displayName = raw.trim();
    if (displayName.length === 0 || displayName.length > 200) throw new BadRequestException('displayName must be 1 to 200 characters');
    // Basic hygiene: disallow control chars
    if (/[\u0000-\u001F]/.test(displayName)) throw new BadRequestException('displayName contains invalid characters');
    const customer = await this.customerRepository.findOne({ where: { id: principal.customerId } });
    if (!customer || customer.deletedAt !== null) throw new NotFoundException('Customer not found');
    let profile: CustomerProfile | null = null;
    try {
      profile = await this.customerService.getProfile(principal.customerId!);
    } catch {
      throw new NotFoundException('Profile not found');
    }
    if (!profile || profile.deletedAt !== null || !profile.isActive) throw new NotFoundException('Profile not found');
    if (profile.displayName === displayName) {
      // No change — return safe projection
      return {
        id: customer.id,
        reference: customer.reference,
        status: customer.status,
        type: customer.type,
        kycLevel: customer.kycLevel,
        kycStatus: customer.kycStatus,
        profile: {
          id: profile.id,
          customerId: profile.customerId,
          displayName: profile.displayName,
          legalName: profile.legalName,
          nationality: profile.nationality,
          isActive: profile.isActive,
          createdAt: profile.createdAt,
          updatedAt: profile.updatedAt,
        },
        createdAt: customer.createdAt,
        updatedAt: customer.updatedAt,
      };
    }
    const previousDisplayName = profile.displayName;
    // Reuse existing transaction/audit pattern — keep controller thin, no hashing/policy here
    const updated = await this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(CustomerProfile);
      const locked = await repo.findOne({ where: { id: profile!.id, customerId: principal.customerId } });
      if (!locked || locked.deletedAt !== null) throw new NotFoundException('Profile not found');
      const previousValues = { displayName: locked.displayName };
      locked.displayName = displayName;
      const saved = await repo.save(locked);
      await this.auditService.record(manager, {
        entityType: 'CUSTOMER_PROFILE',
        entityId: saved.id,
        action: 'PROFILE_UPDATED',
        actor: principal.customerId!,
        previousValues,
        newValues: { displayName: saved.displayName },
      });
      return saved;
    });
    return {
      id: customer.id,
      reference: customer.reference,
      status: customer.status,
      type: customer.type,
      kycLevel: customer.kycLevel,
      kycStatus: customer.kycStatus,
      profile: {
        id: updated.id,
        customerId: updated.customerId,
        displayName: updated.displayName,
        legalName: updated.legalName,
        nationality: updated.nationality,
        isActive: updated.isActive,
        createdAt: updated.createdAt,
        updatedAt: updated.updatedAt,
      },
      createdAt: customer.createdAt,
      updatedAt: customer.updatedAt,
    };
  }

  // ──────────────────────────────────────────────
  // Password change (A26) — reuse existing credential service, no new auth engine
  // ──────────────────────────────────────────────

  @Post('customers/me/password')
  @HttpCode(200)
  async changePassword(@Req() req: AuthenticatedRequest, @Body() dto: Record<string, unknown>) {
    const principal = this.requireCustomerPrincipal(req);
    const currentPassword = (dto as any)?.currentPassword;
    const newPassword = (dto as any)?.newPassword;
    if (typeof currentPassword !== 'string' || currentPassword.length === 0) throw new BadRequestException('currentPassword is required');
    if (typeof newPassword !== 'string' || newPassword.length === 0) throw new BadRequestException('newPassword is required');
    if (currentPassword.length > 1024 || newPassword.length > 128) throw new BadRequestException('Password length is invalid');
    if (newPassword.length < 8) throw new BadRequestException('newPassword must be at least 8 characters');
    if (currentPassword === newPassword) throw new BadRequestException('newPassword must be different from currentPassword');
    // Basic policy: at least 8, not trivially same, no leading/trailing spaces? preserve as-is
    // Verify current credential via existing execution service (PBKDF2/lockout, audit, timingSafeEqual)
    const authResult = await this.executionService.authenticate({
      customerId: principal.customerId!,
      password: currentPassword,
      actor: principal.customerId!,
    });
    if (!authResult.authenticated) {
      // Do not reveal whether customer or credential missing — generic
      throw new UnauthorizedException('Current password is incorrect');
    }
    if (authResult.accountLocked) {
      throw new UnauthorizedException('Account is locked');
    }
    const credentialId = authResult.credentialId!;
    // Ensure new password not same as old via verification (defense even if same string already checked)
    // Fetch credential view for version
    const credentialView = await this.customerAuthService.getCredential(principal.customerId!, credentialId);
    const newHash = (() => {
      const salt = randomBytes(16);
      const iterations = 10000;
      const derived = pbkdf2Sync(newPassword, salt, iterations, 32, 'sha256');
      return `PBKDF2$sha256$${iterations}$${salt.toString('base64url')}$${derived.toString('base64url')}`;
    })();
    await this.customerAuthService.rotatePassword(principal.customerId!, credentialId, {
      passwordHash: newHash,
      hashAlgorithm: 'PBKDF2' as any,
      passwordVersion: (credentialView.passwordVersion ?? 1) + 1,
      actor: principal.customerId!,
    });
    // Audit already done in rotatePassword (no secrets, uses credentialValues without passwordHash)
    // Session revocation: preserve current session (established policy is to keep current, revoke others would be disruptive). Document that we do NOT auto-revoke.
    return { changed: true, passwordVersion: (credentialView.passwordVersion ?? 1) + 1 };
  }

  // ──────────────────────────────────────────────
  // Session read (A26) — safe projection, no token hash
  // ──────────────────────────────────────────────

  @Get('customers/me/sessions')
  async listSessions(@Req() req: AuthenticatedRequest) {
    const principal = this.requireCustomerPrincipal(req);
    // Safe read via DataSource query, never expose tokenHash/refresh secrets
    // Use AuthenticationSession entity via DataSource
    const rows: Array<{ id: string; audience: string; status: string; issued_at: Date; expires_at: Date; last_seen_at: Date | null; revoked_at: Date | null }> = await this.dataSource.query(
      `SELECT id, audience, status, issued_at, expires_at, last_seen_at, revoked_at FROM authentication_sessions WHERE customer_id = $1 ORDER BY issued_at DESC, id DESC`,
      [principal.customerId],
    );
    return {
      customerId: principal.customerId,
      sessions: rows.map((r) => ({
        id: r.id,
        audience: r.audience,
        status: r.status,
        issuedAt: r.issued_at,
        expiresAt: r.expires_at,
        lastSeenAt: r.last_seen_at,
        revokedAt: r.revoked_at,
      })),
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
    @Body() dto: { sourceWalletId: string; destinationWalletId: string; amountMinor: string; currency: string; reference?: string; narration?: string; pin?: string },
  ) {
    const principal = this.requireCustomerPrincipal(req);
    const rawHeaders = req.headers as Record<string, unknown>;
    const idempotencyKey = (rawHeaders['idempotency-key'] as string | undefined) ?? (rawHeaders['Idempotency-Key'] as string | undefined);
    const key = (idempotencyKey ?? '').trim();
    if (!key) throw new BadRequestException('Idempotency-Key header is required');
    // Ensure source wallet belongs to SELF (fail-closed ownership binding)
    const source = await this.walletService.getWallet(dto.sourceWalletId);
    if (source.customerId !== principal.customerId) throw new NotFoundException('Source wallet not found');
    // ── A24 Customer Transaction PIN authorization (reuse PBKDF2 service, keep controller thin) ──
    // PIN is bound to authenticated CUSTOMER principal (do not trust body customerId), verified immediately before financial execution.
    // PIN is never persisted in requestHash/transfer metadata/journal/audit/response/logs (pinoHttp redacts req.body.pin, requestHash is business params only).
    const rawPin = (dto as any).pin;
    if (rawPin === undefined || rawPin === null || (typeof rawPin === 'string' && rawPin.trim().length === 0)) {
      throw new UnauthorizedException('Transaction PIN required');
    }
    if (typeof rawPin !== 'string' || !/^\d{4,12}$/.test(rawPin.trim())) {
      throw new UnauthorizedException('Invalid PIN format');
    }
    const pin = rawPin.trim();
    const verifier = {
      verify: (candidate: string, _alg: string, hash: string) => {
        try {
          const parts = hash.split('$');
          if (parts.length !== 5 || parts[0]?.toUpperCase() !== 'PBKDF2') return { verified: false };
          const digest = (parts[1]?.toLowerCase() as 'sha256' | 'sha512') ?? 'sha256';
          const iter = Number(parts[2]);
          const salt = Buffer.from(parts[3] ?? '', 'base64url');
          const expected = Buffer.from(parts[4] ?? '', 'base64url');
          if (!salt.length || !expected.length || !Number.isSafeInteger(iter) || iter <= 0) return { verified: false };
          const derived = pbkdf2Sync(candidate, salt, iter, expected.length, digest);
          if (derived.length !== expected.length) return { verified: false };
          return { verified: timingSafeEqual(derived, expected) };
        } catch {
          return { verified: false };
        }
      },
    };
    const outcome = await this.pinService.verifyTransactionPin(
      principal.customerId!,
      { pin, actor: principal.customerId! },
      verifier as any,
    );
    if (!outcome.verified) {
      if (outcome.locked || outcome.failureReason === 'PIN_LOCKED') {
        throw new UnauthorizedException('Customer PIN is locked');
      }
      if (outcome.failureReason === 'PIN_NOT_FOUND') {
        throw new UnauthorizedException('Transaction PIN not set');
      }
      throw new UnauthorizedException('Invalid PIN');
    }
    // PIN verified — do not pass PIN to TransferService (keeps requestHash = sha256(business params only), idempotent for same op)
    // Note: destination wallet ownership is not restricted — can be any customer/agent wallet
    // Do not perform direct ledger mutation; delegate to TransferService (preserves SERIALIZABLE/wallet-locking/double-entry)
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
    // ── A25: batch counterparty resolution (avoid N+1) ──
    const counterpartyWalletIds = [
      ...new Set(
        transfers
          .map((t) => {
            const isSource = walletIds.includes(t.sourceWalletId);
            const isDest = walletIds.includes(t.destinationWalletId);
            if (isSource && !isDest) return t.destinationWalletId;
            if (!isSource && isDest) return t.sourceWalletId;
            if (isSource && isDest) return t.destinationWalletId;
            return null;
          })
          .filter((v): v is string => !!v),
      ),
    ];
    const walletMap = new Map<string, WalletAccount>();
    if (counterpartyWalletIds.length > 0) {
      const cpWallets = await this.walletRepository.find({ where: { id: In(counterpartyWalletIds) } });
      for (const w of cpWallets) walletMap.set(w.id, w);
    }
    const customerIds = [...new Set([...walletMap.values()].map((w) => w.customerId))];
    const profileMap = new Map<string, CustomerProfile>();
    const contactMap = new Map<string, CustomerContactMethod>();
    if (customerIds.length > 0) {
      const profiles = await this.profileRepository.find({ where: { customerId: In(customerIds) } });
      for (const p of profiles) {
        if (p.isActive && p.deletedAt === null) profileMap.set(p.customerId, p);
      }
      const contacts = await this.contactRepository.find({ where: { customerId: In(customerIds) } });
      for (const c of contacts) {
        if (c.type === 'PHONE' && !contactMap.has(c.customerId)) {
          // prefer primary, else first
          if (c.isPrimary || !contactMap.has(c.customerId)) contactMap.set(c.customerId, c);
          // if we already have a primary, don't overwrite with non-primary
          const existing = contactMap.get(c.customerId);
          if (existing && !existing.isPrimary && c.isPrimary) contactMap.set(c.customerId, c);
        }
      }
      // ensure primary preference: re-scan for primary if we stored non-primary first
      for (const c of contacts) {
        if (c.type === 'PHONE' && c.isPrimary) contactMap.set(c.customerId, c);
      }
    }
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
        direction = 'INTERNAL';
        counterpartyWalletId = t.destinationWalletId;
      }
      const cpWallet = counterpartyWalletId ? walletMap.get(counterpartyWalletId) ?? null : null;
      const cpCustomerId = cpWallet?.customerId ?? null;
      const cpProfile = cpCustomerId ? profileMap.get(cpCustomerId) ?? null : null;
      const cpContact = cpCustomerId ? contactMap.get(cpCustomerId) ?? null : null;
      const counterparty = counterpartyWalletId
        ? {
            walletId: counterpartyWalletId,
            customerId: cpCustomerId,
            displayName: cpProfile?.displayName ?? null,
            receivingNumber: cpContact?.normalizedValue ?? cpContact?.value ?? null,
          }
        : null;
      // expose only customer-facing fields; hide journalId/ledgerAccountId/idempotency/requestHash/audit/PIN/OTP
      return {
        transferId: t.id,
        id: t.id,
        transactionType: 'WALLET_TRANSFER',
        type: 'WALLET_TRANSFER',
        direction,
        amountMinor: t.amountMinor,
        currency: t.currency,
        feeMinor: '0',
        status: t.status,
        reference: t.reference,
        narration: t.narration,
        paymentReference: t.paymentReference,
        counterparty,
        counterpartyWalletId,
        sourceWalletId: t.sourceWalletId,
        destinationWalletId: t.destinationWalletId,
        createdAt: t.createdAt,
        completedAt: t.completedAt,
        failureCode: t.failureCode,
        failureMessage: t.failureMessage,
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
    // SELF check: transfer must involve one of customer's wallets, otherwise 404 (no leakage, generic not-found)
    if (!walletIds.has(transfer.sourceWalletId) && !walletIds.has(transfer.destinationWalletId)) {
      throw new NotFoundException('Transfer not found');
    }
    const isSource = walletIds.has(transfer.sourceWalletId);
    const isDest = walletIds.has(transfer.destinationWalletId);
    let direction: string = 'UNKNOWN';
    let counterpartyWalletId: string | null = null;
    if (isSource && !isDest) {
      direction = 'SENT';
      counterpartyWalletId = transfer.destinationWalletId;
    } else if (!isSource && isDest) {
      direction = 'RECEIVED';
      counterpartyWalletId = transfer.sourceWalletId;
    } else if (isSource && isDest) {
      direction = 'INTERNAL';
      counterpartyWalletId = transfer.destinationWalletId;
    }
    // batch counterparty (single) — reuse same logic as list, but single query path for determinism
    let counterparty: { walletId: string; customerId: string | null; displayName: string | null; receivingNumber: string | null } | null = null;
    if (counterpartyWalletId) {
      const cpWallet = await this.walletRepository.findOne({ where: { id: counterpartyWalletId } });
      if (cpWallet) {
        const cpCustomerId = cpWallet.customerId;
        const cpProfile = await this.profileRepository.findOne({ where: { customerId: cpCustomerId, isActive: true } });
        const cpContacts = await this.contactRepository.find({ where: { customerId: cpCustomerId } });
        const primary = cpContacts.find((c) => c.type === 'PHONE' && c.isPrimary) ?? cpContacts.find((c) => c.type === 'PHONE') ?? null;
        counterparty = {
          walletId: counterpartyWalletId,
          customerId: cpCustomerId,
          displayName: cpProfile?.displayName ?? null,
          receivingNumber: primary?.normalizedValue ?? primary?.value ?? null,
        };
      } else {
        counterparty = { walletId: counterpartyWalletId, customerId: null, displayName: null, receivingNumber: null };
      }
    }
    // Return safe projection — consistent with history, hide ledger internals (journalId, ledgerAccountId, audit, requestHash, idempotency, PIN/OTP)
    return {
      id: transfer.id,
      transferId: transfer.id,
      transactionType: 'WALLET_TRANSFER',
      type: 'WALLET_TRANSFER',
      direction,
      amountMinor: transfer.amountMinor,
      currency: transfer.currency,
      feeMinor: '0',
      status: transfer.status,
      reference: transfer.reference,
      narration: transfer.narration,
      paymentReference: transfer.paymentReference,
      counterparty,
      counterpartyWalletId,
      sourceWalletId: transfer.sourceWalletId,
      destinationWalletId: transfer.destinationWalletId,
      createdAt: transfer.createdAt,
      completedAt: transfer.completedAt,
      failureCode: transfer.failureCode,
      failureMessage: transfer.failureMessage,
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
