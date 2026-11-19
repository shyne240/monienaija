import {
  BadRequestException,
  Body,
  Controller,
  Get,
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

import { CustomerBeneficiaryService } from '../customer-beneficiary/customer-beneficiary.service';
import type { CustomerBeneficiaryView } from '../customer-beneficiary/customer-beneficiary.types';
import type { RecipientResolution } from '../agent/agent-receiving-number.types';
import { CustomerBeneficiaryStatus } from '../customer-beneficiary/customer-beneficiary.enums';
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

// Some older projections can include this optional field; retain the existing fallback.
type BeneficiaryView = CustomerBeneficiaryView & {
  normalizedDestinationIdentifier?: string | null;
};

function toSafeProjection(view: BeneficiaryView, beneficiaryCustomerId: string | null) {
  return {
    id: view.id,
    nickname: view.nickname,
    beneficiaryCustomerId,
    recipientType: view.walletRecipientType ?? null,
    recipientId: view.walletRecipientId ?? null,
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
    const sorted: BeneficiaryView[] = [...all].sort((a, b) => {
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
    const safeItems: Array<ReturnType<typeof toSafeProjection>> = [];
    for (const view of pageItems) {
      let beneficiaryCustomerId: string | null = null;
      try {
        // Try to resolve via RecipientResolutionService for canonical phone; if fails, fallback to null
        // Use destinationIdentifier normalized
        const dest = view.destinationIdentifier ?? view.normalizedDestinationIdentifier;
        if (dest) {
          try {
            const res = await this.recipientService.resolve(String(dest));
            if (
              res.ownerType === 'CUSTOMER' &&
              (!view.walletRecipientId ||
                (view.walletRecipientType === res.ownerType &&
                  view.walletRecipientId === res.ownerId))
            )
              beneficiaryCustomerId = res.ownerId;
          } catch {
            // A failed or ambiguous resolution must remain unresolved. A direct phone
            // lookup here would bypass the resolver's identity and collision checks.
          }
        }
      } catch {
        // Keep an unresolved customer ID when resolution fails.
      }
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
    @Body()
    dto: {
      nickname?: string;
      beneficiaryIdentifier?: string;
      displayName?: string;
      identifier?: string;
      receivingNumber?: string;
    },
  ) {
    const principal = requireCustomerPrincipal(req);
    const nicknameRaw = dto?.nickname;
    const identifierRaw = dto?.beneficiaryIdentifier ?? dto?.identifier ?? dto?.receivingNumber;
    if (typeof identifierRaw !== 'string' || identifierRaw.trim().length === 0) {
      throw new BadRequestException('beneficiaryIdentifier is required');
    }
    const beneficiaryIdentifier = String(identifierRaw).trim();
    let nickname: string | undefined = undefined;
    if (nicknameRaw !== undefined && nicknameRaw !== null) {
      if (typeof nicknameRaw !== 'string')
        throw new BadRequestException('nickname must be a string');
      const trimmed = nicknameRaw.trim();
      if (trimmed.length === 0) throw new BadRequestException('nickname must not be empty');
      if (trimmed.length > 120)
        throw new BadRequestException('nickname must be at most 120 characters');
      nickname = trimmed;
    }

    let resolution: RecipientResolution;
    try {
      resolution = await this.recipientService.resolve(beneficiaryIdentifier);
    } catch (error: unknown) {
      if (error instanceof ConflictException) throw error;
      if (error instanceof BadRequestException || error instanceof NotFoundException)
        throw new BadRequestException('Invalid beneficiaryIdentifier');
      throw error;
    }
    const view = await this.beneficiaryService.createResolvedWalletBeneficiary(
      { type: 'CUSTOMER', id: principal.customerId! },
      resolution,
      nickname,
    );
    return toSafeProjection(view, resolution.ownerType === 'CUSTOMER' ? resolution.ownerId : null);
  }

  // GET /customers/me/beneficiaries/:beneficiaryId
  @Get(':beneficiaryId')
  async getOne(@Req() req: AuthenticatedRequest, @Param('beneficiaryId') beneficiaryId: string) {
    const principal = requireCustomerPrincipal(req);
    if (
      !beneficiaryId ||
      typeof beneficiaryId !== 'string' ||
      !/^[0-9a-fA-F-]{36}$/.test(beneficiaryId.trim())
    ) {
      throw new BadRequestException('Invalid beneficiaryId');
    }
    let view: BeneficiaryView;
    try {
      view = await this.beneficiaryService.getBeneficiary(principal.customerId!, beneficiaryId);
    } catch (e: unknown) {
      // Map not found to generic 404 without leaking existence
      if (e instanceof NotFoundException) throw new NotFoundException('Beneficiary not found');
      throw e;
    }
    // Resolve beneficiaryCustomerId
    let beneficiaryCustomerId: string | null = null;
    try {
      const dest = view.destinationIdentifier ?? view.normalizedDestinationIdentifier;
      if (dest) {
        const res = await this.recipientService.resolve(String(dest));
        if (
          res.ownerType === 'CUSTOMER' &&
          (!view.walletRecipientId ||
            (view.walletRecipientType === res.ownerType && view.walletRecipientId === res.ownerId))
        )
          beneficiaryCustomerId = res.ownerId;
      }
    } catch {
      // Keep an unresolved customer ID when resolution fails.
    }
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
    if (
      !beneficiaryId ||
      typeof beneficiaryId !== 'string' ||
      !/^[0-9a-fA-F-]{36}$/.test(beneficiaryId.trim())
    ) {
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
    let current: BeneficiaryView;
    try {
      current = await this.beneficiaryService.getBeneficiary(principal.customerId!, beneficiaryId);
    } catch (e: unknown) {
      if (e instanceof NotFoundException) throw new NotFoundException('Beneficiary not found');
      throw e;
    }

    let updatedView: BeneficiaryView = current;
    let didUpdate = false;

    // Handle nickname if provided
    if (dto.nickname !== undefined) {
      const raw = dto.nickname;
      if (typeof raw !== 'string') throw new BadRequestException('nickname must be a string');
      const trimmed = raw.trim();
      if (trimmed.length === 0) throw new BadRequestException('nickname must not be empty');
      if (trimmed.length > 120)
        throw new BadRequestException('nickname must be at most 120 characters');
      if (trimmed !== current.nickname) {
        // Direct update via DataSource with ownership check, no ledger, audit via service? We'll do direct save and manual audit is inside service? For nickname, service does not support, so we do direct repository update
        // Reuse DataSource transaction with single scoped query
        await this.dataSource.query(
          `UPDATE customer_beneficiaries SET nickname = $1, updated_at = NOW(), version = version + 1 WHERE id = $2 AND customer_id = $3 AND deleted_at IS NULL`,
          [trimmed, beneficiaryId, principal.customerId!],
        );
        // Verify update succeeded
        const maybe: Array<{ id: string }> = await this.dataSource.query(
          `SELECT id FROM customer_beneficiaries WHERE id = $1 AND customer_id = $2 AND deleted_at IS NULL LIMIT 1`,
          [beneficiaryId, principal.customerId!],
        );
        if (!maybe[0]) throw new NotFoundException('Beneficiary not found');
        didUpdate = true;
      }
    }

    // Handle status / isActive
    let desiredStatus: CustomerBeneficiaryStatus | undefined = undefined;
    if (dto.status !== undefined) {
      // Preserve the existing string conversion before checking the allowed statuses.
      const rawStatus = String(dto.status as string)
        .trim()
        .toUpperCase();
      if (
        rawStatus !== (CustomerBeneficiaryStatus.ACTIVE as string) &&
        rawStatus !== (CustomerBeneficiaryStatus.SUSPENDED as string)
      ) {
        throw new BadRequestException('status must be ACTIVE or SUSPENDED');
      }
      desiredStatus = rawStatus as CustomerBeneficiaryStatus;
    } else if (dto.isActive !== undefined || dto.is_active !== undefined) {
      const raw = dto.isActive ?? dto.is_active;
      if (typeof raw !== 'boolean') throw new BadRequestException('isActive must be a boolean');
      desiredStatus = raw ? CustomerBeneficiaryStatus.ACTIVE : CustomerBeneficiaryStatus.SUSPENDED;
    }

    if (desiredStatus && desiredStatus !== current.status) {
      // If nickname was updated, need fresh version
      const fresh = await this.beneficiaryService.getBeneficiary(
        principal.customerId!,
        beneficiaryId,
      );
      try {
        updatedView = await this.beneficiaryService.updateBeneficiary(
          principal.customerId!,
          beneficiaryId,
          {
            status: desiredStatus,
            actor: principal.customerId!,
            version: fresh.version,
          },
        );
        didUpdate = true;
      } catch (e: unknown) {
        if (e instanceof ConflictException || e instanceof BadRequestException) throw e;
        if (e instanceof NotFoundException) throw new NotFoundException('Beneficiary not found');
        throw e;
      }
    } else if (didUpdate) {
      updatedView = await this.beneficiaryService.getBeneficiary(
        principal.customerId!,
        beneficiaryId,
      );
    }

    // If no field changed, return current safe projection
    let beneficiaryCustomerId: string | null = null;
    try {
      const dest = updatedView.destinationIdentifier ?? updatedView.normalizedDestinationIdentifier;
      if (dest) {
        const res = await this.recipientService.resolve(String(dest));
        if (
          res.ownerType === 'CUSTOMER' &&
          (!updatedView.walletRecipientId ||
            (updatedView.walletRecipientType === res.ownerType &&
              updatedView.walletRecipientId === res.ownerId))
        )
          beneficiaryCustomerId = res.ownerId;
      }
    } catch {
      // Keep an unresolved customer ID when resolution fails.
    }
    return toSafeProjection(updatedView, beneficiaryCustomerId);
  }
}
