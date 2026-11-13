import { Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';

/** Independent governed execution authority. Must establish that this verified observation
 * discharges this exact command's inbound obligation, not merely that destination and amount
 * match. Resolve and lock current approved execution policy, consent, institution, compliance,
 * eligibility and limits. Atomically reserve/consume authoritative limit usage in the supplied
 * serializable transaction. Never infer authority from a client, A4 snapshot or the admission.
 * References must resolve to durable evidence of the checks. No production implementation exists. */
export interface A7InboundExecutionAuthority {
  authorize(
    manager: EntityManager,
    input: {
      commandId: string;
      customerId: string;
      bindingId: string;
      virtualAccountId: string;
      walletAccountId: string;
      observationId: string;
      providerKey: string;
      providerReferenceHash: string;
      evidenceHash: string;
      amountMinor: string;
      currency: string;
      admissionPolicyReference: string;
    },
  ): Promise<
    | {
        status: 'AUTHORIZED';
        policyReference: string;
        obligationReference: string;
        limitReference: string;
        institutionReference: string;
      }
    | { status: 'DENIED' | 'UNAVAILABLE' }
  >;
}
export const A7_INBOUND_EXECUTION_AUTHORITY = Symbol('A7_INBOUND_EXECUTION_AUTHORITY');
@Injectable()
export class UnavailableA7InboundExecutionAuthority implements A7InboundExecutionAuthority {
  authorize(): Promise<{ status: 'UNAVAILABLE' }> {
    return Promise.resolve({ status: 'UNAVAILABLE' });
  }
}
