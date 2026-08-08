import { createHash } from 'node:crypto';

import { Injectable } from '@nestjs/common';

import { EXTERNAL_PARTNER_ADAPTER_CONTRACT_NAME } from './partner-adapter.types';
import type {
  PartnerRequestSigner,
  PartnerSigningInput,
  PartnerSigningPreparation,
} from './partner-connection.types';

export const PARTNER_REQUEST_SIGNER = Symbol('PARTNER_REQUEST_SIGNER');

@Injectable()
export class PartnerRequestSigningService implements PartnerRequestSigner {
  prepare(input: PartnerSigningInput): PartnerSigningPreparation {
    if (input.partnerKey !== 'NIBSS_NIP') {
      throw new Error('The A6 request-signing boundary does not recognize the partner');
    }
    if (!/^[a-f0-9]{64}$/i.test(input.canonicalPayloadHash)) {
      throw new Error('The A6 request-signing payload hash is invalid');
    }
    if (input.keyReference.partnerKey !== input.partnerKey) {
      throw new Error('The A6 request-signing key reference does not match the partner');
    }
    if (input.keyReference.kind !== 'REQUEST_SIGNING') {
      throw new Error('The A6 request-signing key reference has the wrong purpose');
    }
    if (
      input.keyReference.environment !== 'sandbox' &&
      input.keyReference.environment !== 'production'
    ) {
      throw new Error('The A6 request-signing environment is invalid');
    }
    if (!input.requestId.trim() || !input.correlationId.trim()) {
      throw new Error('The A6 request-signing correlation context is required');
    }

    const signingInput = [
      EXTERNAL_PARTNER_ADAPTER_CONTRACT_NAME,
      input.partnerKey,
      input.environment,
      input.algorithm,
      input.canonicalPayloadHash.toLowerCase(),
      input.requestId.trim(),
      input.correlationId.trim(),
      new Date(input.timestamp).toISOString(),
    ].join('|');
    return {
      status: 'PREPARED',
      input: {
        ...input,
        canonicalPayloadHash: input.canonicalPayloadHash.toLowerCase(),
        requestId: input.requestId.trim(),
        correlationId: input.correlationId.trim(),
        timestamp: new Date(input.timestamp).toISOString(),
      },
      signingInputHash: createHash('sha256').update(signingInput).digest('hex'),
    };
  }
}
