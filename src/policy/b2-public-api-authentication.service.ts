/**
 * B2T10 — B2 public API authentication service.
 *
 * The service is the only B2-side public API authentication integration.
 * It verifies every public B2 route through A2 audience/scope/token-
 * expiry, consumer ACTIVE, credential ISSUED/ROTATED, consent GRANTED,
 * A4 ELIGIBLE, quota ALLOCATED, and rate-limit ALLOWED, and exposes B1
 * catalog/plan/tier and B2 activation as audience-scoped, minimized
 * reads. It never mutates A3 bindings, A4 policy, B1 decisions, or
 * Ledger, and never creates a second session/token vault.
 */

import { Inject, Injectable } from '@nestjs/common';

import {
  B2_PUBLIC_API_AUTHENTICATION_CONTRACT_NAME,
  B2_PUBLIC_API_AUTHENTICATION_CONTRACT_VERSION,
} from './b2-public-api-authentication.constants';
import { B2PublicApiAuthenticationRepository } from './b2-public-api-authentication.repository';
import type {
  B2B1CatalogViewV1,
  B2B1PlanViewV1,
  B2PublicApiAuthenticationConsumerPortsV1,
  B2PublicApiAuthenticationDecisionV1,
  B2PublicApiAuthenticationReplaySafeResultV1,
  B2PublicApiAuthenticationRequestV1,
} from './b2-public-api-authentication.types';

@Injectable()
export class B2PublicApiAuthenticationService {
  constructor(
    @Inject(B2PublicApiAuthenticationRepository)
    private readonly repository: B2PublicApiAuthenticationRepository,
  ) {}

  getContractName(): string {
    return B2_PUBLIC_API_AUTHENTICATION_CONTRACT_NAME;
  }

  getContractVersion(): number {
    return B2_PUBLIC_API_AUTHENTICATION_CONTRACT_VERSION;
  }

  getConsumerPorts(): B2PublicApiAuthenticationConsumerPortsV1 {
    return this.repository.getConsumerPorts();
  }

  authenticate(request: B2PublicApiAuthenticationRequestV1): B2PublicApiAuthenticationDecisionV1 {
    return this.repository.generateAuthenticationDecision(request);
  }

  exposeB1Catalog(request: B2PublicApiAuthenticationRequestV1): {
    view: B2B1CatalogViewV1 | null;
    decision: B2PublicApiAuthenticationDecisionV1;
  } {
    return this.repository.exposeB1Catalog(request);
  }

  exposeB1Plan(
    request: B2PublicApiAuthenticationRequestV1,
    planKey: string,
  ): { view: B2B1PlanViewV1 | null; decision: B2PublicApiAuthenticationDecisionV1 } {
    return this.repository.exposeB1Plan(request, planKey);
  }

  replaySafeAuthenticate(
    request: B2PublicApiAuthenticationRequestV1,
    existingByKey?: { decision: B2PublicApiAuthenticationDecisionV1; requestHash: string } | null,
  ): B2PublicApiAuthenticationReplaySafeResultV1 {
    return this.repository.replaySafeGenerateAuthenticationDecision(request, existingByKey ?? null);
  }
}
