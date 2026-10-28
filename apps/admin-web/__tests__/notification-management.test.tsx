import React from 'react';
import { act, fireEvent, render, waitFor, within } from '@testing-library/react';
import { ApiClient, ApiError } from '../src/services/api-client';
import { useAuthStore, WorkforcePrincipal } from '../src/store/auth-store';
import { NotificationManagementScreen } from '../src/screens/authenticated/NotificationManagementScreen';
import { SystemHealthScreen } from '../src/screens/authenticated/SystemHealthScreen';
import { sanitizeProviderStatusForDisplay } from '../src/services/notification-domain';

jest.mock('../src/services/api-client', () => {
  class MockApiError extends Error {
    status: number;
    code?: string;
    constructor(message: string, status: number, code?: string) {
      super(message);
      this.name = 'ApiError';
      this.status = status;
      this.code = code;
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

function seedPrincipal(options: {
  principalId?: string;
  roles?: string[];
  scopes?: string[];
  assuranceLevel?: 'MFA' | 'PASSWORD';
  type?: WorkforcePrincipal['type'];
}) {
  useAuthStore.setState({
    isAuthenticated: true,
    isLoading: false,
    token: 'test-workforce-token',
    sessionId: 'test-workforce-session',
    error: null,
    principal: {
      type: options.type ?? 'OPERATOR',
      principalId: options.principalId ?? 'issuer:ops-maker-1',
      sessionId: 'test-workforce-session',
      audience: 'workforce-admin',
      roles: options.roles ?? ['OPERATIONS'],
      scopes: options.scopes ?? ['notification.view_deliveries'],
      customerAccess: 'NONE',
      assuranceLevel: options.assuranceLevel ?? 'MFA',
    },
  });
}

function mockBaselineUnintegratedBackend() {
  (ApiClient.get as jest.Mock).mockImplementation((endpoint: string) => {
    if (endpoint.startsWith('/internal/notifications/events')) {
      return Promise.reject(new ApiError('Not Found', 404));
    }
    if (endpoint.startsWith('/internal/notifications/templates')) {
      return Promise.reject(new ApiError('Not Found', 404));
    }
    if (endpoint.startsWith('/internal/notifications/provider-status')) {
      return Promise.reject(new ApiError('Not Found', 404));
    }
    if (endpoint.startsWith('/internal/notifications/change-requests')) {
      return Promise.reject(new ApiError('Not Found', 404));
    }
    if (endpoint.startsWith('/internal/notifications/deliveries?')) {
      if (endpoint.includes('channel=EMAIL')) {
        return Promise.reject(new ApiError('channel must be one of SMS, PUSH', 400));
      }
      return Promise.resolve({
        data: [
          {
            id: 'deliv-sent-1',
            eventType: 'customer.funding.approved',
            eventKey: 'customer.funding.approved:req-1',
            aggregateType: 'CUSTOMER_FUNDING',
            aggregateId: 'req-1',
            recipientType: 'CUSTOMER',
            recipientId: '11111111-1111-4111-8111-111111111111',
            channel: 'SMS',
            status: 'SENT',
            attempts: 1,
            providerRef: 'robase_msg_001',
            correlationId: 'corr-001',
            causationId: null,
            message: 'Your funding of NGN 25000.00 has been approved. Ref 8F4A21C9.',
            lastError: null,
            createdAt: '2026-10-27T08:00:00.000Z',
            updatedAt: '2026-10-27T08:00:02.000Z',
            sentAt: '2026-10-27T08:00:02.000Z',
            failedAt: null,
          },
          {
            id: 'deliv-failed-2',
            eventType: 'transfer.completed',
            eventKey: 'transfer.completed:tx-2',
            aggregateType: 'TRANSFER',
            aggregateId: 'tx-2',
            recipientType: 'CUSTOMER',
            recipientId: '22222222-2222-4222-8222-222222222222',
            channel: 'SMS',
            status: 'FAILED',
            attempts: 3,
            providerRef: null,
            correlationId: 'corr-002',
            causationId: null,
            message: 'Transfer of NGN 5000.00 completed. Ref TX990011.',
            lastError: 'provider_timeout',
            createdAt: '2026-10-27T08:05:00.000Z',
            updatedAt: '2026-10-27T08:08:00.000Z',
            sentAt: null,
            failedAt: '2026-10-27T08:08:00.000Z',
          },
        ],
        total: 2,
        page: 1,
        limit: 20,
        totalPages: 1,
        hasNextPage: false,
      });
    }
    if (endpoint.startsWith('/internal/configuration')) {
      return Promise.resolve({
        environment: 'staging',
        version: '1.3.0',
        apiVersion: 'v1',
        outboxRetryDelaySeconds: 60,
      });
    }
    if (endpoint.startsWith('/internal/diagnostics')) {
      return Promise.resolve({
        status: 'ok',
        version: '1.3.0',
        pendingOutbox: 4,
      });
    }
    if (endpoint.startsWith('/internal/outbox')) {
      return Promise.resolve([
        { id: 'outbox-1', eventType: 'customer.funding.approved', status: 'PENDING', attempts: 0 },
      ]);
    }
    if (endpoint.startsWith('/internal/audit')) {
      return Promise.resolve([
        {
          id: 'aud-1',
          action: 'NOTIFICATION_TEMPLATE_VERSION_SUBMITTED',
          entityId: 'tpl-v2',
          actorId: 'issuer:ops-maker-1',
          occurredAt: '2026-10-27T09:00:00.000Z',
        },
      ]);
    }
    return Promise.resolve([]);
  });

  (ApiClient.post as jest.Mock).mockRejectedValue(new ApiError('Not Found', 404));
  (ApiClient.patch as jest.Mock).mockRejectedValue(new ApiError('Not Found', 404));
}

/* ---------------------------------------------------------------------------
 * INTEGRATION (Arena 3 Phase 5): mock of the REAL merged backend contracts —
 * Arena 1 registry (events/templates/changes/preview in their true shapes),
 * Arena 3 provider-status (flat snapshot) + test-send ({channel, destination}),
 * workforce approvals, and the EMAIL-widened deliveries endpoint.
 * --------------------------------------------------------------------------- */

const REGISTRY_EVENT_FIXTURES = [
  {
    eventType: 'customer.funding.requested',
    deliveryClass: 'TRANSACTIONAL',
    editable: true,
    variables: ['reference'],
    channels: {
      SMS: { enabled: true, locked: false, configurationVersion: 1, activeTemplateVersion: 1 },
      EMAIL: { enabled: false, locked: false, configurationVersion: 1, activeTemplateVersion: 1 },
    },
  },
  {
    eventType: 'customer.funding.approved',
    deliveryClass: 'TRANSACTIONAL',
    editable: true,
    variables: ['reference', 'amount_clause'],
    channels: {
      SMS: { enabled: true, locked: false, configurationVersion: 1, activeTemplateVersion: 1 },
      EMAIL: { enabled: false, locked: false, configurationVersion: 1, activeTemplateVersion: 1 },
    },
  },
  {
    eventType: 'transfer.completed',
    deliveryClass: 'TRANSACTIONAL',
    editable: true,
    variables: ['reference', 'amount_clause'],
    channels: {
      SMS: { enabled: true, locked: false, configurationVersion: 1, activeTemplateVersion: 1 },
      EMAIL: { enabled: false, locked: false, configurationVersion: 1, activeTemplateVersion: 1 },
    },
  },
  {
    eventType: 'support.ticket.assigned',
    deliveryClass: 'INFORMATIONAL',
    editable: true,
    variables: ['reference'],
    channels: {
      SMS: { enabled: true, locked: false, configurationVersion: 1, activeTemplateVersion: 1 },
      EMAIL: { enabled: false, locked: false, configurationVersion: 1, activeTemplateVersion: 1 },
    },
  },
  {
    eventType: 'cash_to_cash.created',
    deliveryClass: 'INFORMATIONAL',
    editable: true,
    variables: ['sender_name', 'amount', 'locator_clause'],
    channels: {
      SMS: { enabled: true, locked: false, configurationVersion: 1, activeTemplateVersion: 1 },
      EMAIL: { enabled: false, locked: false, configurationVersion: 1, activeTemplateVersion: 1 },
    },
  },
  {
    eventType: 'customer.registration.phone_verification',
    deliveryClass: 'SECURITY',
    editable: false,
    variables: [],
    channels: {
      SMS: { enabled: true, locked: true, configurationVersion: 1, activeTemplateVersion: null },
      EMAIL: { enabled: false, locked: true, configurationVersion: 1, activeTemplateVersion: null },
    },
  },
  {
    eventType: 'agent.desk.customer_otp',
    deliveryClass: 'SECURITY',
    editable: false,
    variables: [],
    channels: {
      SMS: { enabled: true, locked: true, configurationVersion: 1, activeTemplateVersion: null },
      EMAIL: { enabled: false, locked: true, configurationVersion: 1, activeTemplateVersion: null },
    },
  },
];

const TEMPLATE_SAMPLE_VALUES: Record<string, string> = {
  reference: 'SAMPLE-1',
  amount_clause: ' of NGN 1250.00',
  amount: 'NGN 2500.00',
  sender_name: 'Ada Example',
  locator_clause: ' Find an active outlet: https://locator.example.ng/agents',
  status: 'IN_PROGRESS',
  ticket_status: 'IN_PROGRESS',
};

function registryTemplateRows(eventType: string, channel: string) {
  const createdAt = '2026-10-20T00:00:00.000Z';
  if (eventType === 'customer.funding.approved' && channel === 'EMAIL') {
    return [
      {
        id: 'tpl-email-v3-other',
        eventType,
        channel,
        locale: 'en-NG',
        version: 3,
        active: false,
        subject: 'Maker Authored Subject {{reference}}',
        body: 'Maker authored body {{amount_clause}}.',
        createdBy: 'issuer:maker-2',
        createdAt: '2026-10-27T00:00:00.000Z',
      },
      {
        id: 'tpl-email-v2-self',
        eventType,
        channel,
        locale: 'en-NG',
        version: 2,
        active: false,
        subject: 'Self Authored Subject {{reference}}',
        body: 'Self authored body {{amount_clause}}.',
        createdBy: 'issuer:checker-1',
        createdAt: '2026-10-26T00:00:00.000Z',
      },
      {
        id: 'tpl-email-v1',
        eventType,
        channel,
        locale: 'en-NG',
        version: 1,
        active: true,
        subject: 'MonieNaija account update',
        body: 'Your funding{{amount_clause}} has been approved. Ref {{reference}}.',
        createdBy: 'SYSTEM_SEED',
        createdAt,
      },
    ];
  }
  const event = REGISTRY_EVENT_FIXTURES.find((candidate) => candidate.eventType === eventType);
  if (!event || event.deliveryClass === 'SECURITY') return [];
  const bodies: Record<string, string> = {
    'cash_to_cash.created':
      'Cash-to-Cash: {{sender_name}} sent you {{amount}}. Visit an active agent outlet to collect.{{locator_clause}}',
    'customer.funding.requested': 'We received your funding request. Ref {{reference}}.',
    'customer.funding.approved': 'Your funding{{amount_clause}} has been approved. Ref {{reference}}.',
    'transfer.completed': 'Transfer{{amount_clause}} completed. Ref {{reference}}.',
    'support.ticket.assigned': 'Update on your support request. Ref {{reference}}.',
  };
  const body = bodies[eventType] ?? 'You have a new update. Ref {{reference}}.';
  return [
    {
      id: `tpl-${eventType}-${channel}-v1`,
      eventType,
      channel,
      locale: 'en-NG',
      version: 1,
      active: true,
      subject: channel === 'EMAIL' ? 'MonieNaija account update' : null,
      body,
      createdBy: 'SYSTEM_SEED',
      createdAt,
    },
  ];
}

const CHANGE_LIST_FIXTURE = {
  page: 1,
  limit: 25,
  hasMore: false,
  items: [
    {
      approvalId: '550e8400-e29b-41d4-a716-446655440001',
      type: 'TEMPLATE',
      eventType: 'transfer.completed',
      channel: 'SMS',
      createdBy: 'issuer:fc-checker',
      createdAt: '2026-10-27T08:00:00.000Z',
      status: 'REQUESTED',
      approvedBy: null,
      expiresAt: null,
    },
    {
      approvalId: '550e8400-e29b-41d4-a716-446655440002',
      type: 'CONFIGURATION',
      eventType: 'support.ticket.assigned',
      channel: 'EMAIL',
      createdBy: 'issuer:ops-maker-9',
      createdAt: '2026-10-27T08:30:00.000Z',
      status: 'REQUESTED',
      approvedBy: null,
      expiresAt: null,
    },
  ],
};

const PROVIDER_STATUS_FIXTURE = {
  channels: ['SMS', 'PUSH', 'EMAIL'],
  sms: {
    provider: 'robase',
    baseUrl: 'https://api.robase.dev',
    configured: true,
    keyFingerprint: '9f2a',
    timeoutMs: 10000,
    // Stray secret that the real backend would never send — the mapped view model must
    // drop unknown fields entirely (defence in depth behind sanitizeProviderStatusForDisplay).
    apiKey: 'robe_99999999999999999999999999999999',
  },
  email: {
    provider: 'resend',
    baseUrl: 'https://api.resend.com',
    configured: true,
    keyFingerprint: 'ab12',
    from: 'no-reply@monienaija.com',
    replyTo: null,
    timeoutMs: 10000,
    smtpPassword: 'super-secret-smtp-password-value',
  },
  worker: {
    enabled: true,
    pollIntervalMs: 5000,
    batchSize: 10,
    retryMaxAttempts: 3,
    retryBaseDelaySeconds: 60,
  },
};

function mockIntegratedRegistryBackend() {
  (ApiClient.get as jest.Mock).mockImplementation((endpoint: string) => {
    if (endpoint.startsWith('/internal/notifications/events')) {
      return Promise.resolve({ items: REGISTRY_EVENT_FIXTURES });
    }
    if (endpoint.startsWith('/internal/notifications/templates')) {
      const url = new URL(endpoint, 'http://admin.local');
      const eventType = url.searchParams.get('eventType') ?? '';
      const channel = url.searchParams.get('channel') ?? 'SMS';
      return Promise.resolve({
        eventType,
        channel,
        locale: 'en-NG',
        items: registryTemplateRows(eventType, channel),
        nextBeforeVersion: null,
      });
    }
    if (endpoint.startsWith('/internal/notifications/changes/')) {
      const approvalId = endpoint.split('/internal/notifications/changes/')[1];
      const row = CHANGE_LIST_FIXTURE.items.find((item) => item.approvalId === approvalId);
      if (!row) return Promise.reject(new ApiError('Not Found', 404));
      return Promise.resolve({
        approvalId,
        change:
          row.type === 'TEMPLATE'
            ? { type: 'TEMPLATE', eventType: row.eventType, channel: row.channel, subject: null, body: 'Frozen proposed body', expectedVersion: 1 }
            : { type: 'CONFIGURATION', eventType: row.eventType, channel: row.channel, enabled: true, expectedVersion: 1 },
        reason: row.type === 'TEMPLATE' ? 'Refine wording' : 'Enable email on ticket assignment',
        createdBy: row.createdBy,
        createdAt: row.createdAt,
        status: row.status,
        requestedBy: row.createdBy,
        approvedBy: null,
        expiresAt: null,
      });
    }
    if (endpoint.startsWith('/internal/notifications/changes')) {
      return Promise.resolve(CHANGE_LIST_FIXTURE);
    }
    if (endpoint.startsWith('/internal/notifications/provider-status')) {
      return Promise.resolve(PROVIDER_STATUS_FIXTURE);
    }
    if (endpoint.startsWith('/internal/notifications/deliveries?')) {
      const url = new URL(endpoint, 'http://admin.local');
      const channel = url.searchParams.get('channel');
      const rows =
        channel === 'EMAIL'
          ? [
              {
                id: 'deliv-email-3',
                eventType: 'transfer.completed',
                eventKey: 'transfer.completed:tx-3',
                aggregateType: 'TRANSFER',
                aggregateId: 'tx-3',
                recipientType: 'CUSTOMER',
                recipientId: '33333333-3333-4333-8333-333333333333',
                channel: 'EMAIL',
                status: 'SENT',
                attempts: 1,
                providerRef: 'test-email-1',
                correlationId: 'corr-003',
                causationId: null,
                message: 'Transfer of NGN 5000.00 completed. Ref TX990011.',
                lastError: null,
                createdAt: '2026-10-27T09:00:00.000Z',
                updatedAt: '2026-10-27T09:00:02.000Z',
                sentAt: '2026-10-27T09:00:02.000Z',
                failedAt: null,
              },
            ]
          : [
              {
                id: 'deliv-sent-1',
                eventType: 'customer.funding.approved',
                eventKey: 'customer.funding.approved:req-1',
                aggregateType: 'CUSTOMER_FUNDING',
                aggregateId: 'req-1',
                recipientType: 'CUSTOMER',
                recipientId: '11111111-1111-4111-8111-111111111111',
                channel: 'SMS',
                status: 'SENT',
                attempts: 1,
                providerRef: 'robase_msg_001',
                correlationId: 'corr-001',
                causationId: null,
                message: 'Your funding of NGN 25000.00 has been approved. Ref 8F4A21C9.',
                lastError: null,
                createdAt: '2026-10-27T08:00:00.000Z',
                updatedAt: '2026-10-27T08:00:02.000Z',
                sentAt: '2026-10-27T08:00:02.000Z',
                failedAt: null,
              },
              {
                id: 'deliv-failed-2',
                eventType: 'transfer.completed',
                eventKey: 'transfer.completed:tx-2',
                aggregateType: 'TRANSFER',
                aggregateId: 'tx-2',
                recipientType: 'CUSTOMER',
                recipientId: '22222222-2222-4222-8222-222222222222',
                channel: 'SMS',
                status: 'FAILED',
                attempts: 3,
                providerRef: null,
                correlationId: 'corr-002',
                causationId: null,
                message: 'Transfer of NGN 5000.00 completed. Ref TX990011.',
                lastError: 'provider_timeout',
                createdAt: '2026-10-27T08:05:00.000Z',
                updatedAt: '2026-10-27T08:08:00.000Z',
                sentAt: null,
                failedAt: '2026-10-27T08:08:00.000Z',
              },
            ];
      return Promise.resolve({ data: rows, total: rows.length, page: 1, limit: 20, totalPages: 1, hasNextPage: false });
    }
    if (endpoint.startsWith('/internal/configuration')) {
      return Promise.resolve({ environment: 'staging', version: '1.3.0', apiVersion: 'v1', outboxRetryDelaySeconds: 60 });
    }
    if (endpoint.startsWith('/internal/diagnostics')) {
      return Promise.resolve({ status: 'ok', version: '1.3.0', pendingOutbox: 4 });
    }
    if (endpoint.startsWith('/internal/outbox')) {
      return Promise.resolve([{ id: 'outbox-1', eventType: 'customer.funding.approved', status: 'PENDING', attempts: 0 }]);
    }
    if (endpoint.startsWith('/internal/audit')) {
      return Promise.resolve([
        { id: 'aud-1', action: 'NOTIFICATION_CHANGE_REQUESTED', entityId: '550e8400-e29b-41d4-a716-446655440002', actorId: 'issuer:ops-maker-9', occurredAt: '2026-10-27T09:00:00.000Z' },
      ]);
    }
    return Promise.resolve([]);
  });

  (ApiClient.post as jest.Mock).mockImplementation((endpoint: string, body?: any) => {
    if (endpoint.startsWith('/internal/notifications/templates/preview')) {
      const renderSample = (text: string | null) =>
        (text ?? '').replace(/\{\{([a-z_]+)\}\}/g, (_m, name: string) => TEMPLATE_SAMPLE_VALUES[name] ?? '');
      const variablesUsed = Array.from(
        ((body?.subject ?? '') + ' ' + (body?.body ?? '')).matchAll(/\{\{([a-z_]+)\}\}/g),
        (m) => m[1],
      );
      return Promise.resolve({
        eventType: body?.eventType,
        channel: body?.channel,
        locale: 'en-NG',
        subject: body?.channel === 'EMAIL' ? renderSample(body?.subject ?? null) : null,
        body: renderSample(body?.body ?? ''),
        variablesUsed,
      });
    }
    if (endpoint === '/internal/notifications/changes') {
      return Promise.resolve({
        approvalId: '550e8400-e29b-41d4-a716-4466554400aa',
        status: 'REQUESTED',
        actionType: body?.type === 'CONFIGURATION' ? 'NOTIFICATION_EVENT_CONFIGURATION_CHANGE' : 'NOTIFICATION_TEMPLATE_CHANGE',
        actionFingerprint: 'fingerprint-1',
        requestedAt: '2026-10-27T10:00:00.000Z',
        expiresAt: '2026-10-27T11:00:00.000Z',
      });
    }
    if (endpoint.includes('/internal/notifications/changes/') && endpoint.endsWith('/execute')) {
      return Promise.resolve({ approvalId: endpoint.split('/')[4], type: 'TEMPLATE' });
    }
    if (endpoint.includes('/internal/a2/workforce/approvals/')) {
      return Promise.resolve({ status: 'APPROVED' });
    }
    if (endpoint === '/internal/notifications/test-send') {
      return Promise.resolve({
        status: 'SENT',
        channel: body?.channel,
        correlationId: 'corr-test-1',
        destination: '+23480***0100',
        provider: 'test',
        providerRef: 'ref-test-1',
        errorCode: null,
      });
    }
    return Promise.reject(new ApiError('Not Found', 404));
  });
  (ApiClient.patch as jest.Mock).mockRejectedValue(new ApiError('Method Not Allowed', 404));
}

describe('ARENA 2 — SMS & Email Notification Management Console', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockBaselineUnintegratedBackend();
  });

  test('Capability 12: denies access fail-closed and fires zero API calls when principal holds no notification.* scope', () => {
    seedPrincipal({
      roles: ['TREASURY'],
      scopes: ['reconciliation.view'],
    });

    const view = render(<NotificationManagementScreen />);
    expect(view.getByTestId('notification-module-access-denied')).toBeTruthy();
    expect(ApiClient.get).not.toHaveBeenCalled();
    expect(ApiClient.post).not.toHaveBeenCalled();
    expect(ApiClient.patch).not.toHaveBeenCalled();
  });

  test('Capability 1 & 12: renders Overview with live SMS delivery/outbox metrics, honest BLOCKED badges on unintegrated Arena 1/3 endpoints, and zero raw JSON <pre>', async () => {
    seedPrincipal({
      roles: ['FINANCE_AUDITOR'],
      scopes: ['notification.view_deliveries', 'diagnostics.view', 'outbox.view'],
    });

    const view = render(<NotificationManagementScreen />);
    await waitFor(() =>
      expect(ApiClient.get).toHaveBeenCalledWith(
        expect.stringContaining('/internal/notifications/deliveries?'),
      ),
    );
    await waitFor(() =>
      expect((view.getByTestId('backend-readiness-matrix').textContent ?? '').includes('BLOCKED')).toBe(
        true,
      ),
    );
    expect(view.getByTestId('overview-email-blocked-badge')).toBeTruthy();
    await waitFor(() =>
      expect((view.getByTestId('notif-panel-overview').textContent ?? '').includes('4')).toBe(true),
    );
    expect(view.container.querySelector('pre')).toBeNull();
  });

  test('Capability 2: permanently locks SECURITY and required transactional triggers while eligible trigger changes flow through the real maker-checker change lifecycle', async () => {
    mockIntegratedRegistryBackend();
    seedPrincipal({
      roles: ['OPERATIONS'],
      scopes: ['notification.view_deliveries', 'notification.manage_configuration'],
    });

    const view = render(<NotificationManagementScreen initialTab="events" />);
    await waitFor(() => expect(view.getByTestId('notification-events-table')).toBeTruthy());

    // SECURITY OTP flow is permanently locked (registry is_locked=true) even when the
    // operator holds configuration scopes
    const otpBtn = view.getByTestId('configure-trigger-agent.desk.customer_otp') as HTMLButtonElement;
    expect(otpBtn.disabled).toBe(true);

    // Required transactional funding outcome stays locked by product decision D-N8
    // (client-side stricter-than-server lock preserved through the registry merge)
    const fundingApprovedBtn = view.getByTestId(
      'configure-trigger-customer.funding.approved',
    ) as HTMLButtonElement;
    expect(fundingApprovedBtn.disabled).toBe(true);

    // Eligible event (customer.funding.requested) can open Configure Triggers drawer
    const eligibleBtn = view.getByTestId(
      'configure-trigger-customer.funding.requested',
    ) as HTMLButtonElement;
    expect(eligibleBtn.disabled).toBe(false);
    fireEvent.click(eligibleBtn);

    const drawer = view.getByTestId('event-trigger-config-panel');
    expect(drawer).toBeTruthy();

    // Submitting with no toggle change and short reason fails validation before any network call
    const postsBefore = (ApiClient.post as jest.Mock).mock.calls.length;
    fireEvent.click(view.getByTestId('submit-trigger-config-btn'));
    expect(view.getByTestId('trigger-validation-errors').textContent).toMatch(
      /Modify at least one channel trigger/i,
    );
    expect((ApiClient.post as jest.Mock).mock.calls.length).toBe(postsBefore);

    // Toggle SMS off, provide valid audit reason -> the real backend has NO PATCH route:
    // the client submits a CONFIGURATION change request (POST /internal/notifications/changes)
    // with the persisted expectedVersion for optimistic concurrency.
    fireEvent.click(view.getByTestId('toggle-sms-enabled-checkbox'));
    fireEvent.change(view.getByTestId('trigger-reason-input'), {
      target: { value: 'Pause requested acknowledgement SMS during maintenance window' },
    });
    fireEvent.click(view.getByTestId('submit-trigger-config-btn'));

    expect(await view.findByTestId('trigger-submit-success')).toBeTruthy();
    expect(view.getByTestId('trigger-submit-success').textContent).toMatch(
      /maker-checker approval/i,
    );
    expect(ApiClient.patch).not.toHaveBeenCalled();
    expect(ApiClient.post).toHaveBeenCalledWith(
      '/internal/notifications/changes',
      {
        type: 'CONFIGURATION',
        eventType: 'customer.funding.requested',
        channel: 'SMS',
        enabled: false,
        expectedVersion: 1,
        reason: 'Pause requested acknowledgement SMS during maintenance window',
      },
      expect.objectContaining({ idempotencyKey: expect.any(String) }),
    );

    // Registry state was NOT faked as applied — the row still shows the persisted ENABLED
    // state until a checker approves and executes the frozen proposal.
    const requestedRow = view.getByTestId('event-row-customer.funding.requested');
    expect(requestedRow.textContent).toContain('ENABLED');
  });

  test('Capability 3, 5 & 6: SMS template editor enforces the registry variable whitelist, C2C non-disclosure (F-S2), secret-exclusion, variable insertion, authoritative server preview, and governed change-request save', async () => {
    mockIntegratedRegistryBackend();
    seedPrincipal({
      roles: ['SUPER_ADMIN'],
      scopes: ['notification.view_deliveries'],
    });

    const view = render(<NotificationManagementScreen initialTab="smsTemplates" />);
    await waitFor(() => expect(view.getByTestId('template-workspace-sms')).toBeTruthy());

    // Selecting a SECURITY OTP event locks template editing completely (Audit F-S6; the
    // registry reports editable=false + locked channels for SECURITY-class events)
    const eventSelect = view.getByTestId('template-event-select');
    fireEvent.change(eventSelect, {
      target: { value: 'customer.registration.phone_verification' },
    });
    expect(view.getByTestId('template-security-locked-banner')).toBeTruthy();
    expect((view.getByTestId('template-body-textarea') as HTMLTextAreaElement).disabled).toBe(true);

    // Switch to cash_to_cash.created — verify C2C non-disclosure banner & forbidden variable rejection
    fireEvent.change(eventSelect, { target: { value: 'cash_to_cash.created' } });
    expect(view.getByTestId('template-c2c-nondisclosure-banner')).toBeTruthy();

    fireEvent.change(view.getByTestId('template-body-textarea'), {
      target: {
        value: 'Transfer {{transferNumber}} from {{senderPhone}} with code {{transfer_code}}',
      },
    });
    fireEvent.change(view.getByTestId('template-change-summary-input'), {
      target: { value: 'Attempted unsafe template update' },
    });
    fireEvent.click(view.getByTestId('submit-template-version-btn'));

    const validationAlert = view.getByTestId('template-validation-errors');
    expect(validationAlert.textContent).toMatch(/non-disclosure rule/i);
    expect(validationAlert.textContent).toMatch(/forbidden: secret codes/i);
    expect(ApiClient.post).not.toHaveBeenCalled();

    // Compose valid C2C beneficiary SMS using the registry allowlist (sender_name, amount,
    // locator_clause) via Approved Variable Browser insertion buttons
    fireEvent.change(view.getByTestId('template-body-textarea'), {
      target: { value: 'MonieNaija transfer received:' },
    });
    fireEvent.click(view.getByTestId('insert-var-body-sender_name'));
    fireEvent.click(view.getByTestId('insert-var-body-amount'));
    fireEvent.click(view.getByTestId('insert-var-body-locator_clause'));

    // Deterministic local Safe Preview substitutes representative safe sample values
    const previewBody = view.getByTestId('rendered-preview-body');
    expect(previewBody.textContent).toContain('A MonieNaija sender');
    expect(previewBody.textContent).toContain('NGN 25,000.00');
    expect(previewBody.textContent).toContain('https://monienaija.example/agents');

    // Server-side preview is LIVE and authoritative (fixed safe samples rendered server-side)
    fireEvent.click(view.getByTestId('run-server-preview-btn'));
    await waitFor(() =>
      expect(view.getByTestId('rendered-preview-body').textContent).toContain('Ada Example'),
    );
    expect(ApiClient.post).toHaveBeenCalledWith(
      '/internal/notifications/templates/preview',
      expect.objectContaining({
        eventType: 'cash_to_cash.created',
        channel: 'SMS',
        locale: 'en-NG',
        subject: null,
      }),
    );

    // Submitting the template version goes through the maker-checker change lifecycle:
    // POST /internal/notifications/changes (type TEMPLATE) with the registry's current
    // ACTIVE version as expectedVersion — never a direct template write.
    fireEvent.change(view.getByTestId('template-change-summary-input'), {
      target: { value: 'Adopt approved C2C beneficiary locator wording' },
    });
    fireEvent.click(view.getByTestId('submit-template-version-btn'));
    const successBox = await view.findByTestId('template-submit-success');
    expect(successBox.textContent).toContain('550e8400-e29b-41d4-a716-4466554400aa');
    expect(ApiClient.post).toHaveBeenCalledWith(
      '/internal/notifications/changes',
      expect.objectContaining({
        type: 'TEMPLATE',
        eventType: 'cash_to_cash.created',
        channel: 'SMS',
        locale: 'en-NG',
        subject: null,
        expectedVersion: 1,
        reason: 'Adopt approved C2C beneficiary locator wording',
      }),
      expect.objectContaining({ idempotencyKey: expect.any(String) }),
    );
  });

  test('Capability 4 & 7: Email template management validates subject + body, supports registry variable insertion, and activates historical versions through governed TEMPLATE_ROLLBACK proposals', async () => {
    mockIntegratedRegistryBackend();
    seedPrincipal({
      principalId: 'issuer:checker-1',
      roles: ['FINANCE_CONTROLLER'],
      scopes: [
        'notification.view_events',
        'notification.manage_templates',
        'notification.approve_templates',
        'privileged:approve',
      ],
      assuranceLevel: 'MFA',
    });

    const view = render(<NotificationManagementScreen initialTab="emailTemplates" />);
    await waitFor(() => expect(view.getByTestId('template-version-history-table')).toBeTruthy());
    fireEvent.change(view.getByTestId('template-event-select'), {
      target: { value: 'customer.funding.approved' },
    });

    // Clear subject -> verify Email subject required validation error (before any network call)
    fireEvent.change(view.getByTestId('email-template-subject-input'), {
      target: { value: '' },
    });
    fireEvent.change(view.getByTestId('template-change-summary-input'), {
      target: { value: 'Update funding email copy with clear branding' },
    });
    fireEvent.click(view.getByTestId('submit-template-version-btn'));
    expect(view.getByTestId('template-validation-errors').textContent).toMatch(
      /Email subject is required/i,
    );

    // Insert the registry-approved amount_clause variable into the Subject and preview it
    fireEvent.change(view.getByTestId('email-template-subject-input'), {
      target: { value: 'MonieNaija Credit:' },
    });
    fireEvent.click(view.getByTestId('insert-var-subject-amount_clause'));
    expect(view.getByTestId('rendered-preview-subject').textContent).toContain('NGN 1250.00');

    // Version history comes from the persistent registry (v1 ACTIVE + v2/v3 inactive).
    // Proposing a rollback is a maker action — maker != checker separation is enforced
    // server-side when the FINANCE_CONTROLLER checker approves, so a self-authored
    // historical version may still be proposed for rollback.
    const selfBtn = view.getByTestId('activate-version-2') as HTMLButtonElement;
    expect(selfBtn.disabled).toBe(false);
    const otherBtn = view.getByTestId('activate-version-3') as HTMLButtonElement;
    expect(otherBtn.disabled).toBe(false);

    fireEvent.click(otherBtn);
    await waitFor(() =>
      expect(ApiClient.post).toHaveBeenCalledWith(
        '/internal/notifications/changes',
        expect.objectContaining({
          type: 'TEMPLATE_ROLLBACK',
          eventType: 'customer.funding.approved',
          channel: 'EMAIL',
          locale: 'en-NG',
          sourceVersion: 3,
          expectedVersion: 1,
        }),
        expect.objectContaining({ idempotencyKey: expect.any(String) }),
      ),
    );
    const feedback = await view.findByTestId('template-activation-feedback');
    expect(feedback.textContent).toMatch(/Rollback proposal/i);
    expect(feedback.textContent).toMatch(/checker must approve and execute/i);
  });

  test('Capability 8: Approvals & Governance enforces MFA assurance, prevents self-approval, and executes the real change lifecycle (workforce approve + frozen-proposal execute)', async () => {
    mockIntegratedRegistryBackend();

    // First verify PASSWORD assurance blocks checker approval
    seedPrincipal({
      principalId: 'issuer:fc-checker',
      roles: ['FINANCE_CONTROLLER'],
      scopes: ['notification.view_events', 'privileged:approve'],
      assuranceLevel: 'PASSWORD',
    });

    const passwordView = render(<NotificationManagementScreen initialTab="approvals" />);
    expect(await passwordView.findByTestId('approvals-mfa-required-banner')).toBeTruthy();
    expect(
      ((await passwordView.findByTestId('approve-change-550e8400-e29b-41d4-a716-446655440002')) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    passwordView.unmount();

    // Now re-mount with MFA assurance
    seedPrincipal({
      principalId: 'issuer:fc-checker',
      roles: ['FINANCE_CONTROLLER'],
      scopes: ['notification.view_events', 'privileged:approve'],
      assuranceLevel: 'MFA',
    });

    const mfaView = render(<NotificationManagementScreen initialTab="approvals" />);
    await waitFor(() =>
      expect(mfaView.getByTestId('notification-change-requests-table')).toBeTruthy(),
    );

    // Self-requested row remains disabled (Maker !== Checker)
    expect(
      (mfaView.getByTestId('approve-change-550e8400-e29b-41d4-a716-446655440001') as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(
      (mfaView.getByTestId('approve-change-550e8400-e29b-41d4-a716-446655440002') as HTMLButtonElement)
        .disabled,
    ).toBe(false);

    // Approving a notification change request executes the REAL two-step contract:
    // 1) POST /internal/a2/workforce/approvals/:id/approve (checker decision)
    // 2) POST /internal/notifications/changes/:id/execute (applies the frozen proposal —
    //    approval alone never mutates templates or configuration)
    fireEvent.click(mfaView.getByTestId('approve-change-550e8400-e29b-41d4-a716-446655440002'));
    await waitFor(() =>
      expect(ApiClient.post).toHaveBeenCalledWith(
        '/internal/a2/workforce/approvals/550e8400-e29b-41d4-a716-446655440002/approve',
        { comment: undefined },
      ),
    );
    await waitFor(() =>
      expect(ApiClient.post).toHaveBeenCalledWith(
        '/internal/notifications/changes/550e8400-e29b-41d4-a716-446655440002/execute',
      ),
    );
    expect(await mfaView.findByTestId('checker-feedback-success')).toBeTruthy();
    expect(mfaView.getByTestId('checker-feedback-success').textContent).toMatch(/APPLIED/i);

    // Direct live workforce approval endpoint validates UUID and calls POST /internal/a2/workforce/approvals/:id/approve
    fireEvent.change(mfaView.getByTestId('direct-workforce-approval-id-input'), {
      target: { value: '550e8400-e29b-41d4-a716-446655440002' },
    });
    fireEvent.change(mfaView.getByTestId('direct-workforce-approval-comment-input'), {
      target: { value: 'Verified safe template variables and trigger impact' },
    });
    fireEvent.click(mfaView.getByTestId('direct-workforce-approve-btn'));

    await waitFor(() =>
      expect(ApiClient.post).toHaveBeenCalledWith(
        '/internal/a2/workforce/approvals/550e8400-e29b-41d4-a716-446655440002/approve',
        { comment: 'Verified safe template variables and trigger impact' },
      ),
    );
    expect(await mfaView.findByTestId('checker-feedback-success')).toBeTruthy();
  });

  test('Capability 9: Provider Status strips any accidental raw secrets/keys and renders only non-secret readiness & masked fingerprints', async () => {
    const rawWithAccidentalSecrets = {
      checkedAt: '2026-10-27T10:00:00.000Z',
      environment: 'production',
      worker: {
        enabled: true,
        batchSize: 10,
        smsRetryMaxAttempts: 3,
        smsRetryBaseDelaySeconds: 60,
        pendingOutboxCount: 1,
      },
      sms: {
        provider: 'robase',
        operationalStatus: 'READY',
        baseUrl: 'https://api.robase.dev',
        apiKeyConfigured: true,
        apiKeyPrefixValid: true,
        apiKeyLast4Fingerprint: 'robe_0123456789abcdef9f2a',
        apiKey: 'robe_99999999999999999999999999999999',
        requestTimeoutMs: 10000,
        productionGuardSatisfied: true,
        senderIdentityMode: 'PROVIDER_WORKSPACE_ACCOUNT',
        senderIdentitySummary: 'Robase workspace account sender identity',
        deliveryReceiptTracking: 'ACCEPTED_BY_PROVIDER_ONLY',
      },
      email: {
        channelEnabledInSchema: true,
        provider: 'ses',
        operationalStatus: 'READY',
        credentialsConfigured: true,
        credentialFingerprint: 'ab12',
        smtpPassword: 'super-secret-smtp-password-value',
        fromAddress: 'no-reply@monienaija.com',
        fromName: 'MonieNaija Alerts',
        domainVerificationStatus: 'VERIFIED',
        honorsCustomerEmailPreference: true,
      },
    };

    const scrubbed = sanitizeProviderStatusForDisplay(rawWithAccidentalSecrets as any);
    expect(scrubbed.sms.apiKey).toBeUndefined();
    expect(scrubbed.email.smtpPassword).toBeUndefined();
    expect(scrubbed.sms.apiKeyLast4Fingerprint).toBe('9f2a');

    // INTEGRATION: the real backend returns the flat non-secret snapshot
    // (PROVIDER_STATUS_FIXTURE, including stray secret fields that must never reach the
    // view model); the client maps it into the console view model and sanitizes.
    mockIntegratedRegistryBackend();

    seedPrincipal({
      roles: ['SUPER_ADMIN'],
      scopes: ['notification.view_deliveries'],
    });

    const view = render(<NotificationManagementScreen initialTab="providers" />);
    await waitFor(() => expect(view.getByTestId('sms-provider-status-details')).toBeTruthy());

    const fullText = view.container.textContent ?? '';
    expect(fullText).toContain('••••9f2a');
    expect(fullText).toContain('••••ab12');
    expect(fullText).not.toContain('robe_99999999999999999999999999999999');
    expect(fullText).not.toContain('robe_0123456789abcdef9f2a');
    expect(fullText).not.toContain('super-secret-smtp-password-value');
    // Mapped readiness from the real flat fields
    expect(fullText).toContain('READY');
    expect(fullText).toContain('no-reply@monienaija.com');
  });

  test('Capability 10: Deliveries & Retries validates Recipient UUID, EMAIL channel filter is LIVE after the Arena 3 widening, manual retry stays honestly BLOCKED, and retry diagnostics are inspectable', async () => {
    mockIntegratedRegistryBackend();
    seedPrincipal({
      roles: ['OPERATIONS'],
      scopes: ['notification.view_deliveries', 'notification.manage_configuration'],
    });

    const view = render(<NotificationManagementScreen initialTab="deliveries" />);
    await waitFor(() => expect(view.getByTestId('notification-deliveries-table')).toBeTruthy());

    // Inspect failed delivery row with 3 attempts
    fireEvent.click(view.getByTestId('inspect-delivery-deliv-failed-2'));
    const inspector = view.getByTestId('delivery-inspector-panel');
    expect(within(inspector).getByText(/provider_timeout/)).toBeTruthy();
    expect(inspector.textContent).toMatch(/3 attempt\(s\)/);

    // Manual retry endpoint is genuinely absent from the backend — honest BLOCKED state,
    // automatic bounded retry lives in NotificationWorkerService
    fireEvent.change(view.getByTestId('manual-retry-reason-input'), {
      target: { value: 'Provider recovered after upstream timeout incident' },
    });
    fireEvent.click(view.getByTestId('request-manual-retry-btn'));
    expect(await view.findByTestId('manual-retry-blocked')).toBeTruthy();

    // Invalid UUID in Recipient ID filter catches client-side before hitting backend
    fireEvent.change(view.getByLabelText('Recipient UUID filter'), {
      target: { value: 'not-a-valid-uuid' },
    });
    fireEvent.click(view.getByTestId('apply-delivery-filters-btn'));
    expect(view.getByTestId('delivery-filter-error').textContent).toMatch(/valid UUID/i);

    // EMAIL channel filter is LIVE (VALID_CHANNELS widened by Arena 3 migration 097 +
    // controller) — the filtered request succeeds and EMAIL rows render; no BLOCKED banner
    fireEvent.change(view.getByLabelText('Recipient UUID filter'), { target: { value: '' } });
    fireEvent.change(view.getByLabelText('Delivery channel'), { target: { value: 'EMAIL' } });
    fireEvent.click(view.getByTestId('apply-delivery-filters-btn'));
    await waitFor(() =>
      expect(ApiClient.get).toHaveBeenCalledWith(
        expect.stringContaining('channel=EMAIL'),
      ),
    );
    expect(await view.findByTestId('delivery-row-deliv-email-3')).toBeTruthy();
    expect(view.queryByTestId('delivery-email-filter-blocked')).toBeNull();
  });

  test('Capability 11 & 12: Controlled Test-Send enforces notification.test_send scope, workforce destination validation, attestation, the real {channel, destination} wire contract, and 429 rate-limit handling without retry', async () => {
    // Without notification.test_send -> submit button is disabled
    seedPrincipal({
      roles: ['FINANCE_AUDITOR'],
      scopes: ['notification.view_deliveries'],
    });
    const restrictedView = render(<NotificationManagementScreen initialTab="testSend" />);
    expect(restrictedView.getByTestId('test-send-scope-restricted-banner')).toBeTruthy();
    expect((restrictedView.getByTestId('submit-test-send-btn') as HTMLButtonElement).disabled).toBe(
      true,
    );
    restrictedView.unmount();

    // With notification.test_send -> validates destination + attestation + reason client-side
    mockIntegratedRegistryBackend();
    seedPrincipal({
      roles: ['OPERATIONS'],
      scopes: ['notification.view_deliveries', 'notification.test_send'],
    });
    const view = render(<NotificationManagementScreen initialTab="testSend" />);

    fireEvent.change(view.getByTestId('test-send-destination-input'), {
      target: { value: 'invalid-phone' },
    });
    fireEvent.click(view.getByTestId('submit-test-send-btn'));
    const valErrors = view.getByTestId('test-send-validation-errors');
    expect(valErrors.textContent).toMatch(/valid E\.164 or Nigerian mobile number/i);
    expect(valErrors.textContent).toMatch(/authorized workforce operator/i);
    expect(ApiClient.post).not.toHaveBeenCalled();

    // Valid Nigerian number (normalized to +2348030000100) + attestation + reason ->
    // the REAL endpoint accepts ONLY { channel, destination } with fixed safe content;
    // eventType/reason/attestation remain console-side governance context.
    fireEvent.change(view.getByTestId('test-send-destination-input'), {
      target: { value: '08030000100' },
    });
    fireEvent.change(view.getByTestId('test-send-reason-input'), {
      target: { value: 'Verify Robase production credential connectivity' },
    });
    fireEvent.click(view.getByTestId('test-send-workforce-attestation'));
    fireEvent.click(view.getByTestId('submit-test-send-btn'));

    expect(await view.findByTestId('test-send-outcome-banner')).toBeTruthy();
    expect(ApiClient.post).toHaveBeenCalledWith(
      '/internal/notifications/test-send',
      { channel: 'SMS', destination: '+2348030000100' },
      expect.objectContaining({ idempotencyKey: expect.any(String) }),
    );
    const outcomeText = view.getByTestId('test-send-outcome-banner').textContent ?? '';
    expect(outcomeText).toContain('SENT');
    expect(outcomeText).toContain('ref-test-1');
    // Destination is displayed MASKED exactly as the backend echoed it
    expect(outcomeText).not.toContain('+2348030000100');

    // Simulate 429 Too Many Requests -> surfaces rate-limit error and does NOT retry
    // (the success path clears the reason field, so re-enter it before the second attempt)
    fireEvent.change(view.getByTestId('test-send-reason-input'), {
      target: { value: 'Second connectivity check after quota exhaustion' },
    });
    const postCallsBefore429 = (ApiClient.post as jest.Mock).mock.calls.length;
    (ApiClient.post as jest.Mock).mockRejectedValueOnce(
      new ApiError('Rate limit exceeded: max 5 test sends per hour', 429),
    );
    fireEvent.click(view.getByTestId('submit-test-send-btn'));
    const rateBanner = await view.findByTestId('test-send-error-banner');
    expect(rateBanner.textContent).toMatch(/Rate limit exceeded \(429\)/i);
    expect((ApiClient.post as jest.Mock).mock.calls.length).toBe(postCallsBefore429 + 1);
  });

  test('Capability 12: read-only auditor never calls outbox/diagnostics/audit without matching scopes and fails closed on 403 mutation without retry', async () => {
    mockIntegratedRegistryBackend();
    seedPrincipal({
      roles: ['FINANCE_AUDITOR'],
      scopes: ['notification.view_deliveries'],
    });

    const auditorView = render(<NotificationManagementScreen initialTab="smsTemplates" />);
    await waitFor(() =>
      expect(auditorView.getByTestId('template-readonly-scope-notice')).toBeTruthy(),
    );
    expect(
      (auditorView.getByTestId('submit-template-version-btn') as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(ApiClient.get).not.toHaveBeenCalledWith(expect.stringContaining('/internal/outbox'));
    expect(ApiClient.get).not.toHaveBeenCalledWith(
      expect.stringContaining('/internal/diagnostics'),
    );
    expect(ApiClient.get).not.toHaveBeenCalledWith(expect.stringContaining('/internal/audit'));
    auditorView.unmount();

    // Now verify 403 Forbidden on the change-request mutation fails closed and does NOT
    // retry (server-side maker authorization: SUPER_ADMIN + MFA + view_deliveries)
    seedPrincipal({
      roles: ['OPERATIONS'],
      scopes: ['notification.view_deliveries', 'notification.manage_templates'],
    });
    const makerView = render(<NotificationManagementScreen initialTab="smsTemplates" />);
    await waitFor(() => expect(makerView.getByTestId('template-workspace-sms')).toBeTruthy());

    (ApiClient.post as jest.Mock).mockRejectedValue(
      new ApiError('Notification change request denied: UNAUTHORIZED', 403),
    );
    fireEvent.change(makerView.getByTestId('template-body-textarea'), {
      target: { value: 'We received your funding request. Ref {{reference}}.' },
    });
    fireEvent.change(makerView.getByTestId('template-change-summary-input'), {
      target: { value: 'Authorized wording refinement for funding confirmation' },
    });
    fireEvent.click(makerView.getByTestId('submit-template-version-btn'));

    const errAlert = await makerView.findByTestId('template-submit-error');
    expect((errAlert.textContent ?? '').includes('Access denied (403)')).toBe(true);
    expect(ApiClient.post).toHaveBeenCalledTimes(1);
    expect(ApiClient.post).toHaveBeenCalledWith(
      '/internal/notifications/changes',
      expect.objectContaining({ type: 'TEMPLATE' }),
      expect.objectContaining({ idempotencyKey: expect.any(String) }),
    );
  });

  test('SystemHealthScreen preserves existing delivery diagnostics and exposes shortcut to Notification Management when callback provided', async () => {
    seedPrincipal({
      roles: ['OPERATIONS'],
      scopes: ['notification.view_deliveries'],
    });
    const onOpen = jest.fn();
    const view = render(<SystemHealthScreen onOpenNotifications={onOpen} />);
    const shortcutBtn = await view.findByTestId('open-notification-management-btn');
    fireEvent.click(shortcutBtn);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });
});
