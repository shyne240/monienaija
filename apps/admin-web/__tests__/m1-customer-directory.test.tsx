import React from 'react';
import { act, fireEvent, render, waitFor, within } from '@testing-library/react';

import { CustomerDirectoryScreen } from '../src/screens/authenticated/CustomerDirectoryScreen';
import { ApiClient } from '../src/services/api-client';
import { useAuthStore } from '../src/store/auth-store';

jest.mock('../src/services/api-client', () => ({
  ApiClient: {
    get: jest.fn(),
    post: jest.fn(),
    put: jest.fn(),
    patch: jest.fn(),
    delete: jest.fn(),
  },
}));

const customer = {
  id: 'cust-synthetic-1',
  reference: 'mn-••••5678',
  type: 'INDIVIDUAL',
  status: 'ACTIVE',
  kycLevel: 'LEVEL_1',
  kycStatus: 'APPROVED',
  displayName: 'Synthetic Directory Alpha',
  legalName: 'Synthetic Directory Alpha Legal',
  createdAt: '2026-09-10T09:00:00.000Z',
  primaryContact: { type: 'PHONE', maskedValue: '+234*****4321', isVerified: true },
};

const unverifiedCustomer = {
  ...customer,
  id: 'cust-synthetic-2',
  displayName: 'Synthetic Directory Beta',
  legalName: null,
  reference: 'mn-••••9012',
  primaryContact: { type: 'PHONE', maskedValue: '+234*****8888', isVerified: false },
};

const noContactCustomer = {
  ...customer,
  id: 'cust-synthetic-3',
  displayName: 'Synthetic Directory Gamma',
  legalName: null,
  reference: 'mn-••••3456',
  primaryContact: null,
};

function directoryResponse(
  data: unknown[] = [customer],
  page = 1,
  hasNextPage = false,
  total = data.length,
) {
  return {
    data,
    total,
    page,
    limit: 20,
    totalPages: hasNextPage ? 2 : 1,
    hasNextPage,
    hasPreviousPage: page > 1,
  };
}

function setPrincipal(scopes: string[]) {
  useAuthStore.setState({
    isAuthenticated: true,
    isLoading: false,
    token: 'synthetic-workforce-token',
    sessionId: 'synthetic-session',
    principal: {
      type: 'OPERATOR',
      principalId: 'issuer:synthetic-operator',
      sessionId: 'synthetic-session',
      audience: 'workforce-admin',
      roles: ['OPERATIONS'],
      scopes,
      customerAccess: 'NONE',
      assuranceLevel: 'MFA',
    },
    error: null,
  });
}

const DIRECTORY_SCOPES = [
  'customer.view',
  'customer.create',
  'customer.view_contact_methods',
  'customer.view_transactions',
];

