import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

import { CustomerKycVerificationPanel } from '../src/components/CustomerKycVerificationPanel';
import type {
  CustomerKycWorkflowClient,
  CustomerKycWorkflowStatus,
} from '../src/services/customer-kyc-verification';

jest.mock('expo-crypto', () => ({
  getRandomBytesAsync: jest.fn(async () => Uint8Array.from({ length: 16 }, (_, i) => i + 1)),
}));

const workflow = (
  overrides: Partial<CustomerKycWorkflowStatus> = {},
): CustomerKycWorkflowStatus => ({
  customer: { status: 'ACTIVE', kycLevel: 'LEVEL_1', kycStatus: 'PENDING' },
  policy: { configured: false, version: null },
  requirements: null,
  candidateAssessment: {
    status: 'UNAVAILABLE',
    level: null,
    reason: 'TRUSTED_EVIDENCE_UNAVAILABLE',
  },
  consentNotice: {
    version: 'notice-v1',
    text: 'This approved notice describes the purpose and handling of the identity check.',
  },
  verificationEnabled: true,
  consents: [],
  history: [],
  ...overrides,
});

function client(
  overrides: Partial<Record<keyof CustomerKycWorkflowClient, jest.Mock>> = {},
): CustomerKycWorkflowClient {
  return {
    status: jest.fn().mockResolvedValue(workflow()),
    availability: jest.fn().mockResolvedValue({
      status: 'AVAILABLE',
      provider: 'MONNIFY',
      routeVersion: 3,
      consentNotice: {
        version: 'notice-v1',
        text: 'This approved notice describes the purpose and handling of the identity check.',
      },
    }),
    grantConsent: jest.fn().mockResolvedValue({
      id: '00000000-0000-4000-8000-000000000101',
      expiresAt: '2026-11-16T00:00:00.000Z',
      provider: 'MONNIFY',
      routeVersion: 3,
    }),
    withdrawConsent: jest.fn().mockResolvedValue({ status: 'WITHDRAWN' }),
    verify: jest.fn().mockResolvedValue({
      id: '00000000-0000-4000-8000-000000000102',
      status: 'MATCH',
      provider: 'MONNIFY',
      expiresAt: '2026-11-16T00:00:00.000Z',
    }),
    ...overrides,
  };
}

