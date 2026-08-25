import { Injectable } from '@nestjs/common';

import type { AuthorizationPrincipal } from './authorization.types';

export interface MakerCheckerRequirement {
  required: boolean;
  reason?: string;
  approvalScope?: string;
  requiredAssurance?: 'PASSWORD' | 'MFA';
}

export interface MakerCheckerCheckCommand {
  principal: AuthorizationPrincipal;
  actionType: string;
  resourceType: string;
  resourceId?: string;
  amountMinor?: string;
  currency?: string;
}

/**
 * Service that determines whether maker/checker approval is required for financial operations.
 * 
 * Maker/checker is required when:
 * 1. Principal has 'finance:prepare' scope but NOT 'finance:approve' scope
 * 2. Transaction amount exceeds configured thresholds
 * 3. Policy explicitly requires dual control
 * 
 * Maker/checker is NOT required when:
 * 1. Principal has both 'finance:prepare' AND 'finance:approve' scopes (self-approval allowed)
 * 2. Operation is below threshold and policy allows single-party execution
 * 3. System context (internal operations already authorized at higher level)
 */
@Injectable()
export class MakerCheckerPolicyService {
  /**
   * Check if maker/checker approval is required for this operation.
   */
  async checkRequirement(command: MakerCheckerCheckCommand): Promise<MakerCheckerRequirement> {
    const { principal, actionType, amountMinor, currency } = command;

    // Check if principal has dual-control bypass
    const hasPrepare = principal.scopes.includes('finance:prepare');
    const hasApprove = principal.scopes.includes('finance:approve');
    const hasExecute = principal.scopes.includes('finance:execute');

    // If principal has execute scope, they can execute without approval
    if (hasExecute) {
      return { required: false, reason: 'EXECUTE_SCOPE_GRANTED' };
    }

    // If principal has both prepare and approve, they can self-approve (dual control satisfied)
    if (hasPrepare && hasApprove) {
      return { required: false, reason: 'DUAL_CONTROL_SATISFIED' };
    }

    // If principal has only prepare, maker/checker is required
    if (hasPrepare && !hasApprove) {
      return {
        required: true,
        reason: 'MAKER_CHECKER_REQUIRED',
        approvalScope: 'finance:approve',
        requiredAssurance: 'MFA',
      };
    }

    // Check amount thresholds for high-value transactions
    if (amountMinor && currency) {
      const threshold = this.getThreshold(currency);
      const amount = BigInt(amountMinor);
      
      if (amount >= threshold) {
        return {
          required: true,
          reason: 'HIGH_VALUE_TRANSACTION',
          approvalScope: 'finance:approve',
          requiredAssurance: 'MFA',
        };
      }
    }

    // Default: no maker/checker required
    return { required: false, reason: 'POLICY_ALLOWS_SINGLE_PARTY' };
  }

  /**
   * Get the threshold amount for a currency above which maker/checker is required.
   * These thresholds should be configurable in production.
   */
  private getThreshold(currency: string): bigint {
    const thresholds: Record<string, bigint> = {
      NGN: BigInt(5_000_000_00), // 5,000,000 NGN (50M kobo)
      USD: BigInt(10_000_00),     // 10,000 USD (1M cents)
      EUR: BigInt(10_000_00),     // 10,000 EUR (1M cents)
      GBP: BigInt(10_000_00),     // 10,000 GBP (1M pence)
    };

    return thresholds[currency] ?? BigInt(10_000_00); // Default: 10,000 units
  }
}
