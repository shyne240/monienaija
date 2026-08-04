import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';

import { CreateAddressDto } from './dto/create-address.dto';
import { CreateContactMethodDto } from './dto/create-contact-method.dto';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { CreateIdentityDocumentDto } from './dto/create-identity-document.dto';
import { CreateKycAssessmentDto } from './dto/create-kyc-assessment.dto';
import { CreateProfileDto } from './dto/create-profile.dto';
import { CustomerQueryDto } from './dto/customer-query.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';
import { CustomerService } from './customer.service';

@Controller('customers')
export class CustomerController {
  constructor(private readonly customerService: CustomerService) {}

  @Post()
  create(@Body() dto: CreateCustomerDto) {
    return this.customerService.create(dto);
  }

  @Get()
  list(@Query() query: CustomerQueryDto) {
    return this.customerService.list(query.status, query.type, query.page, query.limit);
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.customerService.get(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateCustomerDto) {
    return this.customerService.updateStatus(id, dto);
  }

  @Post(':id/profile')
  createProfile(@Param('id') id: string, @Body() dto: CreateProfileDto) {
    return this.customerService.createProfile(id, dto);
  }

  @Post(':id/address')
  createAddress(@Param('id') id: string, @Body() dto: CreateAddressDto) {
    return this.customerService.createAddress(id, dto);
  }

  @Post(':id/contact-method')
  createContactMethod(@Param('id') id: string, @Body() dto: CreateContactMethodDto) {
    return this.customerService.createContactMethod(id, dto);
  }

  @Post(':id/identity-document')
  createIdentityDocument(@Param('id') id: string, @Body() dto: CreateIdentityDocumentDto) {
    return this.customerService.createIdentityDocument(id, dto);
  }

  @Post(':id/kyc-assessment')
  createKycAssessment(@Param('id') id: string, @Body() dto: CreateKycAssessmentDto) {
    return this.customerService.createKycAssessment(id, dto);
  }

  @Get(':id/profile')
  getProfile(@Param('id') id: string) {
    return this.customerService.getProfile(id);
  }

  @Get(':id/addresses')
  getAddresses(@Param('id') id: string) {
    return this.customerService.listAddresses(id);
  }

  @Get(':id/contact-methods')
  getContactMethods(@Param('id') id: string) {
    return this.customerService.listContactMethods(id);
  }

  @Get(':id/identity-documents')
  getIdentityDocuments(@Param('id') id: string) {
    return this.customerService.listIdentityDocuments(id);
  }

  @Get(':id/kyc')
  getKyc(@Param('id') id: string) {
    return this.customerService.getKyc(id);
  }
}
