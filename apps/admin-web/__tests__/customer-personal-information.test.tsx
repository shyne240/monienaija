import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react';

import { CustomerPersonalInformationPanel } from '../src/screens/authenticated/CustomerPersonalInformationPanel';
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

const profileInitial = {
  displayName: 'Synthetic Customer',
  legalName: 'Synthetic Customer Legal',
  firstName: 'Synthetic',
  middleName: null,
  lastName: 'Customer',
  dateOfBirth: '1990-06-12',
  nationality: 'NG',
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
        'customer.view',
        'customer.create',
        'customer.view_address',
        'customer.view_contact_methods',
        'customer.view_identity_documents',
        'kyc.review',
      ],
      customerAccess: 'NONE',
      assuranceLevel: 'MFA',
    },
  });
}

function setReadMocks() {
  let currentProfile = { ...profileInitial };
  let currentContact = {
    id: 'synthetic-phone-contact',
    type: 'PHONE',
    value: '+2348012340001',
    isPrimary: true,
    verifiedAt: null as string | null,
  };
  let currentIdentity = {
    id: 'synthetic-identity',
    type: 'NIN',
    maskedDocumentNumber: '••••••0001',
    issuingCountry: 'NG',
    issuedAt: null,
    expiresAt: null,
  };

  (ApiClient.get as jest.Mock).mockImplementation((path: string) => {
    if (path.endsWith('/profile')) return Promise.resolve(currentProfile);
    if (path.endsWith('/addresses')) return Promise.resolve([]);
    if (path.endsWith('/contact-methods')) return Promise.resolve([currentContact]);
    if (path.endsWith('/identity-documents')) return Promise.resolve([currentIdentity]);
    return Promise.resolve([]);
  });
  (ApiClient.patch as jest.Mock).mockImplementation((path: string, body: Record<string, unknown>) => {
    if (path.endsWith('/profile')) {
      currentProfile = { ...currentProfile, ...body } as typeof currentProfile;
      return Promise.resolve(currentProfile);
    }
    if (path.endsWith('/identity-documents/synthetic-identity')) {
      currentIdentity = { ...currentIdentity, ...body, maskedDocumentNumber: '••••••0002' } as typeof currentIdentity;
      return Promise.resolve(currentIdentity);
    }
    if (path.endsWith('/contact-methods/synthetic-phone-contact')) {
      currentContact = { ...currentContact, ...body, verifiedAt: '2026-10-24T12:05:00.000Z' } as typeof currentContact;
      return Promise.resolve({ id: currentContact.id, type: currentContact.type, maskedValue: '+234*****0001', isPrimary: currentContact.isPrimary, verifiedAt: currentContact.verifiedAt });
    }
    return Promise.resolve({});
  });
  return { getProfile: () => currentProfile, getContact: () => currentContact, getIdentity: () => currentIdentity };
}

describe('CustomerPersonalInformationPanel', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setPrincipal();
  });

  test('persists profile corrections and refreshes the C360 projection', async () => {
    const state = setReadMocks();
    const onProfileUpdated = jest.fn();
    const view = render(<CustomerPersonalInformationPanel customerId="synthetic-customer-id" onProfileUpdated={onProfileUpdated} />);

    expect(await view.findByText('Synthetic Customer')).toBeTruthy();
    fireEvent.click(view.getByRole('button', { name: 'Edit profile' }));
    fireEvent.change(view.getByLabelText(/Display name/), { target: { value: 'Synthetic Revised Customer' } });
    fireEvent.change(view.getByLabelText(/First name/), { target: { value: 'Revised' } });
    fireEvent.click(view.getByRole('button', { name: 'Save profile' }));

    await waitFor(() => {
      expect(ApiClient.patch).toHaveBeenCalledWith('/customers/synthetic-customer-id/profile', expect.objectContaining({
        displayName: 'Synthetic Revised Customer',
        firstName: 'Revised',
        dateOfBirth: '1990-06-12',
      }));
      expect(state.getProfile().displayName).toBe('Synthetic Revised Customer');
      expect(onProfileUpdated).toHaveBeenCalledWith({
        displayName: 'Synthetic Revised Customer',
        legalName: 'Synthetic Customer Legal',
      });
    });
    expect(await view.findByText('Synthetic Revised Customer')).toBeTruthy();
  });

  test('keeps identity values masked and never pre-fills a sensitive document number for correction', async () => {
    const state = setReadMocks();
    const view = render(<CustomerPersonalInformationPanel customerId="synthetic-customer-id" onProfileUpdated={jest.fn()} />);

    expect((await view.findAllByText('••••••0001')).length).toBeGreaterThanOrEqual(1);
    fireEvent.click(view.getAllByRole('button', { name: 'Edit' })[1]);
    const documentNumber = view.getByLabelText(/Document number/);
    expect((documentNumber as HTMLInputElement).value).toBe('');
    fireEvent.change(documentNumber, { target: { value: 'SYNTHETIC-DOCUMENT-0002' } });
    fireEvent.click(view.getByRole('button', { name: 'Save identity details' }));

    await waitFor(() => {
      expect(ApiClient.patch).toHaveBeenCalledWith('/customers/synthetic-customer-id/identity-documents/synthetic-identity', expect.objectContaining({
        documentNumber: 'SYNTHETIC-DOCUMENT-0002',
      }));
      expect(state.getIdentity().maskedDocumentNumber).toBe('••••••0002');
    });
    expect(view.queryByText('SYNTHETIC-DOCUMENT-0002')).toBeNull();
    expect(await view.findByText('••••••0002')).toBeTruthy();
  });

  test('uses the existing OTP endpoints and attaches a one-time proof through an authorized contact update', async () => {
    setReadMocks();
    (ApiClient.post as jest.Mock).mockImplementation((path: string) => {
      if (path === '/customers/registration/otp') return Promise.resolve({ status: 'OTP_REQUEST_ACCEPTED' });
      if (path === '/customers/registration/otp/verify') return Promise.resolve({ verificationToken: 'synthetic-one-time-verification-token' });
      return Promise.resolve({});
    });
    const onVerificationUpdated = jest.fn();
    const view = render(<CustomerPersonalInformationPanel customerId="synthetic-customer-id" onProfileUpdated={jest.fn()} onVerificationUpdated={onVerificationUpdated} />);

    expect(await view.findByText(/Primary · Not verified/)).toBeTruthy();
    fireEvent.click(view.getByRole('button', { name: 'Verify phone' }));
    await view.findByLabelText('One-time code');
    fireEvent.change(view.getByLabelText('One-time code'), { target: { value: '123456' } });
    fireEvent.click(view.getByRole('button', { name: 'Verify phone' }));

    await waitFor(() => {
      expect(ApiClient.post).toHaveBeenCalledWith('/customers/registration/otp', { phone: '+2348012340001' });
      expect(ApiClient.post).toHaveBeenCalledWith('/customers/registration/otp/verify', {
        phone: '+2348012340001',
        code: '123456',
      });
      expect(ApiClient.patch).toHaveBeenCalledWith('/customers/synthetic-customer-id/contact-methods/synthetic-phone-contact', expect.objectContaining({
        verificationToken: 'synthetic-one-time-verification-token',
      }));
      expect(onVerificationUpdated).toHaveBeenCalledTimes(1);
    });
    expect(await view.findByText(/Primary · Verified/)).toBeTruthy();
    expect(view.queryByText('synthetic-one-time-verification-token')).toBeNull();
  });
});
