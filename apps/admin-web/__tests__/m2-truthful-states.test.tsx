import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AuditTrailScreen } from '../src/screens/authenticated/AuditTrailScreen';
import { TransactionObservabilityScreen } from '../src/screens/authenticated/TransactionObservabilityScreen';
import { ReconciliationObservabilityScreen } from '../src/screens/authenticated/ReconciliationObservabilityScreen';
import { AgentUnifiedHistoryPanel } from '../src/components/AgentUnifiedHistoryPanel';
import { formatMinorUnits } from '../src/utils/financial-display';
import { ApiClient } from '../src/services/api-client';
import { useAuthStore } from '../src/store/auth-store';

jest.mock('../src/services/api-client', () => ({ ApiClient: { get: jest.fn() } }));

beforeEach(() => {
  jest.resetAllMocks();
  useAuthStore.setState({ principal: { type: 'OPERATOR', principalId: 'synthetic', sessionId: 'synthetic', audience: 'workforce-admin', roles: [], scopes: ['audit.search', 'customer.view_transactions', 'reconciliation.view'], customerAccess: 'NONE', assuranceLevel: 'MFA' } });
});

test('audit distinguishes initial, failed and empty search', async () => {
  (ApiClient.get as jest.Mock).mockRejectedValueOnce(new Error('Audit unavailable')).mockResolvedValueOnce([]);
  render(<AuditTrailScreen />);
  expect(screen.queryByText(/No audit events/)).toBeNull();
  expect(screen.getByLabelText('Entity ID (optional)')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Search' }));
  expect(await screen.findByText('Audit unavailable')).toBeTruthy();
  expect(screen.queryByText(/No audit events/)).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Search' }));
  expect(await screen.findByText(/No audit events/)).toBeTruthy();
});

test('customer history failure is not presented as empty or zero', async () => {
  (ApiClient.get as jest.Mock).mockRejectedValue(new Error('History unavailable'));
  render(<TransactionObservabilityScreen initialCustomerId="customer-1" />);
  expect(await screen.findByText('History unavailable')).toBeTruthy();
  expect(screen.queryByText(/No transactions found/)).toBeNull();
  expect(screen.queryByText(/0 transactions/)).toBeNull();
});

test('failed agent refresh does not leave an old empty result as current', async () => {
  const load = jest.fn().mockResolvedValueOnce({ items: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 0, hasNextPage: false } }).mockRejectedValueOnce(new Error('Agent history unavailable'));
  render(<AgentUnifiedHistoryPanel agentId="agent-1" canViewAgent loadTransactions={load} />);
  fireEvent.click(screen.getByRole('button', { name: 'Load unified stream' }));
  expect(await screen.findByText('No unified Agent history entries found.')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Refresh unified stream' }));
  expect(await screen.findByText('Agent history unavailable')).toBeTruthy();
  expect(screen.queryByText('No unified Agent history entries found.')).toBeNull();
});

test('zero discrepancies do not imply balanced books', async () => {
  (ApiClient.get as jest.Mock).mockResolvedValue({ status: 'ERROR', generatedAt: '2026-01-01T00:00:00Z', checks: [{ name: 'check', status: 'ERROR', message: 'Check failed', details: {} }], binding: { summary: { bindingsChecked: 0, discrepancies: 0, errors: 0, warnings: 0 }, discrepancies: [] } });
  render(<ReconciliationObservabilityScreen />);
  fireEvent.click(screen.getByRole('button', { name: 'Execute In-House Reconciliation Match' }));
  expect(await screen.findByText(/does not establish that the books are balanced/)).toBeTruthy();
  expect(screen.getByText('Check failed')).toBeTruthy();
});

test('failed finance refresh identifies previous results as stale', async () => {
  (ApiClient.get as jest.Mock).mockResolvedValueOnce({ generatedAt: '2026-01-01T00:00:00Z', journalIntegrity: { balanced: true, totalJournals: 1, invalidJournals: 0, orphanLines: 0 }, totalAssets: [], totalLiabilities: [] }).mockRejectedValueOnce(new Error('Refresh unavailable'));
  render(<ReconciliationObservabilityScreen />);
  fireEvent.click(screen.getByRole('button', { name: /Finance Verification & Activity/ }));
  await screen.findByTestId('finance-verification-summary');
  fireEvent.click(screen.getByRole('button', { name: 'Refresh Finance Verification' }));
  await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/Previous results are stale/));
});

test('minor units retain large values and declared currency without floating point', () => {
  expect(formatMinorUnits('900719925474099301', 'USD')).toBe('USD 900,719,925,474,099,301 minor units');
  expect(formatMinorUnits('-123', 'NGN')).toBe('NGN -123 minor units');
});
