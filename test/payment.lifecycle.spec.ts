import { ConflictException } from '@nestjs/common';

import { assertPaymentTransition } from '../src/payment/payment-lifecycle';
import { PaymentLifecycleState, PaymentType } from '../src/payment/payment.enums';
import { PaymentReferenceService } from '../src/payment/payment-reference.service';

describe('payment lifecycle', () => {
  it('allows the supported deposit and withdrawal transitions', () => {
    expect(() =>
      assertPaymentTransition(PaymentLifecycleState.CREATED, PaymentLifecycleState.PENDING),
    ).not.toThrow();
    expect(() =>
      assertPaymentTransition(PaymentLifecycleState.PENDING, PaymentLifecycleState.PROCESSING),
    ).not.toThrow();
    expect(() =>
      assertPaymentTransition(PaymentLifecycleState.PENDING, PaymentLifecycleState.COMPLETED),
    ).not.toThrow();
    expect(() =>
      assertPaymentTransition(PaymentLifecycleState.PROCESSING, PaymentLifecycleState.COMPLETED),
    ).not.toThrow();
    expect(() =>
      assertPaymentTransition(PaymentLifecycleState.PROCESSING, PaymentLifecycleState.FAILED),
    ).not.toThrow();
    expect(() =>
      assertPaymentTransition(PaymentLifecycleState.PENDING, PaymentLifecycleState.CANCELLED),
    ).not.toThrow();
  });

  it('rejects terminal and skipped transitions', () => {
    expect(() =>
      assertPaymentTransition(PaymentLifecycleState.COMPLETED, PaymentLifecycleState.PENDING),
    ).toThrow(ConflictException);
    expect(() =>
      assertPaymentTransition(PaymentLifecycleState.CANCELLED, PaymentLifecycleState.COMPLETED),
    ).toThrow(ConflictException);
    expect(() =>
      assertPaymentTransition(PaymentLifecycleState.CREATED, PaymentLifecycleState.COMPLETED),
    ).toThrow(ConflictException);
  });

  it('generates a globally sequenced payment reference', async () => {
    const queries: Array<{ sql: string; parameters?: unknown[] }> = [];
    const nextSequence = '12';
    const manager = {
      query: (sql: string, parameters?: unknown[]) => {
        queries.push({ sql, parameters });
        if (sql.includes('nextval')) {
          return Promise.resolve([{ sequence: nextSequence }]);
        }
        return Promise.resolve([]);
      },
    };
    const service = new PaymentReferenceService();

    const reference = await service.nextReference(
      manager as never,
      PaymentType.DEPOSIT,
      '00000000-0000-4000-8000-000000000001',
    );

    expect(reference).toBe('MN000000000012');
    expect(queries).toHaveLength(2);
    expect(queries[1]?.parameters).toEqual([
      'MN000000000012',
      PaymentType.DEPOSIT,
      '00000000-0000-4000-8000-000000000001',
    ]);
  });
});
