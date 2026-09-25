import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Agent } from '../agent/agent.entity';
import { OperationsModule } from '../operations/operations.module';
import { AgentAuthenticationCredential } from './agent-authentication-credential.entity';
import { AgentTransactionPin } from './agent-transaction-pin.entity';
import { AgentAuthenticationSession } from './agent-authentication-session.entity';
import { AgentAuthenticationController } from './agent-authentication.controller';
import { AgentAuthenticationService } from './agent-authentication.service';
import { AgentAuthenticationExecutionService } from './agent-authentication-execution.service';
import { AgentAuthenticationSessionService } from './agent-authentication-session.service';
import { AgentPasswordHashVerificationService } from './agent-password-hash-verification.service';

@Module({
  imports: [
    forwardRef(() => OperationsModule),
    TypeOrmModule.forFeature([Agent, AgentAuthenticationCredential, AgentTransactionPin, AgentAuthenticationSession]),
  ],
  controllers: [AgentAuthenticationController],
  providers: [
    AgentAuthenticationService,
    AgentAuthenticationExecutionService,
    AgentAuthenticationSessionService,
    AgentPasswordHashVerificationService,
  ],
  exports: [
    AgentAuthenticationService,
    AgentAuthenticationExecutionService,
    AgentAuthenticationSessionService,
    AgentPasswordHashVerificationService,
  ],
})
export class AgentAuthenticationModule {}
