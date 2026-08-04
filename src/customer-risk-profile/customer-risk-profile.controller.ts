import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';

import { CustomerRiskProfileService } from './customer-risk-profile.service';
import { CreateCustomerRiskProfileDto } from './dto/create-customer-risk-profile.dto';
import { ReassessCustomerRiskProfileDto } from './dto/reassess-customer-risk-profile.dto';
import { UpdateCustomerRiskProfileDto } from './dto/update-customer-risk-profile.dto';

@Controller('customers')
export class CustomerRiskProfileController {
  constructor(private readonly riskProfileService: CustomerRiskProfileService) {}

  @Post(':id/risk-profile')
  createProfile(@Param('id') id: string, @Body() dto: CreateCustomerRiskProfileDto) {
    return this.riskProfileService.createProfile(id, dto);
  }

  @Get(':id/risk-profile')
  getProfile(@Param('id') id: string) {
    return this.riskProfileService.getProfile(id);
  }

  @Patch(':id/risk-profile')
  updateProfile(@Param('id') id: string, @Body() dto: UpdateCustomerRiskProfileDto) {
    return this.riskProfileService.updateProfile(id, dto);
  }

  @Post(':id/risk-profile/reassess')
  reassessProfile(@Param('id') id: string, @Body() dto: ReassessCustomerRiskProfileDto) {
    return this.riskProfileService.reassessProfile(id, dto);
  }

  @Get(':id/risk-profile/history')
  listHistory(@Param('id') id: string) {
    return this.riskProfileService.listHistory(id);
  }
}
