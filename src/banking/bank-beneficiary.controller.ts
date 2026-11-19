import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';

import type { AuthorizationPrincipal } from '../authorization/authorization.types';
import { BankBeneficiaryCreationService } from './bank-beneficiary-creation.service';
import { CustomerBeneficiaryService } from '../customer-beneficiary/customer-beneficiary.service';
import { CustomerBeneficiaryStatus } from '../customer-beneficiary/customer-beneficiary.enums';

interface AuthenticatedRequest {
  authorizationPrincipal?: AuthorizationPrincipal;
}

function requireCustomer(req: AuthenticatedRequest): string {
  const p = req.authorizationPrincipal;
  if (!p || p.type !== 'CUSTOMER' || !p.customerId)
    throw new UnauthorizedException('Customer authentication required');
  return p.customerId;
}
function requireAgent(req: AuthenticatedRequest): string {
  const p = req.authorizationPrincipal;
  if (!p || p.type !== 'AGENT' || !p.agentId)
    throw new UnauthorizedException('Agent authentication required');
  return p.agentId;
}

const UUID_PREFIX = /^[0-9a-f]{8}-[0-9a-f]{4}-/i;

/**
 * Customer self-service bank-account beneficiaries.
 * Creation is gated on a successful provider name enquiry (RESOLVED); the service refuses
 * to store an unverified account number. Listing is filtered to BANK_ACCOUNT only.
 */
@Controller('customers/me/banking/beneficiaries')
export class CustomerBankBeneficiaryController {
  constructor(
    private readonly creation: BankBeneficiaryCreationService,
    private readonly beneficiaries: CustomerBeneficiaryService,
    private readonly dataSource: DataSource,
  ) {}

  @Get()
  async list(@Req() req: AuthenticatedRequest, @Query('search') search?: string) {
    const customerId = requireCustomer(req);
    const all = await this.beneficiaries.listBeneficiaries(customerId);
    let items = all.filter((b) => b.type === 'BANK_ACCOUNT');
    if (search && typeof search === 'string' && search.trim()) {
      const needle = search.trim().toLowerCase();
      items = items.filter(
        (b) =>
          b.destinationIdentifier?.toLowerCase().includes(needle) ||
          b.destinationName?.toLowerCase().includes(needle) ||
          b.displayName?.toLowerCase().includes(needle) ||
          (b.nickname && b.nickname.toLowerCase().includes(needle)),
      );
    }
    return { items };
  }

  @Post('bank-accounts')
  async createBankAccount(
    @Req() req: AuthenticatedRequest,
    @Body()
    body: { bankCode?: string; accountNumber?: string; nickname?: string; walletId?: string },
  ) {
    const customerId = requireCustomer(req);
    if (!body || typeof body !== 'object' || Array.isArray(body))
      throw new BadRequestException('Invalid request body');
    return this.creation.createForCustomer(customerId, {
      bankCode: body.bankCode as string,
      accountNumber: body.accountNumber as string,
      nickname: body.nickname,
      walletId: body.walletId,
    });
  }

  @Get(':beneficiaryId')
  async getOne(@Req() req: AuthenticatedRequest, @Param('beneficiaryId') beneficiaryId: string) {
    const customerId = requireCustomer(req);
    if (!UUID_PREFIX.test(beneficiaryId))
      throw new BadRequestException('beneficiaryId must be a UUID');
    return this.beneficiaries.getBeneficiary(customerId, beneficiaryId);
  }

  @Patch(':beneficiaryId')
  async patch(
    @Req() req: AuthenticatedRequest,
    @Param('beneficiaryId') beneficiaryId: string,
    @Body() dto: Record<string, unknown>,
  ) {
    const customerId = requireCustomer(req);
    if (!UUID_PREFIX.test(beneficiaryId))
      throw new BadRequestException('beneficiaryId must be a UUID');
    const allowed = new Set(['nickname', 'isActive', 'status']);
    for (const k of Object.keys(dto ?? {}))
      if (!allowed.has(k)) throw new BadRequestException(`Field '${k}' is not allowed`);
    const current = await this.beneficiaries.getBeneficiary(customerId, beneficiaryId);
    let didPatchNickname = false;
    if (dto.nickname !== undefined) {
      const raw = dto.nickname;
      if (typeof raw !== 'string' || !raw.trim())
        throw new BadRequestException('nickname must be a string');
      if (raw.trim().length > 120)
        throw new BadRequestException('nickname must be at most 120 characters');
      if (raw.trim() !== current.nickname) {
        await this.dataSource.query(
          `UPDATE customer_beneficiaries SET nickname=$1, updated_at=NOW(), version=version+1 WHERE id=$2 AND customer_id=$3 AND deleted_at IS NULL`,
          [raw.trim(), beneficiaryId, customerId],
        );
        didPatchNickname = true;
      }
    }
    let desiredStatus: CustomerBeneficiaryStatus | undefined;
    if (dto.status !== undefined) {
      const raw = String(dto.status).trim().toUpperCase();
      if (raw !== CustomerBeneficiaryStatus.ACTIVE && raw !== CustomerBeneficiaryStatus.SUSPENDED)
        throw new BadRequestException('status must be ACTIVE or SUSPENDED');
      desiredStatus = raw as CustomerBeneficiaryStatus;
    } else if (dto.isActive !== undefined) {
      if (typeof dto.isActive !== 'boolean')
        throw new BadRequestException('isActive must be a boolean');
      desiredStatus = dto.isActive
        ? CustomerBeneficiaryStatus.ACTIVE
        : CustomerBeneficiaryStatus.SUSPENDED;
    }
    if (desiredStatus && desiredStatus !== current.status) {
      const fresh = await this.beneficiaries.getBeneficiary(customerId, beneficiaryId);
      return this.beneficiaries.updateBeneficiary(customerId, beneficiaryId, {
        status: desiredStatus,
        actor: customerId,
        version: fresh.version,
      });
    }
    if (didPatchNickname) return this.beneficiaries.getBeneficiary(customerId, beneficiaryId);
    return current;
  }
}

