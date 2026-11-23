import { createHash } from 'node:crypto';
import type { DataSource } from 'typeorm';

import type { CustomerActivationReadinessService } from '../customer-onboarding/customer-activation-readiness.service';
import { UUID } from '../kyc-verification/kyc-orchestrator';
import { KycFoundationError } from '../kyc-verification/kyc.types';

const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const digest = (token: string) => createHash('sha256').update(token).digest('hex');

/**
 * The single mobile-facing onboarding-state projection.
 *
 * Before this service the mobile client had to infer its own state from a combination of
 * `onboarding-route`, `status` and KYC reads, and had no way at all to show "an administrator is
 * reviewing your registration" or "your registration was rejected" or "your account is now
 * active — sign in". The mission requires those states to be explicit.
 *
 * Authority: the *phone-verified registration session* is the credential. It is issued only after
 * an approved OTP proves ownership of the phone, is short-lived, and is consumed on login. Every
 * response is scoped to the one customer that owns the session's verified phone — the caller never
 * supplies a customer id, so no enumeration or cross-customer read is possible.
 *
 * Data minimisation: no customer id, no identifiers, no evidence payloads, no provider details.
 * Requirement codes and labels are the same strings the admin console sees, produced by the shared
 * `CustomerActivationReadinessService`.
 */
export type MobileOnboardingStage =
  | 'NEW'
  | 'CLAIM'
  | 'RESUME_CLAIM'
  | 'LOGIN'
  | 'PENDING_REVIEW'
  | 'REJECTED'
  | 'ACTIVATED';

export interface MobileOnboardingState {
  stage: MobileOnboardingStage;
  /** Human-facing, customer-safe next-action copy. */
  nextAction: string;
  session: { status: 'VERIFIED'; expiresAt: string };
  customer: {
    referenceMasked: string;
    status: string;
    kycLevel: string;
    kycStatus: string;
  } | null;
  claim: { available: boolean; matchedThisSession: boolean } | null;
  credentials: { passcodeSet: boolean; pinSet: boolean };
  requirements: Array<{ code: string; label: string; state: string; detail?: string }>;
  outstanding: string[];
  wallet: { provisioned: boolean; currency: string | null } | null;
  evaluatedAt: string;
}

interface SessionRow {
  id: string;
  phone: string;
  expires_at: Date;
}

interface CustomerRow {
  id: string;
  reference: string;
  status: string;
  kyc_level: string;
  kyc_status: string;
  is_synthetic: boolean;
}

export class MobileOnboardingStateService {
  constructor(
    private readonly db: DataSource,
    private readonly readiness: CustomerActivationReadinessService,
  ) {}

