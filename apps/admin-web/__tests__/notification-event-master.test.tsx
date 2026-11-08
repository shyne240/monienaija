import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react';
import { NotificationManagementScreen } from '../src/screens/authenticated/NotificationManagementScreen';
import { ApiClient, ApiError } from '../src/services/api-client';
import { NotificationManagementApi } from '../src/services/notification-management-api';
import { useAuthStore } from '../src/store/auth-store';
import type { WorkforcePrincipal } from '../src/store/auth-store';

jest.mock('../src/services/api-client', () => {
  class MockApiError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.name = 'ApiError';
      this.status = status;
    }
  }
  return {
    ApiClient: {
      get: jest.fn(),
      post: jest.fn(),
      patch: jest.fn(),
      put: jest.fn(),
      delete: jest.fn(),
    },
    ApiError: MockApiError,
  };
});

type Target = 'EVENT' | 'SMS' | 'EMAIL';
type Status = 'REQUESTED' | 'APPROVED' | 'CONSUMED' | 'REJECTED' | 'CANCELLED' | 'EXPIRED';
interface ConfigurationPayload {
  type: 'CONFIGURATION';
  eventType: string;
  channel: Target;
  enabled: boolean;
  expectedVersion: number;
  reason: string;
}
type PostCall = [endpoint: string, body?: unknown, options?: { idempotencyKey?: string }];
const postCalls = (): PostCall[] => (ApiClient.post as jest.Mock<unknown, PostCall>).mock.calls;
const configurationBody = (call: PostCall): ConfigurationPayload => call[1] as ConfigurationPayload;
interface ChannelState {
  enabled: boolean;
  locked: boolean;
  configurationVersion: number;
  activeTemplateVersion: number | null;
}
interface RegistryEvent {
  eventType: string;
  deliveryClass: 'TRANSACTIONAL' | 'INFORMATIONAL' | 'SECURITY';
  editable: boolean;
  variables: string[];
  eventEnabled?: boolean;
  eventLocked?: boolean;
  eventConfigurationVersion?: number;
  channels: { SMS: ChannelState; EMAIL: ChannelState };
}
interface Proposal {
  approvalId: string;
  change: {
    type: 'CONFIGURATION';
    eventType: string;
    channel: Target;
    enabled: boolean;
    expectedVersion: number;
  };
  reason: string;
  createdBy: string;
  createdAt: string;
  status: Status;
  approvedBy: string | null;
}

const A = 'customer.funding.approved';
const B = 'transfer.completed';
const C = 'support.ticket.assigned';
const D = 'cash_to_cash.created';
const E = 'customer.funding.requested';
const SECURITY = 'agent.desk.customer_otp';
const financialEvents = [
  'customer.funding.requested',
  'customer.funding.approved',
  'customer.funding.rejected',
  'deposit.completed',
  'deposit.failed',
  'withdrawal.completed',
  'withdrawal.failed',
  'transfer.completed',
  'transfer.failed',
  'transfer.unknown',
  'cash_to_cash.created',
  'cash_to_cash.claimed',
  'cash_to_cash.expired',
];
const makerId = 'issuer:configuration-maker';
const checkerId = 'issuer:independent-checker';
const reason = 'Pause this event during the maintenance window';

function channel(enabled: boolean, configurationVersion: number, locked = false): ChannelState {
  return { enabled, locked, configurationVersion, activeTemplateVersion: 1 };
}

function ordinary(
  eventType: string,
  eventEnabled: boolean,
  smsEnabled: boolean,
  emailEnabled: boolean,
): RegistryEvent {
  return {
    eventType,
    deliveryClass:
      eventType.startsWith('support.') || eventType.startsWith('cash_to_cash.')
        ? 'INFORMATIONAL'
        : 'TRANSACTIONAL',
    editable: true,
    variables: ['reference'],
    eventEnabled,
    eventLocked: false,
    eventConfigurationVersion: 7,
    channels: { SMS: channel(smsEnabled, 3), EMAIL: channel(emailEnabled, 5) },
  };
}

function registryFixtures(): RegistryEvent[] {
  return [
    ordinary(A, true, true, false),
    ordinary(B, true, false, true),
    ordinary(C, true, true, true),
    ordinary(D, true, false, false),
    ordinary(E, false, true, true),
    {
      eventType: SECURITY,
      deliveryClass: 'SECURITY',
      editable: false,
      variables: [],
      channels: { SMS: channel(true, 1, true), EMAIL: channel(false, 1, true) },
    },
  ];
}

function seedPrincipal(
  options: {
    principalId?: string;
    type?: string;
    roles?: string[];
    scopes?: string[];
    assuranceLevel?: string;
    customerAccess?: string;
    readOnlyPrincipal?: boolean;
  } = {},
) {
  const principal: WorkforcePrincipal = {
    type: (options.type ?? 'OPERATOR') as WorkforcePrincipal['type'],
    principalId: options.principalId ?? makerId,
    sessionId: 'notification-test-session',
    audience: 'workforce-admin',
    roles: options.roles ?? ['SUPER_ADMIN'],
    scopes: options.scopes ?? ['notification.view_deliveries'],
    customerAccess: options.customerAccess ?? 'NONE',
    assuranceLevel: options.assuranceLevel ?? 'MFA',
    readOnlyPrincipal: options.readOnlyPrincipal,
  };
  useAuthStore.setState({
    isAuthenticated: true,
    isLoading: false,
    token: 'synthetic-test-token',
    sessionId: principal.sessionId,
    principal,
    error: null,
  });
}

