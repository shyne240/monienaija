import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';

import { AgentNetworkScreen } from '../src/screens/authenticated/AgentNetworkScreen';
import { ApiClient } from '../src/services/api-client';
import { useAuthStore } from '../src/store/auth-store';

jest.mock('../src/services/api-client', () => ({
  ApiClient: {
    get: jest.fn(),
    post: jest.fn(),
    patch: jest.fn(),
    put: jest.fn(),
    delete: jest.fn(),
  },
}));

/**
 * V1-AGENT-CLASS-LIFECYCLE-01 — Admin Web class lifecycle surface.
 *
 * These tests exercise the paths that decide whether an operator can be misled:
 *  - readiness must reflect the LIVE gate, and an unreadable projection must say so;
 *  - the impact preview must show withdrawn services and block submission until acknowledged;
 *  - the switch must send the operator's reason and the version it was shown;
 *  - a stale projection for a previous Agent must never land in the new drawer.
 */

const AGENT_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_AGENT_ID = '22222222-2222-4222-8222-222222222222';
const ORDINARY_CLASS = '33333333-3333-4333-8333-333333333333';
const NO_FUNDING_CLASS = '44444444-4444-4444-8444-444444444444';

const CLASSES = [
  {
    id: ORDINARY_CLASS,
    reference: 'CLS-ORD',
    code: 'ORDINARY_L1',
    name: 'Ordinary Level 1',
    isActive: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    applicableServices: ['CASH_IN', 'AGENT_FUNDING'],
  },
  {
    id: NO_FUNDING_CLASS,
    reference: 'CLS-CASHOUT',
    code: 'NO_FUNDING_L1',
    name: 'Cash-Out Only',
    isActive: true,
    createdAt: '2026-02-01T00:00:00.000Z',
    applicableServices: ['CASH_IN'],
  },
];

const agent = (id: string, reference: string, agentClassId: string | null, version = 4) => ({
  id,
  reference,
  status: 'ACTIVE',
  agentClassId,
  agentVersionUnused: undefined,
  version,
  createdAt: '2026-03-01T00:00:00.000Z',
  updatedAt: '2026-03-01T00:00:00.000Z',
});

function setPrincipal(scopes: string[]) {
  useAuthStore.setState({
    isAuthenticated: true,
    isLoading: false,
    token: 'workforce-session-token',
    sessionId: 'session-class-lifecycle',
    error: null,
    principal: {
      type: 'OPERATOR',
      principalId: 'operator-class-lifecycle',
      sessionId: 'session-class-lifecycle',
      roles: ['AGENT_NETWORK_MANAGER'],
      scopes,
      assuranceLevel: 'MFA',
      audience: 'workforce-admin',
      customerAccess: 'NONE',
      agentAccess: 'NONE',
      aggregatorAccess: 'NONE',
    },
  } as never);
}

const readiness = (agentId: string) => ({
  agentId,
  agentStatus: 'ACTIVE',
  agentVersion: 4,
  currentClassId: ORDINARY_CLASS,
  currentClass: {
    id: ORDINARY_CLASS,
    reference: 'CLS-ORD',
    code: 'ORDINARY_L1',
    name: 'Ordinary Level 1',
    isActive: true,
    applicableServices: ['CASH_IN', 'AGENT_FUNDING'],
  },
  // No approved default exists unless a policy/configuration record appoints one; the oldest
  // ACTIVE class does not qualify.
  approvedDefault: null,
  approvedDefaultBasis:
    'No approved Agent class default exists: no policy or configuration record appoints one. An operator must select the class explicitly.',
  allowedServices: ['CASH_IN', 'AGENT_FUNDING'],
  deniedServices: [
    { service: 'CASH_OUT', reason: 'SERVICE_NOT_PERMITTED' },
    { service: 'AGENT_DEFUNDING', reason: 'SERVICE_NOT_PERMITTED' },
  ],
  blockedBy: 'SERVICE_NOT_PERMITTED',
  canOperate: false,
  evaluatedAt: '2026-03-02T09:00:00.000Z',
});

