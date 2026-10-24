import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react';

import { CustomerRegistrationWizard } from '../src/screens/authenticated/CustomerRegistrationWizard';
import { ApiClient } from '../src/services/api-client';
import { useAuthStore } from '../src/store/auth-store';

jest.mock('../src/services/api-client', () => ({
  ApiClient: {
    get: jest.fn(),
    post: jest.fn(),
    patch: jest.fn(),
    delete: jest.fn(),
  },
}));

const createdCustomer = {
  id: 'synthetic-customer-id',
  reference: 'mn-cus-0123456789abcdef01234567',
  type: 'INDIVIDUAL',
  status: 'DRAFT',
  kycLevel: 'NONE',
  kycStatus: 'NOT_STARTED',
  version: 1,
  createdAt: '2026-10-24T12:00:00.000Z',
  updatedAt: '2026-10-24T12:00:00.000Z',
  deletedAt: null,
};

function setPrincipal() {
  useAuthStore.setState({
    isAuthenticated: true,
    isLoading: false,
    token: 'synthetic-workforce-session-token',
    sessionId: 'synthetic-session',
    principal: {
      type: 'PRIVILEGED',
      principalId: 'issuer:synthetic-super-admin',
      sessionId: 'synthetic-session',
      audience: 'workforce-admin',
      roles: ['SUPER_ADMIN'],
      scopes: [
        'customer.create',
        'customer.view',
        'customer.view_contact_methods',
        'customer.view_identity_documents',
        'customer.view_address',
        'kyc.review',
      ],
      customerAccess: 'NONE',
      assuranceLevel: 'MFA',
    },
  });
}

describe('CustomerRegistrationWizard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setPrincipal();
    (ApiClient.patch as jest.Mock).mockImplementation((path: string) => {
      if (path.endsWith('/profile')) return Promise.reject(Object.assign(new Error('not found'), { status: 404 }));
      if (path.endsWith('/contact-methods/synthetic-phone-contact')) {
        return Promise.resolve({ id: 'synthetic-phone-contact', type: 'PHONE', maskedValue: '+234*****0001', isPrimary: true, verifiedAt: '2026-10-24T12:05:00.000Z' });
      }
      return Promise.resolve({});
    });
    (ApiClient.post as jest.Mock).mockImplementation((path: string) => {
      if (path === '/customers') return Promise.resolve(createdCustomer);
      if (path.endsWith('/profile')) return Promise.resolve({ displayName: 'Synthetic New Customer' });
      if (path.endsWith('/contact-method')) return Promise.resolve({ id: 'synthetic-phone-contact', type: 'PHONE', maskedValue: '+234*****0001', isPrimary: true, verifiedAt: null });
      if (path === '/customers/registration/otp') return Promise.resolve({ status: 'OTP_REQUEST_ACCEPTED' });
      if (path === '/customers/registration/otp/verify') return Promise.resolve({ verificationToken: 'synthetic-one-time-verification-token' });
      if (path.endsWith('/address')) return Promise.resolve({ id: 'synthetic-address', type: 'RESIDENTIAL', isPrimary: true });
      if (path.endsWith('/identity-document')) return Promise.resolve({ id: 'synthetic-identity', type: 'NIN', maskedDocumentNumber: '••••••0001', issuingCountry: 'NG' });
      return Promise.resolve({});
    });
  });

  test('persists a multi-section DRAFT, verifies phone by OTP, masks identity value, and never auto-activates', async () => {
    const onCustomerCreated = jest.fn();
    const onOpenCustomer = jest.fn();
    const onClose = jest.fn();
    const view = render(
      <CustomerRegistrationWizard
        onClose={onClose}
        onCustomerCreated={onCustomerCreated}
        onOpenCustomer={onOpenCustomer}
      />,
    );

    fireEvent.change(view.getByLabelText(/Display name/), { target: { value: 'Synthetic New Customer' } });
    fireEvent.click(view.getByRole('button', { name: 'Create DRAFT & continue' }));
    await view.findByLabelText(/Primary phone number/);

    expect(ApiClient.post).toHaveBeenCalledWith('/customers', { type: 'INDIVIDUAL' });
    expect(ApiClient.post).toHaveBeenCalledWith('/customers/synthetic-customer-id/profile', expect.objectContaining({
      displayName: 'Synthetic New Customer',
    }));
    expect(onCustomerCreated).toHaveBeenCalledWith(createdCustomer);
    expect(view.getByText(/Draft reference:/)).toBeTruthy();

    fireEvent.change(view.getByLabelText(/Primary phone number/), { target: { value: '+2348012340001' } });
    fireEvent.click(view.getByRole('button', { name: 'Save contact details' }));
    await view.findByRole('button', { name: 'Send phone OTP' });
    fireEvent.click(view.getByRole('button', { name: 'Send phone OTP' }));
    await view.findByLabelText('One-time code');
    fireEvent.change(view.getByLabelText('One-time code'), { target: { value: '654321' } });
    fireEvent.click(view.getByRole('button', { name: 'Verify primary phone' }));
    await view.findByText('Primary phone verified. The customer is still DRAFT and is not activated.');
    expect(ApiClient.post).toHaveBeenCalledWith('/customers/registration/otp', { phone: '+2348012340001' });
    expect(ApiClient.post).toHaveBeenCalledWith('/customers/registration/otp/verify', {
      phone: '+2348012340001',
      code: '654321',
    });
    expect(ApiClient.patch).toHaveBeenCalledWith('/customers/synthetic-customer-id/contact-methods/synthetic-phone-contact', expect.objectContaining({
      verificationToken: 'synthetic-one-time-verification-token',
    }));

    fireEvent.click(view.getByRole('button', { name: 'Continue to address' }));
    fireEvent.change(view.getByLabelText(/Address line 1/), { target: { value: '1 Synthetic Crescent' } });
    fireEvent.change(view.getByLabelText(/^City/), { target: { value: 'Abuja' } });
    fireEvent.change(view.getByLabelText(/State \/ province/), { target: { value: 'FCT' } });
    fireEvent.click(view.getByRole('button', { name: 'Save address & continue' }));
    await view.findByLabelText(/Document number/);
    fireEvent.change(view.getByLabelText(/Document number/), { target: { value: 'SYNTHETIC-NIN-0001' } });
    fireEvent.click(view.getByRole('button', { name: 'Save identity details & finish' }));
    await view.findByRole('heading', { name: 'Registration summary' });

    expect(view.getByText('DRAFT', { exact: true })).toBeTruthy();
    expect(view.getByText(/No activation or ledger wallet creation was requested/)).toBeTruthy();
    expect(view.getByText(/NIN · ••••••0001/)).toBeTruthy();
    expect(view.queryByText('SYNTHETIC-NIN-0001')).toBeNull();
    expect(ApiClient.post).toHaveBeenCalledWith('/customers/synthetic-customer-id/address', expect.objectContaining({
      lineOne: '1 Synthetic Crescent',
      city: 'Abuja',
      state: 'FCT',
      country: 'NG',
      isPrimary: true,
    }));
    expect(ApiClient.post).toHaveBeenCalledWith('/customers/synthetic-customer-id/identity-document', expect.objectContaining({
      type: 'NIN',
      documentNumber: 'SYNTHETIC-NIN-0001',
      issuingCountry: 'NG',
    }));
    expect((ApiClient.post as jest.Mock).mock.calls.filter(([path]) => path === '/customers')).toHaveLength(1);

    fireEvent.click(view.getByRole('button', { name: 'Open Customer 360°' }));
    await waitFor(() => expect(onOpenCustomer).toHaveBeenCalledWith('synthetic-customer-id'));
  });
});
