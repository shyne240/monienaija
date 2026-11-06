import 'reflect-metadata';
import { ForbiddenException } from '@nestjs/common';

import { DepositController } from '../src/deposit/deposit.controller';
import type { CreateDepositDto } from '../src/deposit/dto/create-deposit.dto';
import { FeeController } from '../src/fee/fee.controller';
import type { CalculateFeeDto } from '../src/fee/dto/calculate-fee.dto';
import type { FeeEngine } from '../src/fee/fee.engine';
import { LedgerController } from '../src/ledger/ledger.controller';
import type { CreateLedgerAccountDto } from '../src/ledger/dto/create-ledger-account.dto';
import type { PostJournalDto } from '../src/ledger/dto/post-journal.dto';
import { LimitController } from '../src/limit/limit.controller';
import type { EvaluateLimitDto } from '../src/limit/dto/evaluate-limit.dto';
import type { LimitEngine } from '../src/limit/limit.engine';
import type { PaymentReasonDto } from '../src/payment/dto/payment-reason.dto';
import { TransferController } from '../src/transfer/transfer.controller';
import type { CreateTransferDto } from '../src/transfer/dto/create-transfer.dto';
import { WithdrawalController } from '../src/withdrawal/withdrawal.controller';
import type { CreateWithdrawalDto } from '../src/withdrawal/dto/create-withdrawal.dto';

describe('controller Promise contracts', () => {
  it('keeps disabled financial write endpoints closed as rejected Promises with Promise metadata', async () => {
    const deposit = Object.create(DepositController.prototype) as DepositController;
    const withdrawal = Object.create(WithdrawalController.prototype) as WithdrawalController;
    const transfer = Object.create(TransferController.prototype) as TransferController;
    const ledger = Object.create(LedgerController.prototype) as LedgerController;
    const req = { headers: {} };
    const reason = {} as PaymentReasonDto;
    const cases: Array<{ prototype: object; method: string; call: () => Promise<never> }> = [
      {
        prototype: DepositController.prototype as object,
        method: 'createDeposit',
        call: () => deposit.createDeposit({} as CreateDepositDto),
      },
      {
        prototype: DepositController.prototype as object,
        method: 'completeDeposit',
        call: () => deposit.completeDeposit('id', req),
      },
      {
        prototype: DepositController.prototype as object,
        method: 'failDeposit',
        call: () => deposit.failDeposit('id', reason, req),
      },
      {
        prototype: DepositController.prototype as object,
        method: 'cancelDeposit',
        call: () => deposit.cancelDeposit('id', reason, req),
      },
      {
        prototype: WithdrawalController.prototype as object,
        method: 'createWithdrawal',
        call: () => withdrawal.createWithdrawal({} as CreateWithdrawalDto),
      },
      {
        prototype: WithdrawalController.prototype as object,
        method: 'processWithdrawal',
        call: () => withdrawal.processWithdrawal('id', req),
      },
      {
        prototype: WithdrawalController.prototype as object,
        method: 'completeWithdrawal',
        call: () => withdrawal.completeWithdrawal('id', req),
      },
      {
        prototype: WithdrawalController.prototype as object,
        method: 'failWithdrawal',
        call: () => withdrawal.failWithdrawal('id', reason, req),
      },
      {
        prototype: WithdrawalController.prototype as object,
        method: 'cancelWithdrawal',
        call: () => withdrawal.cancelWithdrawal('id', reason, req),
      },
      {
        prototype: TransferController.prototype as object,
        method: 'createTransfer',
        call: () => transfer.createTransfer({} as CreateTransferDto),
      },
      {
        prototype: LedgerController.prototype as object,
        method: 'createAccount',
        call: () => ledger.createAccount({} as CreateLedgerAccountDto, req),
      },
      {
        prototype: LedgerController.prototype as object,
        method: 'postJournal',
        call: () => ledger.postJournal(req, {} as PostJournalDto),
      },
    ];

    for (const entry of cases) {
      expect(Reflect.getMetadata('design:returntype', entry.prototype, entry.method)).toBe(Promise);
      let result: Promise<never> | undefined;
      expect(() => {
        result = entry.call();
      }).not.toThrow();
      expect(result).toBeInstanceOf(Promise);
      await expect(result).rejects.toBeInstanceOf(ForbiddenException);
    }
  });

  it('converts synchronous fee and limit engine errors to Promise rejections', async () => {
    const error = new Error('synthetic engine failure');
    const fee = new FeeController({
      calculate: () => {
        throw error;
      },
    } as unknown as FeeEngine);
    const limit = new LimitController({
      evaluate: () => {
        throw error;
      },
    } as unknown as LimitEngine);
    expect(Reflect.getMetadata('design:returntype', FeeController.prototype, 'calculate')).toBe(
      Promise,
    );
    expect(Reflect.getMetadata('design:returntype', LimitController.prototype, 'evaluate')).toBe(
      Promise,
    );
    let feeResult: Promise<unknown> | undefined;
    let limitResult: Promise<unknown> | undefined;
    expect(() => {
      feeResult = fee.calculate({} as CalculateFeeDto);
    }).not.toThrow();
    expect(() => {
      limitResult = limit.evaluate({} as EvaluateLimitDto);
    }).not.toThrow();
    await expect(feeResult).rejects.toBe(error);
    await expect(limitResult).rejects.toBe(error);
  });
});
