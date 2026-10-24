import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { CustomerProofOfAddressPanel } from '../src/screens/authenticated/CustomerProofOfAddressPanel';
import { CustomerTier3ReadinessPanel } from '../src/screens/authenticated/CustomerTier3ReadinessPanel';

describe('Customer Proof of Address and readiness interfaces', () => {
  test('offers dependent candidate types while all file and decision actions remain disabled', async () => {
    render(<CustomerProofOfAddressPanel />);

    expect(screen.getByRole('heading', { name: 'Proof of Address' })).toBeTruthy();
    expect(
      screen.getByText(/configurable candidates, not an approved acceptance list/i),
    ).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Candidate category'), { target: { value: 'TAX' } });
    await waitFor(() => {
      expect((screen.getByLabelText('Candidate document type') as HTMLSelectElement).value).toBe(
        'TAX_ASSESSMENT',
      );
    });

    expect(screen.getByLabelText('Associated residential address')).toHaveProperty(
      'disabled',
      true,
    );
    expect(screen.getByLabelText('Document file (PDF, JPG, JPEG, PNG)')).toHaveProperty(
      'disabled',
      true,
    );
    expect(
      screen.getByRole('button', { name: 'Upload Proof of Address (not enabled)' }),
    ).toHaveProperty('disabled', true);
    expect(screen.getByRole('button', { name: 'Review / decision (not enabled)' })).toHaveProperty(
      'disabled',
      true,
    );
    expect(screen.getByRole('heading', { name: 'Physical address verification' })).toBeTruthy();
    expect(screen.getByText(/no file is sent or stored from this screen/i)).toBeTruthy();
  });

  test('keeps activation, phone, identity, PoA, physical review, KYC, eligibility, and wallet-tier signals distinct', () => {
    render(
      <CustomerTier3ReadinessPanel
        customerType="INDIVIDUAL"
        customerStatus="DRAFT"
        phoneVerified={false}
        kycLevel="LEVEL_1"
        kycStatus="PENDING"
        financialEligibility="PENDING"
      />,
    );

    expect(screen.getByRole('heading', { name: 'Tier 3 readiness factors' })).toBeTruthy();
    expect(screen.getByText('DRAFT')).toBeTruthy();
    expect(screen.getByText('Not verified')).toBeTruthy();
    expect(screen.getByText('Not separately recorded')).toBeTruthy();
    expect(screen.getAllByText('Not configured').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('LEVEL_1 · PENDING')).toBeTruthy();
    expect(screen.getByText('PENDING')).toBeTruthy();
    expect(screen.getByText('No action')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /upgrade|activate wallet tier/i })).toBeNull();
    expect(
      screen.getByText(/no wallet-tier or customer privilege change is available/i),
    ).toBeTruthy();
  });
});
