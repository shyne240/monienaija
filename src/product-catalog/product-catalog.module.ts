import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { OperationsModule } from '../operations/operations.module';

import { ProductCatalogController } from './product-catalog.controller';
import { ProductCatalogSeedService } from './product-catalog-seed.service';
import { ProductCatalogService } from './product-catalog.service';
import { Product } from './product.entity';

/**
 * V1-COMMERCIAL-02 — Product Catalogue foundation module.
 * Authoritative "what product is this?" registry for future commercial configuration.
 */
@Module({
  imports: [TypeOrmModule.forFeature([Product]), OperationsModule],
  controllers: [ProductCatalogController],
  providers: [ProductCatalogService, ProductCatalogSeedService],
  exports: [ProductCatalogService, ProductCatalogSeedService],
})
export class ProductCatalogModule {}
