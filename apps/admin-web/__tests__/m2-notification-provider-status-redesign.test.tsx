import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { NotificationManagementScreen } from '../src/screens/authenticated/NotificationManagementScreen';
import { NotificationManagementApi } from '../src/services/notification-management-api';
import { ApiClient } from '../src/services/api-client';
import { useAuthStore } from '../src/store/auth-store';

jest.mock('../src/services/api-client', () => ({ ApiClient: { get: jest.fn(), post: jest.fn() }, ApiError: class extends Error { status = 503; } }));
const principal = (scopes: string[]) => useAuthStore.setState({principal:{type:'OPERATOR',principalId:'one',sessionId:'one',audience:'workforce-admin',roles:['OPERATIONS'],scopes,customerAccess:'NONE',assuranceLevel:'MFA'}});
beforeEach(() => { jest.restoreAllMocks(); (ApiClient.get as jest.Mock).mockReset().mockRejectedValue(new Error('Synthetic unavailable')); (ApiClient.post as jest.Mock).mockReset(); principal(['notification.view_deliveries']); });
test('minimal provider projection presents only coarse availability, not invented credential state', async () => {
  jest.spyOn(NotificationManagementApi,'getProviderStatus').mockResolvedValue({status:'LIVE',data:{projectionScope:'MINIMAL',environment:null,sms:{operationalStatus:'DEGRADED'},email:{operationalStatus:'NOT_CONFIGURED',channelEnabledInSchema:true},worker:{redacted:true}}} as any);
  render(<NotificationManagementScreen initialTab="providers"/>);
  const sms = screen.getByRole('region',{name:'SMS provider configuration status'});
  expect(await within(sms).findByText('UNAVAILABLE')).toBeTruthy();
  expect(within(sms).getByText(/Coarse availability only/)).toBeTruthy();
  const email = screen.getByRole('region',{name:'Email provider configuration status'});
  expect(within(email).getByText('UNAVAILABLE')).toBeTruthy();
  expect(within(email).queryByText('NOT_CONFIGURED')).toBeNull();
  expect(screen.queryByTestId('sms-provider-status-details')).toBeNull(); expect(screen.queryByTestId('email-provider-status-details')).toBeNull();
  expect(screen.getByTestId('provider-worker-redacted-value').textContent).toContain('not disabled'); expect(ApiClient.post).not.toHaveBeenCalled();
});
test('unavailable provider and diagnostics reads do not invent runtime defaults', async () => {
  principal(['notification.view_deliveries','diagnostics.view']);
  render(<NotificationManagementScreen initialTab="providers"/>);
  await screen.findByText('No current SMS provider observation is available.');
  const worker = screen.getByRole('region',{name:'Worker and retry runtime posture'});
  expect(within(worker).getByText('NOT OBSERVED')).toBeTruthy(); expect(worker.textContent).toContain('Outbox Retry Delay: Unavailable');
  expect(worker.textContent).toContain('Live Pending Outbox: Unavailable'); expect(worker.textContent).not.toContain('0.1.0'); expect(worker.textContent).not.toContain('60s');
});
test('editing the probe context requires a fresh attestation and clears validation without sending', async () => {
  principal(['notification.test_send']);render(<NotificationManagementScreen initialTab="testSend"/>); await screen.findByRole('button',{name:'Refresh Console'});
  const destination=screen.getByTestId('test-send-destination-input'), attest=screen.getByTestId('test-send-workforce-attestation') as HTMLInputElement;
  fireEvent.change(destination,{target:{value:'invalid'}});fireEvent.click(attest);expect(attest.checked).toBe(true);
  fireEvent.click(screen.getByTestId('submit-test-send-btn'));expect(screen.getByTestId('test-send-validation-errors')).toBeTruthy();expect(ApiClient.post).not.toHaveBeenCalled();
  fireEvent.change(destination,{target:{value:'another-invalid'}});expect(attest.checked).toBe(false);expect(screen.queryByTestId('test-send-validation-errors')).toBeNull();
  fireEvent.click(attest);fireEvent.change(screen.getByTestId('test-send-channel-select'),{target:{value:'EMAIL'}});expect(attest.checked).toBe(false);expect(ApiClient.post).not.toHaveBeenCalled();
});
