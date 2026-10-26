import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';

import { AuthorizationService } from '../authorization/authorization.service';
import type { AuthorizationPrincipal } from '../authorization/authorization.types';
import { CreateCustomerAgreementDto } from './dto/create-customer-agreement.dto';
import { CreateCustomerApprovalDecisionDto } from './dto/create-customer-approval-decision.dto';
import { CreateCustomerOnboardingDto } from './dto/create-customer-onboarding.dto';
import { CreateCustomerOnboardingTaskDto } from './dto/create-customer-onboarding-task.dto';
import { UpdateCustomerOnboardingDto } from './dto/update-customer-onboarding.dto';
import { CustomerOnboardingService } from './customer-onboarding.service';

interface AuthenticatedRequest {
  authorizationPrincipal?: AuthorizationPrincipal;
}

@Controller('customers')
export class CustomerOnboardingController {
  constructor(
    private readonly onboardingService: CustomerOnboardingService,
    private readonly auth: AuthorizationService,
  ) {}

  @Post(':id/onboarding')
  createOnboarding(@Param('id') id: string, @Body() dto: CreateCustomerOnboardingDto) {
    return this.onboardingService.createOnboarding(id, dto);
  }

  @Get(':id/onboarding')
  async getOnboarding(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    await this.requireCustomerView(req);
    return this.onboardingService.getOnboarding(id);
  }

  @Patch(':id/onboarding')
  updateOnboarding(@Param('id') id: string, @Body() dto: UpdateCustomerOnboardingDto) {
    return this.onboardingService.updateOnboarding(id, dto);
  }

  @Post(':id/agreements')
  createAgreement(@Param('id') id: string, @Body() dto: CreateCustomerAgreementDto) {
    return this.onboardingService.createAgreement(id, dto);
  }

  @Get(':id/agreements')
  async listAgreements(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    await this.requireCustomerView(req);
    return this.onboardingService.listAgreements(id);
  }

  @Post(':id/onboarding-task')
  createTask(@Param('id') id: string, @Body() dto: CreateCustomerOnboardingTaskDto) {
    return this.onboardingService.createTask(id, dto);
  }

  @Get(':id/onboarding-tasks')
  async listTasks(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    await this.requireCustomerView(req);
    return this.onboardingService.listTasks(id);
  }

  @Post(':id/approval')
  createApproval(@Param('id') id: string, @Body() dto: CreateCustomerApprovalDecisionDto) {
    return this.onboardingService.createApproval(id, dto);
  }

  @Get(':id/approval')
  async getApproval(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    await this.requireCustomerView(req);
    return this.onboardingService.getApproval(id);
  }

  @Get(':id/onboarding-readiness')
  async getReadiness(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    await this.requireCustomerView(req);
    return this.onboardingService.getReadiness(id);
  }

  private async requireCustomerView(req: AuthenticatedRequest): Promise<void> {
    const principal = req.authorizationPrincipal;
    if (!principal) throw new UnauthorizedException('Authentication required');
    if (principal.type === 'CUSTOMER') return;
    await this.auth.requireFunction(
      principal,
      'customer.view',
      'customer',
      ['OPERATOR', 'SERVICE', 'PRIVILEGED'],
    );
  }
}
