import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';

import { AuthorizationService } from '../authorization/authorization.service';
import type { AuthorizationPrincipal } from '../authorization/authorization.types';
import { AgentApplicationService } from './agent-application.service';
import { CreateAgentApplicationDto } from './dto/create-agent-application.dto';
import { UpdateAgentApplicationDto } from './dto/update-agent-application.dto';

interface RequestLike {
  headers: Record<string, string | string[] | undefined>;
  authorizationPrincipal?: AuthorizationPrincipal;
}

@Controller('agents/applications')
export class AgentApplicationPublicController {
  constructor(
    private readonly applicationService: AgentApplicationService,
    private readonly authorizationService: AuthorizationService,
  ) {}

  @Post()
  @HttpCode(201)
  async create(@Body() dto: CreateAgentApplicationDto) {
    // Application creation remains public. A random one-time capability is returned by the
    // service so subsequent reads, edits and submission cannot be authorized by a guessable ID.
    return this.applicationService.create({
      agentClassId: dto.agentClassId,
      agentClassReference: dto.agentClassReference,
      applicantReference: dto.applicantReference ?? dto.businessName ?? 'Applicant',
      businessName: dto.businessName ?? null,
      contactEmail: dto.contactEmail ?? null,
      payload: dto.payload ?? null,
      actor: 'ANONYMOUS_APPLICANT',
    });
  }

  @Get(':id')
  async getOne(@Param('id') id: string, @Req() req: RequestLike) {
    await this.requireApplicationAccess(id, req);
    return this.applicationService.getById(id);
  }

  @Patch(':id')
  async updateDraft(
    @Param('id') id: string,
    @Body() dto: UpdateAgentApplicationDto,
    @Req() req: RequestLike,
  ) {
    const actor = await this.requireApplicationAccess(id, req);
    return this.applicationService.updateDraft(id, {
      businessName: dto.businessName,
      contactEmail: dto.contactEmail,
      payload: dto.payload,
      agentClassId: dto.agentClassId,
      actor,
      expectedVersion: dto.expectedVersion,
    });
  }

  @Post(':id/submit')
  @HttpCode(200)
  async submit(@Param('id') id: string, @Req() req: RequestLike) {
    const actor = await this.requireApplicationAccess(id, req);
    return this.applicationService.submit(id, actor);
  }

  private async requireApplicationAccess(id: string, req: RequestLike): Promise<string> {
    const principal = req.authorizationPrincipal;
    if (principal) {
      return this.authorizationService.requireFunction(
        principal,
        'agent.review_application',
        'agent-application',
        ['OPERATOR', 'SERVICE', 'PRIVILEGED'],
      );
    }
    const accessToken = this.bearerToken(req.headers.authorization);
    await this.applicationService.assertApplicantAccess(id, accessToken);
    const application = await this.applicationService.getById(id);
    return `agent-application:${application.id}`;
  }

  private bearerToken(header: string | string[] | undefined): string {
    if (typeof header !== 'string') throw new UnauthorizedException('Application access token required');
    const match = /^Bearer\s+(\S+)$/i.exec(header);
    if (!match?.[1]) throw new UnauthorizedException('Application access token required');
    return match[1];
  }
}
