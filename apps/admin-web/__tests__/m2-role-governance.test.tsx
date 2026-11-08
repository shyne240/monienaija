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
 render(<RoleAssignmentScreen/>);fill();fireEvent.click(screen.getByRole('button',{name:'Commit Role Assignment'}));fireEvent.click(screen.getByRole('button',{name:'Confirm role change'}));
 expect((screen.getByRole('button',{name:'Operational Roles'}) as HTMLButtonElement).disabled).toBe(true);
 act(()=>principal('two',['workforce.role.assign','workforce.role.assign_operational']));
 await act(async()=>{resolve({status:'ACTIVE'});await pending;});
 expect(screen.queryByText('Finance role assigned successfully.')).toBeNull();
 expect((screen.getByLabelText('Target Principal ID (e.g. issuer:subject)') as HTMLInputElement).value).toBe('');
});
test('an inconsistent role receipt does not claim success',async()=>{
 (ApiClient.post as jest.Mock).mockResolvedValue({status:'REVOKED'});
 render(<RoleAssignmentScreen/>);fill();fireEvent.click(screen.getByRole('button',{name:'Commit Role Assignment'}));fireEvent.click(screen.getByRole('button',{name:'Confirm role change'}));
 expect(await screen.findByText(/outcome is unconfirmed/i)).toBeTruthy();expect(screen.queryByText('Finance role assigned successfully.')).toBeNull();
});
test('a status-only receipt cannot prove which role or principal changed',async()=>{
 (ApiClient.post as jest.Mock).mockResolvedValue({status:'ACTIVE'});render(<RoleAssignmentScreen/>);fill();fireEvent.click(screen.getByRole('button',{name:'Commit Role Assignment'}));fireEvent.click(screen.getByRole('button',{name:'Confirm role change'}));expect(await screen.findByText(/outcome is unconfirmed/i)).toBeTruthy();expect(screen.queryByText('Finance role assigned successfully.')).toBeNull();
});
test('role assignment requires MFA and clears draft when assurance changes',()=>{
 render(<RoleAssignmentScreen/>);fill();act(()=>useAuthStore.setState(state=>({principal:{...state.principal!,assuranceLevel:'PASSWORD'}})));expect((screen.getByLabelText('Target Principal ID (e.g. issuer:subject)') as HTMLInputElement).value).toBe('');expect((screen.getByRole('button',{name:'Commit Role Assignment'}) as HTMLButtonElement).disabled).toBe(true);expect(screen.getByText(/MFA session assurance is required/)).toBeTruthy();expect(ApiClient.post).not.toHaveBeenCalled();
});


test('review captures the role, principal and UTC window; Escape cancels and restores focus without a write',()=>{
 render(<RoleAssignmentScreen/>);fill();const trigger=screen.getByRole('button',{name:'Commit Role Assignment'});fireEvent.click(trigger);
 const dialog=screen.getByRole('dialog',{name:'Confirm role assignment'});expect(dialog.textContent).toContain('synthetic-target');expect(dialog.textContent).toContain('FINANCE_PREPARER');expect(dialog.textContent).toContain(new Date('2026-10-23T10:00').toISOString());
 expect(document.activeElement).toBe(screen.getByRole('button',{name:'Cancel'}));fireEvent.keyDown(document,{key:'Tab',shiftKey:true});expect(document.activeElement).toBe(screen.getByRole('button',{name:'Confirm role change'}));
 fireEvent.keyDown(document,{key:'Escape'});expect(screen.queryByRole('dialog')).toBeNull();expect(document.activeElement).toBe(trigger);expect(ApiClient.post).not.toHaveBeenCalled();
});

test('review freezes finance approvals and a session change dismisses the review',()=>{
 render(<RoleAssignmentScreen/>);fill();fireEvent.change(screen.getByLabelText('Related Maker-Checker Approval IDs (comma separated, when required)'),{target:{value:'approval-a, approval-b'}});
 fireEvent.click(screen.getByRole('button',{name:'Commit Role Assignment'}));expect(screen.getByRole('dialog').textContent).toContain('approval-a, approval-b');expect((screen.getByLabelText('Target Principal ID (e.g. issuer:subject)') as HTMLInputElement).disabled).toBe(true);
 act(()=>principal('two',['workforce.role.assign']));expect(screen.queryByRole('dialog')).toBeNull();expect(ApiClient.post).not.toHaveBeenCalled();
});

test('in-flight review is single flight and cannot be dismissed while executing',async()=>{
 let resolve!:(v:any)=>void;const pending=new Promise<any>(r=>{resolve=r});(ApiClient.post as jest.Mock).mockReturnValue(pending);render(<RoleAssignmentScreen/>);fill();fireEvent.click(screen.getByRole('button',{name:'Commit Role Assignment'}));fireEvent.click(screen.getByRole('button',{name:'Confirm role change'}));
 expect(document.activeElement).toBe(screen.getByRole('dialog'));fireEvent.keyDown(document,{key:'Escape'});expect(screen.getByRole('dialog')).toBeTruthy();expect(ApiClient.post).toHaveBeenCalledTimes(1);
 await act(async()=>{resolve({assignmentReference:'synthetic-reference',assignmentVersion:1,status:'ACTIVE',principalId:'synthetic-target',roleKey:'FINANCE_PREPARER',assignedBy:'one',assignedAt:'2026-10-23T09:00:00Z',effectiveFrom:new Date('2026-10-23T10:00').toISOString(),effectiveTo:new Date('2027-10-23T10:00').toISOString()});await pending;});expect(screen.getByText('Finance role assigned successfully.')).toBeTruthy();expect(screen.getByText(/Target:/).textContent).toContain('synthetic-target');
});

