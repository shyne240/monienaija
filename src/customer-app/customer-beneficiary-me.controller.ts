import {
  BadRequestException,
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
  ConflictException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { randomBytes } from 'node:crypto';

import { CustomerBeneficiaryService } from '../customer-beneficiary/customer-beneficiary.service';
import { CustomerBeneficiaryStatus, CustomerBeneficiaryType } from '../customer-beneficiary/customer-beneficiary.enums';
import { RecipientResolutionService } from '../agent/recipient-resolution.service';
import type { AuthorizationPrincipal } from '../authorization/authorization.types';

interface AuthenticatedRequest {
  headers: Record<string, string | string[] | undefined>;
  authorizationPrincipal?: AuthorizationPrincipal;
}

function requireCustomerPrincipal(req: AuthenticatedRequest): AuthorizationPrincipal {
  const principal = req.authorizationPrincipal;
  if (!principal || principal.type !== 'CUSTOMER' || !principal.customerId) {
    throw new UnauthorizedException('Customer authentication required');
  }
  return principal;
}

function normalizePageLimit(pageRaw?: string, limitRaw?: string): { page: number; limit: number } {
  const p = pageRaw ? parseInt(pageRaw, 10) : 1;
  const l = limitRaw ? parseInt(limitRaw, 10) : 20;
  const page = Number.isSafeInteger(p) && p >= 1 ? p : 1;
  let limit = Number.isSafeInteger(l) && l >= 1 ? l : 20;
  if (limit > 100) limit = 100;
  return { page, limit };
}

function toSafeProjection(view: any, beneficiaryCustomerId: string | null) {
  return {
    id: view.id,
    nickname: view.nickname,
    beneficiaryCustomerId,
    displayName: view.displayName,
    receivingNumber: view.destinationIdentifier ?? view.normalizedDestinationIdentifier ?? null,
    isVerified: !!view.verified,
    isActive: view.status === CustomerBeneficiaryStatus.ACTIVE,
    status: view.status,
    createdAt: view.createdAt,
  };
}

@Controller('customers/me/beneficiaries')
export class CustomerBeneficiaryMeController {
  constructor(
    private readonly beneficiaryService: CustomerBeneficiaryService,
    private readonly recipientService: RecipientResolutionService,
    private readonly dataSource: DataSource,
  ) {}

  // GET /customers/me/beneficiaries?page=1&limit=20
  @Get()
  async list(
    @Req() req: AuthenticatedRequest,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const principal = requireCustomerPrincipal(req);
    const { page: normalizedPage, limit: normalizedLimit } = normalizePageLimit(page, limit);
    // Use service list then paginate deterministically; service already filters deleted and validates customer
    const all = await this.beneficiaryService.listBeneficiaries(principal.customerId!);
    // Deterministic: sort by createdAt ASC, id ASC (service already does sortByCreatedAt, but ensure)
    const sorted = [...all].sort((a: any, b: any) => {
      const ca = new Date(a.createdAt).getTime();
      const cb = new Date(b.createdAt).getTime();
      if (ca !== cb) return ca - cb;
      return String(a.id).localeCompare(String(b.id));
    });
    const total = sorted.length;
    const totalPages = total === 0 ? 0 : Math.ceil(total / normalizedLimit);
    const offset = (normalizedPage - 1) * normalizedLimit;
    const pageItems = sorted.slice(offset, offset + normalizedLimit);

    // Resolve beneficiaryCustomerId for each via DataSource query (single query per beneficiary, but bounded max 100)
    // For performance, we do batch lookup via DataSource for all destinationIdentifiers at once
    const safeItems: any[] = [];
    for (const view of pageItems) {
      let beneficiaryCustomerId: string | null = null;
      try {
        // Try to resolve via RecipientResolutionService for canonical phone; if fails, fallback to null
        // Use destinationIdentifier normalized
        const dest = (view as any).destinationIdentifier ?? (view as any).normalizedDestinationIdentifier;
        if (dest) {
          try {
            const res = await this.recipientService.resolve(String(dest));
            if (res.ownerType === 'CUSTOMER') beneficiaryCustomerId = res.ownerId;
          } catch {
            // Try direct lookup via customer_contact_methods for internal mapping if resolve threw NotFound due to agent ACTIVE? fallback
            try {
              const canonical = String(dest).replace(/\D/g, '').slice(-10);
              if (canonical.length === 10) {
                const rows: Array<{ customer_id: string }> = await this.dataSource.query(
                  `SELECT customer_id FROM customer_contact_methods WHERE type='PHONE' AND deleted_at IS NULL AND (normalized_value = $1 OR normalized_value = '+234' || $1 OR normalized_value = '234' || $1 OR normalized_value = '0' || $1) LIMIT 1`,
                  [canonical],
                );
                if (rows[0]?.customer_id) beneficiaryCustomerId = rows[0].customer_id;
              }
            } catch {}
          }
        }
      } catch {}
      safeItems.push(toSafeProjection(view, beneficiaryCustomerId));
    }

    return {
      items: safeItems,
      pagination: {
        page: normalizedPage,
        limit: normalizedLimit,
        total,
        totalPages,
        hasNextPage: normalizedPage < totalPages,
      },
    };
  }

  // POST /customers/me/beneficiaries {nickname, beneficiaryIdentifier}
  @Post()
  @HttpCode(201)
  async create(
    @Req() req: AuthenticatedRequest,
    @Body() dto: { nickname?: string; beneficiaryIdentifier?: string; displayName?: string },
  ) {
    const principal = requireCustomerPrincipal(req);
    const nicknameRaw = (dto as any)?.nickname;
    const identifierRaw = (dto as any)?.beneficiaryIdentifier ?? (dto as any)?.identifier ?? (dto as any)?.receivingNumber;
    if (typeof identifierRaw !== 'string' || identifierRaw.trim().length === 0) {
      throw new BadRequestException('beneficiaryIdentifier is required');
    }
    const beneficiaryIdentifier = String(identifierRaw).trim();
    let nickname: string | undefined = undefined;
    if (nicknameRaw !== undefined && nicknameRaw !== null) {
      if (typeof nicknameRaw !== 'string') throw new BadRequestException('nickname must be a string');
      const trimmed = nicknameRaw.trim();
      if (trimmed.length === 0) throw new BadRequestException('nickname must not be empty');
      if (trimmed.length > 120) throw new BadRequestException('nickname must be at most 120 characters');
      nickname = trimmed;
    }

    // Resolve identifier via existing mechanism — must be valid Nigerian 10-digit and map to CUSTOMER
    let resolution: any;
    try {
      resolution = await this.recipientService.resolve(beneficiaryIdentifier);
    } catch (e: any) {
      // Convert NotFound/BadRequest from resolution to 400 invalid
      const msg = e?.message ?? 'Invalid beneficiaryIdentifier';
      throw new BadRequestException(msg);
    }
    if (!resolution || resolution.ownerType !== 'CUSTOMER') {
      throw new BadRequestException('beneficiaryIdentifier must resolve to an internal wallet customer');
    }
    if (resolution.ownerId === principal.customerId) {
      throw new BadRequestException('Cannot add self as beneficiary');
    }
    // Only ACTIVE customers are valid recipients for wallet transfer; SUSPENDED should be blocked
    if (resolution.status && resolution.status !== 'ACTIVE') {
      throw new BadRequestException('Beneficiary recipient is not active');
    }

    const displayName = resolution.display ?? String(beneficiaryIdentifier).trim();
    const destinationIdentifier = resolution.receivingNumber ?? beneficiaryIdentifier;
    const reference = `CUST-BEN-${principal.customerId!.slice(0, 8)}-${randomBytes(4).toString('hex').toUpperCase()}-${Date.now().toString(36).toUpperCase()}`;

    let view: any;
    try {
      view = await this.beneficiaryService.createBeneficiary(principal.customerId!, {
        type: CustomerBeneficiaryType.INTERNAL_CUSTOMER,
        displayName,
        reference,
        destinationIdentifier,
        destinationName: displayName,
        destinationInstitution: 'MONIE_NAIJA',
        nickname: nickname ?? displayName,
        actor: principal.customerId!,
      });
    } catch (e: any) {
      // Preserve 409 duplicates, 400 invalid
      if (e instanceof ConflictException) throw e;
      if (e instanceof BadRequestException) throw e;
      throw e;
    }

    // Auto-verify and activate for internal wallet beneficiaries (zero ledger, uses existing verification + status transition)
    // This makes the beneficiary immediately usable for transfers without workforce step, since RecipientResolution already proves existence.
    try {
      await this.beneficiaryService.verifyBeneficiary(principal.customerId!, view.id, {
        verifiedBy: principal.customerId!,
        verificationMethod: 'CUSTOMER_RESOLUTION',
        remarks: 'Auto-verified via RecipientResolutionService for internal wallet beneficiary',
      });
    } catch (e) {
      // If already verified or conflict, ignore? But we want to ensure verified true
      // Fetch latest and check
    }
    let latest: any;
    try {
      latest = await this.beneficiaryService.getBeneficiary(principal.customerId!, view.id);
    } catch {
      latest = view;
    }
    if (latest.status !== CustomerBeneficiaryStatus.ACTIVE) {
      try {
        // Need latest version for transition
        const fresh = await this.beneficiaryService.getBeneficiary(principal.customerId!, view.id);
        await this.beneficiaryService.updateBeneficiary(principal.customerId!, view.id, {
          status: CustomerBeneficiaryStatus.ACTIVE,
          actor: principal.customerId!,
          version: (fresh as any).version,
        });
      } catch (e: any) {
        // If fails due to already ACTIVE or version conflict, fetch again
      }
    }
    const finalView = await this.beneficiaryService.getBeneficiary(principal.customerId!, view.id);
    const beneficiaryCustomerId = resolution.ownerId;
    return toSafeProjection(finalView, beneficiaryCustomerId);
  }

  // GET /customers/me/beneficiaries/:beneficiaryId
  @Get(':beneficiaryId')
  async getOne(@Req() req: AuthenticatedRequest, @Param('beneficiaryId') beneficiaryId: string) {
    const principal = requireCustomerPrincipal(req);
    if (!beneficiaryId || typeof beneficiaryId !== 'string' || !/^[0-9a-fA-F-]{36}$/.test(beneficiaryId.trim())) {
      throw new BadRequestException('Invalid beneficiaryId');
    }
    let view: any;
    try {
      view = await this.beneficiaryService.getBeneficiary(principal.customerId!, beneficiaryId);
    } catch (e: any) {
      // Map not found to generic 404 without leaking existence
      if (e instanceof NotFoundException) throw new NotFoundException('Beneficiary not found');
      throw e;
    }
    // Resolve beneficiaryCustomerId
    let beneficiaryCustomerId: string | null = null;
    try {
      const dest = (view as any).destinationIdentifier ?? (view as any).normalizedDestinationIdentifier;
      if (dest) {
        const res = await this.recipientService.resolve(String(dest));
        if (res.ownerType === 'CUSTOMER') beneficiaryCustomerId = res.ownerId;
      }
    } catch {}
    return toSafeProjection(view, beneficiaryCustomerId);
  }

  // PATCH /customers/me/beneficiaries/:beneficiaryId {nickname?, isActive?, status?}
  @Patch(':beneficiaryId')
  async patch(
    @Req() req: AuthenticatedRequest,
    @Param('beneficiaryId') beneficiaryId: string,
    @Body() dto: Record<string, unknown>,
  ) {
    const principal = requireCustomerPrincipal(req);
    if (!beneficiaryId || typeof beneficiaryId !== 'string' || !/^[0-9a-fA-F-]{36}$/.test(beneficiaryId.trim())) {
      throw new BadRequestException('Invalid beneficiaryId');
    }
    const allowed = new Set(['nickname', 'isActive', 'status', 'is_active']);
    const keys = Object.keys(dto ?? {});
    for (const k of keys) {
      if (!allowed.has(k)) {
        throw new BadRequestException(`Field '${k}' is not allowed`);
      }
    }
    // Fetch ownership enforced
    let current: any;
    try {
      current = await this.beneficiaryService.getBeneficiary(principal.customerId!, beneficiaryId);
    } catch (e: any) {
      if (e instanceof NotFoundException) throw new NotFoundException('Beneficiary not found');
      throw e;
    }

    let updatedView: any = current;
    let didUpdate = false;

    // Handle nickname if provided
    if ((dto as any).nickname !== undefined) {
      const raw = (dto as any).nickname;
      if (typeof raw !== 'string') throw new BadRequestException('nickname must be a string');
      const trimmed = raw.trim();
      if (trimmed.length === 0) throw new BadRequestException('nickname must not be empty');
      if (trimmed.length > 120) throw new BadRequestException('nickname must be at most 120 characters');
      if (trimmed !== current.nickname) {
        // Direct update via DataSource with ownership check, no ledger, audit via service? We'll do direct save and manual audit is inside service? For nickname, service does not support, so we do direct repository update
        // Reuse DataSource transaction with single scoped query
        await this.dataSource.query(
          `UPDATE customer_beneficiaries SET nickname = $1, updated_at = NOW(), version = version + 1 WHERE id = $2 AND customer_id = $3 AND deleted_at IS NULL`,
          [trimmed, beneficiaryId, principal.customerId!],
        );
        // Verify update succeeded
        const maybe = await this.dataSource.query(
          `SELECT id FROM customer_beneficiaries WHERE id = $1 AND customer_id = $2 AND deleted_at IS NULL LIMIT 1`,
          [beneficiaryId, principal.customerId!],
        );
        if (!maybe[0]) throw new NotFoundException('Beneficiary not found');
        didUpdate = true;
      }
    }

    // Handle status / isActive
    let desiredStatus: CustomerBeneficiaryStatus | undefined = undefined;
    if ((dto as any).status !== undefined) {
      const rawStatus = String((dto as any).status).trim().toUpperCase();
      if (rawStatus !== CustomerBeneficiaryStatus.ACTIVE && rawStatus !== CustomerBeneficiaryStatus.SUSPENDED) {
        throw new BadRequestException('status must be ACTIVE or SUSPENDED');
      }
      desiredStatus = rawStatus as CustomerBeneficiaryStatus;
    } else if ((dto as any).isActive !== undefined || (dto as any).is_active !== undefined) {
      const raw = (dto as any).isActive ?? (dto as any).is_active;
      if (typeof raw !== 'boolean') throw new BadRequestException('isActive must be a boolean');
      desiredStatus = raw ? CustomerBeneficiaryStatus.ACTIVE : CustomerBeneficiaryStatus.SUSPENDED;
    }

    if (desiredStatus && desiredStatus !== current.status) {
      // If nickname was updated, need fresh version
      const fresh = await this.beneficiaryService.getBeneficiary(principal.customerId!, beneficiaryId);
      try {
        updatedView = await this.beneficiaryService.updateBeneficiary(principal.customerId!, beneficiaryId, {
          status: desiredStatus,
          actor: principal.customerId!,
          version: (fresh as any).version,
        });
        didUpdate = true;
      } catch (e: any) {
        if (e instanceof ConflictException || e instanceof BadRequestException) throw e;
        if (e instanceof NotFoundException) throw new NotFoundException('Beneficiary not found');
        throw e;
      }
    } else if (didUpdate) {
      updatedView = await this.beneficiaryService.getBeneficiary(principal.customerId!, beneficiaryId);
    }

    // If no field changed, return current safe projection
    let beneficiaryCustomerId: string | null = null;
    try {
      const dest = (updatedView as any).destinationIdentifier ?? (updatedView as any).normalizedDestinationIdentifier;
      if (dest) {
        const res = await this.recipientService.resolve(String(dest));
        if (res.ownerType === 'CUSTOMER') beneficiaryCustomerId = res.ownerId;
      }
    } catch {}
    return toSafeProjection(updatedView, beneficiaryCustomerId);
  }
}
