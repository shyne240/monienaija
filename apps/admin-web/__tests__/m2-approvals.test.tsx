import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { ApprovalsScreen } from '../src/screens/authenticated/ApprovalsScreen';
import { ApiClient } from '../src/services/api-client';
import { useAuthStore } from '../src/store/auth-store';
jest.mock('../src/services/api-client', () => ({ApiClient:{get:jest.fn(),post:jest.fn()}}));
const principal=(id:string, scopes=['privileged:approve'])=>useAuthStore.setState({principal:{type:'OPERATOR',principalId:id,sessionId:id,audience:'workforce-admin',roles:['FINANCE_CONTROLLER'],scopes,customerAccess:'NONE',assuranceLevel:'MFA'}});
beforeEach(()=>{jest.resetAllMocks();principal('one');});
test('a denied checker decision returned with HTTP success is not called approved',async()=>{
 (ApiClient.post as jest.Mock).mockResolvedValue({approved:false,reason:'SELF_APPROVAL_FORBIDDEN',approval:{id:'synthetic-id',status:'REQUESTED'}});
 render(<ApprovalsScreen/>);fireEvent.change(screen.getByLabelText('Pending Approval ID (UUID)'),{target:{value:'synthetic-id'}});fireEvent.click(screen.getByRole('button',{name:'Sign & Approve Action'}));fireEvent.click(screen.getByRole('button',{name:'Confirm decision'}));
 expect(await screen.findByText(/Decision not confirmed: SELF_APPROVAL_FORBIDDEN/)).toBeTruthy();
 expect(screen.queryByText(/Approval recorded/)).toBeNull();
});
test('a denied rejection is not confused with a recorded REJECTED decision',async()=>{
 (ApiClient.post as jest.Mock).mockResolvedValue({approved:false,reason:'MFA_REQUIRED',approval:{id:'synthetic-id',status:'REQUESTED'}});
 render(<ApprovalsScreen/>);fireEvent.change(screen.getByLabelText('Pending Approval ID (UUID)'),{target:{value:'synthetic-id'}});fireEvent.click(screen.getByRole('button',{name:'Reject Action'}));fireEvent.click(screen.getByRole('button',{name:'Confirm decision'}));
 expect(await screen.findByText(/Decision not confirmed: MFA_REQUIRED/)).toBeTruthy();expect(screen.queryByText('Approval decision recorded as rejected successfully.')).toBeNull();
});
test('late approval result is not presented to a different checker',async()=>{
 let resolve!: (v:any)=>void;const pending=new Promise<any>(r=>resolve=r);(ApiClient.post as jest.Mock).mockReturnValue(pending);
 render(<ApprovalsScreen/>);fireEvent.change(screen.getByLabelText('Pending Approval ID (UUID)'),{target:{value:'synthetic-id'}});fireEvent.click(screen.getByRole('button',{name:'Sign & Approve Action'}));fireEvent.click(screen.getByRole('button',{name:'Confirm decision'}));
 act(()=>principal('two'));await act(async()=>{resolve({approved:true,reason:'APPROVED',approval:{id:'synthetic-id',status:'APPROVED'}});await pending;});
 expect(screen.queryByText(/Approval recorded/)).toBeNull();expect((screen.getByLabelText('Pending Approval ID (UUID)') as HTMLInputElement).value).toBe('');
});
test('a new session for the same checker clears the prior decision draft',()=>{
 render(<ApprovalsScreen/>);fireEvent.change(screen.getByLabelText('Pending Approval ID (UUID)'),{target:{value:'synthetic-id'}});
 act(()=>useAuthStore.setState(state=>({principal:{...state.principal!,sessionId:'new-session'}})));
 expect((screen.getByLabelText('Pending Approval ID (UUID)') as HTMLInputElement).value).toBe('');
});


