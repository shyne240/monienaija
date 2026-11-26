import {
  BadRequestException,
  Controller,
  ForbiddenException,
  Get,
  Header,
  Optional,
  Query,
  Req,
  UnauthorizedException,
} from '@nestjs/common';

import type { AuthorizationPrincipal } from '../authorization/authorization.types';
import { InstitutionWorkforceScopeService } from '../institution/institution-workforce-scope.service';
import { CustomerComplianceAccessGuard } from './customer-compliance-access.guard';
import { ComplianceCaseCategory } from './customer-compliance.enums';
import { CustomerComplianceService } from './customer-compliance.service';

interface WorkforceRequest {
  authorizationPrincipal?: AuthorizationPrincipal;
}

@Controller('internal/compliance-cases')
export class InternalComplianceQueueController {
  constructor(
    private readonly complianceService: CustomerComplianceService,
    private readonly accessGuard: CustomerComplianceAccessGuard,
    @Optional() private readonly institutionScope?: InstitutionWorkforceScopeService,
  ) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  async listQueue(
    @Req() req: WorkforceRequest,
    @Query('scope') scopeRaw?: string,
    @Query('status') status?: string,
    @Query('severity') severity?: string,
    @Query('category') category?: string,
    @Query('assignedTo') assignedTo?: string,
    @Query('search') search?: string,
    @Query('institutionId') institutionId?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const principal = req.authorizationPrincipal;
    if (!principal) throw new UnauthorizedException('Authentication required');

    const normalizedScope = (scopeRaw?.trim().toUpperCase() || 'COMPLIANCE') as
      | 'COMPLIANCE'
      | 'FRAUD';
    if (normalizedScope !== 'COMPLIANCE' && normalizedScope !== 'FRAUD') {
      throw new BadRequestException('scope must be COMPLIANCE or FRAUD');
    }

    const access = await this.accessGuard.resolveAccess(principal, 'GET');
    if (normalizedScope === 'FRAUD') {
      if (!access.categories.includes(ComplianceCaseCategory.FRAUD)) {
        throw new ForbiddenException('Fraud case queue requires risk_fraud.manage_fraud_case');
      }
    } else {
      if (!access.categories.some((cat) => cat !== ComplianceCaseCategory.FRAUD)) {
        throw new ForbiddenException('Compliance case queue requires compliance.manage_case');
      }
    }

    const requiredFunction =
      normalizedScope === 'FRAUD' ? 'risk_fraud.manage_fraud_case' : 'compliance.manage_case';
    const canExecute = await this.accessGuard.hasExecuteCapability(principal, requiredFunction);
    const canViewCustomer = principal.scopes.includes('customer.view');

    const recordScope = this.institutionScope
      ? await this.institutionScope.resolveCustomerRecordScope(principal, institutionId)
      : {
          mode: 'PLATFORM' as const,
          institutionIds: [] as string[],
          enrolmentsTablePresent: false,
          agentAffiliationsTablePresent: false,
        };

    return this.complianceService.listQueueCases({
      domainScope: normalizedScope,
      access,
      recordScope,
      canExecute,
      canViewCustomer,
      principalId: principal.principalId,
      status,
      severity,
      category,
      assignedTo,
      search,
      page: page !== undefined ? Number(page) : undefined,
      limit: limit !== undefined ? Number(limit) : undefined,
    });
  }
}