const impact = (agentId: string) => ({
  agentId,
  currentClass: {
    id: ORDINARY_CLASS,
    reference: 'CLS-ORD',
    code: 'ORDINARY_L1',
    name: 'Ordinary Level 1',
    isActive: true,
    applicableServices: ['CASH_IN', 'AGENT_FUNDING'],
  },
  targetClass: {
    id: NO_FUNDING_CLASS,
    reference: 'CLS-CASHOUT',
    code: 'NO_FUNDING_L1',
    name: 'Cash-Out Only',
    isActive: true,
    applicableServices: ['CASH_IN'],
  },
  gains: [],
  losses: [
    {
      service: 'AGENT_FUNDING',
      currentReason: 'ALLOWED',
      targetReason: 'SERVICE_NOT_PERMITTED',
    },
  ],
  unchanged: ['CASH_IN'],
  warnings: ['1 service would be withdrawn from this Agent immediately (AGENT_FUNDING).'],
  blockingReasons: [],
  canSwitch: true,
  writesPerformed: [],
  financialMutations: [],
  readonly: true,
  evaluatedAt: '2026-03-02T09:05:00.000Z',
});

beforeEach(() => {
  jest.resetAllMocks();
  setPrincipal(['agent.view', 'agent.manage_classes', 'agent.review_application']);
});

test('drawer shows live readiness, previews withdrawn services, and submits the governed switch', async () => {
  const switched: any[] = [];
  (ApiClient.get as jest.Mock).mockImplementation((path: string) => {
    if (path.startsWith('/internal/agents?'))
      return Promise.resolve({ data: [agent(AGENT_ID, 'AG-100', ORDINARY_CLASS)], total: 1 });
    if (path === '/internal/agents/classes') return Promise.resolve(CLASSES);
    if (path === `/internal/agents/${AGENT_ID}/financial-position`)
      return Promise.resolve({ agentId: AGENT_ID, walletExists: false });
    if (path === `/internal/agents/${AGENT_ID}/class/readiness`)
      return Promise.resolve(readiness(AGENT_ID));
    if (path === `/internal/agents/${AGENT_ID}/class/history`) return Promise.resolve([]);
    if (path.startsWith(`/internal/agents/${AGENT_ID}/class/impact-preview`))
      return Promise.resolve(impact(AGENT_ID));
    return Promise.resolve([]);
  });
  (ApiClient.post as jest.Mock).mockImplementation((path: string, body: any) => {
    switched.push({ path, body });
    return Promise.resolve({
      agentId: AGENT_ID,
      previousClassId: ORDINARY_CLASS,
      currentClassId: NO_FUNDING_CLASS,
      version: 5,
      changed: true,
      previousClass: CLASSES[0],
      currentClass: CLASSES[1],
      impact: { gains: [], losses: ['AGENT_FUNDING'] },
    });
  });

  render(<AgentNetworkScreen />);
  await screen.findByText('AG-100');
  // Before the catalogue is read the directory shows the raw class id and nothing more — it never
  // invents a name it cannot verify.
  expect(screen.getByTestId(`agent-class-id-${AGENT_ID}`)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'View' }));
  // Opening the drawer resolves the catalogue, so the directory row now carries the real name.
  expect(await screen.findByTestId(`agent-class-name-${AGENT_ID}`)).toBeTruthy();
  expect(screen.queryByTestId(`agent-class-id-${AGENT_ID}`)).toBeNull();

  // Readiness is the live gate, service by service.
  const readinessPanel = await screen.findByTestId('agent-class-readiness');
  expect(within(readinessPanel).getByTestId('agent-class-allowed-CASH_IN')).toBeTruthy();
  expect(
    within(readinessPanel).getByTestId('agent-class-denied-AGENT_DEFUNDING').textContent,
  ).toContain('does not list this service');
  expect(within(readinessPanel).getByText(/did not attempt any operation/)).toBeTruthy();

  // Selecting a target class asks the backend for the read-only impact preview.
  fireEvent.change(await screen.findByLabelText('Target Agent class'), {
    target: { value: NO_FUNDING_CLASS },
  });
  const preview = await screen.findByTestId('agent-class-impact-preview');
  expect(within(preview).getByTestId('agent-class-impact-losses').textContent).toContain(
    'AGENT_FUNDING',
  );
  expect(within(preview).getByText(/Nothing was written/)).toBeTruthy();

  fireEvent.change(screen.getByLabelText('Class change reason'), {
    target: { value: 'Outlet downgraded after review' },
  });
  // Submitting is gated on acknowledging the withdrawal.
  const submit = screen.getByRole('button', { name: 'Reclassify Agent' }) as HTMLButtonElement;
  expect(submit.disabled).toBe(true);
  fireEvent.click(screen.getByLabelText('Acknowledge withdrawn services'));
  await waitFor(() => expect(submit.disabled).toBe(false));
  fireEvent.click(submit);

  await waitFor(() => expect(switched).toHaveLength(1));
  expect(switched[0].path).toBe(`/internal/agents/${AGENT_ID}/class`);
  expect(switched[0].body).toEqual({
    targetClassId: NO_FUNDING_CLASS,
    reason: 'Outlet downgraded after review',
    expectedVersion: 4,
  });
  expect(await screen.findByText('Agent class updated.')).toBeTruthy();
});

