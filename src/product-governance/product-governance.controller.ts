import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';

import { CreateProductGovernanceDto } from './dto/create-product-governance.dto';
import { ProductGovernanceQueryDto } from './dto/product-governance-query.dto';
import { ProductGovernanceKind } from './product-governance.enums';
import { UpdateProductGovernanceDto } from './dto/update-product-governance.dto';
import { ProductGovernanceService } from './product-governance.service';

@Controller('internal/product-governance')
export class ProductGovernanceController {
  constructor(private readonly service: ProductGovernanceService) {}

  @Post('records')
  create(@Body() dto: CreateProductGovernanceDto) {
    return this.service.create(dto);
  }

  @Get('records')
  list(@Query() query: ProductGovernanceQueryDto) {
    return this.service.list(query.kind, query.status, query.limit);
  }

  @Get('records/:id')
  get(@Param('id') id: string) {
    return this.service.get(id);
  }

  @Patch('records/:id')
  update(@Param('id') id: string, @Body() dto: UpdateProductGovernanceDto) {
    return this.service.update(id, dto);
  }

  @Get('report')
  report() {
    return this.service.report();
  }

  @Get('readiness')
  readiness() {
    return this.service.launchReadiness();
  }

  @Get('configuration')
  configuration(@Query() query: ProductGovernanceQueryDto) {
    return this.service.list(
      ProductGovernanceKind.PRODUCT_CONFIGURATION,
      query.status,
      query.limit,
    );
  }
}