describe('M1 Customer Directory — request contract and result truth', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setPrincipal(DIRECTORY_SCOPES);
    (ApiClient.get as jest.Mock).mockResolvedValue(directoryResponse());
  });

  test('uses the existing paginated contract and introduces no new request or write', async () => {
    const view = render(<CustomerDirectoryScreen />);
    await view.findByText('Synthetic Directory Alpha');

    expect(ApiClient.get).toHaveBeenCalledTimes(1);
    expect((ApiClient.get as jest.Mock).mock.calls[0][0]).toBe('/internal/customers?page=1&limit=20');
    expect(ApiClient.post).not.toHaveBeenCalled();
    expect(ApiClient.patch).not.toHaveBeenCalled();
    expect(ApiClient.delete).not.toHaveBeenCalled();
  });

  test('keeps the 250ms debounce and sends the existing filter query keys', async () => {
    jest.useFakeTimers();
    try {
      const view = render(<CustomerDirectoryScreen />);
      await act(async () => {
        jest.advanceTimersByTime(0);
        await Promise.resolve();
      });
      expect(ApiClient.get).toHaveBeenCalledTimes(1);

      fireEvent.change(view.getByRole('searchbox', { name: 'Search customers' }), {
        target: { value: 'Synthetic' },
      });

      await act(async () => {
        jest.advanceTimersByTime(200);
        await Promise.resolve();
      });
      expect(ApiClient.get).toHaveBeenCalledTimes(1);

      await act(async () => {
        jest.advanceTimersByTime(60);
        await Promise.resolve();
      });
      await act(async () => {
        await Promise.resolve();
      });

      const lastUrl = (ApiClient.get as jest.Mock).mock.calls.at(-1)?.[0] as string;
      expect(lastUrl).toContain('search=Synthetic');
      expect(lastUrl).toContain('page=1');
      expect(lastUrl).toContain('limit=20');

      fireEvent.change(view.getByLabelText('Status'), { target: { value: 'ACTIVE' } });
      fireEvent.change(view.getByLabelText('Type'), { target: { value: 'INDIVIDUAL' } });
      fireEvent.change(view.getByLabelText('KYC level'), { target: { value: 'LEVEL_1' } });
      fireEvent.change(view.getByLabelText('KYC status'), { target: { value: 'APPROVED' } });

      await act(async () => {
        await Promise.resolve();
      });

      const filteredUrl = (ApiClient.get as jest.Mock).mock.calls.at(-1)?.[0] as string;
      expect(filteredUrl).toContain('status=ACTIVE');
      expect(filteredUrl).toContain('type=INDIVIDUAL');
      expect(filteredUrl).toContain('kycLevel=LEVEL_1');
      expect(filteredUrl).toContain('kycStatus=APPROVED');
    } finally {
      jest.useRealTimers();
    }
  });

  test('pagination still drives the server page and resets to page 1 on filter change', async () => {
    (ApiClient.get as jest.Mock).mockImplementation((url: string) => {
      if (url.includes('page=2')) return Promise.resolve(directoryResponse([customer], 2, false, 21));
      return Promise.resolve(directoryResponse([customer], 1, true, 21));
    });

    const view = render(<CustomerDirectoryScreen />);
    await view.findByText('Synthetic Directory Alpha');

    expect(view.getByText('Showing 1–20 of 21')).toBeTruthy();

    fireEvent.click(view.getByRole('button', { name: 'Next' }));
    await waitFor(() => {
      expect((ApiClient.get as jest.Mock).mock.calls.at(-1)?.[0]).toContain('page=2');
    });

    fireEvent.change(view.getByLabelText('Status'), { target: { value: 'SUSPENDED' } });
    await waitFor(() => {
      expect((ApiClient.get as jest.Mock).mock.calls.at(-1)?.[0]).toContain('page=1');
    });
  });

  test('distinguishes loading, empty and error results instead of showing a zero count on failure', async () => {
    let reject: ((error: unknown) => void) | undefined;
    (ApiClient.get as jest.Mock).mockImplementation(
      () =>
        new Promise((_resolve, rej) => {
          reject = rej;
        }),
    );

    const view = render(<CustomerDirectoryScreen />);

    expect(view.getByText('Loading customers…')).toBeTruthy();
    expect(view.getByText('Loading customer records…')).toBeTruthy();
    expect(view.getByRole('table').getAttribute('aria-busy')).toBe('true');

    await act(async () => {
      reject?.({ status: 500 });
    });

    expect(view.getByRole('alert')).toBeTruthy();
    expect(view.getByText('Customer records could not be loaded. Try again.')).toBeTruthy();
    expect(view.getByText('Customer count unavailable')).toBeTruthy();
    expect(view.queryByText('0 customers')).toBeNull();
    // A failed fetch must never be presented as a successful empty result.
    expect(view.queryByText('No customer records match these search criteria.')).toBeNull();
  });

  test('renders a distinct empty state for a successful zero-result response', async () => {
    (ApiClient.get as jest.Mock).mockResolvedValue(directoryResponse([], 1, false, 0));

    const view = render(<CustomerDirectoryScreen />);
    await view.findByText('No customer records match these search criteria.');

    expect(view.getByText('0 customers')).toBeTruthy();
    expect(view.queryByRole('alert')).toBeNull();
    expect(view.getByText('No matching records')).toBeTruthy();
  });

  test.each([
    [401, 'Your session has expired. Sign in again to continue.'],
    [403, 'Customer servicing is not available to this workforce role.'],
  ])('maps a %i response to its existing restricted message', async (status, message) => {
    (ApiClient.get as jest.Mock).mockRejectedValue({ status });

    const view = render(<CustomerDirectoryScreen />);
    await view.findByText(message);

    expect(view.getByText('Customer count unavailable')).toBeTruthy();
  });

  test('retry re-issues the same read request and never introduces a write', async () => {
    (ApiClient.get as jest.Mock).mockRejectedValueOnce({ status: 500 });
    const view = render(<CustomerDirectoryScreen />);
    await view.findByText('Customer records could not be loaded. Try again.');

    (ApiClient.get as jest.Mock).mockResolvedValue(directoryResponse());
    fireEvent.click(view.getByRole('button', { name: 'Retry' }));

    await view.findByText('Synthetic Directory Alpha');
    const calls = (ApiClient.get as jest.Mock).mock.calls.map((call) => call[0]);
    expect(calls.every((url: string) => url === '/internal/customers?page=1&limit=20')).toBe(true);
    expect(ApiClient.post).not.toHaveBeenCalled();
  });

  test('keeps previously loaded rows but labels them unconfirmed when a refresh fails', async () => {
    const view = render(<CustomerDirectoryScreen />);
    await view.findByText('Synthetic Directory Alpha');

    (ApiClient.get as jest.Mock).mockRejectedValueOnce({ status: 500 });
    fireEvent.click(view.getByRole('button', { name: 'Refresh' }));

    await view.findByText('Customer count unconfirmed — showing previously loaded results');
    expect(view.getByText('Showing previously loaded results — not yet confirmed')).toBeTruthy();
    expect(view.getByText('Synthetic Directory Alpha')).toBeTruthy();
    expect(view.queryByText('1 customer')).toBeNull();
  });
});

