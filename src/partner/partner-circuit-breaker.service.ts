import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { Environment } from '../config/environment';
import type { PartnerKey } from './partner-adapter.types';

export type PartnerCircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface PartnerCircuitView {
  partnerKey: PartnerKey;
  state: PartnerCircuitState;
  consecutiveFailures: number;
  failureThreshold: number;
  openedAt: string | null;
  retryAt: string | null;
  probeInFlight: boolean;
}

interface MutableCircuitState {
  consecutiveFailures: number;
  state: PartnerCircuitState;
  openedAtMs: number | null;
  retryAtMs: number | null;
  probeInFlight: boolean;
}

@Injectable()
export class PartnerCircuitBreakerService {
  private readonly circuits = new Map<PartnerKey, MutableCircuitState>();

  constructor(private readonly configService: ConfigService) {}

  allowAttempt(partnerKey: PartnerKey, nowMs = Date.now()): boolean {
    const state = this.stateFor(partnerKey);
    if (state.state === 'CLOSED') return true;
    if (state.state === 'OPEN') {
      if (!state.retryAtMs || nowMs < state.retryAtMs) return false;
      if (state.probeInFlight) return false;
      state.state = 'HALF_OPEN';
      state.probeInFlight = true;
      return true;
    }
    return !state.probeInFlight && (state.probeInFlight = true);
  }

  recordFailure(partnerKey: PartnerKey, nowMs = Date.now()): PartnerCircuitView {
    const state = this.stateFor(partnerKey);
    state.consecutiveFailures += 1;
    state.probeInFlight = false;
    if (state.state === 'HALF_OPEN' || state.consecutiveFailures >= this.failureThreshold()) {
      state.state = 'OPEN';
      state.openedAtMs = nowMs;
      state.retryAtMs = nowMs + this.openDurationMs();
    }
    return this.toView(partnerKey, state);
  }

  recordSuccess(partnerKey: PartnerKey): PartnerCircuitView {
    const state = this.stateFor(partnerKey);
    state.consecutiveFailures = 0;
    state.state = 'CLOSED';
    state.openedAtMs = null;
    state.retryAtMs = null;
    state.probeInFlight = false;
    return this.toView(partnerKey, state);
  }

  get(partnerKey: PartnerKey, nowMs = Date.now()): PartnerCircuitView {
    const state = this.stateFor(partnerKey);
    if (state.state === 'OPEN' && state.retryAtMs && nowMs >= state.retryAtMs) {
      state.state = 'HALF_OPEN';
      state.probeInFlight = false;
    }
    return this.toView(partnerKey, state);
  }

  private stateFor(partnerKey: PartnerKey): MutableCircuitState {
    const existing = this.circuits.get(partnerKey);
    if (existing) return existing;
    const state: MutableCircuitState = {
      consecutiveFailures: 0,
      state: 'CLOSED',
      openedAtMs: null,
      retryAtMs: null,
      probeInFlight: false,
    };
    this.circuits.set(partnerKey, state);
    return state;
  }

  private failureThreshold(): number {
    return this.configService.get<number>('A6_PARTNER_CIRCUIT_FAILURE_THRESHOLD') ?? 3;
  }

  private openDurationMs(): number {
    const seconds =
      this.configService.get<Environment['A6_PARTNER_CIRCUIT_OPEN_SECONDS']>(
        'A6_PARTNER_CIRCUIT_OPEN_SECONDS',
      ) ?? 60;
    return seconds * 1000;
  }

  private toView(partnerKey: PartnerKey, state: MutableCircuitState): PartnerCircuitView {
    return {
      partnerKey,
      state: state.state,
      consecutiveFailures: state.consecutiveFailures,
      failureThreshold: this.failureThreshold(),
      openedAt: state.openedAtMs === null ? null : new Date(state.openedAtMs).toISOString(),
      retryAt: state.retryAtMs === null ? null : new Date(state.retryAtMs).toISOString(),
      probeInFlight: state.probeInFlight,
    };
  }
}
