import { createHash } from 'node:crypto';

import { ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { EntityManager } from 'typeorm';

import { AuthorizationService } from './authorization.service';
import type {
  AuthorizationDecision,
  AuthorizationPolicy,
  AuthorizationPrincipal,
} from './authorization.types';
import { PrivilegedActionApprovalService } from './privileged-action-approval.service';
import type { PrivilegedActionDecision } from './privileged-action-approval.types';

export interface FinancialCommandAuthorizationCommand {
  principal: AuthorizationPrincipal;
  resourceType: string;
  resourceId?: string;
  customerId?: string;
  action: string;
  requiredScopes: readonly string[];
}

export interface FinancialCommandApprovalCommand {
  approvalId: string;
  actionType: string;
  actionFingerprint: string;
  principal: AuthorizationPrincipal;
  resourceType: string;
  resourceId?: string;
  customerId?: string;
}

export interface FinancialCommandAuthorizationResult {
  allowed: boolean;
  authorization: AuthorizationDecision;
  reason?: string;
}

export interface FinancialCommandApprovalResult {
  approved: boolean;
  approval?: PrivilegedActionDecision;
  reason?: string;
}

@Injectable()
export class FinancialCommandGateService {
  constructor(
    private readonly authorizationService: AuthorizationService,
    private readonly approvalService: PrivilegedActionApprovalService,
  ) {}

  /**
   * Validate A2 authorization for a financial command.
   * Call this BEFORE starting a transaction.
   */
  async authorize(
    command: FinancialCommandAuthorizationCommand,
  ): Promise<FinancialCommandAuthorizationResult> {
    const policy: AuthorizationPolicy = {
      resourceType: command.resourceType,
      action: command.action,
      requiredScopes: command.requiredScopes,
      allowedPrincipalTypes: ['PRIVILEGED', 'OPERATOR', 'SERVICE'],
      customerAccess: 'NONE',
    };

    const authorization = await this.authorizationService.authorize(command.principal, policy, {
      type: command.resourceType,
      id: command.resourceId,
      customerId: command.customerId,
    });

    if (!authorization.allowed) {
      return {
        allowed: false,
        authorization,
        reason: `A2 authorization denied: ${authorization.reason ?? 'UNKNOWN'}`,
      };
    }

    return {
      allowed: true,
      authorization,
    };
  }

  /**
   * Consume an approval for a financial command.
   * Call this INSIDE a transaction to ensure atomicity with the financial mutation.
   */
  async consumeApproval(
    manager: EntityManager,
    command: FinancialCommandApprovalCommand,
  ): Promise<FinancialCommandApprovalResult> {
    const approval = await this.approvalService.consumeInTransaction(manager, {
      approvalId: command.approvalId,
      actionType: command.actionType,
      actionFingerprint: command.actionFingerprint,
      principal: command.principal,
      resource: {
        type: command.resourceType,
        id: command.resourceId,
        customerId: command.customerId,
      },
    });

    if (!approval.approved) {
      return {
        approved: false,
        approval,
        reason: `Approval denied: ${approval.reason}`,
      };
    }

    return {
      approved: true,
      approval,
    };
  }

  /**
   * Compute a SHA-256 fingerprint of the action payload.
   * Use this to bind an approval to a specific operation.
   */
  computeActionFingerprint(payload: Record<string, unknown>): string {
    return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  }
}
