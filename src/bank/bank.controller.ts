import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';

import { CreateBankDto } from './dto/create-bank.dto';
import { UpdateBankDto } from './dto/update-bank.dto';
import { BankStatus } from './bank.enums';
import { BankService } from './bank.service';

@Controller('banks')
export class BankController {
  constructor(private readonly bankService: BankService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@Body() dto: CreateBankDto) {
    return this.bankService.create(dto);
  }

  @Get()
  list(@Query('search') search?: string, @Query('status') status?: BankStatus) {
    return this.bankService.list(search, status);
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.bankService.get(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateBankDto) {
    return this.bankService.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id') id: string): Promise<void> {
    await this.bankService.remove(id);
  }
}
