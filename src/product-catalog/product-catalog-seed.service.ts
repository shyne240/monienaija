import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { Product } from './product.entity';
import { PRODUCT_CATALOG_SEED } from './product-catalog.seed';

/**
 * V1-COMMERCIAL-02 — idempotent catalogue seeding at application bootstrap, following the
 * CapabilitySeedService convention. Seeds exactly the seven established V1 products; inserts
 * any missing seed codes on later boots without touching existing rows.
 */
@Injectable()
export class ProductCatalogSeedService implements OnApplicationBootstrap {
  private readonly logger = new Logger(ProductCatalogSeedService.name);

  constructor(
    @InjectRepository(Product)
    private readonly repo: Repository<Product>,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.seedIfEmpty();
  }

  async seedIfEmpty(): Promise<number> {
    const count = await this.repo.count();
    if (count > 0) {
      let inserted = 0;
      for (const item of PRODUCT_CATALOG_SEED) {
        const exists = await this.repo.findOne({ where: { code: item.code } as never });
        if (!exists) {
          await this.repo.save(this.repo.create(item as never) as never);
          inserted += 1;
        }
      }
      if (inserted > 0) this.logger.log(`Product catalogue: inserted ${inserted} new products (total ${count + inserted})`);
      return inserted;
    }
    for (const item of PRODUCT_CATALOG_SEED) {
      await this.repo.save(this.repo.create(item as never) as never);
    }
    this.logger.log(`Product catalogue seeded ${PRODUCT_CATALOG_SEED.length} products`);
    return PRODUCT_CATALOG_SEED.length;
  }

  async reseed(): Promise<number> {
    // TRUNCATE ... CASCADE: products is referenced by fee_rules (V1-COMMERCIAL-03); a plain
    // TRUNCATE would fail even when the referencing tables are empty. Test helper only.
    await this.repo.query(`TRUNCATE products CASCADE`);
    for (const item of PRODUCT_CATALOG_SEED) {
      await this.repo.save(this.repo.create(item as never) as never);
    }
    return PRODUCT_CATALOG_SEED.length;
  }
}
