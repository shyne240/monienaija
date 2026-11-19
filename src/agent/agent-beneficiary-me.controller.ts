import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import type { AuthorizationPrincipal } from '../authorization/authorization.types';
import { CustomerBeneficiaryService } from '../customer-beneficiary/customer-beneficiary.service';
import { CustomerBeneficiaryStatus } from '../customer-beneficiary/customer-beneficiary.enums';
import type { CustomerBeneficiaryView } from '../customer-beneficiary/customer-beneficiary.types';
import { RecipientResolutionService } from './recipient-resolution.service';

interface AgentRequest {
  authorizationPrincipal?: AuthorizationPrincipal;
}
function requireAgent(req: AgentRequest): string {
  const p = req.authorizationPrincipal;
  if (!p || p.type !== 'AGENT' || !p.agentId || !p.sessionId)
    throw new UnauthorizedException('Agent session required');
  return p.agentId;
}
function safe(view: CustomerBeneficiaryView) {
  return {
    id: view.id,
    nickname: view.nickname,
    displayName: view.displayName,
    receivingNumber: view.destinationIdentifier,
    recipientType: view.walletRecipientType,
    recipientId: view.walletRecipientId,
    isActive: view.status === CustomerBeneficiaryStatus.ACTIVE,
    isVerified: view.verified,
    status: view.status,
    createdAt: view.createdAt,
  };
}
function bodyObject(body: unknown, allowed: string[]): Record<string, unknown> {
  if (
    !body ||
    typeof body !== 'object' ||
    Array.isArray(body) ||
    Object.keys(body).some((k) => !allowed.includes(k))
  )
    throw new BadRequestException('Invalid request body');
  return body as Record<string, unknown>;
}
@Controller('agents/me/beneficiaries')
export class AgentBeneficiaryMeController {
  constructor(
    private readonly beneficiaries: CustomerBeneficiaryService,
    private readonly recipients: RecipientResolutionService,
  ) {}
  @Get() async list(@Req() req: AgentRequest) {
    const all = await this.beneficiaries.listAgentBeneficiaries(requireAgent(req));
    return { items: all.map(safe) };
  }
  @Get(':beneficiaryId') async get(@Req() req: AgentRequest, @Param('beneficiaryId') id: string) {
    return safe(await this.beneficiaries.getAgentBeneficiary(requireAgent(req), id));
  }
  @Post() async create(@Req() req: AgentRequest, @Body() raw: unknown) {
    const agentId = requireAgent(req);
    const body = bodyObject(raw, ['beneficiaryIdentifier', 'nickname']);
    if (typeof body.beneficiaryIdentifier !== 'string' || !body.beneficiaryIdentifier.trim())
      throw new BadRequestException('beneficiaryIdentifier is required');
    if (body.nickname !== undefined && (typeof body.nickname !== 'string' || !body.nickname.trim()))
      throw new BadRequestException('nickname must not be empty');
    let resolved;
    try {
      resolved = await this.recipients.resolve(body.beneficiaryIdentifier);
    } catch (error) {
      if (error instanceof NotFoundException)
        throw new BadRequestException('Invalid beneficiaryIdentifier');
      throw error;
    }
    return safe(
      await this.beneficiaries.createResolvedWalletBeneficiary(
        { type: 'AGENT', id: agentId },
        resolved,
        body.nickname,
      ),
    );
  }
  @Patch(':beneficiaryId') async patch(
    @Req() req: AgentRequest,
    @Param('beneficiaryId') id: string,
    @Body() raw: unknown,
  ) {
    const body = bodyObject(raw, ['status']);
    if (body.status !== 'ACTIVE' && body.status !== 'SUSPENDED' && body.status !== 'DELETED')
      throw new BadRequestException('Invalid beneficiary status');
    return safe(
      await this.beneficiaries.updateAgentBeneficiary(
        requireAgent(req),
        id,
        body.status as CustomerBeneficiaryStatus,
      ),
    );
  }
}
