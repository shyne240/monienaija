import { Injectable, ForbiddenException } from '@nestjs/common';

import type { WithdrawalGateCommand, WithdrawalGateResult } from './withdrawal-gate.types';
import { CustomerFinancialAccountBindingService } from '../wallet/customer-financial-account-binding.service';
import { CapabilityPolicyEvaluationService } from '../policy/capability-policy.service';
import { PolicySourceEvidenceCoordinator } from '../policy/capability-policy-evidence.coordinator';
import { PolicySourceClass } from '../policy/capability-policy.enums';
import type { PolicyEvaluationCommand } from '../policy/capability-policy.types';

@Injectable()
export class WithdrawalGateService {
  constructor(
    private readonly bindingService: CustomerFinancialAccountBindingService,
    private readonly policyService: CapabilityPolicyEvaluationService,
    private readonly evidenceCoordinator: PolicySourceEvidenceCoordinator,
  ) {}

  async validate(command: WithdrawalGateCommand): Promise<WithdrawalGateResult> {
    // Step 1: Validate A3 binding
    const bindingValidation = await this.bindingService.validateActiveBinding({
      customerId: command.customerId,
      customerWalletId: command.walletId,
      bindingId: command.bindingId,
      walletAccountId: command.walletAccountId,
      ledgerAccountId: command.ledgerAccountId,
      expectedCurrency: command.currency,
      expectedAccountingUnit: command.accountingUnit,
      expectedBindingVersion: command.bindingVersion,
    });

    if (!bindingValidation.valid) {
      return {
        status: 'DENIED',
        reason: `A3 binding validation failed: ${bindingValidation.message}`,
      };
    }

    // Step 2: Collect A4 policy evidence
    const evidenceCommand = {
      customerId: command.customerId,
      capability: 'wallet.withdrawal',
      action: 'create',
      requestedAt: new Date().toISOString(),
      asOf: new Date().toISOString(),
      evidenceProfile: 'wallet-withdrawal-create-v1',
      requiredSourceClasses: [
        PolicySourceClass.CUSTOMER,
        PolicySourceClass.ACCOUNT_BINDING,
        PolicySourceClass.LIMITS,
        PolicySourceClass.ONBOARDING,
        PolicySourceClass.ELIGIBILITY,
        PolicySourceClass.RESTRICTIONS,
        PolicySourceClass.RISK,
        PolicySourceClass.COMPLIANCE,
        PolicySourceClass.ENROLLMENT,
        PolicySourceClass.PERMISSIONS,
      ],
      evaluationContext: {
        currency: command.currency,
        targetBindingId: command.bindingId,
      },
      actorContext: {
        principal: command.principal,
      },
      requestContext: command.requestContext,
    };

    let snapshot;
    try {
      snapshot = await this.evidenceCoordinator.collect(evidenceCommand);
    } catch (error) {
      return {
        status: 'DENIED',
        reason: `A4 evidence collection failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }

    // Step 3: Evaluate A4 capability policy
    const policyCommand: PolicyEvaluationCommand = {
      contractName: 'A4-CAPABILITY-POLICY',
      contractVersion: 1,
      subject: {
        type: 'CUSTOMER',
        customerId: command.customerId,
      },
      capability: 'wallet.withdrawal',
      action: 'create',
      requestedAt: new Date().toISOString(),
      evaluationContext: {
        currency: command.currency,
        targetBindingId: command.bindingId,
        limitUsage: {
          amountMinor: command.amountMinor,
          currency: command.currency,
        },
      },
      actorContext: {
        principal: command.principal,
      },
      sourceEvidenceRequest: {
        evidenceProfile: 'wallet-withdrawal-create-v1',
        asOf: new Date().toISOString(),
        requiredSourceClasses: [
          PolicySourceClass.CUSTOMER,
          PolicySourceClass.ACCOUNT_BINDING,
          PolicySourceClass.LIMITS,
          PolicySourceClass.ONBOARDING,
          PolicySourceClass.ELIGIBILITY,
          PolicySourceClass.RESTRICTIONS,
          PolicySourceClass.RISK,
          PolicySourceClass.COMPLIANCE,
          PolicySourceClass.ENROLLMENT,
          PolicySourceClass.PERMISSIONS,
        ],
      },
      requestContext: command.requestContext,
      snapshot,
    };

    let policyDecision;
    try {
      policyDecision = await this.policyService.evaluate(policyCommand);
    } catch (error) {
      return {
        status: 'DENIED',
        reason: `A4 policy evaluation failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }

    // Step 4: Check policy decision
    if (policyDecision.decision === 'DENY') {
      return {
        status: 'DENIED',
        policyDecision,
        reason: `A4 policy denied: ${policyDecision.reasonCodes.join(', ')}`,
      };
    }

    if (policyDecision.decision === 'SUSPEND') {
      return {
        status: 'DENIED',
        policyDecision,
        reason: `A4 policy suspended: ${policyDecision.reasonCodes.join(', ')}`,
      };
    }

    if (policyDecision.decision === 'PENDING_REVIEW') {
      return {
        status: 'DENIED',
        policyDecision,
        reason: `A4 policy requires review: ${policyDecision.reasonCodes.join(', ')}`,
      };
    }

    // Step 5: Return allowed with limits
    return {
      status: 'ALLOWED',
      policyDecision,
      limits: policyDecision.limits,
    };
  }
}
