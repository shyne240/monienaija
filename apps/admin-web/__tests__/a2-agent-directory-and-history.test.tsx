import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { AgentNetworkScreen } from '../src/screens/authenticated/AgentNetworkScreen';
import { AgentUnifiedHistoryPanel } from '../src/components/AgentUnifiedHistoryPanel';
import { ApiClient } from '../src/services/api-client';
import { useAuthStore } from '../src/store/auth-store';

jest.mock('../src/services/api-client', () => ({
  ApiClient: { get: jest.fn(), post: jest.fn(), patch: jest.fn() },
}));

const get = ApiClient.get as jest.Mock;
const classId = '10234567-89ab-4def-8111-123456789abc';
const aggregatorId = '10234567-89ab-4def-8222-123456789abc';
const onPage = agent('10234567-89ab-4def-8333-123456789abc', 'DIRECTORY-FIRST');
const offPage = agent('10234567-89ab-4def-8444-123456789abc', 'AGENT-OFF-PAGE');
function agent(id: string, reference: string) {
  return {
    id,
    reference,
    status: 'ACTIVE',
    agentClassId: classId,
    createdAt: '2026-11-20T12:00:00Z',
  };
}
function list(page: number, data = [onPage], total = 21) {
  return { page, limit: 20, data, total };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
function session(scopes: string[]) {
  useAuthStore.setState({
    isAuthenticated: true,
    token: 'fixture',
    sessionId: 'fixture',
    principal: {
      type: 'OPERATOR',
      principalId: 'fixture',
      sessionId: 'fixture',
      audience: 'workforce-admin',
      roles: ['AGENT_NETWORK_MANAGER'],
      scopes,
      customerAccess: 'NONE',
      assuranceLevel: 'MFA',
    },
  });
}
const application = {
  id: 'app-a2',
  reference: 'APP-A2',
  applicantReference: offPage.reference,
  status: 'APPROVED',
  agentId: offPage.id,
  agentClassId: classId,
};
const outlet = {
  id: 'outlet-a2',
  agentId: onPage.id,
  reference: 'KANO-OUTLET',
  name: 'Synthetic kiosk',
  status: 'ACTIVE',
  version: 1,
};
const terminal = {
  id: 'terminal-a2',
  agentId: onPage.id,
  outletId: outlet.id,
  reference: 'TERMINAL-A2',
  status: 'ACTIVE',
  version: 3,
};
beforeEach(() => {
  jest.resetAllMocks();
  session([
    'agent.view',
    'agent.review_application',
    'agent.activate',
    'agent.manage_outlets_terminals',
  ]);
});

test('search composes encoded server filters, resets the page, and ignores a stale page response', async () => {
  const pageTwo = deferred<ReturnType<typeof list>>();
  get.mockImplementation((url: string) => {
    const params = new URL(url, 'http://fixture').searchParams;
    if (params.get('page') === '2') return pageTwo.promise;
    if (params.has('search')) return Promise.resolve(list(1, [offPage], 1));
    return Promise.resolve(list(1));
  });
  render(<AgentNetworkScreen />);
  await screen.findByText(onPage.reference);
  fireEvent.click(screen.getByRole('button', { name: 'Next' }));
  fireEvent.change(screen.getByLabelText('Agent reference or ID'), {
    target: { value: ' an & _agent ' },
  });
  fireEvent.change(screen.getByLabelText('Agent class ID'), { target: { value: classId } });
  fireEvent.change(screen.getByLabelText('Aggregator ID (active assignments)'), {
    target: { value: aggregatorId },
  });
  fireEvent.change(screen.getByLabelText('Sort agents'), { target: { value: 'oldest' } });
  fireEvent.click(screen.getByRole('button', { name: 'Search agents' }));
  await screen.findByText(offPage.reference);
  expect(get).toHaveBeenCalledWith(
    `/internal/agents?page=1&limit=20&search=an+%26+_agent&agentClassId=${classId}&aggregatorId=${aggregatorId}&sort=oldest`,
  );
  await act(async () => pageTwo.resolve(list(2)));
  expect(screen.queryByText(onPage.reference)).toBeNull();
  expect((screen.getByRole('button', { name: 'Next' }) as HTMLButtonElement).disabled).toBe(true);
});

test('review queue opens an off-page Agent and only offers activation for a confirmed pending link', async () => {
  let linkedAgentStatus = 'PENDING';
  get.mockImplementation(async (path: string) => {
    if (path.startsWith('/internal/agents?')) return list(1);
    if (path === '/internal/agents/applications') return [{ ...application, linkedAgentStatus }];
    if (path === `/internal/agents/${offPage.id}`) return { ...offPage, status: linkedAgentStatus };
    if (path.endsWith('/financial-position')) return { agentId: offPage.id, walletExists: false };
    throw new Error(`Unexpected request ${path}`);
  });
  (ApiClient.post as jest.Mock).mockImplementation(async () => {
    linkedAgentStatus = 'ACTIVE';
    return offPage;
  });
  render(<AgentNetworkScreen initialOpenApplications />);
  fireEvent.click(await screen.findByRole('button', { name: 'Activate agent' }));
  await screen.findByText(/activated as Agent/);
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Activate agent' })).toBeNull());
  fireEvent.click(screen.getByRole('button', { name: 'Open agent' }));
  expect(
    await within(await screen.findByRole('dialog', { name: 'Agent details' })).findByText(
      offPage.reference,
    ),
  ).toBeTruthy();
  expect(get).toHaveBeenCalledWith(`/internal/agents/${offPage.id}`);
});

test.each([
  [403, 'You are not entitled to view this Agent.'],
  [404, 'Agent not found.'],
])('direct navigation surfaces %s without opening another Agent', async (status, text) => {
  get.mockImplementation(async (path: string) => {
    if (path.startsWith('/internal/agents?')) return list(1);
    throw Object.assign(new Error('Detail read failed'), { status });
  });
  render(<AgentNetworkScreen initialAgentId={offPage.id} />);
  expect(await screen.findByText(text)).toBeTruthy();
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(get.mock.calls.some(([path]) => path.endsWith('/financial-position'))).toBe(false);
});

test('a later selection supersedes an in-flight direct lookup', async () => {
  const older = deferred<typeof offPage>();
  get.mockImplementation((path: string) => {
    if (path.startsWith('/internal/agents?')) return Promise.resolve(list(1));
    if (path === `/internal/agents/${offPage.id}`) return older.promise;
    if (path.endsWith('/financial-position'))
      return Promise.resolve({ agentId: onPage.id, walletExists: false });
    return Promise.reject(new Error(path));
  });
  render(<AgentNetworkScreen initialAgentId={offPage.id} />);
  fireEvent.click(await screen.findByRole('button', { name: 'View' }));
  await act(async () => older.resolve(offPage));
  const dialog = within(screen.getByRole('dialog', { name: 'Agent details' }));
  expect(dialog.getByText(onPage.reference)).toBeTruthy();
  expect(dialog.queryByText(offPage.reference)).toBeNull();
  expect(get).not.toHaveBeenCalledWith(`/internal/agents/${offPage.id}/financial-position`);
});

test('directory and direct lookup are both suppressed without agent.view', () => {
  session(['agent.review_application']);
  render(<AgentNetworkScreen initialAgentId={offPage.id} />);
  expect(screen.getByTestId('agent-directory-not-entitled')).toBeTruthy();
  expect(get).not.toHaveBeenCalled();
});

test('outlet drill-down reads assigned terminals and rejects a mismatched parent', async () => {
  get.mockImplementation(async (path: string) => {
    if (path.startsWith('/internal/agents?')) return list(1);
    if (path.endsWith('/financial-position')) return { agentId: onPage.id, walletExists: false };
    if (
      path === `/internal/agents/${onPage.id}/outlets` ||
      path === `/internal/outlets/${outlet.id}`
    )
      return path.endsWith('/outlets') ? [outlet] : outlet;
    if (path === `/internal/agents/${onPage.id}/terminals`) return [terminal];
    if (path === `/internal/outlets/${outlet.id}/terminals`) return [terminal];
    if (path === `/internal/terminals/${terminal.id}`)
      return { ...terminal, outletId: 'different-outlet' };
    throw new Error(path);
  });
  render(<AgentNetworkScreen />);
  fireEvent.click(await screen.findByRole('button', { name: 'View' }));
  fireEvent.click(screen.getByRole('button', { name: 'Load outlets & terminals' }));
  fireEvent.click(
    await screen.findByRole('button', { name: `Inspect outlet ${outlet.reference}` }),
  );
  expect(
    await within(screen.getByRole('region', { name: 'Outlet record details' })).findByText(
      'TERMINAL-A2 · ACTIVE',
    ),
  ).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: `Inspect terminal ${terminal.reference}` }));
  const details = within(screen.getByRole('region', { name: 'Terminal record details' }));
  expect((await details.findByRole('alert')).textContent).toContain(
    'Terminal details did not match',
  );
  expect(ApiClient.post).not.toHaveBeenCalled();
});

