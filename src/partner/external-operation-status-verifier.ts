import { Injectable } from '@nestjs/common';

import type { ExternalOperationView } from './external-operation.types';

export type ExternalOperationStatusVerificationState =
  | 'VERIFIED_PENDING'
  | 'VERIFIED_REJECTED'
  | 'VERIFIED_ACCEPTED_NOT_SETTLED'
  | 'UNKNOWN'
  | 'UNAVAILABLE';

export interface ExternalOperationStatusVerificationRequest {
  operation: ExternalOperationView;
  requestedAt: string;
  correlationId: string;
}

export interface ExternalOperationStatusVerificationResult {
  state: ExternalOperationStatusVerificationState;
  providerStatus: string | null;
  providerReferenceHash: string | null;
  observedAt: string;
  reasonCode: string | null;
}

export const EXTERNAL_OPERATION_STATUS_VERIFIER = Symbol('EXTERNAL_OPERATION_STATUS_VERIFIER');

export interface ExternalOperationStatusVerifier {
  verify(
    request: ExternalOperationStatusVerificationRequest,
  ): Promise<ExternalOperationStatusVerificationResult>;
}

@Injectable()
export class UnavailableExternalOperationStatusVerifier implements ExternalOperationStatusVerifier {
  verify(
    request: ExternalOperationStatusVerificationRequest,
  ): Promise<ExternalOperationStatusVerificationResult> {
    return Promise.resolve({
      state: 'UNAVAILABLE' as const,
      providerStatus: null,
      providerReferenceHash: null,
      observedAt: request.requestedAt,
      reasonCode: 'STATUS_VERIFICATION_NOT_CONFIGURED',
    });
  }
}
