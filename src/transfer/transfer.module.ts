import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthorizationModule } from '../authorization/authorization.module';
import { CapabilityPolicyModule } from '../policy/capability-policy.module';
import { OperationsModule } from '../operations/operations.module';
import { LedgerModule } from '../ledger/ledger.module';
import { PaymentModule } from '../payment/payment.module';
import { PilotControlModule } from '../pilot/pilot-control.module';
import { WalletModule } from '../wallet/wallet.module';
import { WalletAccount } from '../wallet/wallet-account.entity';
import { LedgerJournal } from '../ledger/ledger-journal.entity';
import { Transfer } from './transfer.entity';
import { TransferController } from './transfer.controller';
import {
  A3InternalTransferBindingAdapter,
  TypeOrmInternalTransferGateAuditAdapter,
  TypeOrmInternalTransferGateIdempotencyAdapter,
} from './internal-transfer-gate.adapters';
import { InternalTransferGateService } from './internal-transfer-gate.service';
import { TransferLifecycleService } from './transfer-lifecycle.service';
import {
  INTERNAL_TRANSFER_AUDIT_PORT,
  INTERNAL_TRANSFER_BINDING_PORT,
  INTERNAL_TRANSFER_IDEMPOTENCY_PORT,
} from './internal-transfer-gate.types';
import { TransferService } from './transfer.service';
import { WalletTransactionController } from './wallet-transaction.controller';

@Module({
  imports: [
    AuthorizationModule,
    CapabilityPolicyModule,
    LedgerModule,
    OperationsModule,
    PaymentModule,
    PilotControlModule,
    WalletModule,
    TypeOrmModule.forFeature([Transfer, WalletAccount, LedgerJournal]),
  ],
  controllers: [TransferController, WalletTransactionController],
  providers: [
    TransferService,
    A3InternalTransferBindingAdapter,
    TypeOrmInternalTransferGateAuditAdapter,
    TypeOrmInternalTransferGateIdempotencyAdapter,
    {
      provide: INTERNAL_TRANSFER_BINDING_PORT,
      useExisting: A3InternalTransferBindingAdapter,
    },
    {
      provide: INTERNAL_TRANSFER_AUDIT_PORT,
      useExisting: TypeOrmInternalTransferGateAuditAdapter,
    },
    {
      provide: INTERNAL_TRANSFER_IDEMPOTENCY_PORT,
      useExisting: TypeOrmInternalTransferGateIdempotencyAdapter,
    },
    InternalTransferGateService,
    TransferLifecycleService,
  ],
  exports: [TransferService, InternalTransferGateService, TransferLifecycleService],
})
export class TransferModule {}
