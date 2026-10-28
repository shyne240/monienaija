import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react';
import { ApiClient, ApiError } from '../src/services/api-client';
import {
  sanitizeProviderStatusForDisplay,
  type ProviderConfigProposal,
  type ProviderConfigurationOverview,
} from '../src/services/notification-domain';
import { NotificationManagementScreen } from '../src/screens/authenticated/NotificationManagementScreen';
import { useAuthStore, WorkforcePrincipal } from '../src/store/auth-store';

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
  principalId: string;
  roles: string[];
  scopes: string[];
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
      principalId: options.principalId,
      sessionId: 'test-workforce-session',
      audience: 'workforce-admin',
      roles: options.roles,
      scopes: options.scopes,
      customerAccess: 'NONE',
      assuranceLevel: options.assuranceLevel ?? 'MFA',
    },
  });
}

function makeOverviewFixture(
  overrides: Partial<ProviderConfigurationOverview> = {},
): ProviderConfigurationOverview {
  return {
    encryption: {
      available: true,
      mode: 'KEYRING_JSON',
      activeKeyVersion: 'v1',
      keyVersions: ['v1'],
    },
    worker: {
      enabled: true,
      pollIntervalMs: 5000,
      batchSize: 10,
      smsRetryMaxAttempts: 3,
      smsRetryBaseDelaySeconds: 60,
    },
    contracts: {
      robase: {
        verifiedEndpoint: 'POST /v1/sms/send',
        senderIdBehaviour:
          'Robase binds sender identity to the authenticated workspace/account; stored as governed metadata.',
        verificationBehaviour: 'Cryptographic + contract validation; test-send sets DELIVERY_TESTED.',
      },
      brevo: {
        verifiedEndpoint: 'POST /v3/smtp/email',
        verifyEndpoints: ['GET /v3/account', 'GET /v3/senders'],
        domainAuthRequirements: [
          'SPF: publish include:spf.brevo.com on sender domain TXT record.',
          'DKIM: publish Brevo DKIM TXT/CNAME selectors and verify in Brevo dashboard.',
          'DMARC: publish _dmarc.<domain> TXT policy (v=DMARC1; p=quarantine or reject).',
        ],
      },
    },
    sms: {
      channel: 'SMS',
      source: 'ENVIRONMENT',
      provider: 'console',
      enabled: true,
      lifecycleState: 'CONSOLE_ONLY',
      gates: {
        configured: false,
        verified: false,
        enabled: false,
        deliveryTested: false,
        productionReady: false,
      },
      baseUrl: null,
      requestTimeoutMs: 10000,
      senderId: null,
      senderIdNote:
        'Robase binds sender identity to the authenticated workspace/account; stored as governed metadata.',
      fromEmail: null,
      fromName: null,
      replyToEmail: null,
      credentialSource: 'NONE',
      hasStoredCredential: false,
      keyFingerprint: null,
      encryptionKeyVersion: null,
      encryptionKeyAvailable: true,
      misconfigurationCode: null,
      domainAuthentication: null,
      verification: {
        verifiedAt: null,
        verifiedBy: null,
        verificationMethod: null,
        lastVerificationError: null,
      },
      lastTest: {
        status: null,
        destinationMasked: null,
        providerRef: null,
        errorCode: null,
        testedAt: null,
        deliveryTestedAt: null,
        deliveryTestedBy: null,
      },
      version: 0,
      updatedBy: null,
      approvedBy: null,
      updatedAt: null,
    },
    email: {
      channel: 'EMAIL',
      source: 'DATABASE',
      provider: 'brevo',
      enabled: true,
      lifecycleState: 'PRODUCTION_READY',
      gates: {
        configured: true,
        verified: true,
        enabled: true,
        deliveryTested: true,
        productionReady: true,
      },
      baseUrl: 'https://api.brevo.com',
      requestTimeoutMs: 10000,
      senderId: null,
      senderIdNote: null,
      fromEmail: 'notifications@monienaija.ng',
      fromName: 'MonieNaija',
      replyToEmail: 'support@monienaija.ng',
      credentialSource: 'ENCRYPTED_DB',
      hasStoredCredential: true,
      keyFingerprint: '****XyZ9',
      encryptionKeyVersion: 'v1',
      encryptionKeyAvailable: true,
      misconfigurationCode: null,
      domainAuthentication: {
        spfConfigured: true,
        dkimConfigured: true,
        dmarcConfigured: true,
        allConfigured: true,
      },
      verification: {
        verifiedAt: '2026-10-28T09:50:00.000Z',
        verifiedBy: 'issuer:ops-1',
        verificationMethod: 'BREVO_ACCOUNT_AND_SENDER_API',
        lastVerificationError: null,
      },
      lastTest: {
        status: 'SENT',
        destinationMasked: 'op***@monienaija.ng',
        providerRef: '<brevo-1@smtp-relay.mailin.fr>',
        errorCode: null,
        testedAt: '2026-10-28T09:55:00.000Z',
        deliveryTestedAt: '2026-10-28T09:55:00.000Z',
        deliveryTestedBy: 'issuer:ops-1',
      },
      version: 2,
      updatedBy: 'issuer:fc-checker-1',
      approvedBy: 'issuer:fc-checker-1',
      updatedAt: '2026-10-28T09:55:00.000Z',
    },
    ...overrides,
  };
}

