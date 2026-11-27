/** @jest-environment jsdom */
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ApiClient } from '../src/services/api-client';
import { useAuthStore } from '../src/store/auth-store';
import { PlatformFundsScreen } from '../src/screens/authenticated/PlatformFundsScreen';
import { ReconciliationObservabilityScreen } from '../src/screens/authenticated/ReconciliationObservabilityScreen';
import { SettlementReportReconciliationPanel } from '../src/screens/authenticated/SettlementReportReconciliationPanel';

jest.mock('../src/services/api-client', () => ({
  ApiClient: {
    get: jest.fn(),
    post: jest.fn(),
    put: jest.fn(),
    patch: jest.fn(),
    delete: jest.fn(),
  },
}));

const MOCK_OVERVIEW_MAKER = {
  capabilities: {
    canView: true,
    canImportAndPropose: true,
    canReview: false,
    mfaVerified: true,
    hasPlatformAuthority: true,
    assignedInstitutionIds: ['11111111-1111-4111-8111-111111111111'],
  },
  selectableInstitutions: [
    {
      id: '11111111-1111-4111-8111-111111111111',
      code: 'INST_KANO',
      displayName: 'Kano Partner MFB',
    },
  ],
  formatDescriptors: [
    {
      providerKey: 'MONNIFY',
      providerDisplayName: 'Monnify',
      reportType: 'COLLECTIONS',
      fileFormat: 'JSON',
      supported: true,
      verificationStatus: 'VERIFIED_OFFICIAL_API_JSON',
      documentedSource: 'Monnify API GET /api/v1/merchant/transactions/search',
      missingSampleNeeded: null,
      note: 'Verified against official Monnify API JSON.',
    },
    {
      providerKey: 'MONNIFY',
      providerDisplayName: 'Monnify',
      reportType: 'COLLECTIONS',
      fileFormat: 'CSV',
      supported: true,
      verificationStatus: 'UNVERIFIED_MISSING_REDACTED_EXPORT',
      documentedSource: 'Monnify Dashboard → Transactions → Export CSV',
      missingSampleNeeded: 'Redacted Monnify Dashboard Collections CSV export',
      note: 'Unverified exact CSV header layout.',
    },
  ],
  summary: {
    importsCount: 2,
    unverifiedFormatImportsCount: 1,
    matchedTransactionsCount: 3,
    exceptionTransactionsCount: 1,
    pendingTransactionReviewsCount: 0,
    reconciledSettlementsCount: 1,
    openSettlementBreaksCount: 1,
    pendingSettlementReviewsCount: 0,
    openReturnDisputeCasesCount: 1,
    reconciledReturnDisputeCasesCount: 0,
    pendingReturnDisputeReviewsCount: 0,
  },
};

