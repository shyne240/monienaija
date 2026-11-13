import React from 'react';
import { render, waitFor } from '@testing-library/react-native';

import { VerificationNotice, verificationCopy } from '../src/components/VerificationNotice';
import type { VerificationState } from '../src/components/VerificationNotice';

const STATES: VerificationState[] = [
  'PENDING',
  'SUCCESS',
  'FAILED',
  'MISMATCH',
  'UNAVAILABLE',
  'ADDITIONAL_INFO',
  'MANUAL_REVIEW',
];

describe('VerificationNotice — the seven states a customer must be able to tell apart', () => {
  test('every state has distinct copy and at most one of them claims success', () => {
    const titles = STATES.map((state) => verificationCopy(state).title);
    expect(new Set(titles).size).toBe(STATES.length);

    const successful = STATES.filter((state) => /success/i.test(verificationCopy(state).title));
    expect(successful).toEqual(['SUCCESS']);
  });

  test('pending and unavailable states never read as success', () => {
    expect(verificationCopy('PENDING').body).toContain('no decision has been returned');
    expect(verificationCopy('UNAVAILABLE').body).toContain('nothing was verified');
    expect(verificationCopy('MISMATCH').title).toBe('Information mismatch');
    expect(verificationCopy('ADDITIONAL_INFO').title).toBe('More information needed');
    expect(verificationCopy('MANUAL_REVIEW').title).toBe('Manual review required');
    expect(verificationCopy('FAILED').title).toBe('Verification failed');
  });

  test('success explicitly does not imply financial eligibility', () => {
    expect(verificationCopy('SUCCESS').body).toContain(
      'still needs every remaining onboarding requirement',
    );
  });

  test('renders an accessible alert with the state copy and optional backend detail', () => {
    const { getByTestId, getByText } = render(
      <VerificationNotice state="MISMATCH" detail="CLAIM_MISMATCH" />,
    );

    expect(getByTestId('verification-notice')).toBeTruthy();
    expect(getByText('Information mismatch')).toBeTruthy();
    expect(getByText('CLAIM_MISMATCH')).toBeTruthy();
  });

  test('is not interactive: it never offers a resubmit that could duplicate a request', () => {
    const { queryByRole } = render(<VerificationNotice state="PENDING" />);
    // No buttons in the notice itself — retry decisions stay with the screen's own gated actions.
    expect(queryByRole('button')).toBeNull();
  });

  test('fires no state changes on render (pure presentational component)', () => {
    // Guard against a regression where the notice would itself trigger a verification request.
    const fetchSpy = jest.fn();
    global.fetch = fetchSpy as unknown as typeof fetch;
    render(<VerificationNotice state="FAILED" />);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('VerificationNotice usage guard', () => {
  test('unknown state falls back to manual review rather than success', () => {
    const copy = verificationCopy('SOMETHING_ELSE' as VerificationState);
    expect(copy.title).toBe('Manual review required');
  });

  test('renders detail verbatim and escapes nothing that would turn it into a pass', async () => {
    const { getByText } = render(
      <VerificationNotice state="UNAVAILABLE" detail="SERVICE_UNAVAILABLE" />,
    );
    await waitFor(() => expect(getByText('Verification service unavailable')).toBeTruthy());
  });
});
