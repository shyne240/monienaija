import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { DashboardScreen } from '../src/screens/authenticated/DashboardScreen';
import { ApiClient } from '../src/services/api-client';
import { useAuthStore } from '../src/store/auth-store';

jest.mock('../src/services/api-client', () => ({ ApiClient: { get: jest.fn() } }));
const widget = (key: string, authorized: boolean) => ({ widgetKey: key, order: 1, displayName: key, description: '', fetchMode: 'proxy', kind: 'table', authorized });
const configuration = (widgets: ReturnType<typeof widget>[], isFallback = false) => ({ templateKey: 'TEST', displayName: 'Test', description: '', isFallback, fallbackReason: isFallback ? 'No assignment' : undefined, widgets });
const calls = ApiClient.get as jest.Mock;
beforeEach(() => {
  jest.resetAllMocks();
  useAuthStore.setState({ isAuthenticated: true, sessionId: 'test', principal: { type: 'OPERATOR', principalId: 'test', sessionId: 'test', audience: 'workforce-admin', roles: ['OPERATIONS'], scopes: ['agent.view', 'agent.review_application'], customerAccess: 'NONE', assuranceLevel: 'MFA' } });
});
test('agent network and onboarding actions respect each resolved widget grant', async () => {
  calls.mockResolvedValue(configuration([widget('agent-lifecycle-summary', true), widget('agent-applications-queue', true)]));
  const onNavigateToAgents = jest.fn();
  render(<DashboardScreen onNavigateToAgents={onNavigateToAgents} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Agent network' }));
  fireEvent.click(screen.getByRole('button', { name: 'Agent onboarding' }));
  expect(onNavigateToAgents).toHaveBeenNthCalledWith(1);
  expect(onNavigateToAgents).toHaveBeenNthCalledWith(2, { openApplications: true });
});
test('restricted widgets do not expose agent actions or request their data', async () => {
  calls.mockResolvedValue(configuration([widget('agent-lifecycle-summary', false), widget('agent-applications-queue', false)]));
  render(<DashboardScreen onNavigateToAgents={jest.fn()} />);
  await screen.findByText('No action sources are available to this session.');
  expect(screen.queryByRole('button', { name: 'Agent network' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Agent onboarding' })).toBeNull();
  expect(calls).toHaveBeenCalledTimes(1);
});
test('fallback is disclosed and configuration errors are retryable', async () => {
  calls.mockRejectedValueOnce(new Error('Offline')).mockResolvedValueOnce(configuration([], true));
  render(<DashboardScreen />);
  fireEvent.click(await screen.findByRole('button', { name: 'Retry dashboard' }));
  expect(await screen.findByText('Default dashboard — No assignment')).toBeTruthy();
  await waitFor(() => expect(calls).toHaveBeenCalledTimes(2));
});
test('an unconfigured agent widget is not mislabeled as a permission denial', async () => {
  calls.mockImplementation((url: string) => url.endsWith('/my-dashboard')
    ? Promise.resolve(configuration([widget('transaction-summary', true)]))
    : Promise.reject(new Error('Synthetic unavailable')));
  render(<DashboardScreen />);
  expect(await screen.findByText('Not configured')).toBeTruthy();
  expect(screen.getByText('Not in this dashboard')).toBeTruthy();
  expect(calls.mock.calls.some(([url]: [string]) => url.includes('agent-lifecycle-summary'))).toBe(false);
});