test('an unreadable readiness projection says so instead of implying full permission', async () => {
  (ApiClient.get as jest.Mock).mockImplementation((path: string) => {
    if (path.startsWith('/internal/agents?'))
      return Promise.resolve({ data: [agent(AGENT_ID, 'AG-200', ORDINARY_CLASS)], total: 1 });
    if (path === '/internal/agents/classes') return Promise.resolve(CLASSES);
    if (path === `/internal/agents/${AGENT_ID}/financial-position`)
      return Promise.resolve({ agentId: AGENT_ID, walletExists: false });
    if (path === `/internal/agents/${AGENT_ID}/class/readiness`)
      return Promise.reject(new Error('Capability gate unavailable'));
    return Promise.resolve([]);
  });

  render(<AgentNetworkScreen />);
  await screen.findByText('AG-200');
  fireEvent.click(screen.getByRole('button', { name: 'View' }));

  const alert = await screen.findByTestId('agent-class-readiness-error');
  expect(alert.textContent).toContain('Capability gate unavailable');
  expect(alert.textContent).toContain('Nothing is assumed to be permitted');
  expect(screen.queryByTestId('agent-class-readiness')).toBeNull();
});

test('a blocked target class disables the switch and names every blocking reason', async () => {
  (ApiClient.get as jest.Mock).mockImplementation((path: string) => {
    if (path.startsWith('/internal/agents?'))
      return Promise.resolve({ data: [agent(AGENT_ID, 'AG-300', ORDINARY_CLASS)], total: 1 });
    if (path === '/internal/agents/classes') return Promise.resolve(CLASSES);
    if (path === `/internal/agents/${AGENT_ID}/financial-position`)
      return Promise.resolve({ agentId: AGENT_ID, walletExists: false });
    if (path === `/internal/agents/${AGENT_ID}/class/readiness`)
      return Promise.resolve(readiness(AGENT_ID));
    if (path.includes('/class/impact-preview'))
      return Promise.resolve({
        ...impact(AGENT_ID),
        canSwitch: false,
        blockingReasons: ['TARGET_CLASS_INACTIVE'],
        warnings: [],
      });
    return Promise.resolve([]);
  });

  render(<AgentNetworkScreen />);
  await screen.findByText('AG-300');
  fireEvent.click(screen.getByRole('button', { name: 'View' }));
  fireEvent.change(await screen.findByLabelText('Target Agent class'), {
    target: { value: NO_FUNDING_CLASS },
  });
  expect(await screen.findByTestId('agent-class-blocked-TARGET_CLASS_INACTIVE')).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Class change reason'), {
    target: { value: 'Attempt a blocked switch' },
  });
  expect(
    (screen.getByRole('button', { name: 'Reclassify Agent' }) as HTMLButtonElement).disabled,
  ).toBe(true);
  expect(ApiClient.post).not.toHaveBeenCalled();
});