describe('M1 Customer Directory — privacy, permissions and actions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setPrincipal(DIRECTORY_SCOPES);
    (ApiClient.get as jest.Mock).mockResolvedValue(
      directoryResponse([customer, unverifiedCustomer, noContactCustomer], 1, false, 3),
    );
  });

  test('keeps masked references, verification labels and permission-dependent contact states', async () => {
    const view = render(<CustomerDirectoryScreen />);
    await view.findByText('Synthetic Directory Alpha');

    expect(view.getByText('mn-••••5678')).toBeTruthy();
    expect(view.getByText('+234*****4321')).toBeTruthy();
    expect(view.getByText('Verified')).toBeTruthy();
    expect(view.getByText('Not verified')).toBeTruthy();
    expect(view.queryByText('mn-0000000000')).toBeNull();
    // With contact permission but no recorded contact, "Not recorded" is shown.
    expect(view.getByText('Not recorded')).toBeTruthy();
    expect(view.queryByText('Restricted')).toBeNull();
  });

  test('shows "Restricted" rather than "Not recorded" without contact permission', async () => {
    setPrincipal(['customer.view']);
    (ApiClient.get as jest.Mock).mockResolvedValue(directoryResponse([noContactCustomer]));

    const view = render(<CustomerDirectoryScreen />);
    await view.findByText('Synthetic Directory Gamma');

    expect(view.getByText('Restricted')).toBeTruthy();
    expect(view.queryByText('Not recorded')).toBeNull();
    expect(view.queryByRole('button', { name: 'New Customer' })).toBeNull();
  });

  test('New Customer remains gated by customer.create and the existing wizard still opens and closes', async () => {
    const view = render(<CustomerDirectoryScreen />);
    await view.findByText('Synthetic Directory Alpha');

    const create = view.getByRole('button', { name: 'New Customer' });
    expect(create.getAttribute('aria-expanded')).toBe('false');
    expect(create.getAttribute('aria-controls')).toBeNull();

    fireEvent.click(create);

    expect(view.getByRole('button', { name: 'Close registration' }).getAttribute('aria-expanded')).toBe('true');
    expect(view.getByRole('button', { name: 'Close registration' }).getAttribute('aria-controls')).toBe(
      'mn-dir-registration',
    );
    expect(view.getByRole('heading', { name: 'Customer details' })).toBeTruthy();
    expect(view.container.querySelector('#mn-dir-registration .cm-registration-wizard')).not.toBeNull();

    fireEvent.click(view.getByRole('button', { name: 'Close registration' }));
    expect(view.queryByRole('heading', { name: 'Customer details' })).toBeNull();
    expect((ApiClient.get as jest.Mock).mock.calls.every((call) => String(call[0]).startsWith('/internal/customers'))).toBe(true);
  });

  test('each row action has a unique accessible name and still opens Customer 360° and returns', async () => {
    (ApiClient.get as jest.Mock).mockImplementation((url: string) => {
      if (url.startsWith('/internal/customers?')) {
        return Promise.resolve(directoryResponse([customer, unverifiedCustomer], 1, false, 2));
      }
      return Promise.resolve(customer);
    });

    const view = render(<CustomerDirectoryScreen />);
    await view.findByText('Synthetic Directory Alpha');

    const alpha = view.getByRole('button', {
      name: 'Open Customer 360° for Synthetic Directory Alpha',
    });
    view.getByRole('button', { name: 'Open Customer 360° for Synthetic Directory Beta' });

    fireEvent.click(alpha);
    await waitFor(() => {
      expect(view.getByRole('button', { name: '← Back to directory' })).toBeTruthy();
    });
    // Customer 360° is outside the pilot's visual scope and keeps its own class contract.
    expect(view.container.querySelector('.cm-workspace')).not.toBeNull();
    expect(view.container.querySelector('.mn-dir-panel')).toBeNull();

    fireEvent.click(view.getByRole('button', { name: '← Back to directory' }));
    await waitFor(() => {
      expect(view.getByRole('heading', { name: 'Customer directory' })).toBeTruthy();
    });
  });
});

