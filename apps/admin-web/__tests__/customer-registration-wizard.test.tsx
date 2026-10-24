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

let identitySequence = 0;

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
    identitySequence = 0;
    setPrincipal();
    (ApiClient.patch as jest.Mock).mockImplementation((path: string) => {
      if (path.endsWith('/profile'))
        return Promise.reject(Object.assign(new Error('not found'), { status: 404 }));
      if (path.endsWith('/contact-methods/synthetic-phone-contact')) {
        return Promise.resolve({
          id: 'synthetic-phone-contact',
          type: 'PHONE',
          maskedValue: '+234*****0001',
          isPrimary: true,
          verifiedAt: '2026-10-24T12:05:00.000Z',
        });
      }
      return Promise.resolve({});
    });
    (ApiClient.post as jest.Mock).mockImplementation((path: string) => {
      if (path === '/customers') return Promise.resolve(createdCustomer);
      if (path.endsWith('/profile'))
        return Promise.resolve({ displayName: 'Synthetic New Customer' });
      if (path.endsWith('/contact-method'))
        return Promise.resolve({
          id: 'synthetic-phone-contact',
          type: 'PHONE',
          maskedValue: '+234*****0001',
          isPrimary: true,
          verifiedAt: null,
        });
      if (path === '/customers/registration/otp')
        return Promise.resolve({ status: 'OTP_REQUEST_ACCEPTED' });
      if (path === '/customers/registration/otp/verify')
        return Promise.resolve({ verificationToken: 'synthetic-one-time-verification-token' });
      if (path.endsWith('/address'))
        return Promise.resolve({ id: 'synthetic-address', type: 'RESIDENTIAL', isPrimary: true });
      if (path.endsWith('/identity-document')) {
        identitySequence += 1;
        return Promise.resolve({
          id: `synthetic-identity-${identitySequence}`,
          type: 'NIN',
          maskedDocumentNumber: `••••••${String(identitySequence).padStart(4, '0')}`,
          issuingCountry: 'NG',
          issuedAt: null,
          expiresAt: null,
        });
      }
      return Promise.resolve({});
    });
  });

  test('shows an accessible DOB error, preserves the submitted value, and does not create an invalid draft', async () => {
    const view = render(
      <CustomerRegistrationWizard
        onClose={jest.fn()}
        onCustomerCreated={jest.fn()}
        onOpenCustomer={jest.fn()}
      />,
    );
    fireEvent.change(view.getByLabelText(/First name/), { target: { value: 'Synthetic' } });
    fireEvent.change(view.getByLabelText(/Last name/), { target: { value: 'Future DOB' } });
    fireEvent.change(view.getByLabelText(/Date of birth/), { target: { value: '2999-01-01' } });
    fireEvent.click(view.getByRole('button', { name: 'Create DRAFT & continue' }));

    const dateOfBirth = view.getByLabelText(/Date of birth/) as HTMLInputElement;
    expect(await view.findByText(/not in the future/)).toBeTruthy();
    expect(dateOfBirth.value).toBe('2999-01-01');
    expect(dateOfBirth.getAttribute('aria-invalid')).toBe('true');
    expect(ApiClient.post).not.toHaveBeenCalledWith('/customers', expect.anything());
  });

  test('prevents duplicate customer creation while the first submit is pending', async () => {
    let releaseCustomer: ((value: typeof createdCustomer) => void) | undefined;
    (ApiClient.post as jest.Mock).mockImplementation((path: string) => {
      if (path === '/customers') {
        return new Promise<typeof createdCustomer>((resolve) => {
          releaseCustomer = resolve;
        });
      }
      return Promise.resolve({ displayName: 'Synthetic New Customer' });
    });
    const view = render(
      <CustomerRegistrationWizard
        onClose={jest.fn()}
        onCustomerCreated={jest.fn()}
        onOpenCustomer={jest.fn()}
      />,
    );
    fireEvent.change(view.getByLabelText(/First name/), { target: { value: 'Synthetic' } });
    fireEvent.change(view.getByLabelText(/Last name/), { target: { value: 'New Customer' } });
    const submit = view.getByRole('button', { name: 'Create DRAFT & continue' });
    fireEvent.click(submit);
    fireEvent.click(submit);

    expect(
      (ApiClient.post as jest.Mock).mock.calls.filter(([path]) => path === '/customers'),
    ).toHaveLength(1);
    releaseCustomer?.(createdCustomer);
    expect(await view.findByLabelText(/Primary phone number/)).toBeTruthy();
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

    fireEvent.change(view.getByLabelText(/First name/), { target: { value: 'Synthetic' } });
    fireEvent.change(view.getByLabelText(/Middle name/), { target: { value: 'New' } });
    fireEvent.change(view.getByLabelText(/Last name/), { target: { value: 'Customer' } });
    fireEvent.click(view.getByRole('button', { name: 'Create DRAFT & continue' }));
    await view.findByLabelText(/Primary phone number/);

    expect(ApiClient.post).toHaveBeenCalledWith('/customers', { type: 'INDIVIDUAL' });
    expect(ApiClient.post).toHaveBeenCalledWith(
      '/customers/synthetic-customer-id/registration-profile',
      expect.objectContaining({
        firstName: 'Synthetic',
        middleName: 'New',
        lastName: 'Customer',
        nationality: 'NG',
      }),
    );
    expect(onCustomerCreated).toHaveBeenCalledWith(createdCustomer);
    expect(onCustomerCreated).toHaveBeenCalledTimes(2);
    expect(view.getByText(/Draft reference:/)).toBeTruthy();

    fireEvent.change(view.getByLabelText(/Primary phone number/), {
      target: { value: '+2348012340001' },
    });
    fireEvent.click(view.getByRole('button', { name: 'Save contact details' }));
    await view.findByRole('button', { name: 'Send phone OTP' });
    fireEvent.click(view.getByRole('button', { name: 'Send phone OTP' }));
    await view.findByLabelText('One-time code');
    fireEvent.change(view.getByLabelText('One-time code'), { target: { value: '654321' } });
    fireEvent.click(view.getByRole('button', { name: 'Verify primary phone' }));
    await view.findByText(
      'Primary phone verified. The customer is still DRAFT and is not activated.',
    );
    expect(ApiClient.post).toHaveBeenCalledWith('/customers/registration/otp', {
      phone: '+2348012340001',
    });
    expect(ApiClient.post).toHaveBeenCalledWith('/customers/registration/otp/verify', {
      phone: '+2348012340001',
      code: '654321',
    });
    expect(ApiClient.patch).toHaveBeenCalledWith(
      '/customers/synthetic-customer-id/contact-methods/synthetic-phone-contact',
      expect.objectContaining({
        verificationToken: 'synthetic-one-time-verification-token',
      }),
    );

    fireEvent.click(view.getByRole('button', { name: 'Continue to address' }));
    fireEvent.change(view.getByLabelText(/Address line 1/), {
      target: { value: '1 Synthetic Crescent' },
    });
    fireEvent.change(view.getByLabelText(/^City/), { target: { value: 'Abuja' } });
    fireEvent.change(view.getByLabelText(/State \/ province/), { target: { value: 'FCT' } });
    fireEvent.click(view.getByRole('button', { name: 'Save address & continue' }));
    await view.findByLabelText(/Document number/);
    fireEvent.change(view.getByLabelText(/Document number/), { target: { value: '00000000001' } });
    fireEvent.click(view.getByRole('button', { name: 'Save this document' }));
    await view.findByText('••••••0001 · Saved');

    fireEvent.click(view.getByRole('button', { name: 'Add another identity document' }));
    fireEvent.change(view.getByLabelText(/Document number/), { target: { value: '00000000002' } });
    fireEvent.click(view.getByRole('button', { name: 'Save this document' }));
    await view.findByText('••••••0002 · Saved');
    fireEvent.click(view.getByRole('button', { name: 'Continue to registration summary' }));
    await view.findByRole('heading', { name: 'Registration summary' });

    expect(view.getByText('DRAFT', { exact: true })).toBeTruthy();
    expect(view.getByText(/No activation or ledger wallet creation was requested/)).toBeTruthy();
    expect(view.getByText(/NIN · ••••••0001/)).toBeTruthy();
    expect(view.getByText(/NIN · ••••••0002/)).toBeTruthy();
    expect(view.queryByText('00000000001')).toBeNull();
    expect(view.queryByText('00000000002')).toBeNull();
    expect(ApiClient.post).toHaveBeenCalledWith(
      '/customers/synthetic-customer-id/address',
      expect.objectContaining({
        lineOne: '1 Synthetic Crescent',
        city: 'Abuja',
        state: 'FCT',
        country: 'NG',
        isPrimary: true,
      }),
    );
    expect(ApiClient.post).toHaveBeenCalledWith(
      '/customers/synthetic-customer-id/identity-document',
      expect.objectContaining({
        type: 'NIN',
        documentNumber: '00000000001',
        issuingCountry: 'NG',
      }),
    );
    expect(ApiClient.post).toHaveBeenCalledWith(
      '/customers/synthetic-customer-id/identity-document',
      expect.objectContaining({
        type: 'NIN',
        documentNumber: '00000000002',
        issuingCountry: 'NG',
      }),
    );
    expect(
      (ApiClient.post as jest.Mock).mock.calls.filter(([path]) => path === '/customers'),
    ).toHaveLength(1);

    fireEvent.click(view.getByRole('button', { name: 'Open Customer 360°' }));
    await waitFor(() => expect(onOpenCustomer).toHaveBeenCalledWith('synthetic-customer-id'));
  });

  test('searches countries by ISO code or name, persists alpha-2 codes, and fixes NIN/BVN to Nigeria', async () => {
    const view = render(
      <CustomerRegistrationWizard
        onClose={jest.fn()}
        onCustomerCreated={jest.fn()}
        onOpenCustomer={jest.fn()}
      />,
    );
    const chooseCountry = async (label: string | RegExp, query: string, optionName: string) => {
      const input = view.getByRole('combobox', { name: label });
      fireEvent.focus(input);
      fireEvent.change(input, { target: { value: query } });
      fireEvent.click(await view.findByRole('option', { name: optionName }));
    };

    expect(view.getByText('Nigeria (NG)')).toBeTruthy();
    await chooseCountry('Nationality', 'US', 'United States (US)');
    fireEvent.change(view.getByLabelText(/First name/), { target: { value: 'Synthetic' } });
    fireEvent.change(view.getByLabelText(/Last name/), { target: { value: 'Country' } });
    fireEvent.click(view.getByRole('button', { name: 'Create DRAFT & continue' }));
    await view.findByLabelText(/Primary phone number/);
    expect(ApiClient.post).toHaveBeenCalledWith(
      '/customers/synthetic-customer-id/registration-profile',
      expect.objectContaining({
        firstName: 'Synthetic',
        lastName: 'Country',
        nationality: 'US',
      }),
    );

    fireEvent.change(view.getByLabelText(/Primary phone number/), {
      target: { value: '+2348012340001' },
    });
    fireEvent.click(view.getByRole('button', { name: 'Save contact details' }));
    const continueToAddress = await view.findByRole('button', { name: 'Continue to address' });
    await waitFor(() => expect((continueToAddress as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(continueToAddress);
    expect(view.getByText('Nigeria (NG)')).toBeTruthy();
    fireEvent.change(view.getByLabelText(/Address line 1/), {
      target: { value: '1 Synthetic Crescent' },
    });
    fireEvent.change(view.getByLabelText(/^City/), { target: { value: 'Abuja' } });
    fireEvent.change(view.getByLabelText(/State \/ province/), { target: { value: 'FCT' } });
    await chooseCountry('Country', 'Kenya', 'Kenya (KE)');
    fireEvent.click(view.getByRole('button', { name: 'Save address & continue' }));
    await view.findByRole('heading', { name: 'Identity documents' });
    expect(ApiClient.post).toHaveBeenCalledWith(
      '/customers/synthetic-customer-id/address',
      expect.objectContaining({ country: 'KE' }),
    );

    const ninIssuingCountry = view.container.querySelector<HTMLInputElement>(
      'input[id^="identity-country-"]',
    );
    expect(ninIssuingCountry).not.toBeNull();
    expect(ninIssuingCountry?.disabled).toBe(true);
    expect(view.getByText('Nigeria (NG)')).toBeTruthy();
    fireEvent.change(view.getByLabelText(/Document number/), {
      target: { value: '00000000001' },
    });
    fireEvent.click(view.getByRole('button', { name: 'Save this document' }));
    expect(await view.findByText('••••••0001 · Saved')).toBeTruthy();

    fireEvent.click(view.getByRole('button', { name: 'Add another identity document' }));
    fireEvent.change(view.getByLabelText(/Identity document type/), {
      target: { value: 'INTERNATIONAL_PASSPORT' },
    });
    const passportIssuingCountry = view.getByRole('combobox', { name: 'Issuing country' });
    expect((passportIssuingCountry as HTMLInputElement).disabled).toBe(false);
    await chooseCountry('Issuing country', 'GB', 'United Kingdom (GB)');
    fireEvent.change(view.getByLabelText(/Document number/), {
      target: { value: 'SYNTHETIC-PASSPORT-0002' },
    });
    fireEvent.change(view.getByLabelText(/Issue date/), { target: { value: '2015-06-12' } });
    fireEvent.change(view.getByLabelText(/Expiry date/), { target: { value: '2035-06-12' } });
    fireEvent.click(view.getByRole('button', { name: 'Save this document' }));
    expect(await view.findByText('••••••0002 · Saved')).toBeTruthy();

    expect(ApiClient.post).toHaveBeenCalledWith(
      '/customers/synthetic-customer-id/identity-document',
      expect.objectContaining({ type: 'NIN', issuingCountry: 'NG' }),
    );
    expect(ApiClient.post).toHaveBeenCalledWith(
      '/customers/synthetic-customer-id/identity-document',
      expect.objectContaining({
        type: 'INTERNATIONAL_PASSPORT',
        issuingCountry: 'GB',
        issuedAt: '2015-06-12',
        expiresAt: '2035-06-12',
      }),
    );
  });

  test('uses the business profile flow and permits skipping identity documents', async () => {
    const view = render(
      <CustomerRegistrationWizard
        onClose={jest.fn()}
        onCustomerCreated={jest.fn()}
        onOpenCustomer={jest.fn()}
      />,
    );
    fireEvent.change(view.getByLabelText(/Customer type/), { target: { value: 'BUSINESS' } });
    expect(view.queryByLabelText(/First name/)).toBeNull();
    expect(view.queryByLabelText(/Last name/)).toBeNull();
    fireEvent.change(view.getByLabelText(/Business name/), {
      target: { value: 'Synthetic Business Ltd' },
    });
    fireEvent.click(view.getByRole('button', { name: 'Create DRAFT & continue' }));
    await view.findByLabelText(/Primary phone number/);
    expect(ApiClient.post).toHaveBeenCalledWith(
      '/customers/synthetic-customer-id/registration-profile',
      { businessName: 'Synthetic Business Ltd' },
    );

    fireEvent.change(view.getByLabelText(/Primary phone number/), {
      target: { value: '+2348012340001' },
    });
    fireEvent.click(view.getByRole('button', { name: 'Save contact details' }));
    const continueToAddress = await view.findByRole('button', { name: 'Continue to address' });
    await waitFor(() => expect((continueToAddress as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(continueToAddress);
    fireEvent.click(view.getByRole('button', { name: 'Skip address' }));
    await view.findByRole('heading', { name: 'Identity documents' });
    expect((view.getByLabelText(/Identity document type/) as HTMLSelectElement).value).toBe(
      'BUSINESS_REGISTRATION',
    );
    fireEvent.click(view.getByRole('button', { name: 'Skip identity documents' }));
    await view.findByRole('heading', { name: 'Registration summary' });
    expect(view.getByRole('heading', { name: 'Synthetic Business Ltd' })).toBeTruthy();
    expect(
      (ApiClient.post as jest.Mock).mock.calls.filter(([path]) =>
        path.endsWith('/identity-document'),
      ),
    ).toHaveLength(0);
  });

  test('keeps saved identity documents when a later independent save fails and removes only the unsaved entry', async () => {
    let identitySaveCount = 0;
    (ApiClient.post as jest.Mock).mockImplementation(
      (path: string, body?: Record<string, unknown>) => {
        if (path === '/customers') return Promise.resolve(createdCustomer);
        if (path.endsWith('/profile'))
          return Promise.resolve({ displayName: 'Synthetic New Customer' });
        if (path.endsWith('/contact-method')) {
          return Promise.resolve({
            id: 'synthetic-phone-contact',
            type: 'PHONE',
            maskedValue: '+234*****0001',
            isPrimary: true,
            verifiedAt: null,
          });
        }
        if (path.endsWith('/identity-document')) {
          identitySaveCount += 1;
          if (identitySaveCount === 2) {
            return Promise.reject(
              Object.assign(new Error('synthetic validation failure'), {
                status: 400,
                validationErrors: { documentNumber: 'Synthetic document was rejected.' },
              }),
            );
          }
          return Promise.resolve({
            id: 'synthetic-identity-saved',
            type: 'NIN',
            maskedDocumentNumber: '••••••0001',
            issuingCountry: 'NG',
            issuedAt: null,
            expiresAt: null,
          });
        }
        return Promise.resolve({});
      },
    );

    const view = render(
      <CustomerRegistrationWizard
        onClose={jest.fn()}
        onCustomerCreated={jest.fn()}
        onOpenCustomer={jest.fn()}
      />,
    );
    fireEvent.change(view.getByLabelText(/First name/), { target: { value: 'Synthetic' } });
    fireEvent.change(view.getByLabelText(/Last name/), { target: { value: 'New Customer' } });
    fireEvent.click(view.getByRole('button', { name: 'Create DRAFT & continue' }));
    await view.findByLabelText(/Primary phone number/);
    fireEvent.change(view.getByLabelText(/Primary phone number/), {
      target: { value: '+2348012340001' },
    });
    fireEvent.click(view.getByRole('button', { name: 'Save contact details' }));
    const continueToAddress = await view.findByRole('button', { name: 'Continue to address' });
    await waitFor(() => expect((continueToAddress as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(continueToAddress);
    fireEvent.click(view.getByRole('button', { name: 'Skip address' }));
    await view.findByRole('heading', { name: 'Identity documents' });

    fireEvent.change(view.getByLabelText(/Document number/), {
      target: { value: '00000000001' },
    });
    fireEvent.click(view.getByRole('button', { name: 'Save this document' }));
    expect(await view.findByText('••••••0001 · Saved')).toBeTruthy();
    fireEvent.click(view.getByRole('button', { name: 'Add another identity document' }));
    fireEvent.change(view.getByLabelText(/Document number/), {
      target: { value: '00000000002' },
    });
    fireEvent.click(view.getByRole('button', { name: 'Save this document' }));
    expect((await view.findAllByText('Synthetic document was rejected.')).length).toBe(2);
    expect(view.getByText('••••••0001 · Saved')).toBeTruthy();
    expect((view.getByLabelText(/Document number/) as HTMLInputElement).value).toBe('00000000002');

    fireEvent.click(view.getByRole('button', { name: 'Remove unsaved entry' }));
    expect(view.getByText('••••••0001 · Saved')).toBeTruthy();
    expect(view.queryByLabelText(/Document number/)).toBeNull();
    expect(view.queryByText('00000000002')).toBeNull();
  });
});
