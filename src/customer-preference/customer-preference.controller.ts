import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';

import type { AuthorizationRequest } from '../authorization/authorization.types';
import { CreateCustomerPreferenceDto } from './dto/create-customer-preference.dto';
import { UpdateCustomerPreferenceDto } from './dto/update-customer-preference.dto';
import { CustomerPreferenceService } from './customer-preference.service';

@Controller('customers')
export class CustomerPreferenceController {
  constructor(private readonly preferenceService: CustomerPreferenceService) {}

  @Post(':id/preferences')
  createPreferences(
    @Param('id') id: string,
    @Body() dto: CreateCustomerPreferenceDto,
    @Req() request: AuthorizationRequest,
  ) {
    const actor = this.requireCustomerSelf(id, request);
    return this.preferenceService.createPreferences(id, { ...dto, actor });
  }

  @Get(':id/preferences')
  getPreferences(@Param('id') id: string, @Req() request: AuthorizationRequest) {
    this.requireCustomerSelf(id, request);
    return this.preferenceService.getPreferences(id);
  }

  @Patch(':id/preferences')
  updatePreferences(
    @Param('id') id: string,
    @Body() dto: UpdateCustomerPreferenceDto,
    @Req() request: AuthorizationRequest,
  ) {
    const actor = this.requireCustomerSelf(id, request);
    return this.preferenceService.updatePreferences(id, { ...dto, actor });
  }

  @Get(':id/preferences/history')
  listHistory(@Param('id') id: string, @Req() request: AuthorizationRequest) {
    this.requireCustomerSelf(id, request);
    return this.preferenceService.listHistory(id);
  }

  /** Defense in depth if the route registry or another caller is ever misconfigured. */
  private requireCustomerSelf(id: string, request: AuthorizationRequest): string {
    const principal = request?.authorizationPrincipal;
    if (!principal) throw new UnauthorizedException('Authentication required');
    if (
      principal.type !== 'CUSTOMER' ||
      principal.customerAccess !== 'SELF' ||
      !principal.sessionId ||
      !id ||
      principal.customerId !== id ||
      principal.principalId !== principal.customerId
    ) {
      throw new ForbiddenException('Authorization denied');
    }
    // RuntimeAccessGuard constructs both IDs from the validated customer session. Never use a
    // body-supplied actor; the service persists this identity in history and both audit records.
    return principal.principalId;
  }
}