test('read-only principal cannot write despite privileged role and mutation scopes',()=>{
 act(()=>useAuthStore.setState(state=>({principal:{...state.principal!,readOnlyPrincipal:true}})));render(<RoleAssignmentScreen/>);expect(screen.getByText(/session that is not read-only/)).toBeTruthy();expect(screen.queryByRole('button',{name:'Commit Role Assignment'})).toBeNull();expect(ApiClient.post).not.toHaveBeenCalled();
});

test('a mismatched assignment window locks all changes until independent role and audit review',async()=>{
 const report=jest.fn();(ApiClient.post as jest.Mock).mockResolvedValue({assignmentReference:'ref',assignmentVersion:1,status:'ACTIVE',principalId:'synthetic-target',roleKey:'FINANCE_PREPARER',assignedBy:'one',assignedAt:'2026-10-23T09:00:00Z',effectiveFrom:'2026-01-01T00:00:00Z',effectiveTo:'2027-10-23T10:00:00Z'});render(<RoleAssignmentScreen onRoleGuardChange={report}/>);fill();fireEvent.click(screen.getByRole('button',{name:'Commit Role Assignment'}));fireEvent.click(screen.getByRole('button',{name:'Confirm role change'}));await screen.findByText(/outcome is unconfirmed/);expect((screen.getByRole('button',{name:'Commit Role Assignment'}) as HTMLButtonElement).disabled).toBe(true);expect((screen.getByRole('button',{name:'Operational Roles'}) as HTMLButtonElement).disabled).toBe(true);expect(screen.getByText(/fresh read cannot exclude a late commit/)).toBeTruthy();expect(report).toHaveBeenLastCalledWith(true,false);const event=new Event('beforeunload',{cancelable:true});window.dispatchEvent(event);expect(event.defaultPrevented).toBe(true);fireEvent.submit(screen.getByRole('button',{name:'Commit Role Assignment'}).closest('form')!);expect(ApiClient.post).toHaveBeenCalledTimes(1);fireEvent.click(screen.getByRole('button',{name:'I reviewed the role, approvals and audit history'}));expect((screen.getByRole('button',{name:'Commit Role Assignment'}) as HTMLButtonElement).disabled).toBe(false);expect((screen.getByLabelText('Target Principal ID (e.g. issuer:subject)') as HTMLInputElement).value).toBe('synthetic-target');
});

test('changing role domain protects entered approval identifiers',()=>{
 const confirm=jest.spyOn(window,'confirm').mockReturnValue(false);render(<RoleAssignmentScreen/>);fireEvent.change(screen.getByLabelText('Related Maker-Checker Approval IDs (comma separated, when required)'),{target:{value:'approval-one'}});fireEvent.click(screen.getByRole('button',{name:'Operational Roles'}));expect(screen.getByLabelText('Related Maker-Checker Approval IDs (comma separated, when required)')).toHaveProperty('value','approval-one');confirm.mockReturnValue(true);fireEvent.click(screen.getByRole('button',{name:'Operational Roles'}));expect(screen.queryByLabelText('Related Maker-Checker Approval IDs (comma separated, when required)')).toBeNull();confirm.mockRestore();
});

test('a store session change clears the local role draft and pending review',()=>{
 render(<RoleAssignmentScreen/>);fill();fireEvent.click(screen.getByRole('button',{name:'Commit Role Assignment'}));act(()=>useAuthStore.setState({sessionId:'different-session'}));expect(screen.queryByRole('dialog')).toBeNull();expect(screen.getByLabelText('Target Principal ID (e.g. issuer:subject)')).toHaveProperty('value','');
});

test('shell navigation protects a role governance draft',async()=>{
 const {Layout}=await import('../src/screens/authenticated/Layout');useAuthStore.setState({isAuthenticated:true});const view=render(<Layout/>);fireEvent.click(view.getByTestId('nav-roleGovernance'));fill();fireEvent.click(view.getByTestId('nav-dashboard'));expect(view.getByRole('dialog',{name:'Leave role change review?'})).toBeTruthy();fireEvent.click(view.getByRole('button',{name:'Keep working'}));expect(view.getByLabelText('Target Principal ID (e.g. issuer:subject)')).toHaveProperty('value','synthetic-target');fireEvent.click(view.getByTestId('nav-dashboard'));fireEvent.click(view.getByRole('button',{name:'Discard and leave'}));expect(view.queryByLabelText('Target Principal ID (e.g. issuer:subject)')).toBeNull();
});
