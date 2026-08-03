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

import { CreateBeneficiaryDto } from './dto/create-beneficiary.dto';
import { UpdateBeneficiaryDto } from './dto/update-beneficiary.dto';
import { BeneficiaryService } from './beneficiary.service';

@Controller('beneficiaries')
export class BeneficiaryController {
  constructor(private readonly beneficiaryService: BeneficiaryService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@Body() dto: CreateBeneficiaryDto) {
    return this.beneficiaryService.create(dto);
  }

  @Get()
  list(@Query('customerId') customerId = '') {
    return this.beneficiaryService.list(customerId);
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.beneficiaryService.get(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateBeneficiaryDto) {
    return this.beneficiaryService.updateNickname(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id') id: string): Promise<void> {
    await this.beneficiaryService.remove(id);
  }
}
