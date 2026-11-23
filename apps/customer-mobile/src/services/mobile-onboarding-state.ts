import { ApiClient } from './api-client';

/**
 * Authoritative onboarding-state read for the unauthenticated mobile registration flow.
 *
 * The backend resolves everything from the phone-verified registration session; the client sends
 * only `{ sessionId }` plus the purpose-limited registration bearer and renders the answer. It must
 * never infer "pending", "rejected" or "activated" locally from partial signals.
 */
export type MobileOnboardingStage =
  'NEW' | 'CLAIM' | 'RESUME_CLAIM' | 'LOGIN' | 'PENDING_REVIEW' | 'REJECTED' | 'ACTIVATED';

export interface MobileOnboardingRequirement {
  code: string;
  label: string;
  state: 'MET' | 'OUTSTANDING' | 'UNAVAILABLE' | 'BLOCKED';
  detail?: string;
}

export interface MobileOnboardingState {
  stage: MobileOnboardingStage;
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
  requirements: MobileOnboardingRequirement[];
  outstanding: string[];
  wallet: { provisioned: boolean; currency: string | null } | null;
  evaluatedAt: string;
}

const STAGES: readonly MobileOnboardingStage[] = [
  'NEW',
  'CLAIM',
  'RESUME_CLAIM',
  'LOGIN',
  'PENDING_REVIEW',
  'REJECTED',
  'ACTIVATED',
];

/**
 * True only when the payload really is an onboarding-state projection.
 *
 * The screen must be able to tell "the server said PENDING_REVIEW" from "the server said nothing we
 * understand". Without this distinction a truncated or older response would be rendered as
 * *pending review* — a fabricated state that could make a customer wait for a review that is not
 * happening. Callers fall back to the weaker `onboarding-route` read instead.
 */
export function isMobileOnboardingState(value: unknown): value is MobileOnboardingState {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<MobileOnboardingState>;
  return (
    typeof candidate.stage === 'string' &&
    STAGES.includes(candidate.stage as MobileOnboardingStage) &&
    Array.isArray(candidate.requirements) &&
    Array.isArray(candidate.outstanding)
  );
}

export const mobileOnboardingStateApi = {
  read: async (sessionId: string, registrationBearer: string): Promise<MobileOnboardingState> => {
    const state = await ApiClient.post<unknown>(
      '/customers/registration-sessions/onboarding-state',
      { sessionId },
      { registrationBearer },
    );
    if (!isMobileOnboardingState(state)) {
      throw new Error('Unrecognised onboarding-state response');
    }
    return state;
  },
};
