import React from 'react';
import { fireEvent, render, waitFor, within } from '@testing-library/react';

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

  test('defaults new Customer 360 profile, address, and NIN identity forms to Nigeria', async () => {
    setReadMocks();
    const originalGet = (ApiClient.get as jest.Mock).getMockImplementation();
    (ApiClient.get as jest.Mock).mockImplementation((path: string) =>
      path.endsWith('/profile')
        ? Promise.reject(Object.assign(new Error('not found'), { status: 404 }))
        : originalGet?.(path));
    const view = render(<CustomerPersonalInformationPanel customerId="synthetic-customer-id" onProfileUpdated={jest.fn()} />);

    const profileHeading = await view.findByRole('heading', { name: 'Personal information' });
    const profileCard = profileHeading.closest('article') as HTMLElement;
    fireEvent.click(within(profileCard).getByRole('button', { name: 'Add profile' }));
    expect(view.getByText('Nigeria (NG)')).toBeTruthy();

    const addressHeading = await view.findByRole('heading', { name: 'Residential and mailing addresses' });
    const addressCard = addressHeading.closest('article') as HTMLElement;
    fireEvent.click(within(addressCard).getByRole('button', { name: 'Add address' }));
    expect(within(addressCard).getByText('Nigeria (NG)')).toBeTruthy();
    fireEvent.click(within(addressCard).getByRole('button', { name: 'Cancel' }));

    const identityHeading = await view.findByRole('heading', { name: 'Supported identity metadata' });
    const identityCard = identityHeading.closest('article') as HTMLElement;
    fireEvent.click(within(identityCard).getByRole('button', { name: 'Add document' }));
    expect(within(identityCard).getByText('Nigeria (NG)')).toBeTruthy();
    expect(view.container.querySelector<HTMLInputElement>('#c360-identity-country')?.disabled).toBe(true);
  });

  test('displays saved country codes as full names and preserves them in profile, address, and identity edits', async () => {
    setReadMocks();
    const originalGet = (ApiClient.get as jest.Mock).getMockImplementation();
    const savedAddress = {
      id: 'synthetic-address-country',
      type: 'RESIDENTIAL',
      lineOne: '1 Synthetic Crescent',
      lineTwo: null,
      city: 'Abuja',
      state: 'FCT',
      country: 'GBR',
      postalCode: null,
      isPrimary: true,
    };
    const savedPassport = {
      id: 'synthetic-identity',
      type: 'INTERNATIONAL_PASSPORT',
      maskedDocumentNumber: '••••••0001',
      issuingCountry: 'GBR',
      issuedAt: '2015-06-12',
      expiresAt: '2035-06-12',
    };
    (ApiClient.get as jest.Mock).mockImplementation((path: string) => {
      if (path.endsWith('/profile')) return Promise.resolve({ ...profileInitial, nationality: 'USA' });
      if (path.endsWith('/addresses')) return Promise.resolve([savedAddress]);
      if (path.endsWith('/identity-documents')) return Promise.resolve([savedPassport]);
      return originalGet?.(path);
    });

    const view = render(<CustomerPersonalInformationPanel customerId="synthetic-customer-id" onProfileUpdated={jest.fn()} />);
    const profileHeading = await view.findByRole('heading', { name: 'Personal information' });
    const profileCard = profileHeading.closest('article') as HTMLElement;
    expect(within(profileCard).getByText('United States')).toBeTruthy();
    expect(within(profileCard).queryByText('USA')).toBeNull();

    const addressHeading = await view.findByRole('heading', { name: 'Residential and mailing addresses' });
    const addressCard = addressHeading.closest('article') as HTMLElement;
    expect(within(addressCard).getByText('United Kingdom')).toBeTruthy();
    const identityHeading = await view.findByRole('heading', { name: 'Supported identity metadata' });
    const identityCard = identityHeading.closest('article') as HTMLElement;
    expect(within(identityCard).getByText(/Issuing country: United Kingdom/)).toBeTruthy();

    const initialReadCount = (ApiClient.get as jest.Mock).mock.calls.length;
    fireEvent.click(within(profileCard).getByRole('button', { name: 'Edit profile' }));
    expect(view.getByText('United States (US)')).toBeTruthy();
    fireEvent.change(view.getByLabelText(/Display name/), { target: { value: 'Synthetic Country Customer' } });
    fireEvent.click(view.getByRole('button', { name: 'Save profile' }));
    await waitFor(() => expect(ApiClient.patch).toHaveBeenCalledWith(
      '/customers/synthetic-customer-id/profile',
      expect.objectContaining({ nationality: 'US' }),
    ));
    await waitFor(() => expect((ApiClient.get as jest.Mock).mock.calls.length).toBeGreaterThan(initialReadCount));
    await waitFor(() => expect(view.queryByText('Loading authorized personal-information sections…')).toBeNull());

    const refreshedAddressCard = (await view.findByRole('heading', { name: 'Residential and mailing addresses' })).closest('article') as HTMLElement;
    const readsAfterProfile = (ApiClient.get as jest.Mock).mock.calls.length;
    fireEvent.click(within(refreshedAddressCard).getByRole('button', { name: 'Edit' }));
    expect(view.getByText('United Kingdom (GB)')).toBeTruthy();
    fireEvent.click(view.getByRole('button', { name: 'Save address' }));
    await waitFor(() => expect(ApiClient.patch).toHaveBeenCalledWith(
      '/customers/synthetic-customer-id/addresses/synthetic-address-country',
      expect.objectContaining({ country: 'GB' }),
    ));
    await waitFor(() => expect((ApiClient.get as jest.Mock).mock.calls.length).toBeGreaterThan(readsAfterProfile));
    await waitFor(() => expect(view.queryByText('Loading authorized personal-information sections…')).toBeNull());

    const refreshedIdentityCard = (await view.findByRole('heading', { name: 'Supported identity metadata' })).closest('article') as HTMLElement;
    fireEvent.click(within(refreshedIdentityCard).getByRole('button', { name: 'Edit' }));
    expect(view.getByText('United Kingdom (GB)')).toBeTruthy();
    fireEvent.click(view.getByRole('button', { name: 'Save identity details' }));
    await waitFor(() => expect(ApiClient.patch).toHaveBeenCalledWith(
      '/customers/synthetic-customer-id/identity-documents/synthetic-identity',
      expect.objectContaining({ issuingCountry: 'GB' }),
    ));
  });

  test('keeps identity values masked and never pre-fills a sensitive document number for correction', async () => {
    const state = setReadMocks();
    const view = render(<CustomerPersonalInformationPanel customerId="synthetic-customer-id" onProfileUpdated={jest.fn()} />);

    expect((await view.findAllByText('••••••0001')).length).toBeGreaterThanOrEqual(1);
    fireEvent.click(view.getAllByRole('button', { name: 'Edit' })[1]);
    const documentNumber = view.getByLabelText(/Document number/);
    expect((documentNumber as HTMLInputElement).value).toBe('');
    expect(view.queryByLabelText(/Issue date/)).toBeNull();
    expect(view.queryByLabelText(/Expiry date/)).toBeNull();
    fireEvent.change(documentNumber, { target: { value: 'SYNTHETIC-DOCUMENT-0002' } });
    fireEvent.click(view.getByRole('button', { name: 'Save identity details' }));

    await waitFor(() => {
      expect(ApiClient.patch).toHaveBeenCalledWith('/customers/synthetic-customer-id/identity-documents/synthetic-identity', expect.objectContaining({
        documentNumber: 'SYNTHETIC-DOCUMENT-0002',
        type: 'NIN',
      }));
      const identityCorrection = (ApiClient.patch as jest.Mock).mock.calls.find(([path]) =>
        path.endsWith('/identity-documents/synthetic-identity'));
      expect(identityCorrection?.[1]).not.toHaveProperty('issuedAt');
      expect(identityCorrection?.[1]).not.toHaveProperty('expiresAt');
      expect(state.getIdentity().maskedDocumentNumber).toBe('••••••0002');
    });
    expect(view.queryByText('SYNTHETIC-DOCUMENT-0002')).toBeNull();
    expect(await view.findByText('••••••0002')).toBeTruthy();
  });

  test('lists multiple identity documents and corrects only the selected saved record', async () => {
    const state = setReadMocks();
    const documents = [
      state.getIdentity(),
      { ...state.getIdentity(), id: 'synthetic-identity-second', maskedDocumentNumber: '••••••0002' },
    ];
    const originalGet = (ApiClient.get as jest.Mock).getMockImplementation();
    (ApiClient.get as jest.Mock).mockImplementation((path: string) =>
      path.endsWith('/identity-documents') ? Promise.resolve(documents) : originalGet?.(path));
    (ApiClient.patch as jest.Mock).mockImplementation((path: string, body: Record<string, unknown>) => {
      const matched = path.match(/identity-documents\/([^/]+)$/);
      if (matched) {
        const index = documents.findIndex((document) => document.id === matched[1]);
        documents[index] = { ...documents[index], ...body, maskedDocumentNumber: '••••••0003' };
        return Promise.resolve(documents[index]);
      }
      return Promise.resolve({});
    });
    (ApiClient.post as jest.Mock).mockImplementation((path: string, body: Record<string, unknown>) => {
      if (path.endsWith('/identity-document')) {
        const added = {
          id: 'synthetic-identity-added',
          type: body.type,
          maskedDocumentNumber: '••••••0004',
          issuingCountry: body.issuingCountry,
          issuedAt: null,
          expiresAt: null,
        };
        documents.unshift(added as typeof documents[number]);
        return Promise.resolve(added);
      }
      return Promise.resolve({});
    });

    const view = render(<CustomerPersonalInformationPanel customerId="synthetic-customer-id" onProfileUpdated={jest.fn()} />);
    const initialReadCount = (ApiClient.get as jest.Mock).mock.calls.length;
    const identityHeading = await view.findByRole('heading', { name: 'Supported identity metadata' });
    const identityCard = identityHeading.closest('article');
    expect(identityCard).not.toBeNull();
    expect(within(identityCard as HTMLElement).getAllByRole('button', { name: 'Edit' })).toHaveLength(2);

    fireEvent.click(within(identityCard as HTMLElement).getAllByRole('button', { name: 'Edit' })[1]);
    fireEvent.change(view.getByLabelText(/Document number/), { target: { value: 'SYNTHETIC-SECOND-UPDATED' } });
    fireEvent.click(view.getByRole('button', { name: 'Save identity details' }));
    await waitFor(() => expect(ApiClient.patch).toHaveBeenCalledWith(
      '/customers/synthetic-customer-id/identity-documents/synthetic-identity-second',
      expect.objectContaining({ documentNumber: 'SYNTHETIC-SECOND-UPDATED' }),
    ));
    expect(documents.find((document) => document.id === 'synthetic-identity')?.maskedDocumentNumber).toBe('••••••0001');
    expect(documents.find((document) => document.id === 'synthetic-identity-second')?.maskedDocumentNumber).toBe('••••••0003');
    await waitFor(() => expect((ApiClient.get as jest.Mock).mock.calls.length).toBeGreaterThan(initialReadCount));
    await waitFor(() => expect(view.queryByText('Loading authorized personal-information sections…')).toBeNull());
    const refreshedIdentityCard = (await view.findByRole('heading', { name: 'Supported identity metadata' })).closest('article') as HTMLElement;

    fireEvent.click(within(refreshedIdentityCard).getByRole('button', { name: 'Add document' }));
    fireEvent.change(view.getByLabelText(/Document number/), { target: { value: 'SYNTHETIC-NEW-0004' } });
    fireEvent.click(view.getByRole('button', { name: 'Save identity details' }));
    expect(await view.findByText('••••••0004')).toBeTruthy();
    expect(documents).toHaveLength(3);
    const finalIdentityCard = (await view.findByRole('heading', { name: 'Supported identity metadata' })).closest('article') as HTMLElement;
    expect(within(finalIdentityCard).queryByRole('button', { name: /delete/i })).toBeNull();
  });

  test('shows optional date inputs only for supported document types and clears them for BVN', async () => {
    setReadMocks();
    const view = render(<CustomerPersonalInformationPanel customerId="synthetic-customer-id" onProfileUpdated={jest.fn()} />);

    await view.findAllByText('••••••0001');
    fireEvent.click(view.getAllByRole('button', { name: 'Edit' })[1]);
    fireEvent.change(view.getByLabelText(/Document type/), { target: { value: 'INTERNATIONAL_PASSPORT' } });
    const issueDate = view.getByLabelText(/Issue date/) as HTMLInputElement;
    const expiryDate = view.getByLabelText(/Expiry date/) as HTMLInputElement;
    expect(issueDate.required).toBe(false);
    expect(expiryDate.required).toBe(false);
    fireEvent.change(issueDate, { target: { value: '2015-06-12' } });
    fireEvent.change(expiryDate, { target: { value: '2035-06-12' } });

    fireEvent.change(view.getByLabelText(/Document type/), { target: { value: 'BVN' } });
    expect(view.queryByLabelText(/Issue date/)).toBeNull();
    expect(view.queryByLabelText(/Expiry date/)).toBeNull();
    const bvnIssuingCountry = view.container.querySelector<HTMLInputElement>('#c360-identity-country');
    expect(bvnIssuingCountry).not.toBeNull();
    expect(bvnIssuingCountry?.disabled).toBe(true);
    expect(view.getByText('Nigeria (NG)')).toBeTruthy();
    fireEvent.click(view.getByRole('button', { name: 'Save identity details' }));

    await waitFor(() => {
      const identityCorrection = (ApiClient.patch as jest.Mock).mock.calls.find(([path]) =>
        path.endsWith('/identity-documents/synthetic-identity'));
      expect(identityCorrection?.[1]).toMatchObject({ type: 'BVN', issuingCountry: 'NG' });
      expect(identityCorrection?.[1]).not.toHaveProperty('issuedAt');
      expect(identityCorrection?.[1]).not.toHaveProperty('expiresAt');
    });
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
