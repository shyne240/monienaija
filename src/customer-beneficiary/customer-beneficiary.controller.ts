import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';

import { CreateCustomerBeneficiaryDto } from './dto/create-customer-beneficiary.dto';
import { UpdateCustomerBeneficiaryDto } from './dto/update-customer-beneficiary.dto';
import { VerifyCustomerBeneficiaryDto } from './dto/verify-customer-beneficiary.dto';
import { CustomerBeneficiaryService } from './customer-beneficiary.service';

@Controller('customers')
export class CustomerBeneficiaryController {
  constructor(private readonly beneficiaryService: CustomerBeneficiaryService) {}

  @Post(':id/beneficiaries')
  createBeneficiary(@Param('id') id: string, @Body() dto: CreateCustomerBeneficiaryDto) {
    return this.beneficiaryService.createBeneficiary(id, dto);
  }

  @Get(':id/beneficiaries')
  listBeneficiaries(@Param('id') id: string) {
    return this.beneficiaryService.listBeneficiaries(id);
  }

  @Get(':id/beneficiaries/:beneficiaryId')
  getBeneficiary(@Param('id') id: string, @Param('beneficiaryId') beneficiaryId: string) {
    return this.beneficiaryService.getBeneficiary(id, beneficiaryId);
  }

  @Patch(':id/beneficiaries/:beneficiaryId')
  updateBeneficiary(
    @Param('id') id: string,
    @Param('beneficiaryId') beneficiaryId: string,
    @Body() dto: UpdateCustomerBeneficiaryDto,
  ) {
    return this.beneficiaryService.updateBeneficiary(id, beneficiaryId, dto);
  }

  @Post(':id/beneficiaries/:beneficiaryId/verify')
  verifyBeneficiary(
    @Param('id') id: string,
    @Param('beneficiaryId') beneficiaryId: string,
    @Body() dto: VerifyCustomerBeneficiaryDto,
  ) {
    return this.beneficiaryService.verifyBeneficiary(id, beneficiaryId, dto);
  }

  @Get(':id/beneficiaries/:beneficiaryId/history')
  listHistory(@Param('id') id: string, @Param('beneficiaryId') beneficiaryId: string) {
    return this.beneficiaryService.listHistory(id, beneficiaryId);
  }

  @Get(':id/beneficiaries/:beneficiaryId/ownership')
  getOwnership(@Param('id') id: string, @Param('beneficiaryId') beneficiaryId: string) {
    return this.beneficiaryService.getOwnership(id, beneficiaryId);
  }
}