test('reject review captures the decision and comment, traps focus and cancels without a write',()=>{
 render(<ApprovalsScreen/>);fireEvent.change(screen.getByLabelText('Pending Approval ID (UUID)'),{target:{value:'synthetic-id'}});fireEvent.change(screen.getByLabelText('Audit Comment / Verification Notes (Optional)'),{target:{value:'reviewed'}});
 const trigger=screen.getByRole('button',{name:'Reject Action'});fireEvent.click(trigger);const dialog=screen.getByRole('dialog',{name:'Confirm rejection'});
 expect(dialog.textContent).toContain('synthetic-id');expect(dialog.textContent).toContain('reviewed');expect(document.activeElement).toBe(screen.getByRole('button',{name:'Cancel'}));fireEvent.keyDown(document,{key:'Tab',shiftKey:true});expect(document.activeElement).toBe(screen.getByRole('button',{name:'Confirm decision'}));
 fireEvent.keyDown(document,{key:'Escape'});expect(screen.queryByRole('dialog')).toBeNull();expect(document.activeElement).toBe(trigger);expect(ApiClient.post).not.toHaveBeenCalled();
});

test('review is single flight and focuses the matching receipt after success',async()=>{
 let resolve!:(v:any)=>void;const pending=new Promise<any>(r=>{resolve=r});(ApiClient.post as jest.Mock).mockReturnValue(pending);render(<ApprovalsScreen/>);fireEvent.change(screen.getByLabelText('Pending Approval ID (UUID)'),{target:{value:'synthetic-id'}});fireEvent.click(screen.getByRole('button',{name:'Sign & Approve Action'}));fireEvent.click(screen.getByRole('button',{name:'Confirm decision'}));
 expect(ApiClient.post).toHaveBeenCalledTimes(1);expect(document.activeElement).toBe(screen.getByRole('dialog'));fireEvent.keyDown(document,{key:'Escape'});expect(screen.getByRole('dialog')).toBeTruthy();
 await act(async()=>{resolve({approved:true,reason:'APPROVED',approval:{id:'synthetic-id',status:'APPROVED'}});await pending;});expect(screen.getByRole('status').textContent).toContain('synthetic-id');expect(document.activeElement).toBe(screen.getByRole('status'));
});

test('a session change closes a pending review before submission',()=>{
 render(<ApprovalsScreen/>);fireEvent.change(screen.getByLabelText('Pending Approval ID (UUID)'),{target:{value:'synthetic-id'}});fireEvent.click(screen.getByRole('button',{name:'Sign & Approve Action'}));act(()=>principal('two'));expect(screen.queryByRole('dialog')).toBeNull();expect(ApiClient.post).not.toHaveBeenCalled();
});

test('read-only checker can inspect the workspace but cannot submit a decision, including after a session transition',()=>{
 render(<ApprovalsScreen/>);fireEvent.change(screen.getByLabelText('Pending Approval ID (UUID)'),{target:{value:'synthetic-id'}});
 act(()=>useAuthStore.setState(state=>({principal:{...state.principal!,readOnlyPrincipal:true}})));
 expect((screen.getByLabelText('Pending Approval ID (UUID)') as HTMLInputElement).value).toBe('');
 fireEvent.change(screen.getByLabelText('Pending Approval ID (UUID)'),{target:{value:'synthetic-id'}});
 expect((screen.getByRole('button',{name:'Sign & Approve Action'}) as HTMLButtonElement).disabled).toBe(true);
 expect((screen.getByRole('button',{name:'Reject Action'}) as HTMLButtonElement).disabled).toBe(true);
 fireEvent.click(screen.getByRole('button',{name:'Sign & Approve Action'}));expect(ApiClient.post).not.toHaveBeenCalled();
});

test('unconfirmed generic decisions lock that approval until an explicit external review acknowledgement',async()=>{
 (ApiClient.post as jest.Mock).mockRejectedValue(new Error('network lost'));
 render(<ApprovalsScreen/>);fireEvent.change(screen.getByLabelText('Pending Approval ID (UUID)'),{target:{value:'synthetic-id'}});fireEvent.click(screen.getByRole('button',{name:'Sign & Approve Action'}));fireEvent.click(screen.getByRole('button',{name:'Confirm decision'}));
 expect(await screen.findByText(/This screen has no generic approval read endpoint/)).toBeTruthy();
 expect((screen.getByRole('button',{name:'Sign & Approve Action'}) as HTMLButtonElement).disabled).toBe(true);
 expect((screen.getByRole('button',{name:'Reject Action'}) as HTMLButtonElement).disabled).toBe(true);
 fireEvent.change(screen.getByLabelText('Pending Approval ID (UUID)'),{target:{value:'other-id'}});fireEvent.change(screen.getByLabelText('Pending Approval ID (UUID)'),{target:{value:'synthetic-id'}});
 expect((screen.getByRole('button',{name:'Reject Action'}) as HTMLButtonElement).disabled).toBe(true);expect(ApiClient.post).toHaveBeenCalledTimes(1);
 fireEvent.click(screen.getByRole('button',{name:'I reviewed the approval and audit trail'}));expect((screen.getByRole('button',{name:'Reject Action'}) as HTMLButtonElement).disabled).toBe(false);
});