  async state(sessionId: string, authorization: string): Promise<MobileOnboardingState> {
    if (!UUID.test(sessionId) || !TOKEN.test(authorization))
      throw new KycFoundationError('BLOCKED');
    return this.db.transaction(async (manager) => {
      const sessions = await manager.query<SessionRow[]>(
        `SELECT id,phone,expires_at FROM kyc_registration_sessions
          WHERE id=$1 AND authorization_hash=$2 AND status='VERIFIED'
            AND verified_at IS NOT NULL AND expires_at>clock_timestamp()`,
        [sessionId, digest(authorization)],
      );
      const session = sessions[0];
      if (!session) throw new KycFoundationError('BLOCKED');

      const customers = await manager.query<CustomerRow[]>(
        `SELECT c.id,c.reference,c.status,c.kyc_level,c.kyc_status,c.is_synthetic
           FROM customer_contact_methods p
           JOIN customers c ON c.id=p.customer_id
          WHERE p.type='PHONE' AND p.normalized_value=$1 AND p.deleted_at IS NULL
            AND c.deleted_at IS NULL AND c.status IN ('DRAFT','ACTIVE')
          ORDER BY c.created_at, c.id`,
        [session.phone],
      );

      const base = {
        session: { status: 'VERIFIED' as const, expiresAt: session.expires_at.toISOString() },
        evaluatedAt: new Date().toISOString(),
      };

      // Zero owners, or more than one owner, of this verified phone: the platform never guesses
      // which record belongs to the caller. `NEW` keeps the self-registration front door open
      // (duplicate phone records remain the registration service's own conflict decision); a
      // multi-owner phone resolves to PENDING_REVIEW because no safe automatic action exists.
      if (customers.length === 0) {
        return {
          ...base,
          stage: 'NEW',
          nextAction: 'Continue registration by verifying your identity.',
          customer: null,
          claim: null,
          credentials: { passcodeSet: false, pinSet: false },
          requirements: [],
          outstanding: [],
          wallet: null,
        };
      }

      const customer = customers.length === 1 ? customers[0]! : null;
      if (!customer) {
        return {
          ...base,
          stage: 'PENDING_REVIEW',
          nextAction:
            'More than one account matches this phone number. Contact support so we can resolve it before anything else happens.',
          customer: null,
          claim: null,
          credentials: { passcodeSet: false, pinSet: false },
          requirements: [],
          outstanding: ['duplicate_phone_records'],
          wallet: null,
        };
      }

      const credentials = await manager.query<Array<{ passcode: boolean; pin: boolean }>>(
        `SELECT
           EXISTS(SELECT 1 FROM customer_authentication_credentials a
                   WHERE a.customer_id=$1 AND a.deleted_at IS NULL) AS passcode,
           EXISTS(SELECT 1 FROM customer_transaction_pins p
                   WHERE p.customer_id=$1 AND p.deleted_at IS NULL) AS pin`,
        [customer.id],
      );
      const passcodeSet = Boolean(credentials[0]?.passcode);
      const pinSet = Boolean(credentials[0]?.pin);
      const claimRows = await manager.query<Array<{ present: boolean }>>(
        `SELECT EXISTS(SELECT 1 FROM mobile_account_claims
                        WHERE session_id=$1 AND customer_id=$2 AND consumed_at IS NULL) AS present`,
        [sessionId, customer.id],
      );
      const matchedThisSession = Boolean(claimRows[0]?.present);

      const snapshot = await this.readiness.evaluate(manager, customer.id);
      const requirements = snapshot.requirements.map(({ code, label, state, detail }) => ({
        code,
        label,
        state,
        ...(detail ? { detail } : {}),
      }));
      const customerSummary = {
        referenceMasked: snapshot.referenceMasked,
        status: customer.status,
        kycLevel: customer.kyc_level,
        kycStatus: customer.kyc_status,
      };
      const wallet = {
        provisioned: snapshot.wallet.provisioned,
        currency: snapshot.wallet.currency,
      };

      // Rejection is terminal for this attempt and is reported before any "you can continue" copy.
      const onboardingRejected = await manager.query<Array<{ present: boolean }>>(
        `SELECT EXISTS(
           SELECT 1 FROM customer_onboardings o
            WHERE o.customer_id=$1 AND o.deleted_at IS NULL AND o.status='REJECTED'
              AND NOT EXISTS (
                SELECT 1 FROM customer_onboardings newer
                 WHERE newer.customer_id=$1 AND newer.deleted_at IS NULL
                   AND newer.created_at > o.created_at
              )
         ) AS present`,
        [customer.id],
      );
      if (customer.kyc_status === 'REJECTED' || onboardingRejected[0]?.present) {
        return {
          ...base,
          stage: 'REJECTED',
          nextAction:
            'Your registration was not approved. Contact support if you believe this is wrong; do not start a second registration with the same phone number.',
          customer: customerSummary,
          claim: null,
          credentials: { passcodeSet, pinSet },
          requirements,
          outstanding: snapshot.outstanding,
          wallet,
        };
      }

      // Fully activated: an ACTIVE customer with a provisioned wallet signs in to the app.
      if (customer.status === 'ACTIVE' && wallet.provisioned) {
        return {
          ...base,
          stage: 'ACTIVATED',
          nextAction: passcodeSet
            ? 'Your account is active. Sign in with your phone number and passcode.'
            : 'Your account is active. Contact support to recover access to your credentials.',
          customer: customerSummary,
          claim: null,
          credentials: { passcodeSet, pinSet },
          requirements,
          outstanding: snapshot.outstanding,
          wallet,
        };
      }

      if (passcodeSet && pinSet) {
        return {
          ...base,
          stage: 'LOGIN',
          nextAction: 'Sign in with your passcode to continue.',
          customer: customerSummary,
          claim: null,
          credentials: { passcodeSet, pinSet },
          requirements,
          outstanding: snapshot.outstanding,
          wallet,
        };
      }

      if (passcodeSet || pinSet) {
        // Half-configured credentials are never repaired automatically.
        return {
          ...base,
          stage: 'PENDING_REVIEW',
          nextAction: 'Your sign-in details are incomplete. Contact support before trying again.',
          customer: customerSummary,
          claim: null,
          credentials: { passcodeSet, pinSet },
          requirements,
          outstanding: [...new Set([...snapshot.outstanding, 'credentials_incomplete'])],
          wallet,
        };
      }

      // Registered on the customer's behalf with no credentials yet: prove identity and claim.
      const claimAvailable = snapshot.requirements.some(
        (requirement) => requirement.code === 'identity_evidence' && requirement.state === 'MET',
      );
      if (claimAvailable) {
        return {
          ...base,
          stage: matchedThisSession ? 'RESUME_CLAIM' : 'CLAIM',
          nextAction: matchedThisSession
            ? 'Choose your passcode and transaction PIN to finish claiming this account.'
            : 'This phone number already has an account. Verify a registered identity document to claim it.',
          customer: customerSummary,
          claim: { available: true, matchedThisSession },
          credentials: { passcodeSet, pinSet },
          requirements,
          outstanding: snapshot.outstanding,
          wallet,
        };
      }

      return {
        ...base,
        stage: 'PENDING_REVIEW',
        nextAction:
          'Your registration is recorded and is waiting for MonieNaija to finish verifying it. You do not need to register again.',
        customer: customerSummary,
        claim: { available: false, matchedThisSession: false },
        credentials: { passcodeSet, pinSet },
        requirements,
        outstanding: snapshot.outstanding,
        wallet,
      };
    });
  }
}
