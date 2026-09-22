import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';

import { ChangeTransactionPinDto } from './dto/change-transaction-pin.dto';
import { CreateTransactionPinDto } from './dto/create-transaction-pin.dto';
import { ResetTransactionPinDto } from './dto/reset-transaction-pin.dto';
import { UnlockCredentialDto } from './dto/unlock-credential.dto';
import { CustomerTransactionPinService } from './customer-transaction-pin.service';

/**
 * Customer transaction PIN management surface. All routes sit under
 * /customers/:id so the runtime access guard enforces the authenticated
 * CUSTOMER principal with SELF customer access, exactly like the rest of the
 * customer authentication API. Responses expose only safe PIN state: never
 * the PIN itself, never hash material.
 */
@Controller('customers')
export class CustomerTransactionPinController {
  constructor(private readonly transactionPinService: CustomerTransactionPinService) {}

  @Get(':id/transaction-pin/status')
  getPinStatus(@Param('id') id: string) {
    return this.transactionPinService.getPinStatus(id);
  }

  @Post(':id/transaction-pin')
  @HttpCode(HttpStatus.CREATED)
  createPin(@Param('id') id: string, @Body() dto: CreateTransactionPinDto) {
    return this.transactionPinService.createPin(id, dto);
  }

  @Post(':id/transaction-pin/change')
  @HttpCode(HttpStatus.OK)
  changePin(@Param('id') id: string, @Body() dto: ChangeTransactionPinDto) {
    return this.transactionPinService.changePin(id, dto);
  }

  @Post(':id/transaction-pin/reset')
  @HttpCode(HttpStatus.OK)
  resetPin(@Param('id') id: string, @Body() dto: ResetTransactionPinDto) {
    return this.transactionPinService.resetPin(id, dto);
  }

  @Post(':id/transaction-pin/unlock')
  @HttpCode(HttpStatus.OK)
  unlockPin(@Param('id') id: string, @Body() dto: UnlockCredentialDto) {
    return this.transactionPinService.unlockPin(id, dto);
  }
}