test('store session change clears generic approval draft even if principal session is unchanged',()=>{
 useAuthStore.setState({sessionId:'old'});render(<ApprovalsScreen/>);fireEvent.change(screen.getByLabelText('Pending Approval ID (UUID)'),{target:{value:'synthetic-id'}});
 act(()=>useAuthStore.setState({sessionId:'new'}));expect((screen.getByLabelText('Pending Approval ID (UUID)') as HTMLInputElement).value).toBe('');
});

test('unconfirmed decisions remain guarded when a different ID is entered and warn on browser unload',async()=>{
 (ApiClient.post as jest.Mock).mockRejectedValue(new Error('network lost'));const report=jest.fn();
 render(<ApprovalsScreen onApprovalGuardChange={report}/>);fireEvent.change(screen.getByLabelText('Pending Approval ID (UUID)'),{target:{value:'id-one'}});fireEvent.click(screen.getByRole('button',{name:'Reject Action'}));fireEvent.click(screen.getByRole('button',{name:'Confirm decision'}));
 await screen.findByText(/This screen has no generic approval read endpoint/);fireEvent.change(screen.getByLabelText('Pending Approval ID (UUID)'),{target:{value:'id-two'}});expect(report).toHaveBeenLastCalledWith(true,false);
 const event=new Event('beforeunload',{cancelable:true});window.dispatchEvent(event);expect(event.defaultPrevented).toBe(true);
 fireEvent.change(screen.getByLabelText('Pending Approval ID (UUID)'),{target:{value:'id-one'}});fireEvent.click(screen.getByRole('button',{name:'I reviewed the approval and audit trail'}));expect(report).toHaveBeenLastCalledWith(true,false);fireEvent.change(screen.getByLabelText('Pending Approval ID (UUID)'),{target:{value:''}});expect(report).toHaveBeenLastCalledWith(false,false);
});

test('an unconfirmed funding decision blocks generic checker decisions in the same workspace',async()=>{
 principal('checker',['privileged:approve','agent.fund']);
 const row={id:'request-one',approvalId:'approval-one',direction:'FUND',agentId:'agent-one',aggregatorId:null,amountMinor:'100',currency:'NGN',idempotencyKey:'key-one',reference:'ref',requestHash:'hash',approvalFingerprint:'fp',status:'PENDING',approvalStatus:'REQUESTED',approvalExpiresAt:'2026-11-01',approvalApprovedBy:null,reason:'reason',actionType:'AGENT_FUND',requesterPrincipalId:'maker',checkerPrincipalId:null,journalId:null,policy:{}};
 (ApiClient.get as jest.Mock).mockResolvedValue([row]);(ApiClient.post as jest.Mock).mockRejectedValue(new Error('network lost'));
 render(<ApprovalsScreen/>);fireEvent.change(screen.getByLabelText('Funding Agent ID'),{target:{value:'agent-one'}});fireEvent.click(screen.getByRole('button',{name:'Load funding instructions'}));await screen.findByRole('button',{name:/request-one.*REQUESTED/});fireEvent.click(screen.getByLabelText('I reviewed this Agent, amount, direction and business reason'));fireEvent.click(screen.getByRole('button',{name:'Approve funding instruction'}));
 expect(await screen.findByTestId('funding-review-lock')).toBeTruthy();fireEvent.change(screen.getByLabelText('Pending Approval ID (UUID)'),{target:{value:'approval-one'}});expect((screen.getByRole('button',{name:'Sign & Approve Action'}) as HTMLButtonElement).disabled).toBe(true);expect(ApiClient.post).toHaveBeenCalledTimes(1);
});
