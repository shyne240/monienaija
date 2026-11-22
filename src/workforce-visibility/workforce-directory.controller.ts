import { Controller, Get, Param, Query, Req } from '@nestjs/common';

import { AuthorizationService } from '../authorization/authorization.service';
import type { AuthorizationPrincipal } from '../authorization/authorization.types';
import { WorkforceDirectoryService } from './workforce-directory.service';
import type { WorkforceAccountStatus } from './workforce-directory.service';

interface AuthenticatedRequest {
  headers?: Record<string, string | string[] | undefined>;
  authorizationPrincipal?: AuthorizationPrincipal;
}

/**
 * ARENA 4 — Workforce Administration (read-only visibility).
 *
 * Gated by the existing catalogue function `workforce.role.view` (SUPER_ADMIN, FINANCE_CONTROLLER,
 * FINANCE_AUDITOR, ADMINISTRATOR). No new function code is invented, no principal type beyond
 * OPERATOR/PRIVILEGED is admitted, and no route here mutates anything: role grants and revocations
 * remain on `A2WorkforceAdministrationController` with their maker/checker and ADMINISTRATOR
 * direct-execute controls. A read-only principal (FINANCE_AUDITOR) may inspect but cannot act, and
 * this surface cannot be used to widen that.
 */
@Controller('internal/workforce')
export class WorkforceDirectoryController {
  constructor(
    private readonly directory: WorkforceDirectoryService,
    private readonly auth: AuthorizationService,
  ) {}

  @Get('directory')
  async list(
    @Req() req: AuthenticatedRequest,
    @Query('search') search?: string,
    @Query('roleKey') roleKey?: string,
    @Query('institutionId') institutionId?: string,
    @Query('principalType') principalType?: string,
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    await this.authorize(req);
    return this.directory.list({
      ...(search ? { search } : {}),
      ...(roleKey ? { roleKey } : {}),
      ...(institutionId ? { institutionId } : {}),
      ...(principalType ? { principalType: principalType as 'WORKFORCE' | 'SUPPORT' } : {}),
      ...(status ? { status: status as WorkforceAccountStatus } : {}),
      page: page ? Number(page) : 1,
      limit: limit ? Number(limit) : 20,
    });
  }

  @Get('directory/:principalId')
  async detail(@Req() req: AuthenticatedRequest, @Param('principalId') principalId: string) {
    await this.authorize(req);
    return this.directory.detail(principalId);
  }

  private authorize(req: AuthenticatedRequest): Promise<string> {
    return this.auth.requireFunction(
      req.authorizationPrincipal,
      'workforce.role.view',
      'internal-workforce-directory',
      ['OPERATOR', 'PRIVILEGED'],
    );
  }
}
