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
 render(<ApprovalsScreen/>);fireEvent.change(screen.getByLabelText('Pending Approval ID (UUID)'),{target:{value:'synthetic-id'}});fireEvent.click(screen.getByRole('button',{name:'Sign & Approve Action'}));
 expect(await screen.findByText(/Decision not confirmed: SELF_APPROVAL_FORBIDDEN/)).toBeTruthy();
 expect(screen.queryByText(/Approval recorded/)).toBeNull();
});
test('a denied rejection is not confused with a recorded REJECTED decision',async()=>{
 (ApiClient.post as jest.Mock).mockResolvedValue({approved:false,reason:'MFA_REQUIRED',approval:{id:'synthetic-id',status:'REQUESTED'}});
 render(<ApprovalsScreen/>);fireEvent.change(screen.getByLabelText('Pending Approval ID (UUID)'),{target:{value:'synthetic-id'}});fireEvent.click(screen.getByRole('button',{name:'Reject Action'}));
 expect(await screen.findByText(/Decision not confirmed: MFA_REQUIRED/)).toBeTruthy();expect(screen.queryByText('Approval decision recorded as rejected successfully.')).toBeNull();
});
test('late approval result is not presented to a different checker',async()=>{
 let resolve!: (v:any)=>void;const pending=new Promise<any>(r=>resolve=r);(ApiClient.post as jest.Mock).mockReturnValue(pending);
 render(<ApprovalsScreen/>);fireEvent.change(screen.getByLabelText('Pending Approval ID (UUID)'),{target:{value:'synthetic-id'}});fireEvent.click(screen.getByRole('button',{name:'Sign & Approve Action'}));
 act(()=>principal('two'));await act(async()=>{resolve({approved:true,reason:'APPROVED',approval:{id:'synthetic-id',status:'APPROVED'}});await pending;});
 expect(screen.queryByText(/Approval recorded/)).toBeNull();expect((screen.getByLabelText('Pending Approval ID (UUID)') as HTMLInputElement).value).toBe('');
});
