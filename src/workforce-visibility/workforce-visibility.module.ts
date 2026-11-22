import { Module } from '@nestjs/common';

import { AuthorizationModule } from '../authorization/authorization.module';
import { WorkforceDirectoryController } from './workforce-directory.controller';
import { WorkforceDirectoryService } from './workforce-directory.service';

/**
 * ARENA 4 — read-only workforce visibility. It owns no entities and writes nothing: every read
 * comes from authoritative tables owned by A2 workforce authentication/administration and the
 * institution module. Kept in its own module so it cannot accidentally acquire a write dependency
 * on those services (and so ownership stays obvious in review).
 */
@Module({
  imports: [AuthorizationModule],
  controllers: [WorkforceDirectoryController],
  providers: [WorkforceDirectoryService],
})
export class WorkforceVisibilityModule {}