describe('CustomerKycVerificationPanel', () => {
  it('fails closed when verification is disabled and collects no identity number', () => {
    const api = client();
    const { getByText, queryByLabelText } = render(
      <CustomerKycVerificationPanel
        api={api}
        workflow={workflow({ verificationEnabled: false })}
        onRefresh={jest.fn()}
      />,
    );

    expect(getByText(/not currently enabled/)).toBeTruthy();
    expect(queryByLabelText('BVN number, secure entry')).toBeNull();
    expect(api.availability).not.toHaveBeenCalled();
    expect(api.grantConsent).not.toHaveBeenCalled();
    expect(api.verify).not.toHaveBeenCalled();
  });

  it.each(['BVN', 'NIN'] as const)(
    'requires the configured notice and explicit %s consent before submitting; displays no tier promise',
    async (kind) => {
      const api = client();
      const onRefresh = jest.fn().mockResolvedValue(undefined);
      const { getByText, getByLabelText } = render(
        <CustomerKycVerificationPanel api={api} workflow={workflow()} onRefresh={onRefresh} />,
      );

      if (kind === 'NIN') fireEvent.press(getByText('Use NIN'));
      fireEvent.press(getByText(`Check ${kind} verification availability`));
      await waitFor(() => expect(getByText(/approved notice describes the purpose/)).toBeTruthy());
      expect(api.availability).toHaveBeenCalledWith(kind);

      fireEvent.press(getByText('I have read and accept this notice'));
      fireEvent.press(getByText('Record consent'));
      await waitFor(() => expect(getByText(/Consent is active until/)).toBeTruthy());
      expect(api.grantConsent).toHaveBeenCalledTimes(1);
      expect(api.verify).not.toHaveBeenCalled();

      fireEvent.changeText(getByLabelText(`${kind} number, secure entry`), '91234567890');
      fireEvent.press(getByText('Submit for verification'));
      await waitFor(() => expect(getByText(/authoritative match/)).toBeTruthy());
      expect(api.verify).toHaveBeenCalledTimes(1);

      expect(api.grantConsent).toHaveBeenCalledWith(
        expect.objectContaining({
          kind,
          accepted: true,
          noticeVersion: 'notice-v1',
          expectedProvider: 'MONNIFY',
          expectedRouteVersion: 3,
        }),
      );
      expect(api.verify).toHaveBeenCalledWith(
        expect.objectContaining({
          kind,
          consentId: '00000000-0000-4000-8000-000000000101',
          identifier: '91234567890',
        }),
      );
      expect(onRefresh).toHaveBeenCalled();
      expect(getByText(/this screen never changes your tier or limits/)).toBeTruthy();
    },
  );

  it('recovers an active consent after reopening without persisting the identity number', async () => {
    const api = client();
    const { getByText, getByLabelText, queryByText } = render(
      <CustomerKycVerificationPanel
        api={api}
        workflow={workflow({
          consents: [
            {
              id: '00000000-0000-4000-8000-000000000101',
              kind: 'BVN',
              noticeVersion: 'notice-v1',
              provider: 'MONNIFY',
              routeVersion: 3,
              expiresAt: '2026-11-16T00:00:00.000Z',
            },
          ],
        })}
        onRefresh={jest.fn()}
      />,
    );

    expect(queryByText('BVN number, secure entry')).toBeNull();
    fireEvent.press(getByText('Resume active BVN consent'));
    await waitFor(() => expect(getByText(/Your active consent was recovered/)).toBeTruthy());
    fireEvent.changeText(getByLabelText('BVN number, secure entry'), '91234567890');
    fireEvent.press(getByText('Submit for verification'));
    await waitFor(() => expect(getByText(/authoritative match/)).toBeTruthy());
    expect(api.availability).toHaveBeenCalledWith('BVN');
    expect(api.grantConsent).not.toHaveBeenCalled();
    expect(api.verify).toHaveBeenCalledWith(
      expect.objectContaining({
        consentId: '00000000-0000-4000-8000-000000000101',
        kind: 'BVN',
        identifier: '91234567890',
      }),
    );
  });

  it('retries an ambiguous request with the same durable request ID and the same in-memory number', async () => {
    const verify = jest
      .fn()
      .mockRejectedValueOnce(new Error('transport interrupted'))
      .mockResolvedValueOnce({
        id: '00000000-0000-4000-8000-000000000102',
        status: 'DISPATCHING',
        provider: 'MONNIFY',
        expiresAt: null,
      });
    const api = client({ verify });
    const { getByText, getByLabelText } = render(
      <CustomerKycVerificationPanel api={api} workflow={workflow()} onRefresh={jest.fn()} />,
    );

    fireEvent.press(getByText('Check BVN verification availability'));
    await waitFor(() => expect(getByText(/approved notice describes the purpose/)).toBeTruthy());
    fireEvent.press(getByText('I have read and accept this notice'));
    fireEvent.press(getByText('Record consent'));
    await waitFor(() => expect(getByText(/Consent is active until/)).toBeTruthy());
    fireEvent.changeText(getByLabelText('BVN number, secure entry'), '91234567890');
    fireEvent.press(getByText('Submit for verification'));
    await waitFor(() => expect(getByText(/Retry only with the same number/)).toBeTruthy());

    fireEvent.press(getByText('Check the same request'));
    await waitFor(() => expect(getByText(/still being processed/)).toBeTruthy());
    expect(verify).toHaveBeenCalledTimes(2);
    expect(verify.mock.calls[0]?.[0].requestId).toBe(verify.mock.calls[1]?.[0].requestId);
    expect(verify.mock.calls[0]?.[0].identifier).toBe('91234567890');
    expect(verify.mock.calls[1]?.[0].identifier).toBe('91234567890');
  });

  it('blocks a fresh request while the latest provider outcome is unresolved', () => {
    const api = client();
    const { getByText, queryByText } = render(
      <CustomerKycVerificationPanel
        api={api}
        workflow={workflow({
          history: [
            {
              id: '00000000-0000-4000-8000-000000000102',
              kind: 'BVN',
              provider: 'MONNIFY',
              status: 'UNKNOWN',
              createdAt: '2026-11-15T00:00:00.000Z',
              completedAt: '2026-11-15T00:00:01.000Z',
              expiresAt: null,
            },
          ],
        })}
        onRefresh={jest.fn()}
      />,
    );

    expect(getByText(/prior request has no safe final outcome/)).toBeTruthy();
    expect(queryByText('Check BVN verification availability')).toBeNull();
    expect(api.availability).not.toHaveBeenCalled();
    expect(api.verify).not.toHaveBeenCalled();
  });

  it('presents an expired verification as not verified and allows a fresh availability check', () => {
    const api = client();
    const { getByText, queryByText } = render(
      <CustomerKycVerificationPanel
        api={api}
        workflow={workflow({
          history: [
            {
              id: '00000000-0000-4000-8000-000000000103',
              kind: 'BVN',
              provider: 'PREMBLY',
              status: 'EXPIRED',
              createdAt: '2026-11-15T00:00:00.000Z',
              completedAt: '2026-11-15T00:00:01.000Z',
              expiresAt: '2026-11-16T00:00:00.000Z',
            },
          ],
        })}
        onRefresh={jest.fn()}
      />,
    );

    expect(getByText(/Latest BVN check: Expired/)).toBeTruthy();
    expect(getByText(/not a verified identity result/)).toBeTruthy();
    expect(queryByText(/prior request has no safe final outcome/)).toBeNull();
    expect(getByText('Check BVN verification availability')).toBeTruthy();
  });
});
