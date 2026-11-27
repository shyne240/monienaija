import React from 'react';
import { render, fireEvent, waitFor, screen } from '@testing-library/react';
import App from '../src/App';
import { ProviderReportPreviewPanel } from '../src/screens/authenticated/ProviderReportPreviewPanel';
import { useAuthStore } from '../src/store/auth-store';
import { ApiClient } from '../src/services/api-client';

jest.mock('../src/services/api-client', () => ({
  ApiClient: {
    get: jest.fn(),
    post: jest.fn(),
    delete: jest.fn(),
  },
}));

const signIn = (scopes: string[]) => {
  useAuthStore.setState({
    isAuthenticated: true,
    isLoading: false,
    token: 'finance-bearer',
    sessionId: 'finance-sess',
    principal: {
      type: 'OPERATOR',
      principalId: 'iss:back-office-finance',
      sessionId: 'finance-sess',
      audience: 'workforce-admin',
      roles: ['FINANCE'],
      scopes,
      customerAccess: 'NONE',
      assuranceLevel: 'MFA',
    },
  });
};

const openPreview = () => {
  fireEvent.click(screen.getByText('Reconciliation'));
  fireEvent.click(screen.getByText('Provider Report Preview'));
};

describe('Admin Web provider report preview', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (ApiClient.get as jest.Mock).mockResolvedValue({ items: [] });
    signIn(['reconciliation.view', 'transaction.view']);
  });

  test('loads a synthetic Monnify preview and shows matched, exception and settlement layers', async () => {
    const { getByTestId, getByText } = render(<App />);
    openPreview();

    expect(getByTestId('preview-read-only-notice')).toBeTruthy();
    fireEvent.click(getByTestId('load-synthetic-preview'));
    // Uploading the same synthetic documents again must be reported, not counted twice.
    fireEvent.click(getByTestId('load-synthetic-preview'));

    await waitFor(() => expect(getByTestId('preview-summary').textContent).toContain('Provider rows'));
    expect(getByTestId('uploaded-reports').textContent).toContain('SYNTHETIC');
    expect(getByTestId('reference-counts').textContent).toContain('NIP session ID: 4');
    const transactions = getByTestId('transaction-matches').textContent ?? '';
    expect(transactions).toContain('MATCHED');
    expect(transactions).toContain('MISMATCH');
    expect(transactions).toContain('AMBIGUOUS');
    expect(transactions).toContain('DUPLICATE_UPLOAD');
    expect(getByTestId('settlement-matches').textContent).toContain('MATCHED');
    expect(getByTestId('finance-review-queue').textContent).toContain('Finance review required');
    expect(getByText('Read-only preview.')).toBeTruthy();
    expect(ApiClient.post).not.toHaveBeenCalled();
    expect(ApiClient.delete).not.toHaveBeenCalled();
  });

  test('refuses an unverified CSV and names the exact exports instead of guessing headers', async () => {
    const { getByTestId } = render(<App />);
    openPreview();
    const csv = new File(
      ['settlementReference,amount,date\nSETDEMO0001,19850.00,2026-11-25\n'],
      'settlement.csv',
      { type: 'text/csv' },
    );
    fireEvent.change(getByTestId('provider-report-file'), { target: { files: [csv] } });
    await waitFor(() => expect(getByTestId('preview-error').textContent).toContain('CSV layout is unverified'));
    expect(getByTestId('preview-error').textContent).toContain('Settlement → Export Settlements');
    expect(getByTestId('uploaded-reports').textContent).toContain('No provider document has been read yet.');
    expect(ApiClient.post).not.toHaveBeenCalled();
  });

  test('without reconciliation.view the preview reads no file and shows no rows', () => {
    const { getByTestId, queryByTestId } = render(
      <ProviderReportPreviewPanel canView={false} institutionId="INST-DEMO" />,
    );
    expect(getByTestId('provider-report-preview').textContent).toContain('permission is required');
    expect(queryByTestId('provider-report-file')).toBeNull();
  });
});
