import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { OperationsModule } from '../operations/operations.module';
import { Agent } from './agent.entity';
import { AgentService } from './agent.service';

/**
 * V1 Agent bounded context — Stage 1: canonical identity only (ADR-0093 §8).
 *
 * The module deliberately exposes NO controller. Publishing an Agent
 * administration API requires deciding which principal type may administer
 * Agents, and `AuthorizationPrincipalType` must not gain `AGENT` in Stage 1
 * (ADR-0093 §11 records that as decided in principle but not implemented).
 * Adding an HTTP surface here would therefore force an authorization decision
 * that Stage 1 is not authorized to make.
 *
 * It imports OperationsModule solely to reuse the existing immutable audit
 * infrastructure rather than creating a parallel mechanism.
 */
@Module({
  imports: [OperationsModule, TypeOrmModule.forFeature([Agent])],
  providers: [AgentService],
  exports: [AgentService],
})
export class AgentModule {}
