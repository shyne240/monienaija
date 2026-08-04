import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';

import { CreateCustomerAgreementDto } from './dto/create-customer-agreement.dto';
import { CreateCustomerApprovalDecisionDto } from './dto/create-customer-approval-decision.dto';
import { CreateCustomerOnboardingDto } from './dto/create-customer-onboarding.dto';
import { CreateCustomerOnboardingTaskDto } from './dto/create-customer-onboarding-task.dto';
import { CreateCustomerRiskProfileDto } from './dto/create-customer-risk-profile.dto';
import { UpdateCustomerOnboardingDto } from './dto/update-customer-onboarding.dto';
import { CustomerOnboardingService } from './customer-onboarding.service';

@Controller('customers')
export class CustomerOnboardingController {
  constructor(private readonly onboardingService: CustomerOnboardingService) {}

  @Post(':id/onboarding')
  createOnboarding(@Param('id') id: string, @Body() dto: CreateCustomerOnboardingDto) {
    return this.onboardingService.createOnboarding(id, dto);
  }

  @Get(':id/onboarding')
  getOnboarding(@Param('id') id: string) {
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
  listAgreements(@Param('id') id: string) {
    return this.onboardingService.listAgreements(id);
  }

  @Post(':id/risk-profile')
  createRiskProfile(@Param('id') id: string, @Body() dto: CreateCustomerRiskProfileDto) {
    return this.onboardingService.createRiskProfile(id, dto);
  }

  @Get(':id/risk-profile')
  getRiskProfile(@Param('id') id: string) {
    return this.onboardingService.getRiskProfile(id);
  }

  @Post(':id/onboarding-task')
  createTask(@Param('id') id: string, @Body() dto: CreateCustomerOnboardingTaskDto) {
    return this.onboardingService.createTask(id, dto);
  }

  @Get(':id/onboarding-tasks')
  listTasks(@Param('id') id: string) {
    return this.onboardingService.listTasks(id);
  }

  @Post(':id/approval')
  createApproval(@Param('id') id: string, @Body() dto: CreateCustomerApprovalDecisionDto) {
    return this.onboardingService.createApproval(id, dto);
  }

  @Get(':id/approval')
  getApproval(@Param('id') id: string) {
    return this.onboardingService.getApproval(id);
  }

  @Get(':id/onboarding-readiness')
  getReadiness(@Param('id') id: string) {
    return this.onboardingService.getReadiness(id);
  }
}
