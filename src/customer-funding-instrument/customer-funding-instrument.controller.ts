import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';

import { CreateCustomerFundingInstrumentDto } from './dto/create-customer-funding-instrument.dto';
import { UpdateCustomerFundingInstrumentDto } from './dto/update-customer-funding-instrument.dto';
import { VerifyCustomerFundingInstrumentDto } from './dto/verify-customer-funding-instrument.dto';
import { CustomerFundingInstrumentService } from './customer-funding-instrument.service';

@Controller('customers')
export class CustomerFundingInstrumentController {
  constructor(private readonly instrumentService: CustomerFundingInstrumentService) {}

  @Post(':id/funding-instruments')
  createInstrument(@Param('id') id: string, @Body() dto: CreateCustomerFundingInstrumentDto) {
    return this.instrumentService.createInstrument(id, dto);
  }

  @Get(':id/funding-instruments')
  listInstruments(@Param('id') id: string) {
    return this.instrumentService.listInstruments(id);
  }

  @Get(':id/funding-instruments/:instrumentId')
  getInstrument(@Param('id') id: string, @Param('instrumentId') instrumentId: string) {
    return this.instrumentService.getInstrument(id, instrumentId);
  }

  @Patch(':id/funding-instruments/:instrumentId')
  updateInstrument(
    @Param('id') id: string,
    @Param('instrumentId') instrumentId: string,
    @Body() dto: UpdateCustomerFundingInstrumentDto,
  ) {
    return this.instrumentService.updateInstrument(id, instrumentId, dto);
  }

  @Post(':id/funding-instruments/:instrumentId/verify')
  verifyInstrument(
    @Param('id') id: string,
    @Param('instrumentId') instrumentId: string,
    @Body() dto: VerifyCustomerFundingInstrumentDto,
  ) {
    return this.instrumentService.verifyInstrument(id, instrumentId, dto);
  }

  @Get(':id/funding-instruments/:instrumentId/history')
  listHistory(@Param('id') id: string, @Param('instrumentId') instrumentId: string) {
    return this.instrumentService.listHistory(id, instrumentId);
  }

  @Get(':id/funding-instruments/:instrumentId/ownership')
  getOwnership(@Param('id') id: string, @Param('instrumentId') instrumentId: string) {
    return this.instrumentService.getOwnership(id, instrumentId);
  }
}