@Controller('agents/me/banking/beneficiaries')
export class AgentBankBeneficiaryController {
  constructor(
    private readonly creation: BankBeneficiaryCreationService,
    private readonly beneficiaries: CustomerBeneficiaryService,
    private readonly dataSource: DataSource,
  ) {}

  @Get()
  async list(@Req() req: AuthenticatedRequest) {
    const agentId = requireAgent(req);
    const all = await this.beneficiaries.listAgentBeneficiaries(agentId);
    return { items: all.filter((b) => b.type === 'BANK_ACCOUNT') };
  }

  @Post('bank-accounts')
  async createBankAccount(
    @Req() req: AuthenticatedRequest,
    @Body()
    body: { bankCode?: string; accountNumber?: string; nickname?: string; walletId?: string },
  ) {
    const agentId = requireAgent(req);
    if (!body || typeof body !== 'object' || Array.isArray(body))
      throw new BadRequestException('Invalid request body');
    return this.creation.createForAgent(agentId, {
      bankCode: body.bankCode as string,
      accountNumber: body.accountNumber as string,
      nickname: body.nickname,
      walletId: body.walletId,
    });
  }

  @Get(':beneficiaryId')
  async getOne(@Req() req: AuthenticatedRequest, @Param('beneficiaryId') beneficiaryId: string) {
    const agentId = requireAgent(req);
    if (!UUID_PREFIX.test(beneficiaryId))
      throw new BadRequestException('beneficiaryId must be a UUID');
    return this.beneficiaries.getAgentBeneficiary(agentId, beneficiaryId);
  }

  @Patch(':beneficiaryId')
  async patch(
    @Req() req: AuthenticatedRequest,
    @Param('beneficiaryId') beneficiaryId: string,
    @Body() dto: Record<string, unknown>,
  ) {
    const agentId = requireAgent(req);
    if (!UUID_PREFIX.test(beneficiaryId))
      throw new BadRequestException('beneficiaryId must be a UUID');
    const allowed = new Set(['nickname', 'isActive', 'status']);
    for (const k of Object.keys(dto ?? {}))
      if (!allowed.has(k)) throw new BadRequestException(`Field '${k}' is not allowed`);
    const current = await this.beneficiaries.getAgentBeneficiary(agentId, beneficiaryId);
    let didPatchNickname = false;
    if (dto.nickname !== undefined) {
      const raw = dto.nickname;
      if (typeof raw !== 'string' || !raw.trim())
        throw new BadRequestException('nickname must be a string');
      if (raw.trim().length > 120)
        throw new BadRequestException('nickname must be at most 120 characters');
      if (raw.trim() !== current.nickname) {
        await this.dataSource.query(
          `UPDATE customer_beneficiaries SET nickname=$1, updated_at=NOW(), version=version+1 WHERE id=$2 AND agent_id=$3 AND deleted_at IS NULL`,
          [raw.trim(), beneficiaryId, agentId],
        );
        didPatchNickname = true;
      }
    }
    let desiredStatus: CustomerBeneficiaryStatus | undefined;
    if (dto.status !== undefined) {
      const raw = String(dto.status).trim().toUpperCase();
      if (raw !== CustomerBeneficiaryStatus.ACTIVE && raw !== CustomerBeneficiaryStatus.SUSPENDED)
        throw new BadRequestException('status must be ACTIVE or SUSPENDED');
      desiredStatus = raw as CustomerBeneficiaryStatus;
    } else if (dto.isActive !== undefined) {
      if (typeof dto.isActive !== 'boolean')
        throw new BadRequestException('isActive must be a boolean');
      desiredStatus = dto.isActive
        ? CustomerBeneficiaryStatus.ACTIVE
        : CustomerBeneficiaryStatus.SUSPENDED;
    }
    if (desiredStatus && desiredStatus !== current.status) {
      return this.beneficiaries.updateAgentBeneficiary(agentId, beneficiaryId, desiredStatus);
    }
    if (didPatchNickname) return this.beneficiaries.getAgentBeneficiary(agentId, beneficiaryId);
    return current;
  }
}