function wireStandardBackendMocks(
  overview: ProviderConfigurationOverview,
  proposals: ProviderConfigProposal[],
) {
  (ApiClient.get as jest.Mock).mockImplementation((endpoint: string) => {
    if (endpoint === '/internal/notifications/provider-config') {
      return Promise.resolve(overview);
    }
    if (endpoint.startsWith('/internal/notifications/provider-config/proposals')) {
      return Promise.resolve({ data: proposals });
    }
    if (endpoint === '/internal/notifications/provider-status') {
      return Promise.resolve({
        sms: {
          provider: overview.sms.provider,
          configured: overview.sms.gates.configured,
          enabled: overview.sms.enabled,
          lifecycleState: overview.sms.lifecycleState,
          gates: overview.sms.gates,
          keyFingerprint: overview.sms.keyFingerprint,
          senderId: overview.sms.senderId,
        },
        email: {
          provider: overview.email.provider,
          configured: overview.email.gates.configured,
          enabled: overview.email.enabled,
          lifecycleState: overview.email.lifecycleState,
          gates: overview.email.gates,
          keyFingerprint: overview.email.keyFingerprint,
          from: overview.email.fromEmail,
          fromName: overview.email.fromName,
          domainAuthentication: overview.email.domainAuthentication,
        },
        worker: overview.worker,
        rateLimit: { maxPerHour: 5 },
      });
    }
    if (endpoint.startsWith('/internal/notifications/events')) {
      return Promise.resolve([]);
    }
    if (endpoint.startsWith('/internal/notifications/templates')) {
      return Promise.resolve([]);
    }
    if (endpoint.startsWith('/internal/notifications/change-requests')) {
      return Promise.resolve([]);
    }
    if (endpoint.startsWith('/internal/notifications/deliveries')) {
      return Promise.resolve({ data: [], meta: { total: 0, page: 1, limit: 25, totalPages: 1 } });
    }
    if (endpoint.startsWith('/internal/diagnostics')) {
      return Promise.reject(new ApiError('Not Found', 404));
    }
    if (endpoint.startsWith('/internal/audit')) {
      return Promise.resolve([]);
    }
    return Promise.resolve([]);
  });
}

