import { ConflictException } from '@nestjs/common';

import { PaymentLifecycleState } from './payment.enums';

const ALLOWED_TRANSITIONS: Readonly<
  Record<PaymentLifecycleState, readonly PaymentLifecycleState[]>
> = {
  [PaymentLifecycleState.CREATED]: [PaymentLifecycleState.PENDING],
  [PaymentLifecycleState.PENDING]: [
    PaymentLifecycleState.PROCESSING,
    PaymentLifecycleState.COMPLETED,
    PaymentLifecycleState.FAILED,
    PaymentLifecycleState.CANCELLED,
  ],
  [PaymentLifecycleState.PROCESSING]: [
    PaymentLifecycleState.COMPLETED,
    PaymentLifecycleState.FAILED,
    PaymentLifecycleState.CANCELLED,
  ],
  [PaymentLifecycleState.COMPLETED]: [],
  [PaymentLifecycleState.FAILED]: [],
  [PaymentLifecycleState.CANCELLED]: [],
};

export function assertPaymentTransition(
  current: PaymentLifecycleState,
  next: PaymentLifecycleState,
): void {
  if (!ALLOWED_TRANSITIONS[current].includes(next)) {
    throw new ConflictException(`Invalid payment state transition from ${current} to ${next}`);
  }
}
