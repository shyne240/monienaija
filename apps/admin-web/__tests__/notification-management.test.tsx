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

  test('Capability 2: permanently locks SECURITY and required transactional triggers while validating eligible trigger changes and marking unintegrated PATCH as BLOCKED without fake persistence', async () => {
    seedPrincipal({
      roles: ['OPERATIONS'],
      scopes: ['notification.view_deliveries', 'notification.manage_configuration'],
    });

    const view = render(<NotificationManagementScreen initialTab="events" />);
    await waitFor(() => expect(view.getByTestId('notification-events-table')).toBeTruthy());

    // SECURITY OTP flow is permanently locked even when operator holds notification.manage_configuration
    const otpBtn = view.getByTestId('configure-trigger-agent.desk.customer_otp') as HTMLButtonElement;
    expect(otpBtn.disabled).toBe(true);

    // Required transactional funding outcome is also locked
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

    // Submitting with no toggle change and short reason fails validation before network call
    fireEvent.click(view.getByTestId('submit-trigger-config-btn'));
    expect(view.getByTestId('trigger-validation-errors').textContent).toMatch(
      /Modify at least one channel trigger/i,
    );
    expect(ApiClient.patch).not.toHaveBeenCalled();

    // Toggle SMS off, provide valid audit reason -> calls PATCH with idempotencyKey and marks BLOCKED on 404
    fireEvent.click(view.getByTestId('toggle-sms-enabled-checkbox'));
    fireEvent.change(view.getByTestId('trigger-reason-input'), {
      target: { value: 'Pause requested acknowledgement SMS during maintenance window' },
    });
    fireEvent.click(view.getByTestId('submit-trigger-config-btn'));

    expect(await view.findByTestId('trigger-submit-blocked')).toBeTruthy();
    expect(view.getByTestId('trigger-submit-blocked').textContent).toMatch(/BLOCKED on ARENA 1/i);
    expect(ApiClient.patch).toHaveBeenCalledWith(
      '/internal/notifications/events/customer.funding.requested/configuration',
      {
        smsEnabled: false,
        emailEnabled: false,
        reason: 'Pause requested acknowledgement SMS during maintenance window',
      },
      expect.objectContaining({ idempotencyKey: expect.any(String) }),
    );

    // Verify original catalogue state was NOT faked as persisted
    const requestedRow = view.getByTestId('event-row-customer.funding.requested');
    expect(requestedRow.textContent).toContain('ENABLED');
  });

  test('Capability 3, 5 & 6: SMS template editor enforces variable whitelist, C2C non-disclosure (F-S2), secret-exclusion, variable insertion, safe preview, and live vs BLOCKED save', async () => {
    seedPrincipal({
      roles: ['OPERATIONS'],
      scopes: ['notification.view_deliveries', 'notification.manage_templates'],
    });

    const view = render(<NotificationManagementScreen initialTab="smsTemplates" />);
    await waitFor(() => expect(view.getByTestId('template-workspace-sms')).toBeTruthy());

    // Selecting a SECURITY OTP event locks template editing completely (Audit F-S6)
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

    // Compose valid C2C beneficiary SMS using Approved Variable Browser insertion buttons
    fireEvent.change(view.getByTestId('template-body-textarea'), {
      target: { value: 'MonieNaija transfer received:' },
    });
    fireEvent.click(view.getByTestId('insert-var-body-sender_name'));
    fireEvent.click(view.getByTestId('insert-var-body-amount'));
    fireEvent.click(view.getByTestId('insert-var-body-agent_locator_url'));

    // Deterministic Safe Preview substitutes representative safe sample values
    const previewBody = view.getByTestId('rendered-preview-body');
    expect(previewBody.textContent).toContain('A MonieNaija sender');
    expect(previewBody.textContent).toContain('NGN 25,000.00');
    expect(previewBody.textContent).toContain('https://monienaija.example/locate-agent');

    // Server preview surfaces BLOCKED banner when Arena 1 preview endpoint returns 404
    fireEvent.click(view.getByTestId('run-server-preview-btn'));
    expect(await view.findByTestId('template-preview-blocked-banner')).toBeTruthy();

    // Submit valid SMS template when backend is 404 -> marks BLOCKED, does not fake save
    fireEvent.change(view.getByTestId('template-change-summary-input'), {
      target: { value: 'Adopt approved C2C beneficiary locator wording' },
    });
    fireEvent.click(view.getByTestId('submit-template-version-btn'));
    expect(await view.findByTestId('template-submit-blocked-banner')).toBeTruthy();

    // Now simulate ARENA 1 backend endpoint integrated (201 PENDING_APPROVAL)
    (ApiClient.post as jest.Mock).mockResolvedValueOnce({
      status: 'PENDING_APPROVAL',
      approvalId: '550e8400-e29b-41d4-a716-446655440099',
      changeRequestId: 'chg-c2c-1',
    });
    fireEvent.click(view.getByTestId('submit-template-version-btn'));
    const successBox = await view.findByTestId('template-submit-success');
    expect(successBox.textContent).toContain('550e8400-e29b-41d4-a716-446655440099');
    expect(ApiClient.post).toHaveBeenCalledWith(
      '/internal/notifications/templates',
      expect.objectContaining({
        eventType: 'cash_to_cash.created',
        channel: 'SMS',
        locale: 'en-NG',
        subject: null,
      }),
      expect.objectContaining({ idempotencyKey: expect.any(String) }),
    );
  });

  test('Capability 4 & 7: Email template management validates subject + body, supports variable insertion into Subject and Body, and enforces Maker !== Checker on version history activation', async () => {
    (ApiClient.get as jest.Mock).mockImplementation((endpoint: string) => {
      if (endpoint.startsWith('/internal/notifications/templates')) {
        return Promise.resolve({
          data: [
            {
              id: 'tpl-email-v1',
              eventType: 'customer.funding.approved',
              channel: 'EMAIL',
              locale: 'en-NG',
              version: 1,
              subject: 'Funding Approved — {{reference}}',
              body: 'Your wallet was credited with {{amount}}.',
              variables: ['reference', 'amount'],
              isActive: true,
              approvalStatus: 'ACTIVE',
              createdBy: 'issuer:system-seed',
              createdAt: '2026-10-20T00:00:00.000Z',
              updatedAt: '2026-10-20T00:00:00.000Z',
            },
            {
              id: 'tpl-email-v2-self',
              eventType: 'customer.funding.approved',
              channel: 'EMAIL',
              locale: 'en-NG',
              version: 2,
              subject: 'Self Authored Subject {{reference}}',
              body: 'Self authored body {{amount}}.',
              variables: ['reference', 'amount'],
              isActive: false,
              approvalStatus: 'PENDING_APPROVAL',
              createdBy: 'issuer:checker-1',
              createdAt: '2026-10-26T00:00:00.000Z',
              updatedAt: '2026-10-26T00:00:00.000Z',
            },
            {
              id: 'tpl-email-v3-other',
              eventType: 'customer.funding.approved',
              channel: 'EMAIL',
              locale: 'en-NG',
              version: 3,
              subject: 'Maker Authored Subject {{reference}}',
              body: 'Maker authored body {{amount}}.',
              variables: ['reference', 'amount'],
              isActive: false,
              approvalStatus: 'PENDING_APPROVAL',
              createdBy: 'issuer:maker-2',
              createdAt: '2026-10-27T00:00:00.000Z',
              updatedAt: '2026-10-27T00:00:00.000Z',
            },
          ],
        });
      }
      return Promise.reject(new ApiError('Not Found', 404));
    });

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

    // Clear subject -> verify Email subject required validation error
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

    // Insert approved variable into Subject and preview rendered subject
    fireEvent.change(view.getByTestId('email-template-subject-input'), {
      target: { value: 'MonieNaija Credit:' },
    });
    fireEvent.click(view.getByTestId('insert-var-subject-amount'));
    expect(view.getByTestId('rendered-preview-subject').textContent).toContain('NGN 25,000.00');

    // Version v2 authored by current principal ('issuer:checker-1') is disabled (Maker !== Checker)
    const selfActivateBtn = view.getByTestId('activate-version-2') as HTMLButtonElement;
    expect(selfActivateBtn.disabled).toBe(true);
    expect(selfActivateBtn.textContent).toContain('Maker ≠ Checker');

    // Version v3 authored by another maker ('issuer:maker-2') can be activated
    const otherActivateBtn = view.getByTestId('activate-version-3') as HTMLButtonElement;
    expect(otherActivateBtn.disabled).toBe(false);

    (ApiClient.post as jest.Mock).mockResolvedValueOnce({ status: 'APPLIED' });
    fireEvent.click(otherActivateBtn);
    await waitFor(() =>
      expect(ApiClient.post).toHaveBeenCalledWith(
        '/internal/notifications/templates/tpl-email-v3-other/activate',
        { comment: undefined },
        expect.objectContaining({ idempotencyKey: expect.any(String) }),
      ),
    );
  });

  test('Capability 8: Approvals & Governance enforces MFA assurance, prevents self-approval, and executes live /internal/a2/workforce/approvals/:id decisions', async () => {
    (ApiClient.get as jest.Mock).mockImplementation((endpoint: string) => {
      if (endpoint.startsWith('/internal/notifications/change-requests')) {
        return Promise.resolve({
          data: [
            {
              id: 'chg-self',
              approvalId: '550e8400-e29b-41d4-a716-446655440001',
              changeType: 'TEMPLATE_CREATE',
              eventType: 'transfer.completed',
              channel: 'SMS',
              summary: 'Self change',
              status: 'PENDING_APPROVAL',
              requestedBy: 'issuer:fc-checker',
              requestedAt: '2026-10-27T08:00:00.000Z',
            },
            {
              id: 'chg-other',
              approvalId: '550e8400-e29b-41d4-a716-446655440002',
              changeType: 'EVENT_TRIGGER_CONFIG',
              eventType: 'support.ticket.assigned',
              channel: 'MULTI',
              summary: 'Enable email on ticket assignment',
              status: 'PENDING_APPROVAL',
              requestedBy: 'issuer:ops-maker-9',
              requestedAt: '2026-10-27T08:30:00.000Z',
            },
          ],
        });
      }
      return Promise.reject(new ApiError('Not Found', 404));
    });

    // First verify PASSWORD assurance blocks checker approval
    seedPrincipal({
      principalId: 'issuer:fc-checker',
      roles: ['FINANCE_CONTROLLER'],
      scopes: ['notification.view_events', 'privileged:approve'],
      assuranceLevel: 'PASSWORD',
    });

    const passwordView = render(<NotificationManagementScreen initialTab="approvals" />);
    expect(await passwordView.findByTestId('approvals-mfa-required-banner')).toBeTruthy();
    expect((passwordView.getByTestId('approve-change-chg-other') as HTMLButtonElement).disabled).toBe(
      true,
    );
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
    expect((mfaView.getByTestId('approve-change-chg-self') as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect((mfaView.getByTestId('approve-change-chg-other') as HTMLButtonElement).disabled).toBe(
      false,
    );

    // Direct live workforce approval endpoint validates UUID and calls POST /internal/a2/workforce/approvals/:id/approve
    (ApiClient.post as jest.Mock).mockResolvedValueOnce({ status: 'APPROVED' });
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

    (ApiClient.get as jest.Mock).mockImplementation((endpoint: string) => {
      if (endpoint.startsWith('/internal/notifications/provider-status')) {
        return Promise.resolve(rawWithAccidentalSecrets);
      }
      return Promise.reject(new ApiError('Not Found', 404));
    });

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
  });

  test('Capability 10: Deliveries & Retries validates Recipient UUID, surfaces EMAIL channel filter as BLOCKED before Arena 3 migration, and inspects retry diagnostics', async () => {
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

    // Manual retry boundary surfaces BLOCKED when Arena 3 endpoint returns 404
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

    // Selecting EMAIL channel filter surfaces explicit BLOCKED (ARENA 3) message when backend returns 400
    fireEvent.change(view.getByLabelText('Recipient UUID filter'), { target: { value: '' } });
    fireEvent.change(view.getByLabelText('Delivery channel'), { target: { value: 'EMAIL' } });
    fireEvent.click(view.getByTestId('apply-delivery-filters-btn'));
    expect(await view.findByTestId('delivery-email-filter-blocked')).toBeTruthy();
  });

  test('Capability 11 & 12: Controlled Test-Send enforces notification.test_send scope, workforce destination validation, attestation, BLOCKED state, and 429 rate-limit handling without retry', async () => {
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

    // With notification.test_send -> validates destination + attestation + reason
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

    // Valid Nigerian number (normalized to +2348030000100) + attestation + reason -> hits 404 BLOCKED first
    fireEvent.change(view.getByTestId('test-send-destination-input'), {
      target: { value: '08030000100' },
    });
    fireEvent.change(view.getByTestId('test-send-reason-input'), {
      target: { value: 'Verify Robase production credential connectivity' },
    });
    fireEvent.click(view.getByTestId('test-send-workforce-attestation'));
    fireEvent.click(view.getByTestId('submit-test-send-btn'));

    expect(await view.findByTestId('test-send-blocked-banner')).toBeTruthy();
    expect(ApiClient.post).toHaveBeenCalledWith(
      '/internal/notifications/test-send',
      {
        channel: 'SMS',
        eventType: 'customer.funding.approved',
        destination: '+2348030000100',
        reason: 'Verify Robase production credential connectivity',
        workforceDestinationConfirmed: true,
      },
      expect.objectContaining({ idempotencyKey: expect.any(String) }),
    );

    // Simulate 429 Too Many Requests -> surfaces rate-limit error and does NOT retry
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

    // Now verify 403 Forbidden on mutation fails closed and does NOT retry
    seedPrincipal({
      roles: ['OPERATIONS'],
      scopes: ['notification.view_deliveries', 'notification.manage_templates'],
    });
    const makerView = render(<NotificationManagementScreen initialTab="smsTemplates" />);
    await waitFor(() => expect(makerView.getByTestId('template-workspace-sms')).toBeTruthy());

    (ApiClient.post as jest.Mock).mockRejectedValueOnce(
      new ApiError('Forbidden by route policy', 403),
    );
    fireEvent.change(makerView.getByTestId('template-change-summary-input'), {
      target: { value: 'Authorized wording refinement for funding confirmation' },
    });
    fireEvent.click(makerView.getByTestId('submit-template-version-btn'));

    const errAlert = await makerView.findByTestId('template-submit-error');
    expect((errAlert.textContent ?? '').includes('Access denied (403)')).toBe(true);
    expect(ApiClient.post).toHaveBeenCalledTimes(1);
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