function seedChecker(principalId = checkerId) {
  seedPrincipal({
    principalId,
    roles: ['FINANCE_CONTROLLER'],
    scopes: ['notification.view_deliveries', 'privileged:approve'],
  });
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** Stateful contract fake: proposals do not mutate registry rows until a distinct checker executes. */
function installRegistryBackend() {
  const server: {
    events: RegistryEvent[];
    proposals: Proposal[];
    registryUnavailable: boolean;
    queueUnavailable: boolean;
    createError: { channel: Target; status: number; message: string } | null;
    executeError: { status: number; message: string } | null;
  } = {
    events: registryFixtures(),
    proposals: [],
    registryUnavailable: false,
    queueUnavailable: false,
    createError: null,
    executeError: null,
  };

  const eventFor = (eventType: string) =>
    server.events.find((item) => item.eventType === eventType);
  const currentTarget = (event: RegistryEvent, target: Target) =>
    target === 'EVENT'
      ? {
          enabled: event.eventEnabled,
          locked: event.eventLocked,
          version: event.eventConfigurationVersion,
        }
      : {
          enabled: event.channels[target].enabled,
          locked: event.channels[target].locked,
          version: event.channels[target].configurationVersion,
        };
  const listRow = (proposal: Proposal) => ({
    approvalId: proposal.approvalId,
    type: proposal.change.type,
    eventType: proposal.change.eventType,
    channel: proposal.change.channel,
    createdBy: proposal.createdBy,
    createdAt: proposal.createdAt,
    status: proposal.status,
    approvedBy: proposal.approvedBy,
    expiresAt: null,
  });

  (ApiClient.get as jest.Mock).mockImplementation((endpoint: string) =>
    Promise.resolve().then(() => {
      if (endpoint === '/internal/notifications/events') {
        if (server.registryUnavailable) throw new ApiError('Registry unavailable', 404);
        return { items: clone(server.events) };
      }
      if (endpoint.startsWith('/internal/notifications/changes/')) {
        const approvalId = decodeURIComponent(endpoint.split('/').pop() ?? '');
        const proposal = server.proposals.find((item) => item.approvalId === approvalId);
        if (!proposal) throw new ApiError('Not Found', 404);
        return {
          ...clone(proposal),
          requestedBy: proposal.createdBy,
          expiresAt: null,
        };
      }
      if (endpoint.startsWith('/internal/notifications/changes')) {
        if (server.queueUnavailable) throw new ApiError('Approval queue unavailable', 503);
        return { page: 1, limit: 25, hasMore: false, items: server.proposals.map(listRow) };
      }
      if (endpoint.startsWith('/internal/notifications/provider-status')) {
        return {
          projectionScope: 'MINIMAL',
          channels: ['SMS', 'EMAIL'],
          sms: { available: true },
          email: { available: true },
        };
      }
      if (
        endpoint.startsWith('/internal/notifications/deliveries?') ||
        endpoint.startsWith('/internal/notifications/outbox-receipts?')
      ) {
        return { data: [], total: 0, page: 1, limit: 20, totalPages: 0, hasNextPage: false };
      }
      return [];
    }),
  );

  (ApiClient.post as jest.Mock).mockImplementation(
    (endpoint: string, body?: ConfigurationPayload) =>
      Promise.resolve().then(() => {
        const principal = useAuthStore.getState().principal;
        if (endpoint === '/internal/notifications/changes') {
          if (!body) throw new ApiError('Missing configuration proposal', 400);
          if (
            !principal ||
            !principal.roles.includes('SUPER_ADMIN') ||
            !principal.scopes.includes('notification.view_deliveries') ||
            principal.assuranceLevel !== 'MFA' ||
            principal.readOnlyPrincipal ||
            principal.customerAccess !== 'NONE'
          )
            throw new ApiError('Maker denied', 403);
          if (server.createError && server.createError.channel === body.channel) {
            throw new ApiError(server.createError.message, server.createError.status);
          }
          const event = eventFor(body.eventType);
          if (!event || !event.editable || event.deliveryClass === 'SECURITY') {
            throw new ApiError('Configuration locked', 403);
          }
          const target = currentTarget(event, body.channel);
          if (target.locked !== false) throw new ApiError('Configuration locked', 403);
          if (target.version !== body.expectedVersion)
            throw new ApiError('Configuration version has changed', 409);
          const approvalId = `550e8400-e29b-41d4-a716-${String(server.proposals.length + 1).padStart(12, '0')}`;
          const proposal: Proposal = {
            approvalId,
            change: {
              type: 'CONFIGURATION',
              eventType: body.eventType,
              channel: body.channel,
              enabled: body.enabled,
              expectedVersion: body.expectedVersion,
            },
            reason: body.reason,
            createdBy: principal.principalId,
            createdAt: '2026-11-02T10:00:00.000Z',
            status: 'REQUESTED',
            approvedBy: null,
          };
          server.proposals.unshift(proposal);
          return { approvalId, status: 'REQUESTED', requestedAt: proposal.createdAt };
        }
        const approvalMatch = endpoint.match(
          /^\/internal\/a2\/workforce\/approvals\/([^/]+)\/(approve|reject)$/,
        );
        if (approvalMatch) {
          const proposal = server.proposals.find((item) => item.approvalId === approvalMatch[1]);
          if (
            !proposal ||
            !principal ||
            !principal.roles.includes('FINANCE_CONTROLLER') ||
            !principal.scopes.includes('privileged:approve') ||
            principal.assuranceLevel !== 'MFA' ||
            principal.readOnlyPrincipal ||
            proposal.createdBy === principal.principalId
          ) {
            throw new ApiError('Checker denied', 403);
          }
          if (proposal.status !== 'REQUESTED') throw new ApiError('Invalid approval status', 409);
          proposal.status = approvalMatch[2] === 'approve' ? 'APPROVED' : 'REJECTED';
          proposal.approvedBy = principal.principalId;
          return { approved: proposal.status === 'APPROVED', reason: proposal.status, approval: { id: proposal.approvalId, status: proposal.status } };
        }
        const executeMatch = endpoint.match(
          /^\/internal\/notifications\/changes\/([^/]+)\/execute$/,
        );
        if (executeMatch) {
          const proposal = server.proposals.find((item) => item.approvalId === executeMatch[1]);
          if (
            !proposal ||
            !principal ||
            proposal.status !== 'APPROVED' ||
            proposal.approvedBy !== principal.principalId ||
            proposal.createdBy === principal.principalId ||
            !principal.roles.includes('FINANCE_CONTROLLER') ||
            !principal.scopes.includes('privileged:approve') ||
            principal.assuranceLevel !== 'MFA' ||
            principal.readOnlyPrincipal
          ) {
            throw new ApiError('Execution denied', 403);
          }
          if (server.executeError)
            throw new ApiError(server.executeError.message, server.executeError.status);
          const event = eventFor(proposal.change.eventType)!;
          const target = currentTarget(event, proposal.change.channel);
          if (target.locked !== false) throw new ApiError('Configuration locked', 403);
          if (target.version !== proposal.change.expectedVersion) {
            throw new ApiError('Configuration version has changed', 409);
          }
          if (proposal.change.channel === 'EVENT') {
            event.eventEnabled = proposal.change.enabled;
            event.eventConfigurationVersion! += 1;
          } else {
            event.channels[proposal.change.channel].enabled = proposal.change.enabled;
            event.channels[proposal.change.channel].configurationVersion += 1;
          }
          proposal.status = 'CONSUMED';
          return { approvalId: proposal.approvalId, type: proposal.change.type };
        }
        throw new ApiError('Not Found', 404);
      }),
  );
  (ApiClient.patch as jest.Mock).mockRejectedValue(new ApiError('Method Not Allowed', 405));
  (ApiClient.put as jest.Mock).mockRejectedValue(new ApiError('Method Not Allowed', 405));
  return server;
}

type View = ReturnType<typeof render>;
async function ready(view: View) {
  await waitFor(() =>
    expect(
      (view.getByTestId('refresh-notifications-console-btn') as HTMLButtonElement).disabled,
    ).toBe(false),
  );
}
async function openEvent(view: View, eventType = A) {
  await ready(view);
  const button = view.getByTestId(`configure-trigger-${eventType}`) as HTMLButtonElement;
  expect(button.disabled).toBe(false);
  fireEvent.click(button);
  expect(view.getByTestId('event-trigger-config-panel')).toBeTruthy();
}
function submitReason(view: View) {
  fireEvent.change(view.getByTestId('trigger-reason-input'), { target: { value: reason } });
  fireEvent.click(view.getByTestId('submit-trigger-config-btn'));
}
async function approve(view: View, approvalId: string) {
  await waitFor(() =>
    expect((view.getByTestId(`approve-change-${approvalId}`) as HTMLButtonElement).disabled).toBe(
      false,
    ),
  );
  fireEvent.click(view.getByTestId(`approve-change-${approvalId}`));
  await waitFor(() =>
    expect(view.getByTestId(`change-request-row-${approvalId}`).textContent).toContain('APPLIED'),
  );
  expect(view.getByTestId('checker-feedback-success').textContent).toMatch(/executed/i);
  await ready(view);
}

describe('H-04/H-06 — versioned event-master controls', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('shows disabled, SMS-only, Email-only, both and neither without treating saved channels as delivery guarantees', async () => {
    installRegistryBackend();
    seedPrincipal();
    const view = render(<NotificationManagementScreen initialTab="events" />);
    await ready(view);
    expect(view.getByTestId(`effective-channels-${A}`).textContent).toBe('SMS only');
    expect(view.getByTestId(`effective-channels-${B}`).textContent).toBe('Email only');
    expect(view.getByTestId(`effective-channels-${C}`).textContent).toBe('SMS and Email');
    expect(view.getByTestId(`effective-channels-${D}`).textContent).toBe('Neither channel');
    expect(view.getByTestId(`effective-channels-${E}`).textContent).toBe('Event disabled');
    expect(view.getByTestId(`saved-sms-${E}`).textContent).toBe('ENABLED');
    expect(view.getByTestId(`saved-email-${E}`).textContent).toBe('ENABLED');
    expect(view.getByTestId(`effective-channels-${SECURITY}`).textContent).toBe(
      'Managed separately',
    );
    expect(view.getByTestId('notif-panel-events').textContent).toMatch(/not a delivery guarantee/i);
    await act(() => {
      fireEvent.click(view.getByTestId('notif-tab-overview'));
      return Promise.resolve();
    });
    const overview = view.getByTestId('notif-panel-overview').textContent ?? '';
    expect(overview).toContain('Ordinary events with SMS gate enabled: 2 / 5 with known state');
    expect(overview).toContain('Ordinary events with Email gate enabled: 2 / 5 with known state');
  });

  test('exposes all three unlocked controls for every owner-approved financial event', async () => {
    const server = installRegistryBackend();
    server.events = financialEvents.map((eventType) => ordinary(eventType, true, true, false));
    seedPrincipal();
    const view = render(<NotificationManagementScreen initialTab="events" />);
    await ready(view);
    for (const eventType of financialEvents) {
      await openEvent(view, eventType);
      expect((view.getByTestId('toggle-event-enabled-checkbox') as HTMLInputElement).disabled).toBe(
        false,
      );
      expect((view.getByTestId('toggle-sms-enabled-checkbox') as HTMLInputElement).disabled).toBe(
        false,
      );
      expect((view.getByTestId('toggle-email-enabled-checkbox') as HTMLInputElement).disabled).toBe(
        false,
      );
      fireEvent.click(view.getByRole('button', { name: 'Close' }));
    }
    expect(ApiClient.post).not.toHaveBeenCalled();
  });

  test('disables and re-enables only the EVENT target after independent approval and execution, preserving channels and other events', async () => {
    const server = installRegistryBackend();
    const unrelatedBefore = clone(server.events.find((event) => event.eventType === B));
    seedPrincipal();
    const maker = render(<NotificationManagementScreen initialTab="events" />);
    await openEvent(maker);
    const registryReads = (ApiClient.get as jest.Mock).mock.calls.filter(
      ([url]) => url === '/internal/notifications/events',
    ).length;
    expect((maker.getByTestId('toggle-event-enabled-checkbox') as HTMLInputElement).checked).toBe(
      true,
    );
    fireEvent.click(maker.getByTestId('toggle-event-enabled-checkbox'));
    submitReason(maker);
    expect(await maker.findByTestId('trigger-submit-success')).toBeTruthy();
    expect(server.proposals).toHaveLength(1);
    expect(server.proposals[0].change).toEqual({
      type: 'CONFIGURATION',
      eventType: A,
      channel: 'EVENT',
      enabled: false,
      expectedVersion: 7,
    });
    expect(
      (ApiClient.get as jest.Mock).mock.calls.filter(
        ([url]) => url === '/internal/notifications/events',
      ),
    ).toHaveLength(registryReads);
    expect(server.events[0].eventEnabled).toBe(true);
    expect(maker.getByTestId(`event-master-${A}`).textContent).toBe('ENABLED');
    expect(maker.getByTestId(`event-pending-${A}`).textContent).toContain(
      'EVENT: disable — Pending approval',
    );
    const disableId = server.proposals[0].approvalId;
    maker.unmount();

    seedChecker();
    const checker = render(<NotificationManagementScreen initialTab="approvals" />);
    await approve(checker, disableId);
    expect(server.events[0].eventEnabled).toBe(false);
    expect(server.events[0].eventConfigurationVersion).toBe(8);
    expect(server.events[0].channels.SMS.enabled).toBe(true);
    expect(server.events[0].channels.EMAIL.enabled).toBe(false);
    fireEvent.click(checker.getByTestId('notif-tab-events'));
    expect(checker.getByTestId(`effective-channels-${A}`).textContent).toBe('Event disabled');
    expect(checker.getByTestId(`saved-sms-${A}`).textContent).toBe('ENABLED');
    checker.unmount();

    seedPrincipal();
    const makerAgain = render(<NotificationManagementScreen initialTab="events" />);
    await openEvent(makerAgain);
    expect(
      (makerAgain.getByTestId('toggle-event-enabled-checkbox') as HTMLInputElement).checked,
    ).toBe(false);
    fireEvent.click(makerAgain.getByTestId('toggle-event-enabled-checkbox'));
    submitReason(makerAgain);
    await makerAgain.findByTestId('trigger-submit-success');
    expect(server.proposals[0].change).toEqual({
      type: 'CONFIGURATION',
      eventType: A,
      channel: 'EVENT',
      enabled: true,
      expectedVersion: 8,
    });
    expect(makerAgain.getByTestId(`effective-channels-${A}`).textContent).toBe('Event disabled');
    const enableId = server.proposals[0].approvalId;
    makerAgain.unmount();

    seedChecker();
    const checkerAgain = render(<NotificationManagementScreen initialTab="approvals" />);
    await approve(checkerAgain, enableId);
    fireEvent.click(checkerAgain.getByTestId('notif-tab-events'));
    expect(checkerAgain.getByTestId(`effective-channels-${A}`).textContent).toBe('SMS only');
    expect(server.events[0].channels.SMS.enabled).toBe(true);
    expect(server.events[0].channels.EMAIL.enabled).toBe(false);
    expect(server.events.find((event) => event.eventType === B)).toEqual(unrelatedBefore);
    expect(ApiClient.patch).not.toHaveBeenCalled();
    expect(ApiClient.put).not.toHaveBeenCalled();
  });

  test('creates separate EVENT, SMS and EMAIL proposals with their own versions and applies only the executed targets', async () => {
    const server = installRegistryBackend();
    seedPrincipal();
    const maker = render(<NotificationManagementScreen initialTab="events" />);
    await openEvent(maker);
    fireEvent.click(maker.getByTestId('toggle-event-enabled-checkbox'));
    fireEvent.click(maker.getByTestId('toggle-sms-enabled-checkbox'));
    fireEvent.click(maker.getByTestId('toggle-email-enabled-checkbox'));
    submitReason(maker);
    expect((await maker.findByTestId('trigger-submit-success')).textContent).toContain(
      '3 separate proposals',
    );
    const requests = postCalls().filter(([url]) => url === '/internal/notifications/changes');
    expect(
      requests.map((call) => {
        const body = configurationBody(call);
        return [body.channel, body.enabled, body.expectedVersion, body.reason];
      }),
    ).toEqual([
      ['EVENT', false, 7, reason],
      ['SMS', false, 3, reason],
      ['EMAIL', true, 5, reason],
    ]);
    expect(
      requests.every(([, , options]) =>
        Boolean(options?.idempotencyKey && options.idempotencyKey.length > 0),
      ),
    ).toBe(true);
    expect(new Set(requests.map(([, , options]) => options?.idempotencyKey)).size).toBe(3);
    expect(new Set(server.proposals.map((proposal) => proposal.approvalId)).size).toBe(3);
    expect(maker.getByTestId(`event-pending-${A}`).textContent).toContain('EVENT: disable');
    expect(maker.getByTestId(`event-pending-${A}`).textContent).toContain('SMS: disable');
    expect(maker.getByTestId(`event-pending-${A}`).textContent).toContain('EMAIL: enable');
    expect(maker.getByTestId(`effective-channels-${A}`).textContent).toBe('SMS only');
    const idFor = (target: Target) =>
      server.proposals.find((proposal) => proposal.change.channel === target)!.approvalId;
    const smsId = idFor('SMS');
    const emailId = idFor('EMAIL');
    const eventId = idFor('EVENT');
    maker.unmount();

    seedChecker();
    const checker = render(<NotificationManagementScreen initialTab="approvals" />);
    await approve(checker, smsId);
    expect(server.events[0].eventEnabled).toBe(true);
    expect(server.events[0].channels.SMS.enabled).toBe(false);
    expect(server.events[0].channels.EMAIL.enabled).toBe(false);
    expect(server.proposals.find((proposal) => proposal.approvalId === eventId)?.status).toBe(
      'REQUESTED',
    );
    await approve(checker, emailId);
    expect(server.events[0].channels.EMAIL.enabled).toBe(true);
    expect(server.events[0].eventEnabled).toBe(true);
    await approve(checker, eventId);
    fireEvent.click(checker.getByTestId('notif-tab-events'));
    expect(checker.getByTestId(`effective-channels-${A}`).textContent).toBe('Event disabled');
    expect(checker.getByTestId(`saved-sms-${A}`).textContent).toBe('DISABLED');
    expect(checker.getByTestId(`saved-email-${A}`).textContent).toBe('ENABLED');
  });

  test('does not propose or overwrite an untouched channel changed concurrently by another administrator', async () => {
    const server = installRegistryBackend();
    seedPrincipal();
    const maker = render(<NotificationManagementScreen initialTab="events" />);
    await openEvent(maker);
    server.events[0].channels.EMAIL.enabled = true;
    server.events[0].channels.EMAIL.configurationVersion += 1;
    fireEvent.click(maker.getByTestId('toggle-sms-enabled-checkbox'));
    submitReason(maker);
    await maker.findByTestId('trigger-submit-success');
    expect(server.proposals).toHaveLength(1);
    expect(server.proposals[0].change).toMatchObject({
      channel: 'SMS',
      enabled: false,
      expectedVersion: 3,
    });
    expect(server.events[0].channels.EMAIL).toMatchObject({
      enabled: true,
      configurationVersion: 6,
    });
    const approvalId = server.proposals[0].approvalId;
    maker.unmount();
    seedChecker();
    const checker = render(<NotificationManagementScreen initialTab="approvals" />);
    await approve(checker, approvalId);
    fireEvent.click(checker.getByTestId('notif-tab-events'));
    expect(checker.getByTestId(`effective-channels-${A}`).textContent).toBe('Email only');
    expect(server.events[0].channels.EMAIL).toMatchObject({
      enabled: true,
      configurationVersion: 6,
    });
  });

  test('exposes a stale EVENT version conflict without retrying or replacing the snapshot version', async () => {
    const server = installRegistryBackend();
    const unrelatedBefore = clone(server.events[1]);
    seedPrincipal();
    const maker = render(<NotificationManagementScreen initialTab="events" />);
    await openEvent(maker);
    server.events[0].eventEnabled = false;
    server.events[0].eventConfigurationVersion = 8;
    fireEvent.click(maker.getByTestId('toggle-event-enabled-checkbox'));
    submitReason(maker);
    expect((await maker.findByTestId('trigger-submit-error')).textContent).toMatch(
      /Version conflict for EVENT.*refresh/i,
    );
    const requests = postCalls().filter(([url]) => url === '/internal/notifications/changes');
    expect(requests).toHaveLength(1);
    expect(requests[0][1]).toMatchObject({ channel: 'EVENT', enabled: false, expectedVersion: 7 });
    expect(server.proposals).toHaveLength(0);
    expect(server.events[1]).toEqual(unrelatedBefore);
    fireEvent.click(maker.getByRole('button', { name: 'Close' }));
    await act(() => {
      fireEvent.click(maker.getByTestId('refresh-notifications-console-btn'));
      return Promise.resolve();
    });
    await waitFor(() =>
      expect(maker.getByTestId(`event-master-${A}`).textContent).toBe('DISABLED'),
    );
  });

  test('reports partial multi-target failure and retains only the unsubmitted drafts for retry', async () => {
    const server = installRegistryBackend();
    seedPrincipal();
    const maker = render(<NotificationManagementScreen initialTab="events" />);
    await openEvent(maker);
    server.events[0].channels.SMS.configurationVersion = 4;
    fireEvent.click(maker.getByTestId('toggle-event-enabled-checkbox'));
    fireEvent.click(maker.getByTestId('toggle-sms-enabled-checkbox'));
    fireEvent.click(maker.getByTestId('toggle-email-enabled-checkbox'));
    submitReason(maker);
    const feedback = await maker.findByTestId('trigger-submit-error');
    expect(feedback.textContent).toMatch(
      /Created 1 separate proposal.*EVENT=.*Version conflict for SMS/i,
    );
    expect(feedback.textContent).toMatch(/Remaining targets were not attempted/i);
    expect(server.proposals).toHaveLength(1);
    expect(server.proposals[0].change.channel).toBe('EVENT');
    expect(maker.getByTestId(`event-pending-${A}`).textContent).toContain('EVENT: disable');
    expect(maker.getByTestId(`effective-channels-${A}`).textContent).toBe('SMS only');
    expect((maker.getByTestId('toggle-event-enabled-checkbox') as HTMLInputElement).checked).toBe(
      true,
    );
    expect((maker.getByTestId('toggle-sms-enabled-checkbox') as HTMLInputElement).checked).toBe(
      false,
    );
    const firstCalls = postCalls().filter(([url]) => url === '/internal/notifications/changes');
    expect(firstCalls.map((call) => configurationBody(call).channel)).toEqual(['EVENT', 'SMS']);
    expect((maker.getByTestId('submit-trigger-config-btn') as HTMLButtonElement).disabled).toBe(true);
    expect(maker.getByTestId('trigger-review-lock').textContent).toMatch(/cannot exclude a late commit/i);
    fireEvent.click(maker.getByTestId('submit-trigger-config-btn'));
    expect(postCalls().filter(([url]) => url === '/internal/notifications/changes')).toHaveLength(2);
    const confirmation = jest.spyOn(window, 'confirm').mockReturnValue(true);
    fireEvent.click(maker.getByRole('button', {name: 'Acknowledge independent trigger review'})); confirmation.mockRestore();
    expect(maker.queryByTestId('event-trigger-config-panel')).toBeNull();
    expect(server.proposals).toHaveLength(1);
  });

  test('keeps SECURITY locked and treats target locks and unavailable versions independently', async () => {
    const server = installRegistryBackend();
    server.events[0].eventLocked = true;
    delete server.events[1].eventConfigurationVersion;
    seedPrincipal();
    const view = render(<NotificationManagementScreen initialTab="events" />);
    await ready(view);
    expect((view.getByTestId(`configure-trigger-${SECURITY}`) as HTMLButtonElement).disabled).toBe(
      true,
    );
    fireEvent.click(view.getByTestId(`configure-trigger-${SECURITY}`));
    expect(view.queryByTestId('event-trigger-config-panel')).toBeNull();
    await expect(
      NotificationManagementApi.submitEventConfigurationChange(SECURITY, {
        channel: 'EVENT',
        enabled: false,
        expectedVersion: 1,
        reason,
      }),
    ).rejects.toThrow(/SECURITY events/i);
    expect(ApiClient.post).not.toHaveBeenCalled();

    await openEvent(view, A);
    expect((view.getByTestId('toggle-event-enabled-checkbox') as HTMLInputElement).disabled).toBe(
      true,
    );
    expect((view.getByTestId('toggle-sms-enabled-checkbox') as HTMLInputElement).disabled).toBe(
      false,
    );
    fireEvent.click(view.getByTestId('toggle-sms-enabled-checkbox'));
    submitReason(view);
    await view.findByTestId('trigger-submit-success');
    expect(server.proposals[0].change.channel).toBe('SMS');
    fireEvent.click(view.getByRole('button', { name: 'Close' }));
    await openEvent(view, B);
    expect((view.getByTestId('toggle-event-enabled-checkbox') as HTMLInputElement).disabled).toBe(
      true,
    );
    expect(
      view.getByText('Versioned configuration unavailable; refresh the registry.'),
    ).toBeTruthy();
    expect((view.getByTestId('toggle-email-enabled-checkbox') as HTMLInputElement).disabled).toBe(
      false,
    );
  });

  test.each([
    {
      label: 'role alone is insufficient',
      roles: ['OPERATIONS'],
      scopes: ['notification.view_deliveries', 'notification.manage_configuration'],
    },
    {
      label: 'SERVICE is not a workforce maker',
      type: 'SERVICE',
      roles: ['SUPER_ADMIN'],
      scopes: ['notification.view_deliveries'],
    },
    {
      label: 'missing registry scope',
      roles: ['SUPER_ADMIN'],
      scopes: ['notification.manage_configuration'],
    },
    {
      label: 'password assurance',
      roles: ['SUPER_ADMIN'],
      scopes: ['notification.view_deliveries'],
      assuranceLevel: 'PASSWORD',
    },
    {
      label: 'read-only session',
      roles: ['SUPER_ADMIN'],
      scopes: ['notification.view_deliveries'],
      readOnlyPrincipal: true,
    },
    {
      label: 'customer access not NONE',
      roles: ['SUPER_ADMIN'],
      scopes: ['notification.view_deliveries'],
      customerAccess: 'FULL',
    },
  ])('fails closed for an unauthorized maker: $label', async (principal) => {
    installRegistryBackend();
    seedPrincipal(principal);
    const view = render(<NotificationManagementScreen initialTab="events" />);
    await ready(view);
    const button = view.getByTestId(`configure-trigger-${A}`) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    expect(view.queryByTestId('event-trigger-config-panel')).toBeNull();
    expect(ApiClient.post).not.toHaveBeenCalled();
  });

  test('does not allow edits from offline reference data and handles server authorization denial without retry', async () => {
    const server = installRegistryBackend();
    server.registryUnavailable = true;
    seedPrincipal();
    const offline = render(<NotificationManagementScreen initialTab="events" />);
    await ready(offline);
    expect((offline.getByTestId(`configure-trigger-${A}`) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(offline.getByTestId(`effective-channels-${A}`).textContent).toBe('Unavailable');
    expect(ApiClient.post).not.toHaveBeenCalled();
    offline.unmount();

    server.registryUnavailable = false;
    server.createError = { channel: 'EVENT', status: 403, message: 'Server denied this maker' };
    const online = render(<NotificationManagementScreen initialTab="events" />);
    await openEvent(online);
    fireEvent.click(online.getByTestId('toggle-event-enabled-checkbox'));
    submitReason(online);
    expect((await online.findByTestId('trigger-submit-error')).textContent).toMatch(
      /Access denied \(403\)/i,
    );
    expect(server.proposals).toHaveLength(0);
    expect(postCalls().filter(([url]) => url === '/internal/notifications/changes')).toHaveLength(
      1,
    );
    expect(online.getByTestId(`event-master-${A}`).textContent).toBe('ENABLED');
  });

  test('prevents self-approval even when a maker also has checker permissions', async () => {
    const server = installRegistryBackend();
    seedPrincipal({
      roles: ['SUPER_ADMIN', 'FINANCE_CONTROLLER'],
      scopes: ['notification.view_deliveries', 'privileged:approve'],
    });
    const view = render(<NotificationManagementScreen initialTab="events" />);
    await openEvent(view);
    fireEvent.click(view.getByTestId('toggle-event-enabled-checkbox'));
    submitReason(view);
    await view.findByTestId('trigger-submit-success');
    const id = server.proposals[0].approvalId;
    fireEvent.click(view.getByTestId('notif-tab-approvals'));
    const approveButton = view.getByTestId(`approve-change-${id}`) as HTMLButtonElement;
    expect(approveButton.disabled).toBe(true);
    fireEvent.click(approveButton);
    expect(server.proposals[0].status).toBe('REQUESTED');
    expect(postCalls().some(([url]) => url.includes('/approve') || url.endsWith('/execute'))).toBe(
      false,
    );
  });

  test('shows approved but unconfirmed after a transient execution failure and only applies on successful checker retry', async () => {
    const server = installRegistryBackend();
    seedPrincipal();
    const maker = render(<NotificationManagementScreen initialTab="events" />);
    await openEvent(maker);
    fireEvent.click(maker.getByTestId('toggle-event-enabled-checkbox'));
    submitReason(maker);
    await maker.findByTestId('trigger-submit-success');
    const id = server.proposals[0].approvalId;
    maker.unmount();

    server.executeError = { status: 503, message: 'Temporary execution failure' };
    seedChecker();
    const checker = render(<NotificationManagementScreen initialTab="approvals" />);
    await waitFor(() =>
      expect((checker.getByTestId(`approve-change-${id}`) as HTMLButtonElement).disabled).toBe(
        false,
      ),
    );
    fireEvent.click(checker.getByTestId(`approve-change-${id}`));
    const feedback = await checker.findByTestId('checker-feedback-error');
    expect(feedback.textContent).toMatch(
      /Approval recorded, but execution could not be confirmed.*Temporary execution failure/i,
    );
    expect(feedback.textContent).not.toMatch(/approved and executed/i);
    await ready(checker);
    expect(server.proposals[0].status).toBe('APPROVED');
    expect(server.events[0].eventEnabled).toBe(true);
    expect(checker.getByTestId(`change-request-row-${id}`).textContent).toContain('APPROVED');
    fireEvent.click(checker.getByTestId('notif-tab-events'));
    expect(checker.getByTestId(`event-master-${A}`).textContent).toBe('ENABLED');
    expect(checker.getByTestId(`event-pending-${A}`).textContent).toMatch(
      /Approved, not yet confirmed effective/,
    );

    server.executeError = null;
    fireEvent.click(checker.getByTestId('notif-tab-approvals'));
    const acknowledge = checker.getByRole('button', {name: 'Acknowledge independent approval review'});
    await waitFor(() => expect((acknowledge as HTMLButtonElement).disabled).toBe(false));
    const confirmation = jest.spyOn(window, 'confirm').mockReturnValue(true); fireEvent.click(acknowledge); confirmation.mockRestore();
    fireEvent.click(checker.getByTestId(`execute-change-${id}`));
    expect((await checker.findByTestId('checker-feedback-success')).textContent).toMatch(
      /executed/i,
    );
    await ready(checker);
    expect(server.proposals[0].status).toBe('CONSUMED');
    fireEvent.click(checker.getByTestId('notif-tab-events'));
    expect(checker.getByTestId(`event-master-${A}`).textContent).toBe('DISABLED');
    expect(checker.getByTestId(`event-pending-${A}`).textContent).toBe('None in loaded queue');
  });

  test('an approved stale proposal still conflicts at execution and never overwrites the newer registry state', async () => {
    const server = installRegistryBackend();
    const unrelatedBefore = clone(server.events[1]);
    seedPrincipal();
    const maker = render(<NotificationManagementScreen initialTab="events" />);
    await openEvent(maker);
    fireEvent.click(maker.getByTestId('toggle-event-enabled-checkbox'));
    submitReason(maker);
    await maker.findByTestId('trigger-submit-success');
    const id = server.proposals[0].approvalId;
    maker.unmount();
    // Another approved change advanced the target after proposal creation.
    server.events[0].eventConfigurationVersion = 8;

    seedChecker();
    const checker = render(<NotificationManagementScreen initialTab="approvals" />);
    await waitFor(() =>
      expect((checker.getByTestId(`approve-change-${id}`) as HTMLButtonElement).disabled).toBe(
        false,
      ),
    );
    fireEvent.click(checker.getByTestId(`approve-change-${id}`));
    expect((await checker.findByTestId('checker-feedback-error')).textContent).toMatch(
      /version has changed/i,
    );
    await waitFor(() =>
      expect(checker.getByTestId(`change-request-row-${id}`).textContent).toContain('APPROVED'),
    );
    await ready(checker);
    expect(server.events[0].eventEnabled).toBe(true);
    expect(server.events[0].eventConfigurationVersion).toBe(8);
    expect(server.events[1]).toEqual(unrelatedBefore);
    const acknowledge = checker.getByRole('button', {name: 'Acknowledge independent approval review'});
    await waitFor(() => expect((acknowledge as HTMLButtonElement).disabled).toBe(false));
    const confirmation = jest.spyOn(window, 'confirm').mockReturnValue(true); fireEvent.click(acknowledge); confirmation.mockRestore();
    fireEvent.click(checker.getByTestId(`execute-change-${id}`));
    await waitFor(() =>
      expect(postCalls().filter(([url]) => url.endsWith('/execute'))).toHaveLength(2),
    );
    expect(server.proposals[0].status).toBe('APPROVED');
    expect(server.events[0].eventConfigurationVersion).toBe(8);
    expect(server.events[0].eventEnabled).toBe(true);
  });

  test.each([
    {
      label: 'approval scope without FINANCE_CONTROLLER',
      roles: ['OPERATIONS'],
      scopes: [
        'notification.view_deliveries',
        'notification.approve_configuration',
        'privileged:approve',
      ],
    },
    {
      label: 'SERVICE principal',
      type: 'SERVICE',
      roles: ['FINANCE_CONTROLLER'],
      scopes: ['notification.view_deliveries', 'privileged:approve'],
    },
    {
      label: 'read-only checker',
      roles: ['FINANCE_CONTROLLER'],
      scopes: ['notification.view_deliveries', 'privileged:approve'],
      readOnlyPrincipal: true,
    },
  ])('does not offer checker actions to an unauthorized identity: $label', async (identity) => {
    const server = installRegistryBackend();
    seedPrincipal();
    const maker = render(<NotificationManagementScreen initialTab="events" />);
    await openEvent(maker);
    fireEvent.click(maker.getByTestId('toggle-event-enabled-checkbox'));
    submitReason(maker);
    await maker.findByTestId('trigger-submit-success');
    const id = server.proposals[0].approvalId;
    maker.unmount();
    seedPrincipal({ ...identity, principalId: checkerId });
    const checker = render(<NotificationManagementScreen initialTab="approvals" />);
    await ready(checker);
    expect(checker.getByTestId(`change-request-row-${id}`)).toBeTruthy();
    expect(checker.queryByTestId(`approve-change-${id}`)).toBeNull();
    expect(server.proposals[0].status).toBe('REQUESTED');
    expect(postCalls().some(([url]) => url.includes('/approve') || url.endsWith('/execute'))).toBe(
      false,
    );
  });

  test('does not treat cancelled, expired or unknown proposal statuses as pending or approved', async () => {
    const server = installRegistryBackend();
    const base: Proposal = {
      approvalId: '550e8400-e29b-41d4-a716-000000000001',
      change: {
        type: 'CONFIGURATION',
        eventType: A,
        channel: 'EVENT',
        enabled: false,
        expectedVersion: 7,
      },
      reason,
      createdBy: makerId,
      createdAt: '2026-11-02T10:00:00.000Z',
      status: 'CANCELLED',
      approvedBy: null,
    };
    server.proposals.push(
      base,
      { ...clone(base), approvalId: '550e8400-e29b-41d4-a716-000000000002', status: 'EXPIRED' },
      {
        ...clone(base),
        approvalId: '550e8400-e29b-41d4-a716-000000000003',
        status: 'UNEXPECTED' as Status,
      },
    );
    seedChecker();
    const view = render(<NotificationManagementScreen initialTab="events" />);
    await ready(view);
    expect(view.getByTestId(`event-pending-${A}`).textContent).toBe('None in loaded queue');
    fireEvent.click(view.getByTestId('notif-tab-approvals'));
    expect(view.getByTestId(`change-request-row-${base.approvalId}`).textContent).toContain(
      'CANCELLED',
    );
    expect(
      view.getByTestId('change-request-row-550e8400-e29b-41d4-a716-000000000002').textContent,
    ).toContain('EXPIRED');
    expect(
      view.getByTestId('change-request-row-550e8400-e29b-41d4-a716-000000000003').textContent,
    ).toContain('UNKNOWN');
    expect(view.queryByTestId(`approve-change-${base.approvalId}`)).toBeNull();
  });

  test('labels proposal receipts as last known if the approval queue cannot be refreshed', async () => {
    const server = installRegistryBackend();
    seedPrincipal();
    const view = render(<NotificationManagementScreen initialTab="events" />);
    await openEvent(view);
    fireEvent.click(view.getByTestId('toggle-event-enabled-checkbox'));
    submitReason(view);
    await view.findByTestId('trigger-submit-success');
    server.queueUnavailable = true;
    await act(() => {
      fireEvent.click(view.getByTestId('refresh-notifications-console-btn'));
      return Promise.resolve();
    });
    await waitFor(() =>
      expect(view.getByTestId(`event-pending-${A}`).textContent).toMatch(
        /Current approval status is unavailable; shown proposals are last known/i,
      ),
    );
    expect(view.getByTestId(`event-pending-${A}`).textContent).toContain('EVENT: disable');
  });

  test('warns that a transport failure leaves submission status unconfirmed', async () => {
    const server = installRegistryBackend();
    server.createError = { channel: 'EVENT', status: 503, message: 'Gateway timeout' };
    seedPrincipal();
    const view = render(<NotificationManagementScreen initialTab="events" />);
    await openEvent(view);
    fireEvent.click(view.getByTestId('toggle-event-enabled-checkbox'));
    submitReason(view);
    expect((await view.findByTestId('trigger-submit-error')).textContent).toMatch(
      /EVENT submission could not be confirmed.*Check the approval queue before retrying/i,
    );
    expect(view.getByTestId(`event-master-${A}`).textContent).toBe('ENABLED');
    expect(postCalls().filter(([url]) => url === '/internal/notifications/changes')).toHaveLength(1);
    const event = new Event('beforeunload', {cancelable:true}); window.dispatchEvent(event); expect(event.defaultPrevented).toBe(true);
    const confirmation = jest.spyOn(window, 'confirm').mockReturnValue(false);
    fireEvent.click(view.getByRole('button', {name:'Close'})); expect(view.getByTestId('event-trigger-config-panel')).toBeTruthy();
    fireEvent.click(view.getByTestId('refresh-notifications-console-btn')); await ready(view);
    expect(view.getByTestId('trigger-review-lock')).toBeTruthy(); expect((view.getByTestId('submit-trigger-config-btn') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(view.getByRole('button', {name:'Acknowledge independent trigger review'})); expect(view.getByTestId('trigger-review-lock')).toBeTruthy();
    confirmation.mockReturnValue(true); fireEvent.click(view.getByRole('button', {name:'Acknowledge independent trigger review'})); confirmation.mockRestore();
    expect(view.queryByTestId('event-trigger-config-panel')).toBeNull(); expect(view.queryByTestId('trigger-review-lock')).toBeNull();
  });
});

test('event catalogue filters, empty state and drawer focus remain keyboard discoverable', async () => {
  jest.clearAllMocks(); installRegistryBackend(); seedPrincipal();
  const view = render(<NotificationManagementScreen initialTab="events" />); await ready(view);
  const search = view.getByLabelText('Search event or description');
  fireEvent.change(search, { target: { value: 'no-synthetic-match' } });
  expect(view.getByText('No catalogue events match these filters.')).toBeTruthy();
  expect(view.getByText(/Showing 0 of \d+ catalogue events/)).toBeTruthy();
  fireEvent.click(view.getByRole('button', { name: 'Reset filters' }));
  expect((search as HTMLInputElement).value).toBe('');
  const trigger = view.getByTestId(`configure-trigger-${A}`) as HTMLButtonElement;
  expect(trigger.getAttribute('aria-label')).toContain(A); fireEvent.click(trigger);
  expect(document.activeElement).toBe(view.getByTestId('event-trigger-config-panel'));
  fireEvent.click(view.getByRole('button', { name: 'Close' }));
  expect(view.queryByTestId('event-trigger-config-panel')).toBeNull(); expect(document.activeElement).toBe(trigger);
  expect(ApiClient.post).not.toHaveBeenCalled();
});
