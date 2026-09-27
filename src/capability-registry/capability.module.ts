import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Capability } from './capability.entity';
import { CapabilityController } from './capability.controller';
import { CapabilitySeedService } from './capability-seed.service';
import { CapabilityService } from './capability.service';

@Module({
  imports: [TypeOrmModule.forFeature([Capability])],
  controllers: [CapabilityController],
  providers: [CapabilityService, CapabilitySeedService],
  exports: [CapabilityService],
})
export class CapabilityRegistryModule {}