test('both transfer types use the history API filter; changing type resets paging and denial is explicit', async () => {
  get.mockImplementation(async (url: string) => {
    const params = new URL(url, 'http://fixture').searchParams;
    const page = Number(params.get('page'));
    const type = params.get('type');
    if (type === 'EXTERNAL_BANK_TRANSFER') {
      if (page === 2) throw Object.assign(new Error('denied'), { status: 403 });
      return {
        items: [],
        pagination: { page, limit: 20, total: 21, totalPages: 2, hasNextPage: true },
      };
    }
    return {
      items: [
        {
          id: `ref-${page}`,
          reference: `TRANSFER-PAGE-${page}`,
          type,
          status: 'COMPLETED',
          direction: 'DEBIT',
          amountMinor: '1200',
          currency: 'NGN',
          createdAt: '2026-11-20T00:00:00Z',
        },
      ],
      pagination: { page, limit: 20, total: 21, totalPages: 2, hasNextPage: page === 1 },
    };
  });
  render(<AgentUnifiedHistoryPanel agentId={offPage.id} canViewAgent />);
  const filter = screen.getByLabelText('Unified history service filter');
  fireEvent.change(filter, { target: { value: 'WALLET_TRANSFER' } });
  fireEvent.click(screen.getByRole('button', { name: 'Load unified stream' }));
  await screen.findByText('TRANSFER-PAGE-1');
  fireEvent.click(screen.getByRole('button', { name: 'Next' }));
  await screen.findByText('TRANSFER-PAGE-2');
  expect(get).toHaveBeenCalledWith(
    `/internal/agents/${offPage.id}/transactions?page=2&limit=20&type=WALLET_TRANSFER`,
  );
  fireEvent.change(filter, { target: { value: 'EXTERNAL_BANK_TRANSFER' } });
  await screen.findByTestId('agent-unified-history-empty');
  expect(get).toHaveBeenCalledWith(
    `/internal/agents/${offPage.id}/transactions?page=1&limit=20&type=EXTERNAL_BANK_TRANSFER`,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Next' }));
  await screen.findByTestId('agent-unified-history-forbidden');
  expect(screen.queryByText('TRANSFER-PAGE-2')).toBeNull();
});

test('suspended outlets are not offered for creation or terminal reactivation', async () => {
  get.mockImplementation(async (path: string) => {
    if (path.startsWith('/internal/agents?')) return list(1);
    if (path.endsWith('/financial-position')) return { agentId: onPage.id, walletExists: false };
    if (path.endsWith('/outlets')) return [{ ...outlet, status: 'SUSPENDED' }];
    if (path.endsWith('/terminals')) return [{ ...terminal, status: 'SUSPENDED' }];
    throw new Error(path);
  });
  render(<AgentNetworkScreen />);
  fireEvent.click(await screen.findByRole('button', { name: 'View' }));
  fireEvent.click(screen.getByRole('button', { name: 'Load outlets & terminals' }));
  const reactivate = await screen.findByRole('button', { name: 'Reactivate terminal' });
  expect((reactivate as HTMLButtonElement).disabled).toBe(true);
  expect(screen.queryByRole('button', { name: 'Create terminal' })).toBeNull();
  expect(screen.getByText('Create an active outlet before adding a terminal.')).toBeTruthy();
  fireEvent.click(reactivate);
  expect(ApiClient.post).not.toHaveBeenCalled();
});

test('an explicit aggregator context selects the relationship-gated outlet creation API', async () => {
  get.mockImplementation(async (path: string) => {
    if (path.startsWith('/internal/agents?')) return list(1);
    if (path.endsWith('/financial-position')) return { agentId: onPage.id, walletExists: false };
    if (path.endsWith('/outlets') || path.endsWith('/terminals')) return [];
    throw new Error(path);
  });
  (ApiClient.post as jest.Mock).mockResolvedValue({
    ...outlet,
    code: null,
    displayName: null,
    city: null,
    state: null,
    country: 'NG',
    addressLine: null,
  });
  render(<AgentNetworkScreen />);
  fireEvent.click(await screen.findByRole('button', { name: 'View' }));
  fireEvent.click(screen.getByRole('button', { name: 'Load outlets & terminals' }));
  const form = within(await screen.findByRole('form', { name: 'Create outlet form' }));
  fireEvent.change(form.getByLabelText('Outlet reference'), {
    target: { value: outlet.reference },
  });
  fireEvent.change(form.getByLabelText('Outlet name'), { target: { value: outlet.name } });
  const context = form.getByLabelText(/Outlet aggregator ID/);
  fireEvent.change(context, { target: { value: 'bad-aggregator' } });
  fireEvent.click(form.getByRole('button', { name: 'Create outlet' }));
  expect(await screen.findByText('Aggregator ID must be a UUID.')).toBeTruthy();
  expect(ApiClient.post).not.toHaveBeenCalled();
  fireEvent.change(context, { target: { value: aggregatorId } });
  fireEvent.click(form.getByRole('button', { name: 'Create outlet' }));
  expect(await screen.findByText(`Outlet ${outlet.reference} created.`)).toBeTruthy();
  expect(ApiClient.post).toHaveBeenCalledWith(
    `/internal/aggregators/${aggregatorId}/agents/${onPage.id}/outlets`,
    {
      reference: outlet.reference,
      name: outlet.name,
    },
  );
});

test('late receiving-number data cannot appear in another Agent drawer', async () => {
  const previous = deferred<{ agentId: string; receivingNumber: string; status: string }>();
  get.mockImplementation(async (path: string) => {
    if (path.startsWith('/internal/agents?')) return list(1, [onPage, offPage], 2);
    if (path.endsWith('/financial-position'))
      return { agentId: path.split('/')[3], walletExists: false };
    if (path === `/internal/agents/${onPage.id}/receiving-number`) return previous.promise;
    if (path === `/internal/agents/${offPage.id}/receiving-number`)
      return { agentId: offPage.id, receivingNumber: '8222222222', status: 'ACTIVE' };
    throw new Error(path);
  });
  render(<AgentNetworkScreen />);
  const view = (reference: string) =>
    within(screen.getByText(reference).closest('tr')!).getByRole('button', { name: 'View' });
  await screen.findByText(onPage.reference);
  fireEvent.click(view(onPage.reference));
  fireEvent.click(screen.getByRole('button', { name: 'Load receiving number' }));
  fireEvent.click(screen.getByRole('button', { name: 'Close' }));
  fireEvent.click(view(offPage.reference));
  fireEvent.click(screen.getByRole('button', { name: 'Load receiving number' }));
  await screen.findByText('8222222222');
  await act(async () =>
    previous.resolve({ agentId: onPage.id, receivingNumber: '8111111111', status: 'ACTIVE' }),
  );
  expect(screen.queryByText('8111111111')).toBeNull();
  expect(screen.getByText('8222222222')).toBeTruthy();
});

test('an estate response with a terminal outside the Agent’s listed outlets fails closed', async () => {
  get.mockImplementation(async (path: string) => {
    if (path.startsWith('/internal/agents?')) return list(1);
    if (path.endsWith('/financial-position')) return { agentId: onPage.id, walletExists: false };
    if (path.endsWith('/outlets')) return [outlet];
    if (path.endsWith('/terminals')) return [{ ...terminal, outletId: 'foreign-parent' }];
    throw new Error(path);
  });
  render(<AgentNetworkScreen />);
  fireEvent.click(await screen.findByRole('button', { name: 'View' }));
  fireEvent.click(screen.getByRole('button', { name: 'Load outlets & terminals' }));
  await screen.findByText(/outside the selected Agent’s estate/);
  expect(screen.queryByRole('button', { name: 'Create terminal' })).toBeNull();
  expect(screen.queryByText(terminal.reference)).toBeNull();
});

test('refreshing an ineligible parent does not silently reassign a terminal draft', async () => {
  let refreshed = false;
  const otherOutlet = { ...outlet, id: 'other-outlet', reference: 'OTHER-OUTLET' };
  get.mockImplementation(async (path: string) => {
    if (path.startsWith('/internal/agents?')) return list(1);
    if (path.endsWith('/financial-position')) return { agentId: onPage.id, walletExists: false };
    if (path.endsWith('/outlets'))
      return refreshed ? [{ ...outlet, status: 'SUSPENDED' }, otherOutlet] : [outlet];
    if (path.endsWith('/terminals')) return [];
    throw new Error(path);
  });
  render(<AgentNetworkScreen />);
  fireEvent.click(await screen.findByRole('button', { name: 'View' }));
  fireEvent.click(screen.getByRole('button', { name: 'Load outlets & terminals' }));
  fireEvent.change(await screen.findByLabelText('Terminal reference'), {
    target: { value: 'DRAFT-TERMINAL' },
  });
  refreshed = true;
  fireEvent.click(screen.getByRole('button', { name: 'Refresh outlets & terminals' }));
  expect(((await screen.findByLabelText('Terminal outlet')) as HTMLSelectElement).value).toBe('');
  expect((screen.getByLabelText('Terminal reference') as HTMLInputElement).value).toBe(
    'DRAFT-TERMINAL',
  );
  fireEvent.click(screen.getByRole('button', { name: 'Create terminal' }));
  expect(ApiClient.post).not.toHaveBeenCalled();
  await screen.findByText(/an outlet selection are required/);
});