describe('M1 Customer Directory — table semantics, keyboard and narrow-screen affordances', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setPrincipal(DIRECTORY_SCOPES);
    (ApiClient.get as jest.Mock).mockResolvedValue(directoryResponse());
  });

  test('the table keeps semantic headers, a caption and a named focusable scroll region', async () => {
    const view = render(<CustomerDirectoryScreen />);
    await view.findByText('Synthetic Directory Alpha');

    const table = view.getByRole('table');
    expect(table.querySelector('caption')?.textContent).toContain('Customer directory results');

    const headers = Array.from(table.querySelectorAll('thead th'));
    expect(headers.map((header) => header.getAttribute('scope'))).toEqual(Array(8).fill('col'));
    expect(headers[0].textContent).toBe('Customer');
    expect(headers[0].className).toContain('mn-dir-table__sticky');

    const region = view.getByRole('region', { name: 'Customer records table' });
    expect(region.getAttribute('tabindex')).toBe('0');
    expect(region.querySelector('table')).toBe(table);
    expect(
      view.getByText('Scroll horizontally to view every column and the row actions.'),
    ).toBeTruthy();
  });

  test('status is conveyed by text as well as colour and shape', async () => {
    const view = render(<CustomerDirectoryScreen />);
    await view.findByText('Synthetic Directory Alpha');

    const row = view.getByRole('row', { name: /Synthetic Directory Alpha/ });
    expect(within(row).getByText('ACTIVE').className).toContain('mn-badge--success');
    expect(within(row).getByText('ACTIVE').querySelector('.mn-badge__marker')).not.toBeNull();
    expect(within(row).getByText('LEVEL_1').className).toContain('mn-dir-chip');
    expect(within(row).getByText('APPROVED').className).toContain('mn-badge');
  });

  test('filters remain labelled and operable in reading order', async () => {
    const view = render(<CustomerDirectoryScreen />);
    await view.findByText('Synthetic Directory Alpha');

    const labels = ['Search', 'Status', 'Type', 'KYC level', 'KYC status'];
    for (const label of labels) {
      expect(view.getByLabelText(label, { exact: true })).toBeTruthy();
    }

    fireEvent.change(view.getByLabelText('Status'), { target: { value: 'ACTIVE' } });
    expect(view.getByRole('button', { name: 'Clear filters' })).toBeTruthy();

    fireEvent.click(view.getByRole('button', { name: 'Clear filters' }));
    await waitFor(() => {
      expect((view.getByLabelText('Status') as HTMLSelectElement).value).toBe('');
    });
    expect(view.queryByRole('button', { name: 'Clear filters' })).toBeNull();
  });
});
