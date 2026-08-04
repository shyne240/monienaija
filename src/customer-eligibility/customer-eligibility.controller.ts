import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';

import { CreateCustomerEligibilityDto } from './dto/create-customer-eligibility.dto';
import { CreateCustomerLimitProfileDto } from './dto/create-customer-limit-profile.dto';
import { CreateCustomerOperatingPermissionDto } from './dto/create-customer-operating-permission.dto';
import { CreateCustomerProductEnrollmentDto } from './dto/create-customer-product-enrollment.dto';
import { CreateCustomerRestrictionDto } from './dto/create-customer-restriction.dto';
import { UpdateCustomerEligibilityDto } from './dto/update-customer-eligibility.dto';
import { UpdateCustomerLimitProfileDto } from './dto/update-customer-limit-profile.dto';
import { UpdateCustomerProductEnrollmentDto } from './dto/update-customer-product-enrollment.dto';
import { CustomerEligibilityService } from './customer-eligibility.service';

@Controller('customers')
export class CustomerEligibilityController {
  constructor(private readonly eligibilityService: CustomerEligibilityService) {}

  @Post(':id/eligibility')
  createEligibility(@Param('id') id: string, @Body() dto: CreateCustomerEligibilityDto) {
    return this.eligibilityService.createEligibility(id, dto);
  }

  @Get(':id/eligibility')
  getEligibility(@Param('id') id: string) {
    return this.eligibilityService.getEligibility(id);
  }

  @Patch(':id/eligibility')
  updateEligibility(@Param('id') id: string, @Body() dto: UpdateCustomerEligibilityDto) {
    return this.eligibilityService.updateEligibility(id, dto);
  }

  @Post(':id/limit-profile')
  createLimitProfile(@Param('id') id: string, @Body() dto: CreateCustomerLimitProfileDto) {
    return this.eligibilityService.createLimitProfile(id, dto);
  }

  @Get(':id/limit-profile')
  getLimitProfile(@Param('id') id: string) {
    return this.eligibilityService.getLimitProfile(id);
  }

  @Patch(':id/limit-profile')
  updateLimitProfile(@Param('id') id: string, @Body() dto: UpdateCustomerLimitProfileDto) {
    return this.eligibilityService.updateLimitProfile(id, dto);
  }

  @Post(':id/product-enrollment')
  createEnrollment(@Param('id') id: string, @Body() dto: CreateCustomerProductEnrollmentDto) {
    return this.eligibilityService.createEnrollment(id, dto);
  }

  @Get(':id/product-enrollments')
  listEnrollments(@Param('id') id: string) {
    return this.eligibilityService.listEnrollments(id);
  }

  @Patch(':id/product-enrollments/:enrollmentId')
  updateEnrollment(
    @Param('id') id: string,
    @Param('enrollmentId') enrollmentId: string,
    @Body() dto: UpdateCustomerProductEnrollmentDto,
  ) {
    return this.eligibilityService.updateEnrollment(id, enrollmentId, dto);
  }

  @Post(':id/permission')
  createPermission(@Param('id') id: string, @Body() dto: CreateCustomerOperatingPermissionDto) {
    return this.eligibilityService.createPermission(id, dto);
  }

  @Get(':id/permissions')
  listPermissions(@Param('id') id: string) {
    return this.eligibilityService.listPermissions(id);
  }

  @Post(':id/restriction')
  createRestriction(@Param('id') id: string, @Body() dto: CreateCustomerRestrictionDto) {
    return this.eligibilityService.createRestriction(id, dto);
  }

  @Get(':id/restrictions')
  listRestrictions(@Param('id') id: string) {
    return this.eligibilityService.listRestrictions(id);
  }

  @Get(':id/operating-status')
  getOperatingStatus(@Param('id') id: string) {
    return this.eligibilityService.getOperatingStatus(id);
  }
}