describe('Settlement Report & Statement Reconciliation Admin Web UI', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    (ApiClient.get as jest.Mock).mockImplementation((path: string) => {
      if (path.startsWith('/internal/finance-operations/platform-funds/scope')) {
        return Promise.resolve({
          mode: 'PLATFORM',
          institutionIds: [],
          platformFunctionGranted: true,
        });
      }
      if (path.startsWith('/internal/finance-operations/platform-funds/settlement-accounts')) {
        return Promise.resolve({ items: [] });
      }
      if (path.startsWith('/internal/finance-operations/platform-funds/comparisons')) {
        return Promise.resolve({
          items: [],
          total: 0,
          limit: 25,
          offset: 0,
          scope: { mode: 'PLATFORM', institutionIds: [], platformFunctionGranted: true },
        });
      }
      if (path.startsWith('/internal/finance-operations/settlement-reconciliation/overview')) {
        return Promise.resolve(MOCK_OVERVIEW_MAKER);
      }
      if (path.startsWith('/internal/finance-operations/settlement-reconciliation/imports')) {
        return Promise.resolve({
          items: [
            {
              id: 'imp-1',
              institutionId: '11111111-1111-4111-8111-111111111111',
              institutionCode: 'INST_KANO',
              providerKey: 'MONNIFY',
              reportType: 'COLLECTIONS',
              fileFormat: 'CSV',
              verificationStatus: 'UNVERIFIED_MISSING_REDACTED_EXPORT',
              verificationNote: 'Unverified CSV header layout',
              sourceFilename: 'monnify-collections.csv',
              contentSha256: 'a'.repeat(64),
              currency: 'NGN',
              periodStart: null,
              periodEnd: null,
              statementDestination: 'BANK_ACCOUNT',
              maskedStatementAccount: '••••••6789',
              totalRows: 4,
              validRows: 4,
              rejectedRows: 0,
              duplicateRowsSkipped: 0,
              grossTotalMinor: '1000000',
              providerFeeTotalMinor: '15000',
              netTotalMinor: '985000',
              importedBy: 'finance-preparer',
              importerNote: null,
              importedAt: '2026-11-26T10:00:00.000Z',
            },
          ],
        });
      }
      if (
        path.startsWith(
          '/internal/finance-operations/settlement-reconciliation/transaction-matches',
        )
      ) {
        return Promise.resolve({
          items: [
            {
              id: 'match-1',
              institutionId: '11111111-1111-4111-8111-111111111111',
              institutionCode: 'INST_KANO',
              providerKey: 'MONNIFY',
              direction: 'INBOUND',
              matchStatus: 'FEE_MISMATCH',
              matchedKeys: ['providerTransactionReference'],
              reportRowId: 'row-1',
              providerReference: 'MNFY|20261126|999',
              providerPlatformReference: 'MNJ-B2W-999',
              nipSessionId: null,
              settlementReference: 'SET-001',
              internalSourceType: 'BANKING_INBOUND_PAYMENT',
              internalSourceId: '22222222-2222-4222-8222-222222222222',
              internalBusinessReference: 'MNJ-B2W-999',
              internalProviderReference: 'MNFY|20261126|999',
              internalTransactionHistoryPath:
                '#transaction-history/BANK_TO_WALLET/22222222-2222-4222-8222-222222222222',
              internalJournalIds: ['33333333-3333-4333-8333-333333333333'],
              currency: 'NGN',
              providerGrossMinor: '1000000',
              providerFeeMinor: '20000',
              providerNetMinor: '980000',
              internalGrossMinor: '1000000',
              internalProviderFeeMinor: '15000',
              internalPlatformFeeMinor: '5000',
              internalCustomerCreditMinor: '995000',
              internalNetMinor: '985000',
              varianceMinor: '-5000',
              feeVarianceMinor: '5000',
              providerStatus: 'PAID',
              internalStatus: 'CREDITED',
              providerOccurredAt: '2026-11-26T10:00:00.000Z',
              internalOccurredAt: '2026-11-26T10:00:05.000Z',
              maskedAccount: '••••••6789',
              ambiguousCandidates: [],
              explanation: 'Monnify deducted ₦200.00 fee vs expected ₦150.00.',
              reviewState: 'NONE',
              proposedDecision: null,
              proposedNote: null,
              proposedBy: null,
              proposedAt: null,
              reviewedBy: null,
              reviewNote: null,
              reviewedAt: null,
              linkedJournalId: null,
              updatedAt: '2026-11-26T10:05:00.000Z',
            },
          ],
        });
      }
      if (
        path.startsWith('/internal/finance-operations/settlement-reconciliation/settlement-batches')
      ) {
        return Promise.resolve({
          items: [
            {
              id: 'batch-1',
              institutionId: '11111111-1111-4111-8111-111111111111',
              institutionCode: 'INST_KANO',
              providerKey: 'MONNIFY',
              settlementReference: 'SET-20261126-A',
              payoutReference: 'PO-001',
              statementDestination: 'BANK_ACCOUNT',
              maskedDestinationAccount: '••••••5060',
              currency: 'NGN',
              settledAt: '2026-11-26T12:00:00.000Z',
              grossCollectionsMinor: '1000000',
              providerFeeTotalMinor: '15000',
              expectedNetSettlementMinor: '985000',
              platformFeeTotalMinor: '5000',
              customerWalletCreditTotalMinor: '995000',
              reportedNetSettlementMinor: '985000',
              statementCreditMinor: null,
              varianceMinor: '-985000',
              matchedCollectionCount: 1,
              missingCollectionCount: 0,
              batchStatus: 'STATEMENT_UNMATCHED',
              settlementReportRowId: 'row-set-1',
              statementReportRowId: null,
              linkedJournalId: null,
              linkedComparisonId: null,
              explanation: 'Awaiting commercial bank statement credit matching SET-20261126-A.',
              reviewState: 'NONE',
              proposedDecision: null,
              proposedNote: null,
              proposedBy: null,
              proposedAt: null,
              reviewedBy: null,
              reviewNote: null,
              reviewedAt: null,
              updatedAt: '2026-11-26T12:05:00.000Z',
            },
          ],
        });
      }
      if (
        path.startsWith(
          '/internal/finance-operations/settlement-reconciliation/return-dispute-cases',
        )
      ) {
        return Promise.resolve({
          items: [
            {
              id: 'case-1',
              institutionId: '11111111-1111-4111-8111-111111111111',
              institutionCode: 'INST_KANO',
              providerKey: 'MONNIFY',
              caseKey: 'REF-001',
              caseKind: 'VOLUNTARY_REFUND',
              lifecycleStatus: 'AWAITING_PROVIDER_CONFIRMATION',
              originalSourceType: 'BANKING_INBOUND_PAYMENT',
              originalSourceId: '22222222-2222-4222-8222-222222222222',
              originalBusinessReference: 'MNJ-B2W-999',
              originalProviderReference: 'MNFY|20261126|999',
              originalTransactionHistoryPath:
                '#transaction-history/BANK_TO_WALLET/22222222-2222-4222-8222-222222222222',
              originalGrossMinor: '1000000',
              originalProviderFeeMinor: '15000',
              originalNetMinor: '985000',
              originalCurrency: 'NGN',
              originalJournalIds: ['33333333-3333-4333-8333-333333333333'],
              returnOrDisputeReference: 'MNFY-REF-001',
              eventAmountMinor: '1000000',
              providerEventStatus: 'PENDING',
              providerReportRowId: 'row-ref-1',
              internalDisputeId: null,
              linkedReversalJournalId: null,
              explanation: 'Original collection frozen; refund awaiting provider completion.',
              reviewState: 'NONE',
              proposedDecision: null,
              proposedNote: null,
              proposedBy: null,
              proposedAt: null,
              reviewedBy: null,
              reviewNote: null,
              reviewedAt: null,
              updatedAt: '2026-11-26T13:00:00.000Z',
            },
          ],
        });
      }
      return Promise.resolve([]);
    });
  });

  it('exposes Settlement Report Reconciliation inside PlatformFundsScreen for FINANCE_PREPARER and renders all 4 workflows + format warnings', async () => {
    useAuthStore.setState({
      isAuthenticated: true,
      isLoading: false,
      sessionId: 'sess-prep',
      principal: {
        principalId: 'prep-1',
        sessionId: 'sess-prep',
        type: 'OPERATOR',
        roles: ['FINANCE_PREPARER'],
        scopes: ['ledger.view', 'finance.prepare'],
        assuranceLevel: 'MFA',
        customerAccess: 'NONE',
        readOnlyPrincipal: false,
      } as never,
    });

    const onOpenJournal = jest.fn();
    render(<PlatformFundsScreen onOpenJournal={onOpenJournal} />);

    // Switch to Provider Settlement Reports & Statements workspace
    fireEvent.click(
      screen.getByRole('button', { name: /Provider Settlement Reports & Statements/i }),
    );

    expect(await screen.findByTestId('settlement-report-reconciliation-panel')).toBeTruthy();
    expect(await screen.findByText('monnify-collections.csv')).toBeTruthy();
    expect(screen.getByText('UNVERIFIED EXPORT')).toBeTruthy();

    // Preview an unverified CSV import and verify explicit warning
    (ApiClient.post as jest.Mock).mockResolvedValueOnce({
      providerKey: 'MONNIFY',
      reportType: 'COLLECTIONS',
      fileFormat: 'CSV',
      verificationStatus: 'UNVERIFIED_MISSING_REDACTED_EXPORT',
      verificationNote: 'Exact CSV header layout has not been verified against a live sample.',
      missingSampleNeeded: 'Redacted Monnify Dashboard Collections CSV export',
      currency: 'NGN',
      maskedStatementAccount: '••••••6789',
      alreadyImportedFileId: null,
      totalRows: 1,
      validRowsCount: 1,
      rejectedRowsCount: 0,
      intraFileDuplicateRowsCount: 0,
      priorImportDuplicateRowsCount: 0,
      grossTotalMinor: '1200000',
      providerFeeTotalMinor: '18000',
      netTotalMinor: '1182000',
      financeReviewRowsCount: 1,
      internalMerchantSettlementTotalMinor: '985000',
      internalPlatformFeeTotalMinor: '5000',
      internalCustomerCreditTotalMinor: '980000',
      predictedCounts: { MATCHED: 1, AMBIGUOUS_CANDIDATES: 1 },
      sampleValidRows: [
        {
          rowNumber: 1,
          direction: 'INBOUND',
          providerTransactionReference: 'MNFY|1',
          platformReference: 'MNJ-PAY-1',
          settlementReference: 'SET-001',
          nipSessionId: null,
          grossAmountMinor: '1000000',
          providerFeeMinor: '15000',
          netAmountMinor: '985000',
          providerStatus: 'PAID',
          occurredAt: '2026-11-26T09:10:00.000Z',
          maskedAccount: '••••••6789',
          predictedStatus: 'MATCHED',
          requiresFinanceReview: false,
          internalMerchantSettlementMinor: '985000',
          internalPlatformFeeMinor: '5000',
          internalCustomerCreditMinor: '980000',
          ambiguousCandidatesCount: 0,
          explanation: 'Exact match',
        },
        {
          rowNumber: 2,
          direction: 'INBOUND',
          providerTransactionReference: 'MNFY|AMB|2',
          platformReference: 'MNJ-AMB-2',
          settlementReference: 'SET-001',
          nipSessionId: null,
          grossAmountMinor: '200000',
          providerFeeMinor: '3000',
          netAmountMinor: '197000',
          providerStatus: 'PAID',
          occurredAt: '2026-11-26T09:40:00.000Z',
          maskedAccount: '••••••6789',
          predictedStatus: 'AMBIGUOUS_CANDIDATES',
          requiresFinanceReview: true,
          internalMerchantSettlementMinor: null,
          internalPlatformFeeMinor: null,
          internalCustomerCreditMinor: null,
          ambiguousCandidatesCount: 2,
          explanation: 'Multiple internal candidates share payment reference MNJ-AMB-2',
        },
      ],
      rejectedRows: [],
    });

    fireEvent.change(screen.getByTestId('sr-report-content-textarea'), {
      target: { value: 'Transaction Reference,Amount Paid\nMNFY|1,10000.00\nMNFY|AMB|2,2000.00' },
    });
    fireEvent.click(screen.getByTestId('sr-preview-btn'));

    expect(await screen.findByText('UNVERIFIED EXPORT FORMAT')).toBeTruthy();
    expect(screen.getByText(/Redacted Monnify Dashboard Collections CSV export/i)).toBeTruthy();
    expect(screen.getByTestId('sr-preview-rows-table')).toBeTruthy();
    expect(screen.getAllByText('₦9,850.00').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('₦50.00').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('₦9,800.00').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByTestId('sr-preview-review-flag-2')).toBeTruthy();

    // Workflow 2: Transaction Matching — FINANCE_PREPARER lacks transaction.view so history link is explained, while Journal link works
    fireEvent.click(screen.getByRole('button', { name: /2\. Transaction Matching/i }));
    expect(await screen.findByText('MNJ-B2W-999')).toBeTruthy();
    expect(screen.getAllByText('FEE_MISMATCH').length).toBeGreaterThanOrEqual(2);
    fireEvent.click(screen.getByRole('button', { name: 'Inspect' }));

    expect(await screen.findByText(/requires/i)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Open Journal 33333333/i }));
    expect(onOpenJournal).toHaveBeenCalledWith('33333333-3333-4333-8333-333333333333');

    // Workflow 3: Settlement & Statement
    fireEvent.click(screen.getByRole('button', { name: /3\. Settlement & Statement/i }));
    expect(await screen.findByText('SET-20261126-A')).toBeTruthy();
    expect(screen.getAllByText('STATEMENT_UNMATCHED').length).toBeGreaterThanOrEqual(2);

    // Workflow 4: Returns & Disputes
    fireEvent.click(screen.getByRole('button', { name: /4\. Returns & Disputes/i }));
    expect(await screen.findByText('MNFY-REF-001')).toBeTruthy();
    expect(screen.getAllByText('AWAITING_PROVIDER_CONFIRMATION').length).toBeGreaterThanOrEqual(2);

    // Format Verification Matrix tab
    fireEvent.click(screen.getByRole('button', { name: /Format Verification Matrix/i }));
    expect(await screen.findByTestId('sr-format-matrix')).toBeTruthy();
    expect(screen.getByText('VERIFIED_OFFICIAL_API_JSON')).toBeTruthy();
  });

  it('renders active #transaction-history/<TYPE>/<UUID> link when principal holds transaction.view (e.g. FINANCE_AUDITOR / SUPER_ADMIN)', async () => {
    useAuthStore.setState({
      isAuthenticated: true,
      isLoading: false,
      sessionId: 'sess-aud',
      principal: {
        principalId: 'aud-1',
        sessionId: 'sess-aud',
        type: 'OPERATOR',
        roles: ['FINANCE_AUDITOR'],
        scopes: ['ledger.view', 'reconciliation.view', 'transaction.view'],
        assuranceLevel: 'MFA',
        customerAccess: 'NONE',
        readOnlyPrincipal: false,
      } as never,
    });

    render(<SettlementReportReconciliationPanel />);
    fireEvent.click(await screen.findByRole('button', { name: /2\. Transaction Matching/i }));
    await waitFor(() => expect(screen.getByText('FEE_MISMATCH')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Inspect' }));

    const link = await screen.findByRole('link', {
      name: /#transaction-history\/BANK_TO_WALLET\/22222222-2222-4222-8222-222222222222/,
    });
    expect(link.getAttribute('href')).toBe(
      '#transaction-history/BANK_TO_WALLET/22222222-2222-4222-8222-222222222222',
    );
  });

  it('shows Provider Settlement Reports button inside ReconciliationObservabilityScreen only when caller holds ledger.view', () => {
    useAuthStore.setState({
      isAuthenticated: true,
      isLoading: false,
      sessionId: 'sess-aud',
      principal: {
        principalId: 'aud-1',
        sessionId: 'sess-aud',
        type: 'OPERATOR',
        roles: ['FINANCE_AUDITOR'],
        scopes: ['reconciliation.view', 'ledger.view'],
        assuranceLevel: 'MFA',
        customerAccess: 'NONE',
        readOnlyPrincipal: false,
      } as never,
    });

    const { unmount } = render(<ReconciliationObservabilityScreen />);
    expect(screen.getByRole('button', { name: /Provider Settlement Reports/i })).toBeTruthy();
    unmount();

    useAuthStore.setState({
      isAuthenticated: true,
      isLoading: false,
      sessionId: 'sess-ops',
      principal: {
        principalId: 'ops-1',
        sessionId: 'sess-ops',
        type: 'OPERATOR',
        roles: ['OPERATIONS'],
        scopes: ['reconciliation.view', 'transaction.view'],
        assuranceLevel: 'MFA',
        customerAccess: 'NONE',
        readOnlyPrincipal: false,
      } as never,
    });

    render(<ReconciliationObservabilityScreen />);
    expect(screen.queryByRole('button', { name: /Provider Settlement Reports/i })).toBeNull();
  });
});
