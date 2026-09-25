import {
  Body,
  Controller,
  HttpCode,
  Param,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';

import { AgentLifecycleService } from './agent-lifecycle.service';
import type { AuthorizationPrincipal } from '../authorization/authorization.types';

interface AuthenticatedRequest {
  headers: Record<string, string | string[] | undefined>;
  authorizationPrincipal?: AuthorizationPrincipal;
}

@Controller('internal/agents')
export class AgentLifecycleController {
  constructor(private readonly lifecycleService: AgentLifecycleService) {}

  @Post(':id/activate')
  @HttpCode(200)
  async activate(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    const actor = this.requirePrivileged(req);
    // If id is an applicationId, try activateFromApplication; else direct agent activate
    // We support both: if the id looks like an application and application exists, use application activation
    try {
      const app = await this.lifecycleService.activateFromApplication(id, actor);
      return app;
    } catch {
      // fallback to direct agent activation
      return this.lifecycleService.activate(id, actor);
    }
  }

  @Post(':id/suspend')
  @HttpCode(200)
  async suspend(
    @Param('id') id: string,
    @Body() body: { reason?: string },
    @Req() req: AuthenticatedRequest,
  ) {
    const actor = this.requirePrivileged(req);
    return this.lifecycleService.suspend(id, actor, body.reason);
  }

  @Post(':id/reactivate')
  @HttpCode(200)
  async reactivate(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    const actor = this.requirePrivileged(req);
    return this.lifecycleService.reactivate(id, actor);
  }

  @Post(':id/terminate')
  @HttpCode(200)
  async terminate(
    @Param('id') id: string,
    @Body() body: { reason?: string },
    @Req() req: AuthenticatedRequest,
  ) {
    const actor = this.requirePrivileged(req);
    return this.lifecycleService.terminate(id, actor, body.reason);
  }

  @Post('applications/:applicationId/activate')
  @HttpCode(200)
  async activateFromApplication(
    @Param('applicationId') applicationId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    const actor = this.requirePrivileged(req);
    return this.lifecycleService.activateFromApplication(applicationId, actor);
  }

  private requirePrivileged(req: AuthenticatedRequest): string {
    const principal = req.authorizationPrincipal;
    if (!principal) throw new UnauthorizedException('Authentication required');
    if (principal.type === 'AGENT' || principal.type === 'CUSTOMER') {
      throw new UnauthorizedException('Privileged access required');
    }
    return principal.principalId;
  }
}
