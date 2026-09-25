import { forwardRef, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';

import { CustomerAuthenticationModule } from '../customer-authentication/customer-authentication.module';
import { LedgerModule } from '../ledger/ledger.module';
import { PaymentModule } from '../payment/payment.module';
import { OperationsModule } from '../operations/operations.module';
import { WalletModule } from '../wallet/wallet.module';
import { Agent } from './agent.entity';
import { AgentFinancialAccountBinding } from './agent-financial-account-binding.entity';
import { AgentFinancialAccountService } from './agent-financial-account.service';
import { AgentAuthenticationCredential } from './agent-authentication.entity';
import { AgentAuthenticationService } from './agent-authentication.service';
import { AgentFloatMovementService } from './agent-float-movement.service';
import { AgentSession } from './agent-session.entity';
import { AgentWallet } from './agent-wallet.entity';
import {
  AGENT_FLOAT_ACCOUNTING,
  agentFloatAccountingConfiguration,
} from './agent-float-accounting';
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
  imports: [
    OperationsModule,
    // Reuses the mature PIN/password security primitives only. Agent
    // credentials remain Agent-owned; no customer row is ever created.
    forwardRef(() => CustomerAuthenticationModule),
    LedgerModule,
    PaymentModule,
    WalletModule,
    TypeOrmModule.forFeature([
      Agent,
      AgentWallet,
      AgentFinancialAccountBinding,
      AgentAuthenticationCredential,
      AgentSession,
    ]),
  ],
  providers: [
    AgentService,
    AgentFinancialAccountService,
    AgentFloatMovementService,
    AgentAuthenticationService,
    {
      // Finance-owned classification. Absent configuration keeps Agent float
      // provisioning fail-closed rather than defaulting a GL classification.
      // The database enforces the same decision independently.
      provide: AGENT_FLOAT_ACCOUNTING,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        agentFloatAccountingConfiguration({
          AGENT_FLOAT_ACCOUNTING_ENABLED: config.get<string>('AGENT_FLOAT_ACCOUNTING_ENABLED'),
          AGENT_FLOAT_ACCOUNTING_UNIT: config.get<string>('AGENT_FLOAT_ACCOUNTING_UNIT'),
          AGENT_FLOAT_ACCOUNT_TYPE: config.get<string>('AGENT_FLOAT_ACCOUNT_TYPE'),
          AGENT_FLOAT_NORMAL_BALANCE: config.get<string>('AGENT_FLOAT_NORMAL_BALANCE'),
          AGENT_FLOAT_ACCOUNT_CODE_PREFIX: config.get<string>('AGENT_FLOAT_ACCOUNT_CODE_PREFIX'),
        }),
    },
  ],
  exports: [
    AgentService,
    AgentFinancialAccountService,
    AgentFloatMovementService,
    AgentAuthenticationService,
  ],
})
export class AgentModule {}
