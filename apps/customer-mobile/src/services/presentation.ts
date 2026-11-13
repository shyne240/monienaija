/**
 * ARENA 4 — pure presentation helpers for the customer banking surfaces.
 *
 * Deliberately free of React and network access so they can be unit-tested. They format and label
 * values the backend already decided; they never compute eligibility, balances, thumbnails or
 * financial outcomes.
 */

import type { BadgeStatus } from '../components/StatusBadge';
import type { KycUpgradePathwayStatus } from './customer-account';

const NAIRA = '₦';

/** Formats minor units (kobo) as Naira. Returns an em dash when the backend sent nothing. */
export function formatMinor(minor: string | number | null | undefined): string {
  if (minor === null || minor === undefined || minor === '') return '—';
  const value = Number(minor);
  if (!Number.isFinite(value)) return '—';
  return `${NAIRA}${(value / 100).toLocaleString('en-NG', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** Hidden-balance placeholder of the same width class, so the card never reflows oddly. */
export const HIDDEN_BALANCE = '••••••';

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('en-NG', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('en-NG', { day: 'numeric', month: 'long', year: 'numeric' });
}

export function initialsOf(name: string | null | undefined): string {
  const cleaned = (name ?? '').trim();
  if (!cleaned) return 'MN';
  return cleaned
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('');
}

export function greetingFor(hour: number): string {
  if (!Number.isFinite(hour)) return 'Hello';
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

/** Human label for a machine status without ever upgrading it to "successful". */
export function statusLabel(status: string | null | undefined): string {
  const value = (status ?? '').toUpperCase();
  switch (value) {
    case 'COMPLETED':
    case 'APPROVED':
    case 'CLAIMED':
    case 'ACTIVE':
      return 'Completed';
    case 'PENDING':
    case 'PROCESSING':
    case 'PENDING_RECOVERY':
    case 'UNCLAIMED':
    case 'REQUESTED':
      return 'Pending';
    case 'FAILED':
    case 'REJECTED':
      return 'Failed';
    case 'CANCELLED':
      return 'Cancelled';
    case 'EXPIRED':
      return 'Expired';
    case 'REVERSED':
      return 'Reversed';
    case 'SUSPENDED':
      return 'Suspended';
    case '':
      return 'Unknown';
    default:
      return value.charAt(0) + value.slice(1).toLowerCase();
  }
}

export function statusTone(status: string | null | undefined): BadgeStatus {
  const value = (status ?? '').toUpperCase();
  if (['COMPLETED', 'APPROVED', 'CLAIMED', 'ACTIVE'].includes(value)) return 'SUCCESS';
  if (['FAILED', 'REJECTED', 'CANCELLED'].includes(value)) return 'FAILED';
  if (['EXPIRED', 'REVERSED'].includes(value)) return 'EXPIRED';
  if (value === 'SUSPENDED') return 'SUSPENDED';
  return 'PENDING';
}

/** A reconciled terminal state is the only thing that may read as settled. */
export function isTerminalStatus(status: string | null | undefined): boolean {
  return ['COMPLETED', 'FAILED', 'REJECTED', 'CANCELLED', 'EXPIRED', 'REVERSED'].includes(
    (status ?? '').toUpperCase(),
  );
}

export const KYC_LEVEL_LABELS: Record<string, string> = {
  NONE: 'Tier 0 · Unverified',
  LEVEL_1: 'Tier 1 · Verified',
  LEVEL_2: 'Tier 2 · Enhanced',
  LEVEL_3: 'Tier 3',
};

export const KYC_STATUS_LABELS: Record<string, string> = {
  NOT_STARTED: 'Not started',
  PENDING: 'In review',
  APPROVED: 'Approved',
  REJECTED: 'Not approved',
};

export const EVIDENCE_LABELS: Record<string, string> = {
  BVN: 'Bank Verification Number (BVN)',
  NIN: 'National Identification Number (NIN)',
  PHONE: 'Verified phone number',
  BIOMETRIC: 'Biometric verification',
  ADDRESS: 'Residential address',
  UTILITY_BILL: 'Utility bill',
  GPS: 'Location confirmation',
};

export function evidenceLabel(code: string): string {
  return EVIDENCE_LABELS[code] ?? code.replace(/_/g, ' ');
}

export const PRODUCT_LABELS: Record<string, string> = {
  WALLET_TRANSFER: 'Send to a MonieNaija wallet',
  CASH_TO_WALLET: 'Cash deposit through an agent',
  WALLET_TO_CASH: 'Cash withdrawal through an agent',
  CASH_TO_CASH: 'Cash transfer received',
  CUSTOMER_FUNDING: 'Wallet funding',
};

export function productLabel(code: string): string {
  return PRODUCT_LABELS[code] ?? code.replace(/_/g, ' ');
}

export const TRANSACTION_TYPE_LABELS: Record<string, string> = {
  WALLET_TRANSFER: 'Wallet transfer',
  FUNDING: 'Wallet funding',
  CASH_IN: 'Cash deposit (agent)',
  CASH_OUT: 'Cash withdrawal (agent)',
  CASH_TO_CASH: 'Cash transfer (agent)',
};

export function transactionTypeLabel(code: string | null | undefined): string {
  return code ? (TRANSACTION_TYPE_LABELS[code] ?? code.replace(/_/g, ' ')) : 'Transaction';
}

export interface KycPathwayCopy {
  title: string;
  body: string;
  actionLabel: string | null;
}

/**
 * Copy for the KYC panel. It is derived from the backend's `upgradePathway.status`, so the app
 * cannot invent an upgrade promise, a threshold or a rejection.
 */
export function kycPathwayCopy(
  status: KycUpgradePathwayStatus | undefined,
  nextLevel: string | null | undefined,
  tierLabel: string,
): KycPathwayCopy {
  const target = nextLevel ? (KYC_LEVEL_LABELS[nextLevel] ?? nextLevel) : null;
  switch (status) {
    case 'TOP_TIER':
      return {
        title: 'You are on the highest supported tier',
        body: `${tierLabel}. There is no higher tier in the current MonieNaija tier model.`,
        actionLabel: null,
      };
    case 'MANUAL_REVIEW':
      return {
        title: 'Your verification is under review',
        body: 'A MonieNaija compliance reviewer is looking at your verification. Nothing more is needed from you right now.',
        actionLabel: null,
      };
    case 'EVIDENCE_UNAVAILABLE':
      return {
        title: target
          ? `Your ${target} upgrade is not yet assessable`
          : 'Upgrade not yet assessable',
        body: 'MonieNaija cannot yet assess verified identity evidence for upgrades. Your current tier and limits remain exactly as shown.',
        actionLabel: 'See what the upgrade needs',
      };
    case 'POLICY_NOT_CONFIGURED':
    default:
      return {
        title: 'Tier requirements are not published yet',
        body: 'MonieNaija has not published the requirement set for the next tier, so no upgrade can be promised. Your current tier and limits are unaffected.',
        actionLabel: null,
      };
  }
}
