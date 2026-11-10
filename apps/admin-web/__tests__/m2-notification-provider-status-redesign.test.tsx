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
test('malformed provider projections are unavailable instead of inventing worker or provider defaults',async()=>{
 (ApiClient.get as jest.Mock).mockResolvedValueOnce({channels:['SMS','EMAIL'],projectionScope:'FULL',sms:{},email:{},worker:{}});
 await expect(NotificationManagementApi.getProviderStatus()).rejects.toThrow(/could not be verified/);
 (ApiClient.get as jest.Mock).mockResolvedValueOnce({channels:['SMS','EMAIL'],projectionScope:'MINIMAL',sms:{},email:{available:false}});
 await expect(NotificationManagementApi.getProviderStatus()).rejects.toThrow(/could not be verified/);
 expect(ApiClient.post).not.toHaveBeenCalled();
});
test('provider status distinguishes reported configuration from unreported verification and worker activity',async()=>{
 (ApiClient.get as jest.Mock).mockResolvedValueOnce({channels:['SMS','PUSH','EMAIL'],projectionScope:'FULL',sms:{provider:'robase',enabled:true,configured:true,deliveryTested:false,lifecycleState:'CONFIGURED',keyFingerprint:'1234',timeoutMs:null},email:{provider:'resend',enabled:true,configured:true,deliveryTested:false,lifecycleState:'CONFIGURED',domainAuth:null},worker:{enabled:true,pollIntervalMs:5000,batchSize:10,retryMaxAttempts:3,retryBaseDelaySeconds:60}});
 const result=await NotificationManagementApi.getProviderStatus();expect(result.status).toBe('LIVE');
 if(result.status==='LIVE') { expect(result.data.worker.pendingOutboxCount).toBeNull();expect(result.data.sms.apiKeyPrefixValid).toBeNull();expect(result.data.sms.productionGuardSatisfied).toBeNull();expect(result.data.sms.requestTimeoutMs).toBeNull();expect(result.data.email.domainVerificationStatus).toBe('UNKNOWN'); }
 expect(ApiClient.post).not.toHaveBeenCalled();
});

test('local probe draft can be cleared without sending or retaining attestation', async () => {
  principal(['notification.test_send']); render(<NotificationManagementScreen initialTab="testSend"/>);
  const destination=screen.getByTestId('test-send-destination-input') as HTMLInputElement;
  const attestation=screen.getByTestId('test-send-workforce-attestation') as HTMLInputElement;
  const clear=screen.getByRole('button',{name:'Clear local probe draft'}) as HTMLButtonElement;
  expect(clear.disabled).toBe(true); fireEvent.change(destination,{target:{value:'invalid'}}); fireEvent.click(attestation);
  fireEvent.click(screen.getByTestId('submit-test-send-btn')); expect(screen.getByTestId('test-send-validation-errors')).toBeTruthy();
  expect(clear.disabled).toBe(false); fireEvent.click(clear);
  expect(destination.value).toBe(''); expect(attestation.checked).toBe(false); expect(screen.queryByTestId('test-send-validation-errors')).toBeNull(); expect(clear.disabled).toBe(true); expect(ApiClient.post).not.toHaveBeenCalled();
});

test('overview shortcuts move focus to the existing section tabs without sending',async()=>{
 render(<NotificationManagementScreen initialTab="overview"/>);await screen.findByRole('button',{name:/Explore event catalogue/});
 fireEvent.click(screen.getByRole('button',{name:/Explore event catalogue/}));const tab=screen.getByRole('tab',{name:'2. Event Catalogue & Triggers'});expect(tab.getAttribute('aria-selected')).toBe('true');expect(document.activeElement).toBe(tab);expect(ApiClient.post).not.toHaveBeenCalled();
});
