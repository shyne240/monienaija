import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';

import { CreateCustomerPreferenceDto } from './dto/create-customer-preference.dto';
import { UpdateCustomerPreferenceDto } from './dto/update-customer-preference.dto';
import { CustomerPreferenceService } from './customer-preference.service';

@Controller('customers')
export class CustomerPreferenceController {
  constructor(private readonly preferenceService: CustomerPreferenceService) {}

  @Post(':id/preferences')
  createPreferences(@Param('id') id: string, @Body() dto: CreateCustomerPreferenceDto) {
    return this.preferenceService.createPreferences(id, dto);
  }

  @Get(':id/preferences')
  getPreferences(@Param('id') id: string) {
    return this.preferenceService.getPreferences(id);
  }

  @Patch(':id/preferences')
  updatePreferences(@Param('id') id: string, @Body() dto: UpdateCustomerPreferenceDto) {
    return this.preferenceService.updatePreferences(id, dto);
  }

  @Get(':id/preferences/history')
  listHistory(@Param('id') id: string) {
    return this.preferenceService.listHistory(id);
  }
}