test('a late class projection for the previous Agent never lands in the new drawer', async () => {
  let resolveReadiness: (value: unknown) => void = () => undefined;
  const staleReadiness = new Promise((resolve) => {
    resolveReadiness = resolve;
  });
  (ApiClient.get as jest.Mock).mockImplementation((path: string) => {
    if (path.startsWith('/internal/agents?'))
      return Promise.resolve({
        data: [
          agent(AGENT_ID, 'AG-400', ORDINARY_CLASS),
          agent(OTHER_AGENT_ID, 'AG-401', NO_FUNDING_CLASS),
        ],
        total: 2,
      });
    if (path === '/internal/agents/classes') return Promise.resolve(CLASSES);
    if (path.endsWith('/financial-position'))
      return Promise.resolve({ agentId: OTHER_AGENT_ID, walletExists: false });
    if (path === `/internal/agents/${AGENT_ID}/class/readiness`) return staleReadiness;
    if (path === `/internal/agents/${OTHER_AGENT_ID}/class/readiness`)
      return Promise.resolve({
        ...readiness(OTHER_AGENT_ID),
        currentClassId: NO_FUNDING_CLASS,
        allowedServices: ['CASH_IN'],
        deniedServices: [{ service: 'CASH_OUT', reason: 'SERVICE_NOT_PERMITTED' }],
      });
    return Promise.resolve([]);
  });

  render(<AgentNetworkScreen />);
  await screen.findByText('AG-400');
  const views = screen.getAllByRole('button', { name: 'View' });
  fireEvent.click(views[0]);
  fireEvent.click(views[1]);

  const panel = await screen.findByTestId('agent-class-readiness');
  expect(within(panel).getByTestId('agent-class-allowed-CASH_IN')).toBeTruthy();

  // The first Agent's readiness resolves AFTER the operator moved on; it must be discarded.
  resolveReadiness(readiness(AGENT_ID));
  await waitFor(() =>
    expect(screen.queryByTestId('agent-class-denied-AGENT_DEFUNDING')).toBeNull(),
  );
  expect(screen.getByTestId('agent-class-readiness')).toBeTruthy();
});

test('without agent.manage_classes the console never offers the switch form', async () => {
  setPrincipal(['agent.view']);
  (ApiClient.get as jest.Mock).mockImplementation((path: string) => {
    if (path.startsWith('/internal/agents?'))
      return Promise.resolve({ data: [agent(AGENT_ID, 'AG-500', ORDINARY_CLASS)], total: 1 });
    if (path === '/internal/agents/classes') return Promise.resolve(CLASSES);
    if (path === `/internal/agents/${AGENT_ID}/financial-position`)
      return Promise.resolve({ agentId: AGENT_ID, walletExists: false });
    if (path === `/internal/agents/${AGENT_ID}/class/readiness`)
      return Promise.resolve(readiness(AGENT_ID));
    return Promise.resolve([]);
  });

  render(<AgentNetworkScreen />);
  await screen.findByText('AG-500');
  fireEvent.click(screen.getByRole('button', { name: 'View' }));
  // Reads stay available (SUPPORT/agent.view may investigate)…
  expect(await screen.findByTestId('agent-class-readiness')).toBeTruthy();
  // …but no write surface is rendered.
  expect(screen.queryByLabelText('Target Agent class')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Reclassify Agent' })).toBeNull();
  expect(ApiClient.post).not.toHaveBeenCalled();
});
