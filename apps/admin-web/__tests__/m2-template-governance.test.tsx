import React from 'react';
import {act, fireEvent, render, screen} from '@testing-library/react';
import {NotificationTemplateWorkspace} from '../src/components/NotificationTemplateWorkspace';
import {BASELINE_CODE_EVENT_CATALOGUE, deriveNotificationPermissions, NotificationTemplateVersion} from '../src/services/notification-domain';
import {NotificationManagementApi} from '../src/services/notification-management-api';
import {ApiClient} from '../src/services/api-client';
import {WorkforcePrincipal} from '../src/store/auth-store';

jest.mock('../src/services/api-client',()=>({ApiClient:{get:jest.fn(),post:jest.fn()},ApiError:class ApiError extends Error {status=500;}}));
const principal:WorkforcePrincipal={type:'OPERATOR',principalId:'maker',sessionId:'session',audience:'workforce-admin',roles:['SUPER_ADMIN'],scopes:['notification.view_deliveries'],customerAccess:'NONE',assuranceLevel:'MFA'};
const event=BASELINE_CODE_EVENT_CATALOGUE.find(item=>item.eventType==='customer.funding.approved')!;
const version=(n:number):NotificationTemplateVersion=>({id:`version-${n}`,eventType:event.eventType,channel:'SMS',locale:'en-NG',version:n,subject:null,body:`Current text version ${n}`,variables:[],isActive:true,approvalStatus:'ACTIVE',createdBy:'synthetic',createdAt:'2026-01-01',updatedAt:'2026-01-01',sourceOrigin:'DATABASE'});
const props=(n:number)=>({channel:'SMS' as const,events:[event],templates:[version(n)],templatesRegistryBlocked:false,emailChannelBlocked:false,permissions:deriveNotificationPermissions(principal),currentPrincipalId:'maker'});
beforeEach(()=>{jest.restoreAllMocks();(ApiClient.post as jest.Mock).mockReset();(ApiClient.get as jest.Mock).mockReset();});

test('a changed active template retains but blocks an edited draft until reset',async()=>{
 const view=render(<NotificationTemplateWorkspace {...props(1)}/>);fireEvent.change(screen.getByTestId('template-body-textarea'),{target:{value:'Synthetic edited draft'}});fireEvent.change(screen.getByTestId('template-change-summary-input'),{target:{value:'Synthetic explanation'}});
 view.rerender(<NotificationTemplateWorkspace {...props(2)}/>);expect(await screen.findByText(/active template changed since this draft was loaded/)).toBeTruthy();expect((screen.getByTestId('template-body-textarea') as HTMLTextAreaElement).value).toBe('Synthetic edited draft');
 fireEvent.click(screen.getByTestId('submit-template-version-btn'));expect(screen.getByText(/confirmed, current active template is required/)).toBeTruthy();expect(ApiClient.post).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('button',{name:'Reload active version'}));expect((screen.getByTestId('template-body-textarea') as HTMLTextAreaElement).value).toBe('Current text version 2');
});

test('template change uses the reviewed version and rejects an unconfirmed receipt',async()=>{
 (ApiClient.post as jest.Mock).mockResolvedValue({approvalId:'synthetic',status:'REJECTED',actionType:'NOTIFICATION_TEMPLATE_CHANGE',requestedAt:'2026-01-01'});
 await expect(NotificationManagementApi.submitTemplateVersion({eventType:event.eventType,channel:'SMS',locale:'en-NG',subject:null,body:'Synthetic text',changeSummary:'Synthetic explanation',expectedVersion:3})).rejects.toThrow(/outcome not confirmed/);
 expect(ApiClient.post).toHaveBeenCalledWith('/internal/notifications/changes',expect.objectContaining({expectedVersion:3}),expect.any(Object));expect(ApiClient.get).not.toHaveBeenCalled();
});

test('a late template proposal cannot update a workspace after unmount',async()=>{
 let resolve!:(value:any)=>void;const pending=new Promise<any>(r=>resolve=r);jest.spyOn(NotificationManagementApi,'submitTemplateVersion').mockReturnValue(pending);const onTemplateSubmitted=jest.fn();
 const view=render(<NotificationTemplateWorkspace {...props(1)} onTemplateSubmitted={onTemplateSubmitted}/>);fireEvent.change(screen.getByTestId('template-body-textarea'),{target:{value:'Synthetic edited draft'}});fireEvent.change(screen.getByTestId('template-change-summary-input'),{target:{value:'Synthetic explanation'}});fireEvent.click(screen.getByTestId('submit-template-version-btn'));
 expect(NotificationManagementApi.submitTemplateVersion).toHaveBeenCalledWith(expect.objectContaining({expectedVersion:1}));view.unmount();await act(async()=>{resolve({status:'LIVE',data:{status:'PENDING_APPROVAL',approvalId:'synthetic',updatedAt:'2026-01-01'}});await pending;});expect(onTemplateSubmitted).not.toHaveBeenCalled();
});

test('a confirmed proposal remains confirmed if the later registry refresh fails',async()=>{
 jest.spyOn(NotificationManagementApi,'submitTemplateVersion').mockResolvedValue({status:'LIVE',data:{status:'PENDING_APPROVAL',approvalId:'synthetic-approval',updatedAt:'2026-01-01'}});
 const onTemplateSubmitted=jest.fn();render(<NotificationTemplateWorkspace {...props(1)} onTemplateSubmitted={onTemplateSubmitted} onRefreshRequested={()=>Promise.reject(new Error('offline'))}/>);
 fireEvent.change(screen.getByTestId('template-body-textarea'),{target:{value:'Synthetic edited draft'}});fireEvent.change(screen.getByTestId('template-change-summary-input'),{target:{value:'Synthetic explanation'}});fireEvent.click(screen.getByTestId('submit-template-version-btn'));
 expect((await screen.findByTestId('template-submit-success')).textContent).toMatch(/maker-checker approval.*Registry refresh failed/);expect(onTemplateSubmitted).toHaveBeenCalledWith(expect.anything(),expect.objectContaining({id:'synthetic-approval'}));expect(screen.queryByTestId('template-submit-error')).toBeNull();
});
