import React from 'react';
import { render, screen, within } from '@testing-library/react';

import {
  CustomerRegistrationReviewPanel,
  type RegistrationReview,
} from '../src/screens/authenticated/CustomerRegistrationReviewPanel';

const baseReview: RegistrationReview = {
  customerId: 'cust-review-1',
  reference: 'mn-••••4321',
  customerType: 'INDIVIDUAL',
  customerStatus: 'DRAFT',
  isSynthetic: false,
  defaults: {
    customerClass: {
      configured: true,
      classCode: 'STANDARD',
      className: 'Standard',
      source: 'DEFAULT',
      effectiveFrom: '2026-11-01T00:00:00.000Z',
    },
    kyc: {
      level: 'LEVEL_1',
      status: 'APPROVED',
      assessment: {
        level: 'LEVEL_1',
        status: 'APPROVED',
        expiresAt: '2026-12-01T00:00:00.000Z',
        reason: null,
      },
    },
  },
  onboardingWorkflow: { status: 'COMPLETED', eligibility: 'ELIGIBLE', completed: true },
  financialEligibility: 'ELIGIBLE',
  restrictions: { active: [] },
  identityConflicts: 0,
  trustedEvidence: { state: 'VERIFIED', verifiedKinds: ['BVN'] },
  wallet: null,
  requirements: [
    { code: 'phone_verified', label: 'Phone verified', state: 'MET' },
    {
      code: 'identity_evidence',
      label: 'Identity verified by an approved provider',
      state: 'MET',
      detail: 'Verified: BVN',
    },
    { code: 'account_active', label: 'Account activated by MonieNaija', state: 'OUTSTANDING' },
    { code: 'wallet', label: 'Wallet provisioned', state: 'OUTSTANDING' },
  ],
  outstanding: ['account_active', 'wallet'],
  activatable: true,
  activationRoute: 'PATCH /api/v1/customers/:id',
  evaluatedAt: '2026-11-23T06:00:00.000Z',
};

describe('CustomerRegistrationReviewPanel', () => {
  it('never offers an activation control and points at the governed route instead', () => {
    render(<CustomerRegistrationReviewPanel review={baseReview} />);

    // Read-only by construction: no button anywhere in the panel.
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText('This screen cannot activate an account')).toBeTruthy();
    expect(screen.getByText('PATCH /api/v1/customers/:id')).toBeTruthy();
  });

  it('renders the requirement list with its four states distinguished', () => {
    render(
      <CustomerRegistrationReviewPanel
        review={{
          ...baseReview,
          activatable: false,
          requirements: [
            { code: 'phone_verified', label: 'Phone verified', state: 'MET' },
            {
              code: 'kyc_assessment',
              label: 'KYC assessment approved',
              state: 'OUTSTANDING',
              detail: 'Current assessment is NONE/NOT_STARTED',
            },
            {
              code: 'identity_evidence',
              label: 'Identity verified by an approved provider',
              state: 'UNAVAILABLE',
              detail: 'Trusted identity evidence could not be read',
            },
            {
              code: 'account_restriction',
              label: 'No active financial restriction',
              state: 'BLOCKED',
              detail: 'FROZEN',
            },
          ],
        }}
      />,
    );

    const requirements = screen.getByRole('region', { name: 'Requirements' });
    expect(within(requirements).getByText('Met')).toBeTruthy();
    expect(within(requirements).getByText('Outstanding')).toBeTruthy();
    // An unreadable dependency is explicitly NOT shown as verified or as rejected.
    expect(within(requirements).getByText('Cannot be determined')).toBeTruthy();
    expect(within(requirements).getByText('Blocked')).toBeTruthy();
    expect(
      within(requirements).getByText('Trusted identity evidence could not be read'),
    ).toBeTruthy();

    expect(screen.getByText('Not ready')).toBeTruthy();
    expect(
      screen.getByText(/requirement\(s\) cannot be confirmed from authoritative records/i),
    ).toBeTruthy();
  });

  it('lists active restrictions and identity conflicts as blockers', () => {
    render(
      <CustomerRegistrationReviewPanel
        review={{
          ...baseReview,
          activatable: false,
          restrictions: { active: ['FROZEN'] },
          identityConflicts: 2,
        }}
      />,
    );

    const blockers = screen.getByRole('region', { name: 'Blockers' });
    expect(within(blockers).getByText('FROZEN')).toBeTruthy();
    expect(within(blockers).getByText('Identity ownership conflicts')).toBeTruthy();
    expect(within(blockers).getByText('2')).toBeTruthy();
  });

  it('shows loading and error states without implying a decision', () => {
    const view = render(<CustomerRegistrationReviewPanel review={null} loading />);
    expect(screen.getByText('Loading registration review…')).toBeTruthy();
    expect(screen.queryByText('Not ready')).toBeNull();
    expect(screen.queryByText('Ready to activate')).toBeNull();

    view.rerender(<CustomerRegistrationReviewPanel review={null} error="Review unavailable." />);
    expect(screen.getByText('Review unavailable.')).toBeTruthy();

    view.rerender(<CustomerRegistrationReviewPanel review={null} />);
    expect(screen.getByText('Registration review is unavailable.')).toBeTruthy();
  });

  it('masks the reference and never prints identity evidence details or a customer id', () => {
    const view = render(<CustomerRegistrationReviewPanel review={baseReview} />);
    const text = view.container.textContent ?? '';
    expect(text).toContain('mn-••••4321');
    expect(text).not.toContain(baseReview.customerId);
    expect(text).not.toMatch(/identityMac|macKeyVersion/i);
  });
});
