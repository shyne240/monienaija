import type { AuthorizationPrincipal } from '../authorization/authorization.types';
import type { GovernedChangeRequestView } from '../authorization/commercial-rule-governance.service';
import type {
  WalletOwnershipEvidenceType,
  WalletOwnershipResolutionClass,
} from './wallet-ownership-resolution.enums';
import type { WalletOwnerClass } from './wallet-ownership-resolution.enums';

/** Maker side of the governed REVIEW-to-owner resolution. */
export interface RequestWalletOwnershipResolutionCommand {
  principal: AuthorizationPrincipal;
  walletId: string;
  resolutionClass: WalletOwnershipResolutionClass;
  /** Required for CUSTOMER/AGENT: the authoritative customer or agent UUID. */
  targetOwnerId?: string;
  /** Required for SYSTEM: `wallet_system_owners.code`. */
  systemOwnerCode?: string;
  evidenceType: WalletOwnershipEvidenceType;
  evidenceReference: string;
  reason: string;
  expiresInSeconds?: number;
  now?: Date;
}

/** Checker-execution side; must repeat the exact approved request payload. */
export interface ExecuteWalletOwnershipResolutionCommand {
  principal: AuthorizationPrincipal;
  walletId: string;
  resolutionClass: WalletOwnershipResolutionClass;
  targetOwnerId?: string;
  systemOwnerCode?: string;
  evidenceType: WalletOwnershipEvidenceType;
  evidenceReference: string;
  reason: string;
  approvalId: string;
  now?: Date;
}

/** Server-verified facts recorded alongside an applied resolution. */
export interface WalletOwnershipEvidenceSummary {
  readonly evidenceType: WalletOwnershipEvidenceType;
  readonly verifiedAt: string;
  readonly [fact: string]: unknown;
}

export interface WalletOwnershipResolutionView {
  approvalId: string;
  walletId: string;
  currency: string;
  ledgerAccountId: string;
  resolutionClass: WalletOwnershipResolutionClass;
  /** Historical owner reference preserved from before the resolution. */
  previousOwnerReference: string;
  /** Canonical owner reference now stored on the wallet. */
  resolvedOwnerReference: string;
  systemOwnerCode: string | null;
  evidenceType: WalletOwnershipEvidenceType;
  evidenceReference: string;
  evidenceDigest: string;
  evidenceSummary: Readonly<Record<string, unknown>>;
  reason: string;
  executedBy: string;
  executedAt: Date;
  ownerClass: WalletOwnerClass;
  /** True while the wallet remains REVIEW and therefore financially restricted. */
  financiallyRestricted: boolean;
}

export type WalletOwnershipResolutionRequestView = GovernedChangeRequestView;

/** Administrative reconciliation projection (no customer PII, references only). */
export interface WalletOwnershipReviewItem {
  walletId: string;
  currency: string;
  status: string;
  ownerClass: WalletOwnerClass;
  /** The preserved historical reference that failed classification. */
  ownerReference: string;
  reviewReason: string;
  ledgerAccountId: string;
  balanceMinor: string;
  referenceIsUuid: boolean;
  /** Existing wallet that already owns this canonical reference + currency (collision blocker). */
  collidingWalletId: string | null;
  financiallyRestricted: boolean;
  createdAt: Date;
}

export interface WalletOwnershipReviewReport {
  generatedAt: Date;
  summary: {
    totalWallets: number;
    unresolved: number;
    resolved: number;
    financiallyRestricted: number;
    byOwnerClass: Record<string, number>;
    appliedResolutions: number;
  };
  unresolvedWallets: WalletOwnershipReviewItem[];
  appliedResolutions: Array<{
    walletId: string;
    resolutionClass: WalletOwnershipResolutionClass;
    previousOwnerReference: string;
    resolvedOwnerReference: string;
    systemOwnerCode: string | null;
    evidenceType: WalletOwnershipEvidenceType;
    evidenceReference: string;
    approvalId: string;
    executedBy: string;
    executedAt: Date;
  }>;
}
