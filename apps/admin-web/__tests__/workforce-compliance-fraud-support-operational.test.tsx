import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ComplianceScreen } from '../src/screens/authenticated/ComplianceScreen';
import { RiskFraudScreen } from '../src/screens/authenticated/RiskFraudScreen';
import { SupportTicketsScreen } from '../src/screens/authenticated/SupportTicketsScreen';
import { KycProviderManagementScreen } from '../src/screens/authenticated/KycProviderManagementScreen';
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

const CASE_UUID = '11111111-2222-4333-8444-555555555555';
const CUST_UUID = '22222222-3333-4444-8555-666666666666';

function setWorkforcePrincipal(roleKey: string, scopes: string[], principalId = `ops:${roleKey}`) {
  useAuthStore.setState({
    principal: {
      type: 'OPERATOR',
      principalId,
      sessionId: `sess-${roleKey}`,
      audience: 'workforce-admin',
      roles: [roleKey],
      scopes,
      customerAccess: 'NONE',
      assuranceLevel: 'MFA',
    },
    sessionId: `sess-${roleKey}`,
    token: `tok-${roleKey}`,
    isAuthenticated: true,
  });
}

describe('Workforce Compliance, Fraud, KYC Review & Support Operational Surfaces', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  test('ComplianceScreen (mode="kyc") loads operational queue and renders restricted evidence dossier for FINANCE_AUDITOR', async () => {
    setWorkforcePrincipal('FINANCE_AUDITOR', ['kyc.view']);

    (ApiClient.get as jest.Mock).mockImplementation((url: string) => {
      if (url.startsWith('/internal/kyc/review-workspace/queue')) {
        return Promise.resolve({
          scopeMode: 'PLATFORM',
          institutionIds: null,
          total: 1,
          page: 1,
          limit: 15,
          counts: {
            total: 1,
            pendingReview: 1,
            manualHolds: 0,
            rejected: 0,
            notStarted: 0,
            approved: 0,
          },
          items: [
            {
              customerId: CUST_UUID,
              displayName: 'Amina Abdullahi',
              customerStatus: 'ACTIVE',
              kycLevel: 'NONE',
              kycStatus: 'PENDING',
              tierStatus: 'TIER_0',
              manualReviewHold: false,
              primaryInstitutionId: 'inst-alpha',
              primaryInstitutionCode: 'INST-ALPHA',
              primaryInstitutionName: 'Alpha MFB',
              enrolmentEligibility: 'PENDING_KYC',
              identityDocumentCount: 1,
              pendingPoaCount: 1,
              lastAssessedAt: null,
            },
          ],
        });
      }
      if (url === `/internal/kyc/review-workspace/customers/${CUST_UUID}`) {
        return Promise.resolve({
          customer: {
            id: CUST_UUID,
            displayName: 'Amina Abdullahi',
            status: 'ACTIVE',
          },
          institutions: [],
          kycSummary: {
            customerId: CUST_UUID,
            level: 'NONE',
            status: 'PENDING',
            reason: 'MANUAL_REVIEW',
          },
          tierState: {
            currentTier: 'TIER_0',
            manualReviewHold: false,
            activeFlags: [],
          },
          evidenceStatus: {
            identityDocuments: {
              access: 'RESTRICTED',
              requiredScope: 'customer.view_identity_documents',
              items: null,
            },
            proofOfAddress: {
              access: 'RESTRICTED',
              requiredScope: 'customer.view_proof_of_address_metadata',
              items: null,
            },
          },
          governance: {
            providerRouting: {
              access: 'RESTRICTED',
              requiredScope: 'kyc.provider.view',
              providers: null,
            },
            tierPolicy: {
              access: 'SUMMARY_ONLY',
              activeVersion: 1,
              policy: null,
            },
          },
          supportedDecisions: {
            readOnlyPrincipal: true,
            canPlaceHoldPending: false,
            canApprove: false,
            canReject: false,
          },
          recentAssessments: [],
        });
      }
      if (url === `/customers/${CUST_UUID}/kyc`) {
        return Promise.resolve({
          customerId: CUST_UUID,
          level: 'NONE',
          status: 'PENDING',
          reason: 'MANUAL_REVIEW',
        });
      }
      return Promise.resolve({});
    });

    render(<ComplianceScreen mode="kyc" />);

    fireEvent.click(screen.getByRole('button', { name: 'Load operational KYC queue' }));
    expect(await screen.findByText('Amina Abdullahi')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: `Review customer ${CUST_UUID}` }));

    expect(await screen.findByText(/customer\.view_identity_documents/)).toBeTruthy();
    expect(screen.getByText(/customer\.view_proof_of_address_metadata/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Submit Assessment' })).toBeNull();
  });

  test('ComplianceScreen (mode="cases") opens ComplianceCaseDrawer and executes singular assignment + version-consistent status update', async () => {
    setWorkforcePrincipal('COMPLIANCE', ['compliance.manage_case'], 'ops:compliance-01');

    let currentVersion = 1;
    let currentStatus = 'OPEN';
    let currentAssignedTo: string | null = null;

    (ApiClient.get as jest.Mock).mockImplementation((url: string) => {
      if (url.startsWith('/internal/compliance-cases')) {
        return Promise.resolve({
          scopeMode: 'PLATFORM',
          total: 1,
          page: 1,
          limit: 20,
          counts: {
            total: 1,
            open: 1,
            underReview: 0,
            escalated: 0,
            resolved: 0,
            closed: 0,
            criticalOrHighActive: 1,
          },
          items: [
            {
              id: CASE_UUID,
              customerId: CUST_UUID,
              customerDisplayName: 'Amina Abdullahi',
              caseNumber: 'cc-ops-aml-0001',
              category: 'AML',
              severity: 'HIGH',
              status: currentStatus,
              version: currentVersion,
              assignedTo: currentAssignedTo,
            },
          ],
        });
      }
      if (url === `/customers/${CUST_UUID}/compliance-cases/${CASE_UUID}`) {
        return Promise.resolve({
          id: CASE_UUID,
          customerId: CUST_UUID,
          caseNumber: 'cc-ops-aml-0001',
          category: 'AML',
          severity: 'HIGH',
          status: currentStatus,
          version: currentVersion,
          assignedTo: currentAssignedTo,
        });
      }
      if (url.endsWith('/comments') || url.endsWith('/evidence') || url.endsWith('/history')) {
        return Promise.resolve([]);
      }
      return Promise.resolve([]);
    });

    (ApiClient.post as jest.Mock).mockImplementation((url: string, body: any) => {
      if (url === `/customers/${CUST_UUID}/compliance-cases/${CASE_UUID}/assignment`) {
        currentAssignedTo = body.assignedTo;
        currentVersion += 1;
        return Promise.resolve({ assignedTo: currentAssignedTo });
      }
      if (url === `/customers/${CUST_UUID}/compliance-cases/${CASE_UUID}/comment`) {
        return Promise.resolve({ id: 'cmt-1', comment: body.comment });
      }
      return Promise.resolve({});
    });

    (ApiClient.patch as jest.Mock).mockImplementation((url: string, body: any) => {
      if (url === `/customers/${CUST_UUID}/compliance-cases/${CASE_UUID}`) {
        currentStatus = body.status;
        currentVersion += 1;
        return Promise.resolve({
          id: CASE_UUID,
          customerId: CUST_UUID,
          caseNumber: 'cc-ops-aml-0001',
          category: 'AML',
          severity: 'HIGH',
          status: currentStatus,
          version: currentVersion,
          assignedTo: currentAssignedTo,
        });
      }
      return Promise.resolve({});
    });

    render(<ComplianceScreen mode="cases" />);

    fireEvent.click(screen.getByRole('button', { name: 'Load compliance queue' }));
    expect(await screen.findByText('cc-ops-aml-0001')).toBeTruthy();

    fireEvent.click(
      screen.getByRole('button', { name: 'Inspect queue case cc-ops-aml-0001' }),
    );
    expect(await screen.findByText('AUTHORIZED CASE RECORD')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Assign to me' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save assignment' }));

    await waitFor(() =>
      expect(ApiClient.post).toHaveBeenCalledWith(
        `/customers/${CUST_UUID}/compliance-cases/${CASE_UUID}/assignment`,
        expect.objectContaining({ assignedTo: 'ops:compliance-01' }),
      ),
    );

    fireEvent.change(screen.getByLabelText('Case status'), {
      target: { value: 'UNDER_REVIEW' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save case status' }));

    await waitFor(() =>
      expect(ApiClient.patch).toHaveBeenCalledWith(
        `/customers/${CUST_UUID}/compliance-cases/${CASE_UUID}`,
        expect.objectContaining({ status: 'UNDER_REVIEW', version: 2 }),
      ),
    );
  });

  test('RiskFraudScreen loads FRAUD scope queue without exposing non-FRAUD categories', async () => {
    setWorkforcePrincipal('RISK_FRAUD', ['risk_fraud.manage_fraud_case']);

    (ApiClient.get as jest.Mock).mockImplementation((url: string) => {
      if (url.startsWith('/internal/compliance-cases')) {
        expect(url).toContain('scope=FRAUD');
        return Promise.resolve({
          scopeMode: 'ASSIGNED_INSTITUTIONS',
          total: 1,
          page: 1,
          limit: 20,
          counts: {
            total: 1,
            open: 1,
            underReview: 0,
            escalated: 0,
            resolved: 0,
            closed: 0,
            criticalOrHighActive: 1,
          },
          items: [
            {
              id: 'case-frd-1',
              customerId: 'cust-0004',
              customerDisplayName: 'Emeka Okafor',
              caseNumber: 'cc-ops-frd-0004',
              category: 'FRAUD',
              severity: 'CRITICAL',
              status: 'OPEN',
              version: 1,
            },
          ],
        });
      }
      return Promise.resolve([]);
    });

    render(<RiskFraudScreen />);

    fireEvent.click(screen.getByRole('button', { name: 'Load FRAUD queue' }));
    expect(await screen.findByText('cc-ops-frd-0004')).toBeTruthy();
  });

  test('SupportTicketsScreen loads internal customer ticket and triggers Customer 360° jump', async () => {
    setWorkforcePrincipal('CUSTOMER_SERVICE', ['customer.manage_support_case']);
    const onNavigateToCustomer = jest.fn();

    (ApiClient.get as jest.Mock).mockImplementation((url: string) => {
      if (url.startsWith('/internal/support/tickets?')) {
        return Promise.resolve({
          pagination: { total: 1, page: 1, limit: 20 },
          counts: {
            total: 1,
            open: 1,
            inProgress: 0,
            waitingOnCustomer: 0,
            resolved: 0,
            closed: 0,
            unassignedActive: 1,
            urgentOrHighActive: 1,
          },
          items: [
            {
              id: 'tkt-0001',
              reference: 'TKT-OPS-0001',
              subject: 'Tier upgrade verification inquiry',
              category: 'PROFILE',
              priority: 'HIGH',
              status: 'OPEN',
              customerId: CUST_UUID,
              agentId: null,
              assignedTo: null,
              version: 1,
              createdAt: '2026-11-25T10:00:00.000Z',
              updatedAt: '2026-11-25T10:00:00.000Z',
            },
          ],
        });
      }
      if (url === '/internal/support/tickets/tkt-0001/messages') {
        return Promise.resolve([]);
      }
      if (url === '/internal/support/tickets/tkt-0001') {
        return Promise.resolve({
          id: 'tkt-0001',
          reference: 'TKT-OPS-0001',
          subject: 'Tier upgrade verification inquiry',
          description: 'Customer requested tier verification update.',
          category: 'PROFILE',
          priority: 'HIGH',
          status: 'OPEN',
          customerId: CUST_UUID,
          agentId: null,
          assignedTo: null,
          version: 1,
          createdAt: '2026-11-25T10:00:00.000Z',
          updatedAt: '2026-11-25T10:00:00.000Z',
        });
      }
      return Promise.resolve({});
    });

    render(<SupportTicketsScreen onNavigateToCustomer={onNavigateToCustomer} />);

    expect(await screen.findByText('TKT-OPS-0001')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'View' }));

    const openCustomerBtn = await screen.findByRole('button', { name: 'Open Customer 360°' });
    fireEvent.click(openCustomerBtn);
    expect(onNavigateToCustomer).toHaveBeenCalledWith(CUST_UUID);
  });

  test('KycProviderManagementScreen displays governed Monnify, Dojah, and Prembly routing role matrix', async () => {
    setWorkforcePrincipal('SUPER_ADMIN', ['kyc.provider.view', 'kyc.provider.propose']);

    (ApiClient.get as jest.Mock).mockImplementation((url: string) => {
      if (url === '/internal/kyc/providers') {
        return Promise.resolve({
          version: 1,
          configuration: {
            providers: {
              MONNIFY: { enabled: true, capabilities: ['BVN', 'NIN'] },
              DOJAH: { enabled: false, capabilities: [] },
              PREMBLY: { enabled: false, capabilities: [] },
              SYNTHETIC: { enabled: false, capabilities: [] },
            },
            routes: {
              BVN: { primary: 'MONNIFY', fallback: null },
              NIN: { primary: null, fallback: null },
              ADDRESS_VERIFICATION: { primary: null, fallback: null },
              ENHANCED_DUE_DILIGENCE: { primary: null, fallback: null },
            },
          },
          catalogue: [
            {
              code: 'MONNIFY',
              candidateCapabilities: ['BVN', 'NIN'],
              confirmedCapabilities: [],
              testOnly: false,
              ready: false,
              capabilities: [
                { code: 'BVN', candidate: true, confirmed: false, ready: false },
                { code: 'NIN', candidate: true, confirmed: false, ready: false },
              ],
            },
            {
              code: 'DOJAH',
              candidateCapabilities: [
                'BVN',
                'NIN',
                'ADDRESS_VERIFICATION',
                'ENHANCED_DUE_DILIGENCE',
              ],
              confirmedCapabilities: [],
              testOnly: false,
              ready: false,
              capabilities: [
                { code: 'BVN', candidate: true, confirmed: false, ready: false },
                { code: 'NIN', candidate: true, confirmed: false, ready: false },
              ],
            },
            {
              code: 'PREMBLY',
              candidateCapabilities: ['BVN', 'NIN'],
              confirmedCapabilities: [],
              testOnly: false,
              ready: false,
              capabilities: [
                { code: 'BVN', candidate: true, confirmed: false, ready: false },
                { code: 'NIN', candidate: true, confirmed: false, ready: false },
              ],
            },
          ],
        });
      }
      if (url === '/internal/kyc/providers/proposals') return Promise.resolve([]);
      if (url === '/internal/kyc/providers/history') return Promise.resolve([]);
      if (url === '/internal/kyc/providers/prembly/credentials') {
        return Promise.resolve({
          provider: 'PREMBLY',
          encryptionAvailable: false,
          sandboxTestEnabled: false,
          productionReleased: false,
          sandbox: {
            configured: false,
            version: 0,
            fingerprint: null,
            keyVersion: null,
            updatedAt: null,
          },
          production: {
            configured: false,
            version: 0,
            fingerprint: null,
            keyVersion: null,
            updatedAt: null,
          },
        });
      }
      if (url === '/internal/kyc/providers/prembly/credential-proposals') {
        return Promise.resolve([]);
      }
      return Promise.resolve([]);
    });

    render(<KycProviderManagementScreen />);

    expect(await screen.findByText('Provider roles & routing paths')).toBeTruthy();
    expect(screen.getByText('MONNIFY — Identity (BVN / NIN)')).toBeTruthy();
    expect(screen.getByText('DOJAH — Identity & Address Assurance')).toBeTruthy();
    expect(screen.getByText('PREMBLY — Governed BVN / NIN Adapter')).toBeTruthy();
  });
});