describe('Governed SMS (Robase) & Email (Brevo) Provider Configuration Workspace', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  it('1. preserves all 8 existing Notification Management tabs alongside Tab 9 (Provider Configuration) and renders truthful readiness states & SPF/DKIM/DMARC guidance', async () => {
    seedPrincipal({
      principalId: 'issuer:super-admin-1',
      roles: ['SUPER_ADMIN'],
      scopes: [
        'notification.view_deliveries',
        'notification.provider.view',
        'notification.provider.configure',
        'notification.test_send',
      ],
    });
    wireStandardBackendMocks(makeOverviewFixture(), []);

    const view = render(<NotificationManagementScreen />);

    // All 8 original tabs + Tab 9 exist intact
    for (const tabKey of [
      'overview',
      'events',
      'smsTemplates',
      'emailTemplates',
      'approvals',
      'providers',
      'deliveries',
      'testSend',
      'providerConfig',
    ]) {
      expect(view.getByTestId(`notif-tab-${tabKey}`)).toBeTruthy();
    }

    // Open Tab 6 -> click quick jump to Tab 9
    fireEvent.click(view.getByTestId('notif-tab-providers'));
    const jumpBtn = await view.findByTestId('jump-to-provider-config-btn');
    fireEvent.click(jumpBtn);

    const workspace = await view.findByTestId('provider-config-workspace');
    expect(workspace).toBeTruthy();
    expect(view.getByTestId('provider-encryption-banner').textContent?.includes('KEYRING_JSON')).toBe(
      true,
    );

    // Truthful badges: SMS is CONSOLE_ONLY, Email is PRODUCTION_READY with ****XyZ9 fingerprint
    expect(
      view.getByTestId('sms-lifecycle-badge').textContent?.includes('CONSOLE_ONLY'),
    ).toBe(true);
    expect(
      view.getByTestId('email-lifecycle-badge').textContent?.includes('PRODUCTION_READY'),
    ).toBe(true);
    expect(view.getByTestId('email-provider-config-panel').textContent?.includes('****XyZ9')).toBe(
      true,
    );
    expect(
      view.getByTestId('email-domain-auth-guidance').textContent?.includes('include:spf.brevo.com'),
    ).toBe(true);
  });

  it('2. validates Brevo xsmtpsib- vs xkeysib- keys, submits write-only credentials, immediately wipes password input, and never writes secrets to browser storage', async () => {
    seedPrincipal({
      principalId: 'issuer:super-admin-1',
      roles: ['SUPER_ADMIN'],
      scopes: [
        'notification.view_deliveries',
        'notification.provider.view',
        'notification.provider.configure',
      ],
    });

    const proposals: ProviderConfigProposal[] = [];
    wireStandardBackendMocks(makeOverviewFixture(), proposals);

    const sampleBrevoKey = 'xkeysib-' + 'a1b2c3d4e5f60718'.repeat(4) + '-Live9';
    let postedBody: Record<string, unknown> | null = null;
    (ApiClient.post as jest.Mock).mockImplementation(
      (endpoint: string, body: Record<string, unknown>) => {
        if (endpoint === '/internal/notifications/provider-config/proposals') {
          postedBody = body;
          const created: ProviderConfigProposal = {
            id: 'prop-email-1',
            channel: 'EMAIL',
            expectedVersion: 2,
            proposedProvider: 'brevo',
            proposedEnabled: true,
            proposedBaseUrl: 'https://api.brevo.com',
            proposedRequestTimeoutMs: 10000,
            proposedSenderId: null,
            proposedFromEmail: 'notifications@monienaija.ng',
            proposedFromName: 'MonieNaija',
            proposedReplyToEmail: 'support@monienaija.ng',
            credentialAction: 'SET_ENCRYPTED',
            proposedEncryptionKeyVersion: 'v1',
            proposedKeyFingerprint: '****ive9',
            proposedDomainAuthentication: {
              spfConfigured: true,
              dkimConfigured: true,
              dmarcConfigured: true,
            },
            reason: String(body.reason),
            status: 'REQUESTED',
            proposerPrincipalId: 'issuer:super-admin-1',
            approvalId: 'appr-1',
            actionFingerprint: 'fp-1',
            decidedBy: null,
            decidedAt: null,
            decisionReason: null,
            activatedBy: null,
            activatedAt: null,
            resultingVersion: null,
            createdAt: '2026-10-28T10:05:00.000Z',
            updatedAt: '2026-10-28T10:05:00.000Z',
          };
          proposals.unshift(created);
          return Promise.resolve(created);
        }
        return Promise.resolve({});
      },
    );

    const view = render(<NotificationManagementScreen initialTab="providerConfig" />);
    await view.findByTestId('provider-config-workspace');

    // Switch Email credential action to SET_ENCRYPTED and enter an invalid xsmtpsib- SMTP key
    fireEvent.change(view.getByTestId('email-credential-action-select'), {
      target: { value: 'SET_ENCRYPTED' },
    });
    const keyInput = (await view.findByTestId('email-api-key-input')) as HTMLInputElement;
    expect(keyInput.type).toBe('password');

    fireEvent.change(keyInput, {
      target: { value: 'xsmtpsib-1234567890abcdef1234567890abcdef' },
    });
    fireEvent.change(view.getByTestId('email-reason-input'), {
      target: { value: 'Rotate Brevo transactional email API key' },
    });
    fireEvent.click(view.getByTestId('submit-email-proposal-btn'));

    const errBanner = await view.findByTestId('email-form-errors');
    expect(errBanner.textContent?.includes('xkeysib-')).toBe(true);
    expect(postedBody).toBeNull();

    // Now enter a valid Brevo REST API key (xkeysib-...) and submit
    fireEvent.change(keyInput, { target: { value: sampleBrevoKey } });
    await act(async () => {
      fireEvent.click(view.getByTestId('submit-email-proposal-btn'));
    });

    await waitFor(() => {
      expect(postedBody).not.toBeNull();
    });
    expect(postedBody!['apiKey']).toBe(sampleBrevoKey);

    // Password field wiped immediately on submit & secret NEVER written to browser storage or DOM
    expect(
      (view.queryByTestId('email-api-key-input') as HTMLInputElement | null)?.value ?? '',
    ).toBe('');
    expect(JSON.stringify(window.localStorage)).not.toContain(sampleBrevoKey);
    expect(JSON.stringify(window.sessionStorage)).not.toContain(sampleBrevoKey);
    expect(view.container.textContent?.includes(sampleBrevoKey)).toBe(false);

    // Maker sees Self-Approval Prohibited badge on their own REQUESTED proposal
    const selfBlock = await view.findByTestId('self-approval-blocked-prop-email-1');
    expect(selfBlock.textContent?.includes('Self-Approval Prohibited')).toBe(true);
  });

  it('3. enforces independent checker approval & activation for FINANCE_CONTROLLER', async () => {
    const requestedProposal: ProviderConfigProposal = {
      id: 'prop-sms-1',
      channel: 'SMS',
      expectedVersion: 0,
      proposedProvider: 'robase',
      proposedEnabled: true,
      proposedBaseUrl: 'https://api.robase.dev',
      proposedRequestTimeoutMs: 10000,
      proposedSenderId: 'MonieNaija',
      proposedFromEmail: null,
      proposedFromName: null,
      proposedReplyToEmail: null,
      credentialAction: 'SET_ENCRYPTED',
      proposedEncryptionKeyVersion: 'v1',
      proposedKeyFingerprint: '****7081',
      proposedDomainAuthentication: {
        spfConfigured: false,
        dkimConfigured: false,
        dmarcConfigured: false,
      },
      reason: 'Configure Robase SMS live workspace credential',
      status: 'REQUESTED',
      proposerPrincipalId: 'issuer:super-admin-1',
      approvalId: 'appr-sms-1',
      actionFingerprint: 'fp-sms-1',
      decidedBy: null,
      decidedAt: null,
      decisionReason: null,
      activatedBy: null,
      activatedAt: null,
      resultingVersion: null,
      createdAt: '2026-10-28T10:10:00.000Z',
      updatedAt: '2026-10-28T10:10:00.000Z',
    };

    const proposals = [requestedProposal];
    const overview = makeOverviewFixture();
    wireStandardBackendMocks(overview, proposals);

    (ApiClient.post as jest.Mock).mockImplementation((endpoint: string) => {
      if (endpoint === '/internal/notifications/provider-config/proposals/prop-sms-1/approve') {
        proposals[0] = {
          ...proposals[0]!,
          status: 'APPROVED',
          decidedBy: 'issuer:fc-checker-2',
          decidedAt: '2026-10-28T10:12:00.000Z',
        };
        return Promise.resolve(proposals[0]);
      }
      if (endpoint === '/internal/notifications/provider-config/proposals/prop-sms-1/activate') {
        proposals[0] = {
          ...proposals[0]!,
          status: 'ACTIVATED',
          activatedBy: 'issuer:fc-checker-2',
          activatedAt: '2026-10-28T10:13:00.000Z',
          resultingVersion: 1,
        };
        overview.sms = {
          ...overview.sms,
          source: 'DATABASE',
          provider: 'robase',
          enabled: true,
          lifecycleState: 'ENABLED',
          gates: {
            configured: true,
            verified: false,
            enabled: true,
            deliveryTested: false,
            productionReady: false,
          },
          baseUrl: 'https://api.robase.dev',
          senderId: 'MonieNaija',
          credentialSource: 'ENCRYPTED_DB',
          hasStoredCredential: true,
          keyFingerprint: '****7081',
          encryptionKeyVersion: 'v1',
          version: 1,
        };
        return Promise.resolve({ proposal: proposals[0], configuration: overview.sms });
      }
      return Promise.resolve({});
    });

    // Independent FINANCE_CONTROLLER (checker) approves and activates
    seedPrincipal({
      principalId: 'issuer:fc-checker-2',
      roles: ['FINANCE_CONTROLLER'],
      scopes: [
        'notification.view_deliveries',
        'notification.provider.view',
        'notification.provider.configure',
      ],
    });

    const view = render(<NotificationManagementScreen initialTab="providerConfig" />);
    const approveBtn = await view.findByTestId('approve-provider-proposal-prop-sms-1');
    await act(async () => {
      fireEvent.click(approveBtn);
    });

    const activateBtn = await view.findByTestId('activate-provider-proposal-prop-sms-1');
    await act(async () => {
      fireEvent.click(activateBtn);
    });

    await waitFor(() => {
      expect(
        view.getByTestId('sms-lifecycle-badge').textContent?.includes('ENABLED'),
      ).toBe(true);
    });
  });

  it('4. sanitizeProviderStatusForDisplay strips raw robe_, xkeysib-, xsmtpsib-, re_, and MNNPS1: envelopes aggressively', () => {
    const dirty = {
      sms: {
        provider: 'robase',
        apiKey: 'robe_secret_should_vanish',
        strayNote: 'robe_1234567890abcdef1234567890abcdef',
        keyFingerprint: 'robe_1234567890abcdef9988',
      },
      email: {
        provider: 'brevo',
        encrypted_api_key: 'MNNPS1:v1:aaaa:bbbb:cccc',
        diagnostic: 'xkeysib-abcdef0123456789abcdef0123456789',
        smtpLeak: 'xsmtpsib-abcdef0123456789abcdef0123456789',
      },
    };

    const scrubbed = sanitizeProviderStatusForDisplay(dirty);
    const serialized = JSON.stringify(scrubbed);
    expect(serialized).not.toContain('robe_');
    expect(serialized).not.toContain('xkeysib-');
    expect(serialized).not.toContain('xsmtpsib-');
    expect(serialized).not.toContain('MNNPS1:');
    expect(scrubbed.sms.keyFingerprint).toBe('****9988');
  });
});
