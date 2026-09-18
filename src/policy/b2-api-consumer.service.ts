/**
 * B2T08 — B2 API consumer, credential, quota, and rate-limit service.
 *
 * The B2 API consumer service is the only B2-side consumer, credential,
 * quota, and rate-limit authority. It never stores raw secrets, never
 * logs raw secrets, never duplicates the A2 authentication or
 * authorization authority, and never posts ledger entries. It exposes
 * only read-only consumer ports to later B2 tasks.
 */

import { Inject, Injectable } from '@nestjs/common';

import {
  B2_API_CONSUMER_CONTRACT_NAME,
  B2_API_CONSUMER_CONTRACT_VERSION,
} from './b2-api-consumer.constants';
import { B2ApiConsumerRepository } from './b2-api-consumer.repository';
import type {
  B2ApiConsumerConsumerPortsV1,
  B2ApiConsumerDecisionV1,
  B2ApiConsumerReplaySafeResultV1,
  B2ApiConsumerRequestV1,
  B2ApiConsumerState,
  B2ApiCredentialDecisionV1,
  B2ApiCredentialRequestV1,
  B2ApiQuotaDecisionV1,
  B2ApiQuotaGroup,
  B2ApiRateLimitBucket,
  B2ApiRateLimitDecisionV1,
} from './b2-api-consumer.types';

@Injectable()
export class B2ApiConsumerService {
  constructor(
    @Inject(B2ApiConsumerRepository)
    private readonly repository: B2ApiConsumerRepository,
  ) {}

  getContractName(): string {
    return B2_API_CONSUMER_CONTRACT_NAME;
  }

  getContractVersion(): number {
    return B2_API_CONSUMER_CONTRACT_VERSION;
  }

  getConsumerPorts(): B2ApiConsumerConsumerPortsV1 {
    return this.repository.getConsumerPorts();
  }

  generateConsumerDecision(request: B2ApiConsumerRequestV1): B2ApiConsumerDecisionV1 {
    return this.repository.generateConsumerDecision(request);
  }

  replaySafeGenerateConsumerDecision(
    request: B2ApiConsumerRequestV1,
    existingByKey?: { decision: B2ApiConsumerDecisionV1; requestHash: string } | null,
  ): B2ApiConsumerReplaySafeResultV1<B2ApiConsumerDecisionV1> {
    return this.repository.replaySafeGenerateConsumerDecision(request, existingByKey ?? null);
  }

  transitionConsumerState(
    current: B2ApiConsumerDecisionV1,
    targetState: B2ApiConsumerState,
  ): B2ApiConsumerDecisionV1 {
    return this.repository.transitionConsumerState(current, targetState);
  }

  generateCredentialDecision(
    request: B2ApiCredentialRequestV1,
  ): B2ApiCredentialDecisionV1 & { rawSecret: string } {
    return this.repository.generateCredentialDecision(request);
  }

  rotateCredentialDecision(
    current: B2ApiCredentialDecisionV1,
  ): B2ApiCredentialDecisionV1 & { rawSecret: string } {
    return this.repository.rotateCredentialDecision(current);
  }

  revokeCredentialDecision(current: B2ApiCredentialDecisionV1): B2ApiCredentialDecisionV1 {
    return this.repository.revokeCredentialDecision(current);
  }

  replaySafeGenerateCredentialDecision(
    request: B2ApiCredentialRequestV1,
    existingByKey?: { decision: B2ApiCredentialDecisionV1; requestHash: string } | null,
  ): B2ApiConsumerReplaySafeResultV1<B2ApiCredentialDecisionV1> {
    return this.repository.replaySafeGenerateCredentialDecision(request, existingByKey ?? null);
  }

  computeConsumerRequestHash(request: B2ApiConsumerRequestV1): string {
    return this.repository.computeConsumerRequestHash(request);
  }

  computeCredentialRequestHash(request: B2ApiCredentialRequestV1): string {
    return this.repository.computeCredentialRequestHash(request);
  }

  createQuotaDecision(
    consumerId: string,
    quotaGroup: B2ApiQuotaGroup,
    idempotencyKey: string,
    correlationId: string,
  ): B2ApiQuotaDecisionV1 {
    return this.repository.createQuotaDecision(
      consumerId,
      quotaGroup,
      idempotencyKey,
      correlationId,
    );
  }

  checkQuota(decision: B2ApiQuotaDecisionV1, consumed: number): B2ApiQuotaDecisionV1 {
    return this.repository.checkQuota(decision, consumed);
  }

  createRateLimitBucket(
    consumerId: string,
    bucket: B2ApiRateLimitBucket,
  ): B2ApiRateLimitDecisionV1 {
    return this.repository.createRateLimitBucket(consumerId, bucket);
  }

  consumeRateLimitToken(
    bucket: B2ApiRateLimitDecisionV1,
    tokens: number,
  ): B2ApiRateLimitDecisionV1 {
    return this.repository.consumeRateLimitToken(bucket, tokens);
  }
}
