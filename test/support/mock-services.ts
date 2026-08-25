/**
 * Shared mock services for integration tests.
 * These mocks allow financial services to pass authorization/gate checks
 * in integration tests where the full authorization infrastructure is not set up.
 */

import type { FinancialCommandGateService } from '../src/authorization/financial-command-gate.service';
import type { MakerCheckerPolicyService } from '../src/authorization/maker-checker-policy.service';
import type { DepositGateService } from '../src/deposit/deposit-gate.service';
import type { WithdrawalGateService } from '../src/withdrawal/withdrawal-gate.service';
import type { InternalTransferGateService } from '../src/transfer/internal-transfer-gate.service';

export function createMockCommandGate(): FinancialCommandGateService {
  return {
    authorize: async () => ({ allowed: true, authorization: {} as any }),
    computeActionFingerprint: () => 'a'.repeat(64),
    consumeApproval: async () => ({ approved: true }),
  } as unknown as FinancialCommandGateService;
}

export function createMockMakerCheckerPolicy(): MakerCheckerPolicyService {
  return {
    checkRequirement: async () => ({ required: false, reason: 'POLICY_ALLOWS_SINGLE_PARTY' }),
  } as unknown as MakerCheckerPolicyService;
}

export function createMockDepositGate(): DepositGateService {
  return {
    validate: async () => ({ status: 'ALLOWED' }),
  } as unknown as DepositGateService;
}

export function createMockWithdrawalGate(): WithdrawalGateService {
  return {
    validate: async () => ({ status: 'ALLOWED' }),
  } as unknown as WithdrawalGateService;
}

export function createMockInternalTransferGate(): InternalTransferGateService {
  return {
    validate: async () => ({ status: 'PASSED' }),
  } as unknown as InternalTransferGateService;
}
