import React from 'react';
import {act,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {NotificationManagementScreen} from '../src/screens/authenticated/NotificationManagementScreen';
import {NotificationManagementApi} from '../src/services/notification-management-api';
import {BASELINE_CODE_EVENT_CATALOGUE} from '../src/services/notification-domain';
import {ApiClient,ApiError} from '../src/services/api-client';
import {useAuthStore} from '../src/store/auth-store';
jest.mock('../src/services/api-client',()=>{class MockApiError extends Error{status:number;constructor(message:string,status:number){super(message);this.status=status;}}return {ApiClient:{get:jest.fn(),post:jest.fn(),patch:jest.fn()},ApiError:MockApiError};});
const principal=(id='one')=>useAuthStore.setState({principal:{type:'OPERATOR',principalId:id,sessionId:id,audience:'workforce-admin',roles:['OPERATIONS'],scopes:['notification.view_deliveries'],customerAccess:'NONE',assuranceLevel:'MFA'}});
beforeEach(()=>{jest.restoreAllMocks();(ApiClient.get as jest.Mock).mockReset().mockRejectedValue(new ApiError('Unavailable',404));principal();jest.spyOn(NotificationManagementApi,'listEvents').mockResolvedValue({status:'LIVE',data:BASELINE_CODE_EVENT_CATALOGUE});});
test('registry errors remain isolated to the failed template channel',async()=>{
 jest.spyOn(NotificationManagementApi,'listTemplates').mockImplementation(async (options)=>options?.channel==='SMS'?Promise.reject(new Error('Synthetic SMS failure')):{status:'LIVE',data:[]});
 render(<NotificationManagementScreen initialTab="smsTemplates"/>);expect(await screen.findByText(/Template registry unavailable: Synthetic SMS failure/)).toBeTruthy();fireEvent.click(screen.getByRole('tab',{name:'4. Email Templates'}));await waitFor(()=>expect(screen.queryByText(/Template registry unavailable: Synthetic SMS failure/)).toBeNull());fireEvent.click(screen.getByRole('tab',{name:'3. SMS Templates'}));expect(await screen.findByText(/Template registry unavailable: Synthetic SMS failure/)).toBeTruthy();
});
test('late template results from an earlier principal cannot enter the new workspace',async()=>{
 let resolve!:(value:any)=>void;const pending=new Promise<any>(r=>resolve=r);let count=0;jest.spyOn(NotificationManagementApi,'listTemplates').mockImplementation(()=>++count===1?pending:Promise.resolve({status:'LIVE',data:[]}));render(<NotificationManagementScreen initialTab="smsTemplates"/>);await waitFor(()=>expect(count).toBe(1));act(()=>principal('two'));await waitFor(()=>expect(count).toBe(2));await act(async()=>{resolve({status:'BLOCKED',message:'STALE BLOCKED'});await pending;});expect(screen.queryByText('STALE BLOCKED')).toBeNull();
});
test('malformed template pages cannot silently become a live empty list',async()=>{
 (ApiClient.get as jest.Mock).mockResolvedValue({unexpected:'response'});await expect(NotificationManagementApi.listTemplates({eventType:'transfer.completed',channel:'SMS'})).rejects.toThrow('invalid list');
});
