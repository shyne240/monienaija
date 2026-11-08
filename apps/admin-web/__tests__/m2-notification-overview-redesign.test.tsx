import React from 'react';
import {act,fireEvent,render,screen,within} from '@testing-library/react';
import {NotificationManagementScreen} from '../src/screens/authenticated/NotificationManagementScreen';
import {NotificationManagementApi} from '../src/services/notification-management-api';
import {BASELINE_CODE_EVENT_CATALOGUE} from '../src/services/notification-domain';
import {ApiClient} from '../src/services/api-client';
import {useAuthStore} from '../src/store/auth-store';
jest.mock('../src/services/api-client',()=>({ApiClient:{get:jest.fn(),post:jest.fn(),patch:jest.fn()},ApiError:class extends Error {status=503}}));
const principal=(scopes:string[])=>useAuthStore.setState({principal:{type:'OPERATOR',principalId:'one',sessionId:'one',audience:'workforce-admin',roles:['OPERATIONS'],scopes,customerAccess:'NONE',assuranceLevel:'MFA'}});
function deferred(){let resolve!:(v:any)=>void;const promise=new Promise<any>(r=>resolve=r);return {promise,resolve};}
beforeEach(()=>{jest.restoreAllMocks();(ApiClient.get as jest.Mock).mockReset().mockRejectedValue(new Error('Synthetic unavailable'));principal(['notification.view_deliveries']);});
test('overview distinguishes an unresolved registry from an actual read and labels contract-only entries',async()=>{
 const events=deferred();jest.spyOn(NotificationManagementApi,'listEvents').mockReturnValue(events.promise);
 render(<NotificationManagementScreen/>);expect(screen.getByText('CHECKING REGISTRY')).toBeTruthy();expect(screen.queryByText('DB REGISTRY READ')).toBeNull();
 const matrix=screen.getByTestId('backend-readiness-matrix');expect(within(matrix).getByText('Evidence')).toBeTruthy();expect(within(matrix).getAllByText('CONTRACT LISTED').length).toBeGreaterThan(0);expect(matrix.textContent).toContain('GET /internal/notifications/templates');expect(matrix.textContent).toContain('POST /internal/notifications/changes');expect(matrix.textContent).toContain('/internal/notifications/provider-config/proposals');expect(matrix.textContent).not.toContain('provider-configs');expect(matrix.textContent).not.toContain('GET/POST /internal/notifications/templates');
 await act(async()=>{events.resolve({status:'LIVE',data:BASELINE_CODE_EVENT_CATALOGUE});await events.promise;});expect(screen.getByText('DB REGISTRY READ')).toBeTruthy();
});
test('restricted catalogue is not advertised as live and manual tab navigation preserves activation semantics',async()=>{
 principal(['notification.test_send']);render(<NotificationManagementScreen/>);expect(within(screen.getByRole('region',{name:'Event catalogue and outbox health'})).getByText('SCOPE RESTRICTED')).toBeTruthy();expect(screen.queryByText('DB REGISTRY READ')).toBeNull();
 const overview=screen.getByRole('tab',{name:'1. Overview'}),events=screen.getByRole('tab',{name:'2. Event Catalogue & Triggers'});overview.focus();fireEvent.keyDown(overview,{key:'ArrowRight'});expect(document.activeElement).toBe(events);expect(overview.getAttribute('aria-selected')).toBe('true');fireEvent.click(events);expect(events.getAttribute('aria-selected')).toBe('true');expect(screen.getByRole('tabpanel').getAttribute('aria-labelledby')).toBe(events.id);expect(ApiClient.post).not.toHaveBeenCalled();
});
test('refresh does not present an earlier provider observation as current while the new read is pending',async()=>{
 const pending=deferred();const status={sms:{provider:'console',operationalStatus:'CONSOLE_ONLY'},email:{provider:'none',operationalStatus:'NOT_CONFIGURED'},worker:{enabled:false,redacted:false},projectionScope:'FULL'} as any;
 jest.spyOn(NotificationManagementApi,'listEvents').mockResolvedValue({status:'LIVE',data:BASELINE_CODE_EVENT_CATALOGUE});
 jest.spyOn(NotificationManagementApi,'getProviderStatus').mockResolvedValueOnce({status:'LIVE',data:status}).mockReturnValueOnce(pending.promise);
 render(<NotificationManagementScreen/>);await screen.findByText('CONSOLE_ONLY');const refresh=await screen.findByRole('button',{name:'Refresh Console'});fireEvent.click(refresh);
 expect(screen.queryByText('CONSOLE_ONLY')).toBeNull();expect(within(screen.getByRole('region',{name:'SMS channel status'})).getByText('LOADING…')).toBeTruthy();
 await act(async()=>{pending.resolve({status:'LIVE',data:status});await pending.promise;});expect(await screen.findByText('CONSOLE_ONLY')).toBeTruthy();
});
