import type { ExternalOperationReferenceType } from './external-operation.enums';
import type { ExternalCallbackReceiptStatus } from './external-callback.enums';

export const EXTERNAL_CALLBACK_CONTRACT_NAME = 'A6-PARTNER-CALLBACK' as const;
export const EXTERNAL_CALLBACK_CONTRACT_VERSION = 1 as const;
export const EXTERNAL_CALLBACK_IDEMPOTENCY_SCOPE = 'external.partner.callback.v1';

export interface PartnerCallbackHeadersV1 {
  partnerKey?: string | string[];
  callbackEventId?: string | string[];
  callbackTimestamp?: string | string[];
  callbackSignature?: string | string[];
}

export interface PartnerCallbackPayloadV1 {
  contractName: typeof EXTERNAL_CALLBACK_CONTRACT_NAME;
  contractVersion: typeof EXTERNAL_CALLBACK_CONTRACT_VERSION;
  partnerKey: 'NIBSS_NIP';
  callbackEventId: string;
  externalOperationId: string;
  externalOperationReference: string;
  correlationId: string;
  providerReference: {
    referenceType: Extract<
      ExternalOperationReferenceType,
      | ExternalOperationReferenceType.OPERATION
      | ExternalOperationReferenceType.TRANSACTION
      | ExternalOperationReferenceType.SETTLEMENT
    >;
    value: string;
    namespace: string;
  };
  providerStatus: string;
  amountMinor: string;
  currency: 'NGN';
  occurredAt: string;
}

export interface VerifiedPartnerCallbackV1 {
  payload: PartnerCallbackPayloadV1;
  callbackEventId: string;
  callbackTimestamp: number;
  payloadHash: string;
  signatureHash: string;
}

export type ExternalCallbackRejectionCode =
  | 'CALLBACK_UNAUTHORIZED'
  | 'CALLBACK_SECRET_UNAVAILABLE'
  | 'CALLBACK_MALFORMED'
  | 'CALLBACK_STALE'
  | 'CALLBACK_SIGNATURE_INVALID'
  | 'CALLBACK_SCHEMA_UNSUPPORTED'
  | 'UNKNOWN_PROVIDER_REFERENCE'
  | 'EXTERNAL_OPERATION_REFERENCE_MISMATCH'
  | 'EXTERNAL_OPERATION_CORRELATION_MISMATCH'
  | 'EXTERNAL_OPERATION_AMOUNT_MISMATCH'
  | 'EXTERNAL_OPERATION_CURRENCY_MISMATCH'
  | 'DUPLICATE_CALLBACK'
  | 'CALLBACK_IDEMPOTENCY_CONFLICT'
  | 'CALLBACK_EVIDENCE_UNAVAILABLE';

export interface ExternalCallbackIngestionResult {
  accepted: boolean;
  status: ExternalCallbackReceiptStatus;
  replayed: boolean;
  duplicate: boolean;
  receiptId: string;
  callbackEventId: string;
  externalOperationId: string | null;
  correlationId: string;
  providerReferenceType: string;
  providerReferenceHash: string;
  providerStatus: string;
  rejectionCode: ExternalCallbackRejectionCode | null;
}
