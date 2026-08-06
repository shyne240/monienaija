import type {
  AuthorizationDecision,
  AuthorizationDenialReason,
  AuthorizationPolicy,
  AuthorizationPrincipal,
  AuthorizationResource,
} from './authorization.types';
import type { PrivilegedActionApprovalStatus } from './privileged-action-approval.enums';

export interface RequestPrivilegedActionCommand {
  principal: AuthorizationPrincipal;
  policy: AuthorizationPolicy;
  resource: AuthorizationResource;
  actionFingerprint: string;
  reason: string;
  actor?: string;
  approvalScope?: string;
  expiresInSeconds?: number;
  now?: Date;
}

export interface DecidePrivilegedActionCommand {
  principal: AuthorizationPrincipal;
  approvalId: string;
  comment?: string;
  now?: Date;
}

export interface ConsumePrivilegedActionCommand {
  principal: AuthorizationPrincipal;
  approvalId: string;
  actionType: string;
  resource: AuthorizationResource;
  actionFingerprint: string;
  now?: Date;
}

export interface EmergencyAccessCommand {
  principal: AuthorizationPrincipal;
  resourceType: string;
  resourceId?: string;
  reason: string;
  expiresInSeconds?: number;
  now?: Date;
}

export interface PrivilegedActionApprovalView {
  id: string;
  actionType: string;
  resourceType: string;
  resourceId: string | null;
  customerId: string | null;
  requesterPrincipalId: string;
  approvedBy: string | null;
  approvalScope: string;
  requiredAssurance: string;
  status: PrivilegedActionApprovalStatus;
  isEmergency: boolean;
  requestedAt: Date;
  expiresAt: Date;
  approvedAt: Date | null;
  rejectedAt: Date | null;
  cancelledAt: Date | null;
  consumedAt: Date | null;
  version: number;
}

export interface PrivilegedActionDecision {
  approved: boolean;
  approval?: PrivilegedActionApprovalView;
  authorization?: AuthorizationDecision;
  reason?:
    | AuthorizationDenialReason
    | 'REQUESTED'
    | 'APPROVED'
    | 'REJECTED'
    | 'CANCELLED'
    | 'CONSUMED'
    | 'EXPIRED'
    | 'NOT_FOUND'
    | 'SELF_APPROVAL_FORBIDDEN'
    | 'MFA_REQUIRED'
    | 'APPROVAL_SCOPE_MISSING'
    | 'ACTION_MISMATCH'
    | 'RESOURCE_MISMATCH'
    | 'FINGERPRINT_MISMATCH'
    | 'INVALID_EMERGENCY_ACCESS';
}
