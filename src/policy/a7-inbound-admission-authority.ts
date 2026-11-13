import { Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';

/** Trusted, transaction-bound inbound admission authority. It is not a payment verifier.
 * An implementation MUST independently resolve and lock its governed route, beneficiary
 * consent where applicable, institution, restrictions and inbound limit configuration and
 * usage, checking them against this exact persisted command and policy decision. It must
 * independently revalidate every required A4 source (including onboarding, enrollment,
 * customer eligibility, risk and restrictions) and the intended amount against current
 * governed records; a client's snapshot, declared amount or fingerprint is never proof.
 * It must return durable identities for the resolved authority records. A return of
 * AUTHORIZED is permitted only after those checks; it is never a client-provided assertion.
 * Receipt and financial execution checks remain mandatory at the later execution boundary. */
export interface A7InboundAdmissionAuthority {
  recheck(
    manager: EntityManager,
    input: {
      commandId: string;
      commandReference: string;
      customerId: string;
      sessionId: string;
      bindingId: string;
      bindingVersion: number;
      customerWalletId: string;
      walletAccountId: string;
      ledgerAccountId: string;
      virtualAccountId: string;
      policyDecisionReference: string;
      inboundObservationId: string | null;
      intendedAmountMinor: string;
    },
  ): Promise<
    | {
        status: 'AUTHORIZED';
        evidenceReferences: {
          route: string;
          limits: string;
          compliance: string;
          institution: string;
          consent: string | null;
        };
      }
    | { status: 'DENIED' | 'UNAVAILABLE' }
  >;
}
export const A7_INBOUND_ADMISSION_AUTHORITY = Symbol('A7_INBOUND_ADMISSION_AUTHORITY');
@Injectable()
export class UnavailableA7InboundAdmissionAuthority implements A7InboundAdmissionAuthority {
  recheck(): Promise<{ status: 'UNAVAILABLE' }> {
    return Promise.resolve({ status: 'UNAVAILABLE' });
  }
}
