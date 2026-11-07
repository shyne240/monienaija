import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { RoleAssignmentScreen } from '../src/screens/authenticated/RoleAssignmentScreen';
import { ApiClient } from '../src/services/api-client';
import { useAuthStore } from '../src/store/auth-store';
jest.mock('../src/services/api-client', () => ({ ApiClient: { post: jest.fn(), delete: jest.fn() } }));
const principal = (id: string, scopes: string[]) => useAuthStore.setState({principal:{ type:'PRIVILEGED',principalId:id,sessionId:id,audience:'workforce-admin',roles:['SUPER_ADMIN'],scopes,customerAccess:'NONE',assuranceLevel:'MFA' }});
function fill() {fireEvent.change(screen.getByLabelText('Target Principal ID (e.g. issuer:subject)'),{target:{value:'synthetic-target'}});fireEvent.change(screen.getByLabelText('Effective From'),{target:{value:'2026-10-23T10:00'}});fireEvent.change(screen.getByLabelText('Effective To'),{target:{value:'2027-10-23T10:00'}});}
beforeEach(()=>{jest.resetAllMocks();principal('one',['workforce.role.assign','workforce.role.assign_operational']);});
test('role governance freezes action context while submitting and ignores completion after a principal change',async()=>{
 let resolve!: (v:any)=>void;const pending=new Promise<any>(r=>{resolve=r});(ApiClient.post as jest.Mock).mockReturnValue(pending);
 render(<RoleAssignmentScreen/>);fill();fireEvent.click(screen.getByRole('button',{name:'Commit Role Assignment'}));
 expect((screen.getByRole('button',{name:'Operational Roles'}) as HTMLButtonElement).disabled).toBe(true);
 act(()=>principal('two',['workforce.role.assign','workforce.role.assign_operational']));
 await act(async()=>{resolve({status:'ACTIVE'});await pending;});
 expect(screen.queryByText('Finance role assigned successfully.')).toBeNull();
 expect((screen.getByLabelText('Target Principal ID (e.g. issuer:subject)') as HTMLInputElement).value).toBe('');
});
test('an inconsistent role receipt does not claim success',async()=>{
 (ApiClient.post as jest.Mock).mockResolvedValue({status:'REVOKED'});
 render(<RoleAssignmentScreen/>);fill();fireEvent.click(screen.getByRole('button',{name:'Commit Role Assignment'}));
 expect(await screen.findByText(/outcome is unconfirmed/i)).toBeTruthy();expect(screen.queryByText('Finance role assigned successfully.')).toBeNull();
});
