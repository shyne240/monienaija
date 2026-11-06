import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useWidgetData } from '../src/components/dashboard/useWidgetData';
import { CommercialRulesScreen } from '../src/screens/authenticated/CommercialRulesScreen';
import { SupportTicketsScreen } from '../src/screens/authenticated/SupportTicketsScreen';
import { ComplianceScreen } from '../src/screens/authenticated/ComplianceScreen';
import { RiskFraudScreen } from '../src/screens/authenticated/RiskFraudScreen';
import { ApiClient } from '../src/services/api-client';
import { useAuthStore } from '../src/store/auth-store';
import { formatFinancialAmount } from '../src/utils/financial-display';

jest.mock('../src/services/api-client', () => ({ ApiClient: { get: jest.fn(), post: jest.fn() } }));

beforeEach(() => {
  jest.resetAllMocks();
  useAuthStore.setState({ principal: { type: 'OPERATOR', principalId: 'synthetic', sessionId: 'synthetic', audience: 'workforce-admin', roles: [], scopes: ['fee_rule.view', 'commission_rule.view', 'customer.manage_support_case', 'kyc.view', 'compliance.manage_case', 'risk_fraud.manage_fraud_case'], customerAccess: 'NONE', assuranceLevel: 'MFA' } });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => { resolve = r; });
  return { promise, resolve };
}

test('dashboard widget discards old responses when dependencies change', async () => {
  const old = deferred<string>(); const current = deferred<string>();
  const Widget = ({ query }: {query: string}) => {
    const { data } = useWidgetData(() => query === 'old' ? old.promise : current.promise, [query]);
    return <div>{data}</div>;
  };
  const view = render(<Widget query="old" />);
  view.rerender(<Widget query="new" />);
  await act(async () => { current.resolve('current'); await current.promise; });
  expect(screen.getByText('current')).toBeTruthy();
  await act(async () => { old.resolve('stale'); await old.promise; });
  expect(screen.getByText('current')).toBeTruthy();
  expect(screen.queryByText('stale')).toBeNull();
});

test('commercial tabs reject out-of-order responses', async () => {
  const fees = deferred<unknown>(); const commissions = deferred<unknown>();
  (ApiClient.get as jest.Mock).mockImplementation((url: string) => url.includes('commission') ? commissions.promise : fees.promise);
  render(<CommercialRulesScreen initialTab="fees" />);
  fireEvent.click(screen.getByRole('tab', { name: 'Commissions' }));
  await act(async () => { commissions.resolve([{ id: 'c1', code: 'COMMISSION' }]); await commissions.promise; });
  expect(screen.getAllByText('COMMISSION').length).toBeGreaterThan(0);
  await act(async () => { fees.resolve([{ id: 'f1', code: 'OLD FEE' }]); await fees.promise; });
  expect(screen.queryByText('OLD FEE')).toBeNull();
  expect(screen.getAllByText('COMMISSION').length).toBeGreaterThan(0);
});

test('support retrieval failure does not claim empty or zero results', async () => {
  (ApiClient.get as jest.Mock).mockRejectedValue(new Error('Queue unavailable'));
  render(<SupportTicketsScreen />);
  expect(await screen.findByText('Queue unavailable')).toBeTruthy();
  expect(screen.queryByText(/No tickets for this filter/)).toBeNull();
  expect(screen.queryByText(/Total 0/)).toBeNull();
});

test('KYC and compliance failures are not shown as successful empty searches', async () => {
  (ApiClient.get as jest.Mock).mockRejectedValue(new Error('Lookup unavailable'));
  const view = render(<ComplianceScreen initialCustomerId="synthetic" mode="kyc" />);
  expect(await screen.findByText('Lookup unavailable')).toBeTruthy();
  expect(screen.queryByText(/No KYC assessment found/)).toBeNull();
  view.unmount();
  render(<ComplianceScreen initialCustomerId="synthetic" mode="cases" />);
  expect(await screen.findByText('Lookup unavailable')).toBeTruthy();
  expect(screen.queryByText(/No compliance cases match/)).toBeNull();
});

test('fraud search distinguishes an empty response from an error', async () => {
  (ApiClient.get as jest.Mock).mockRejectedValueOnce(new Error('Fraud service unavailable')).mockResolvedValueOnce([]);
  render(<RiskFraudScreen />);
  fireEvent.change(screen.getByLabelText('Customer UUID'), { target: { value: 'synthetic' } });
  fireEvent.click(screen.getByRole('button', { name: 'Search FRAUD cases' }));
  expect(await screen.findByText('Fraud service unavailable')).toBeTruthy();
  expect(screen.queryByText(/No FRAUD cases/)).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Search FRAUD cases' }));
  await waitFor(() => expect(screen.getByText(/No FRAUD cases/)).toBeTruthy());
});

test('financial displays preserve large NGN amounts and non-NGN minor units', () => {
  expect(formatFinancialAmount('900719925474099301', 'NGN')).toBe('₦9,007,199,254,740,993.01');
  expect(formatFinancialAmount('1200', 'USD')).toBe('USD 1,200 minor units');
});

test('commercial tabs support keyboard navigation', async () => {
  (ApiClient.get as jest.Mock).mockResolvedValue([]);
  render(<CommercialRulesScreen initialTab="fees" />);
  const first = screen.getByRole('tab', { name: 'Fees' });
  first.focus();
  fireEvent.keyDown(first, { key: 'ArrowRight' });
  const second = screen.getByRole('tab', { name: 'Commissions' });
  expect(document.activeElement).toBe(second);
  expect(second.getAttribute('aria-selected')).toBe('true');
  expect(first.getAttribute('tabindex')).toBe('-1');
});
