import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import App from '../src/App';
import { ApiClient } from '../src/services/api-client';
import { useAuthStore } from '../src/store/auth-store';

jest.mock('../src/services/api-client', () => {
  const actual = jest.requireActual('../src/services/api-client');
  return {
    ...actual,
    ApiClient: { get: jest.fn(), post: jest.fn(), delete: jest.fn() },
  };
});

const api = ApiClient as unknown as { get: jest.Mock; post: jest.Mock };

/**
 * Banking operations workspace.
 *
 * The assertions are about what the screen refuses to claim, not just what it renders. A readiness
 * screen that quietly shows a green badge for a provider nobody approved would be the most damaging
 * possible defect here, because an operator would act on it.
 */
describe('Admin Web banking operations workspace', () => {
  function signIn(
    scopes = [
      'reconciliation.view',
      'banking.provider.view',
      'banking.reconciliation.run',
      'banking.reconciliation.resolve',
    ],
  ) {
    useAuthStore.setState({
      isAuthenticated: true,
      isLoading: false,
      token: 'banking-bearer',
      sessionId: 'banking-sess',
      principal: {
        type: 'OPERATOR',
        principalId: 'iss:banking-ops',
        sessionId: 'banking-sess',
        audience: 'workforce-admin',
        roles: ['SUPER_ADMIN'],
        scopes,
      } as never,
    } as never);
  }

  async function openWorkspace() {
    render(<App />);
    fireEvent.click(await screen.findByText('Banking operations'));
    return screen.findByRole('heading', { name: /Banking operations/i });
  }

  beforeEach(() => {
    jest.clearAllMocks();
    signIn();
    // Default: nothing registered.
    api.get.mockImplementation((endpoint: string) => {
      if (endpoint.includes('/internal/banking/capabilities')) return Promise.resolve([]);
      return Promise.reject(new Error(`unexpected GET ${endpoint}`));
    });
  });

  it('shows no readiness until an institution is loaded', async () => {
    await openWorkspace();
    expect(screen.getByText(/Load an institution to see provider readiness/i)).toBeTruthy();
    // Crucially: no account numbers, no balances, no invented readiness.
    expect(screen.queryByText(/^Operational/)).toBeNull();
  });

  it('loads a Treasury reconciliation-only view without requesting provider or resolve functions', async () => {
    signIn(['reconciliation.view']);
    api.get.mockImplementation((endpoint: string) => {
      if (endpoint.includes('/reconciliation/') && endpoint.endsWith('/runs'))
        return Promise.resolve([
          {
            id: 'run-1',
            provider_key: 'sandbox-provider',
            environment: 'sandbox',
            state: 'COMPLETED',
            observations: 2,
            exceptions_raised: 1,
            started_at: '2026-11-27T00:00:00.000Z',
            completed_at: '2026-11-27T00:01:00.000Z',
            failure_code: null,
          },
        ]);
      if (endpoint.includes('/reconciliation/') && endpoint.includes('/exceptions'))
        return Promise.resolve([
          {
            id: 'exception-1',
            runId: 'run-1',
            kind: 'MISSING_SETTLEMENT',
            severity: 'WARNING',
            state: 'OPEN',
            operationReference: 'BIZ-REF-1',
            amountMinor: null,
            currency: null,
            note: null,
            assignedTo: null,
            createdAt: '2026-11-27T00:00:00.000Z',
            escalatedAt: null,
          },
        ]);
      return Promise.reject(new Error(`unexpected GET ${endpoint}`));
    });

    await openWorkspace();
    expect(screen.getByTestId('banking-reconciliation-only-access')).toBeTruthy();
    expect(screen.queryByText('Adapter capabilities')).toBeNull();
    fireEvent.change(screen.getByLabelText('Institution ID'), {
      target: { value: '11111111-1111-1111-1111-111111111111' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Load' }));

    expect(await screen.findByText('sandbox-provider')).toBeTruthy();
    expect(screen.getByText('BIZ-REF-1')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Run reconciliation/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Record escalation' })).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    const requested = api.get.mock.calls.map(([path]) => String(path));
    expect(requested.some((path) => path.includes('/internal/banking/capabilities'))).toBe(false);
    expect(requested.some((path) => path.includes('/internal/banking/providers'))).toBe(false);
    expect(
      requested.some((path) => path.includes('/reconciliation/') && path.endsWith('/runs')),
    ).toBe(true);
    expect(
      requested.some((path) => path.includes('/reconciliation/') && path.includes('/exceptions')),
    ).toBe(true);
  });

  it('says the registry is empty instead of implying banking works', async () => {
    api.get.mockImplementation((endpoint: string) => {
      if (endpoint.includes('/internal/banking/capabilities')) return Promise.resolve([]);
      if (endpoint.includes('/internal/banking/providers'))
        return Promise.resolve({ registered: [], providers: [] });
      if (endpoint.includes('/reconciliation')) return Promise.resolve([]);
      return Promise.resolve([]);
    });
    await openWorkspace();
    fireEvent.change(screen.getByLabelText('Institution ID'), {
      target: { value: '11111111-1111-1111-1111-111111111111' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Load' }));
    expect(await screen.findByText(/No banking provider is configured/i)).toBeTruthy();
    expect(screen.getByText(/banking is disabled unless credentials/i)).toBeTruthy();
  });

  it('renders each provider state separately and never asserts an entitlement', async () => {
    api.get.mockImplementation((endpoint: string) => {
      if (endpoint.includes('/internal/banking/capabilities')) return Promise.resolve([]);
      if (endpoint.includes('/internal/banking/providers'))
        return Promise.resolve({
          registered: ['monnify'],
          providers: [
            {
              providerKey: 'monnify',
              state: 'OPERATIONAL_BUT_ENTITLEMENT_UNCONFIRMED',
              usable: true,
              entitled: 'UNKNOWN',
              approved: true,
              credentialed: true,
              operational: true,
              disabled: false,
              capability: 'VIRTUAL_ACCOUNT_PROVISION',
            },
            {
              providerKey: 'other-bank',
              state: 'IMPLEMENTED_NOT_APPROVED',
              usable: false,
              entitled: 'UNKNOWN',
              approved: false,
              credentialed: false,
              operational: false,
              disabled: false,
              capability: 'VIRTUAL_ACCOUNT_PROVISION',
            },
          ],
        });
      return Promise.resolve([]);
    });
    await openWorkspace();
    fireEvent.change(screen.getByLabelText('Institution ID'), {
      target: { value: '11111111-1111-1111-1111-111111111111' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Load' }));

    expect(await screen.findByText('Operational — entitlement unconfirmed')).toBeTruthy();
    expect(screen.getByText('Implemented, not approved')).toBeTruthy();
    // Entitlement is never claimed, for either provider.
    expect(screen.getAllByText(/Unknown — not asserted/i).length).toBeGreaterThanOrEqual(2);
    // A run button exists only for the usable provider.
    expect(screen.getAllByRole('button', { name: /Run reconciliation/ })).toHaveLength(1);
  });

  it('warns that no provider is operational when none is usable', async () => {
    api.get.mockImplementation((endpoint: string) => {
      if (endpoint.includes('/internal/banking/capabilities')) return Promise.resolve([]);
      if (endpoint.includes('/internal/banking/providers'))
        return Promise.resolve({
          registered: ['monnify'],
          providers: [
            {
              providerKey: 'monnify',
              state: 'APPROVED_NOT_CREDENTIALED',
              usable: false,
              entitled: 'UNKNOWN',
              approved: true,
              credentialed: false,
              operational: false,
              disabled: false,
              capability: 'VIRTUAL_ACCOUNT_PROVISION',
            },
          ],
        });
      return Promise.resolve([]);
    });
    await openWorkspace();
    fireEvent.change(screen.getByLabelText('Institution ID'), {
      target: { value: '11111111-1111-1111-1111-111111111111' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Load' }));
    expect(
      await screen.findByText(/No provider is operational for this institution/i),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Run reconciliation/ })).toBeNull();
  });

  it('states that resolving an exception cannot move money', async () => {
    api.get.mockImplementation((endpoint: string) => {
      if (endpoint.includes('/internal/banking/capabilities')) return Promise.resolve([]);
      if (endpoint.includes('/internal/banking/providers'))
        return Promise.resolve({ registered: ['monnify'], providers: [] });
      if (endpoint.includes('/exceptions'))
        return Promise.resolve([
          {
            id: 'exc-1',
            runId: 'run-1',
            kind: 'PROVIDER_ONLY',
            severity: 'ERROR',
            state: 'OPEN',
            operationReference: 'op-ref-1',
            amountMinor: '150000',
            currency: 'NGN',
            note: null,
            assignedTo: null,
            createdAt: new Date().toISOString(),
            escalatedAt: null,
          },
        ]);
      return Promise.resolve([]);
    });
    api.post.mockResolvedValue({ exceptionId: 'exc-1', resolution: 'ESCALATED' });
    await openWorkspace();
    fireEvent.change(screen.getByLabelText('Institution ID'), {
      target: { value: '11111111-1111-1111-1111-111111111111' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Load' }));
    // Wait for the row itself, not just the static caption, so the click targets a loaded table.
    expect(await screen.findByText('PROVIDER_ONLY')).toBeTruthy();
    expect(screen.getByText(/cannot move, correct\s+or settle money/i)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Record escalation' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(/documents a decision and evidence/i)).toBeTruthy();
  });

  it('reports a permission failure honestly rather than as a generic error', async () => {
    const { ApiError } = jest.requireActual('../src/services/api-client');
    api.get.mockImplementation((endpoint: string) => {
      if (endpoint.includes('/internal/banking/capabilities')) return Promise.resolve([]);
      return Promise.reject(new ApiError('Forbidden', 403));
    });
    await openWorkspace();
    fireEvent.change(screen.getByLabelText('Institution ID'), {
      target: { value: '11111111-1111-1111-1111-111111111111' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Load' }));
    expect(await screen.findByText(/do not have the banking function required/i)).toBeTruthy();
  });
});
