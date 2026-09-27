import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { Capability } from './capability.entity';
import { CAPABILITY_SEED } from './capability.seed';

@Injectable()
export class CapabilitySeedService implements OnApplicationBootstrap {
  private readonly logger = new Logger(CapabilitySeedService.name);

  constructor(
    @InjectRepository(Capability)
    private readonly repo: Repository<Capability>,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.seedIfEmpty();
  }

  async seedIfEmpty(): Promise<number> {
    const count = await this.repo.count();
    if (count > 0) {
      // Ensure any new seed codes are inserted (idempotent upsert for new capabilities added in later code)
      let inserted = 0;
      for (const item of CAPABILITY_SEED) {
        const exists = await this.repo.findOne({ where: { capabilityCode: item.capabilityCode } as never });
        if (!exists) {
          await this.repo.save(this.repo.create(item as never) as never);
          inserted++;
        }
      }
      if (inserted > 0) this.logger.log(`Capability registry: inserted ${inserted} new capabilities (total ${count + inserted})`);
      return inserted;
    }
    // Empty — full seed
    for (const item of CAPABILITY_SEED) {
      await this.repo.save(this.repo.create(item as never) as never);
    }
    this.logger.log(`Capability registry seeded ${CAPABILITY_SEED.length} capabilities`);
    return CAPABILITY_SEED.length;
  }

  async reseed(): Promise<number> {
    // For tests: truncate and reseed
    await this.repo.clear();
    for (const item of CAPABILITY_SEED) {
      await this.repo.save(this.repo.create(item as never) as never);
    }
    return CAPABILITY_SEED.length;
  }
}
