import React from 'react';
import {act,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import {LimitAssignmentScreen} from '../src/screens/authenticated/LimitAssignmentScreen';
import {ApiClient} from '../src/services/api-client';
import {useAuthStore} from '../src/store/auth-store';
jest.mock('../src/services/api-client',()=>({ApiClient:{get:jest.fn(),post:jest.fn(),patch:jest.fn()}}));
const principal=(id='one')=>useAuthStore.setState({principal:{type:'OPERATOR',principalId:id,sessionId:id,audience:'workforce-admin',roles:['FINANCE_CONTROLLER'],scopes:['limit.view','limit.modify'],customerAccess:'NONE',assuranceLevel:'MFA'}});
const row={id:'synthetic-id',subjectType:'AGENT_CLASS',subjectId:'synthetic-class',limitProfileCode:'CLASS_STANDARD',isActive:true};
function deferred(){let resolve!:(v:any)=>void;const promise=new Promise<any>(r=>resolve=r);return {promise,resolve};}
beforeEach(()=>{jest.resetAllMocks();principal();});
test('an assignment without a version is displayed without inventing one and cannot be changed',async()=>{
 (ApiClient.get as jest.Mock).mockResolvedValue({data:[row],total:1,page:1,limit:20,totalPages:1,hasNextPage:false});render(<LimitAssignmentScreen/>);expect(await screen.findByText('Unavailable')).toBeTruthy();const button=screen.getByRole('button',{name:'Deactivate CLASS_STANDARD for AGENT_CLASS synthetic-class'}) as HTMLButtonElement;expect(button.disabled).toBe(true);fireEvent.click(button);expect(ApiClient.patch).not.toHaveBeenCalled();
});
test('a malformed create receipt does not claim assignment success',async()=>{
 (ApiClient.get as jest.Mock).mockResolvedValue({data:[]});(ApiClient.post as jest.Mock).mockResolvedValue({});render(<LimitAssignmentScreen/>);fireEvent.change(screen.getByLabelText('Agent class UUID'),{target:{value:'synthetic-class'}});fireEvent.change(screen.getByLabelText('Agent class limit profile code'),{target:{value:'CLASS_STANDARD'}});fireEvent.click(screen.getByRole('button',{name:'Assign to class'}));expect(await screen.findByText(/Assignment outcome not confirmed/)).toBeTruthy();expect(screen.queryByText(/Assigned profile CLASS_STANDARD/)).toBeNull();
});
test('editing diagnostics filters invalidates late results',async()=>{
 const pending=deferred();(ApiClient.get as jest.Mock).mockImplementation((url:string)=>url.includes('limit-usages')?pending.promise:Promise.resolve({data:[]}));render(<LimitAssignmentScreen/>);fireEvent.click(screen.getByRole('button',{name:'Search usage'}));fireEvent.change(screen.getAllByPlaceholderText('Profile code')[0],{target:{value:'NEW_PROFILE'}});await act(async()=>{pending.resolve({data:[{id:'old',product:'OLD_RESULT'}],page:1,limit:20,total:1,totalPages:1});await pending.promise;});expect(screen.queryByText('OLD_RESULT')).toBeNull();
});
test('an old assignment read cannot cross to another principal',async()=>{
 const pending=deferred();let calls=0;(ApiClient.get as jest.Mock).mockImplementation(()=>++calls===1?pending.promise:Promise.resolve({data:[]}));render(<LimitAssignmentScreen/>);act(()=>principal('two'));await screen.findByText('No matching limit assignments.');await act(async()=>{pending.resolve({data:[row]});await pending.promise;});expect(screen.queryByText('CLASS_STANDARD')).toBeNull();
});
test('assignment pagination preserves applied filters and uses the server page',async()=>{
 (ApiClient.get as jest.Mock).mockImplementation((url:string)=>{
   if(url.includes('page=2')) return Promise.resolve({data:[{...row,id:'page-two',limitProfileCode:'SECOND_PROFILE',version:2}],total:21,page:2,limit:20,totalPages:2,hasNextPage:false});
   return Promise.resolve({data:[{...row,version:1}],total:21,page:1,limit:20,totalPages:2,hasNextPage:true});
 });
 render(<LimitAssignmentScreen/>);await screen.findByText('CLASS_STANDARD');fireEvent.change(screen.getByLabelText('Assignment subject type'),{target:{value:'AGENT_CLASS'}});fireEvent.click(screen.getByRole('button',{name:'Filter assignments'}));await screen.findByText('21 assignments · Page 1 of 2');fireEvent.click(screen.getByRole('button',{name:'Next assignments'}));expect(await screen.findByText('SECOND_PROFILE')).toBeTruthy();expect(ApiClient.get).toHaveBeenCalledWith('/internal/limit-assignments?page=2&subjectType=AGENT_CLASS');expect(screen.getByText('21 assignments · Page 2 of 2')).toBeTruthy();
});
test('assignment page metadata cannot claim a different requested page',async()=>{
 (ApiClient.get as jest.Mock).mockImplementation((url:string)=>Promise.resolve({data:[{...row,version:1}],total:21,page:1,limit:20,totalPages:2,hasNextPage:true}));render(<LimitAssignmentScreen/>);await screen.findByText('21 assignments · Page 1 of 2');fireEvent.click(screen.getByRole('button',{name:'Next assignments'}));expect(await screen.findByText(/invalid or mismatched page/)).toBeTruthy();expect(screen.queryByText('21 assignments · Page 1 of 2')).toBeNull();
});


test('an unconfirmed toggle requires a verified matching read and explicit independent review',async()=>{
 (ApiClient.get as jest.Mock).mockResolvedValue({data:[{...row,version:1}],page:1,limit:20,total:1,totalPages:1,hasNextPage:false});
 (ApiClient.patch as jest.Mock).mockResolvedValue({id:'wrong',status:'DISABLED'});
 render(<LimitAssignmentScreen/>);fireEvent.click(await screen.findByRole('button',{name:'Deactivate CLASS_STANDARD for AGENT_CLASS synthetic-class'}));
 expect(await screen.findByText(/Assignment update not confirmed/)).toBeTruthy();expect(screen.queryByRole('button',{name:/Deactivate CLASS_STANDARD/})).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'Filter assignments'}));expect((await screen.findByRole('button',{name:'Deactivate CLASS_STANDARD for AGENT_CLASS synthetic-class'}) as HTMLButtonElement).disabled).toBe(true);expect(screen.queryByRole('button',{name:'I reviewed assignments and audit history'})).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'Load matching assignments for review'}));fireEvent.click(await screen.findByRole('button',{name:'I reviewed assignments and audit history'}));expect((screen.getByRole('button',{name:/Deactivate CLASS_STANDARD/}) as HTMLButtonElement).disabled).toBe(false);
});

test('customer context rejects another subject rather than displaying its assignment',async()=>{
 (ApiClient.get as jest.Mock).mockResolvedValue({data:[{...row,version:1}]});
 render(<LimitAssignmentScreen initialCustomerId="customer-1"/>);expect(await screen.findByText(/invalid or mismatched response/)).toBeTruthy();expect(screen.queryByRole('button',{name:/Deactivate CLASS_STANDARD/})).toBeNull();expect(ApiClient.get).toHaveBeenCalledWith('/internal/limit-assignments/customer/customer-1');
});

test('section navigation and action cards respect read and assignment scopes',async()=>{
 useAuthStore.setState(state=>({principal:{...state.principal!,scopes:['agent.assign_limit']}}));render(<LimitAssignmentScreen/>);
 expect(screen.getByRole('navigation',{name:'Limit workspace sections'})).toBeTruthy();expect(screen.getByRole('link',{name:'Manage assignments'})).toBeTruthy();expect(screen.queryByRole('link',{name:'Usage diagnostics'})).toBeNull();expect(screen.queryByRole('region',{name:'Existing assignments'})).toBeNull();
 expect(screen.getByLabelText('Agent UUID')).toBeTruthy();expect(screen.queryByLabelText('Agent class UUID')).toBeNull();expect(ApiClient.get).not.toHaveBeenCalled();
});


test('a matching versioned toggle receipt displays success in the assignment register',async()=>{
 (ApiClient.get as jest.Mock).mockResolvedValue({data:[{...row,version:1}]});(ApiClient.patch as jest.Mock).mockResolvedValue({...row,isActive:false,version:2});
 render(<LimitAssignmentScreen/>);fireEvent.click(await screen.findByRole('button',{name:'Deactivate CLASS_STANDARD for AGENT_CLASS synthetic-class'}));
 expect(await screen.findByText('Agent Class limit assignment CLASS_STANDARD deactivated.')).toBeTruthy();
 expect(ApiClient.patch).toHaveBeenCalledWith('/internal/limit-assignments/synthetic-id',{subjectType:'AGENT_CLASS',isActive:false,version:1});
});


test('an assignment read started during a failed toggle cannot restore stale rows',async()=>{
 const patch=deferred(), read=deferred();let reads=0;
 (ApiClient.get as jest.Mock).mockImplementation(()=>++reads===1?Promise.resolve({data:[{...row,version:1}]}):read.promise);
 (ApiClient.patch as jest.Mock).mockReturnValue(patch.promise);render(<LimitAssignmentScreen/>);
 fireEvent.click(await screen.findByRole('button',{name:/Deactivate CLASS_STANDARD/}));fireEvent.click(screen.getByRole('button',{name:'Filter assignments'}));
 await act(async()=>{patch.resolve({id:'wrong'});await patch.promise;});expect(screen.getByText(/Assignment update not confirmed/)).toBeTruthy();
 await act(async()=>{read.resolve({data:[{...row,version:1}]});await read.promise;});expect(screen.queryByRole('button',{name:/Deactivate CLASS_STANDARD/})).toBeNull();
});

test('read-only principals cannot issue assignment writes even when scopes include mutation',async()=>{
 useAuthStore.setState(state=>({principal:{...state.principal!,readOnlyPrincipal:true,scopes:['limit.view','limit.modify','agent.assign_limit']}}));(ApiClient.get as jest.Mock).mockResolvedValue({data:[{...row,version:1}]});render(<LimitAssignmentScreen/>);await screen.findByText('CLASS_STANDARD');expect(screen.getByText(/This session is read-only/)).toBeTruthy();expect(screen.queryByRole('button',{name:/Deactivate CLASS_STANDARD/})).toBeNull();expect((screen.getByRole('button',{name:'Assign to class'}) as HTMLButtonElement).disabled).toBe(true);fireEvent.submit(screen.getByRole('button',{name:'Assign to class'}).closest('form')!);expect(ApiClient.post).not.toHaveBeenCalled();expect(ApiClient.patch).not.toHaveBeenCalled();
});

test('write-only principals must acknowledge independent review after an uncertain create',async()=>{
 useAuthStore.setState(state=>({principal:{...state.principal!,scopes:['agent.assign_limit']}}));(ApiClient.post as jest.Mock).mockRejectedValue(new Error('network lost'));const report=jest.fn();render(<LimitAssignmentScreen onLimitGuardChange={report}/>);fireEvent.change(screen.getByLabelText('Agent UUID'),{target:{value:'agent-1'}});fireEvent.change(screen.getByLabelText('Agent limit profile code'),{target:{value:'STANDARD'}});fireEvent.click(screen.getByRole('button',{name:'Assign'}));await screen.findByText(/Assignment outcome not confirmed/);expect(report).toHaveBeenLastCalledWith(true,false);expect((screen.getByRole('button',{name:'Assign'}) as HTMLButtonElement).disabled).toBe(true);expect(ApiClient.get).not.toHaveBeenCalled();expect(screen.getByText(/independently authorized source/)).toBeTruthy();fireEvent.click(screen.getByRole('button',{name:'I reviewed assignments and audit history'}));expect((screen.getByRole('button',{name:'Assign'}) as HTMLButtonElement).disabled).toBe(false);expect((screen.getByLabelText('Agent UUID') as HTMLInputElement).value).toBe('agent-1');
});

test('a mismatched review cannot unlock a create and navigation guard preserves entered draft',async()=>{
 (ApiClient.get as jest.Mock).mockResolvedValue({data:[],page:1,limit:20,total:0,totalPages:0,hasNextPage:false});(ApiClient.post as jest.Mock).mockResolvedValue({});const report=jest.fn();render(<LimitAssignmentScreen onLimitGuardChange={report}/>);fireEvent.change(screen.getByLabelText('Agent class UUID'),{target:{value:'synthetic-class'}});fireEvent.change(screen.getByLabelText('Agent class limit profile code'),{target:{value:'CLASS_STANDARD'}});await waitFor(()=>expect(report).toHaveBeenLastCalledWith(true,false));const event=new Event('beforeunload',{cancelable:true});window.dispatchEvent(event);expect(event.defaultPrevented).toBe(true);fireEvent.click(screen.getByRole('button',{name:'Assign to class'}));await screen.findByText(/Assignment outcome not confirmed/);
 (ApiClient.get as jest.Mock).mockResolvedValue({data:[{...row,subjectId:'other',version:1}],page:1,limit:20,total:1,totalPages:1,hasNextPage:false});fireEvent.click(screen.getByRole('button',{name:'Load matching assignments for review'}));expect(await screen.findByText(/review response could not be verified/)).toBeTruthy();expect(screen.queryByRole('button',{name:'I reviewed assignments and audit history'})).toBeNull();expect((screen.getByRole('button',{name:'Assign to class'}) as HTMLButtonElement).disabled).toBe(true);
});

test('assignment actions are mutually exclusive while a request is pending',async()=>{
 useAuthStore.setState(state=>({principal:{...state.principal!,scopes:['limit.view','limit.modify','agent.assign_limit']}}));(ApiClient.get as jest.Mock).mockResolvedValue({data:[{...row,version:1}]});const pending=deferred();(ApiClient.post as jest.Mock).mockReturnValue(pending.promise);render(<LimitAssignmentScreen/>);await screen.findByText('CLASS_STANDARD');fireEvent.change(screen.getByLabelText('Agent UUID'),{target:{value:'agent-1'}});fireEvent.change(screen.getByLabelText('Agent limit profile code'),{target:{value:'STANDARD'}});fireEvent.click(screen.getByRole('button',{name:'Assign'}));expect((screen.getByRole('button',{name:'Assign to class'}) as HTMLButtonElement).disabled).toBe(true);expect((screen.getByRole('button',{name:/Deactivate CLASS_STANDARD/}) as HTMLButtonElement).disabled).toBe(true);fireEvent.submit(screen.getByRole('button',{name:'Assign to class'}).closest('form')!);expect(ApiClient.post).toHaveBeenCalledTimes(1);await act(async()=>{pending.resolve({});await pending.promise;});
});

test('shell navigation protects an unfinished assignment draft',async()=>{
 const {Layout}=await import('../src/screens/authenticated/Layout');useAuthStore.setState(state=>({isAuthenticated:true,principal:{...state.principal!,scopes:['limit.view','limit.modify','agent.assign_limit']}}));(ApiClient.get as jest.Mock).mockResolvedValue({data:[]});const view=render(<Layout/>);fireEvent.click(view.getByTestId('nav-limitAssignments'));fireEvent.change(await view.findByLabelText('Agent UUID'),{target:{value:'draft-agent'}});fireEvent.click(view.getByTestId('nav-dashboard'));expect(view.getByRole('dialog',{name:'Leave limit assignment review?'})).toBeTruthy();fireEvent.click(view.getByRole('button',{name:'Keep working'}));expect((view.getByLabelText('Agent UUID') as HTMLInputElement).value).toBe('draft-agent');fireEvent.click(view.getByTestId('nav-dashboard'));fireEvent.click(view.getByRole('button',{name:'Discard and leave'}));expect(view.queryByLabelText('Agent UUID')).toBeNull();
});

test('assignment filters reject mismatched rows rather than offering actions',async()=>{
 (ApiClient.get as jest.Mock).mockResolvedValue({data:[{...row,version:1}],page:1,limit:20,total:1,totalPages:1,hasNextPage:false});
 render(<LimitAssignmentScreen/>);await screen.findByText('CLASS_STANDARD');fireEvent.change(screen.getByLabelText('Assignment profile code'),{target:{value:'OTHER_PROFILE'}});fireEvent.click(screen.getByRole('button',{name:'Filter assignments'}));
 expect(await screen.findByText(/invalid or mismatched response/)).toBeTruthy();expect(screen.queryByText('CLASS_STANDARD')).toBeNull();expect(screen.queryByRole('button',{name:/Deactivate CLASS_STANDARD/})).toBeNull();
});

test('review does not unlock for duplicate assignments or incoherent page metadata',async()=>{
 (ApiClient.get as jest.Mock).mockResolvedValue({data:[{...row,version:1}],page:1,limit:20,total:1,totalPages:1,hasNextPage:false});(ApiClient.patch as jest.Mock).mockResolvedValue({});
 render(<LimitAssignmentScreen/>);fireEvent.click(await screen.findByRole('button',{name:/Deactivate CLASS_STANDARD/}));await screen.findByText(/Assignment update not confirmed/);
 (ApiClient.get as jest.Mock).mockResolvedValue({data:[{...row,version:1},{...row,version:1}],page:1,limit:20,total:2,totalPages:1,hasNextPage:false});fireEvent.click(screen.getByRole('button',{name:'Load matching assignments for review'}));
 expect(await screen.findByText(/review response could not be verified/)).toBeTruthy();expect(screen.queryByRole('button',{name:'I reviewed assignments and audit history'})).toBeNull();
});

test('toggle receipt must consume exactly the submitted version',async()=>{
 (ApiClient.get as jest.Mock).mockResolvedValue({data:[{...row,version:1}]});(ApiClient.patch as jest.Mock).mockResolvedValue({...row,version:3,isActive:false});
 render(<LimitAssignmentScreen/>);fireEvent.click(await screen.findByRole('button',{name:/Deactivate CLASS_STANDARD/}));expect(await screen.findByText(/Assignment update not confirmed/)).toBeTruthy();expect(screen.queryByText(/deactivated\./)).toBeNull();
});

test('filter edits while a write is pending do not trigger an outdated automatic refresh',async()=>{
 const pending=deferred();(ApiClient.get as jest.Mock).mockResolvedValue({data:[{...row,version:1}]});(ApiClient.patch as jest.Mock).mockReturnValue(pending.promise);
 render(<LimitAssignmentScreen/>);fireEvent.click(await screen.findByRole('button',{name:/Deactivate CLASS_STANDARD/}));fireEvent.change(screen.getByLabelText('Assignment profile code'),{target:{value:'NEW_PROFILE'}});
 await act(async()=>{pending.resolve({...row,version:2,isActive:false});await pending.promise;});expect(screen.getByText('Agent Class limit assignment CLASS_STANDARD deactivated.')).toBeTruthy();expect(ApiClient.get).toHaveBeenCalledTimes(1);expect(screen.queryByRole('button',{name:/Deactivate CLASS_STANDARD/})).toBeNull();
});


test('assignment detail uses returned data, restores focus and clears on filter changes',async()=>{
 (ApiClient.get as jest.Mock).mockResolvedValue({data:[row],total:1,page:1,limit:20,totalPages:1,hasNextPage:false});render(<LimitAssignmentScreen/>);
 const trigger=await screen.findByRole('button',{name:'View CLASS_STANDARD assignment details'});trigger.focus();fireEvent.click(trigger);const dialog=screen.getByRole('dialog',{name:'Limit assignment details'});expect(within(dialog).getByText('synthetic-id')).toBeTruthy();expect(within(dialog).getByText('Unavailable')).toBeTruthy();fireEvent.keyDown(document,{key:'Escape'});expect(screen.queryByRole('dialog',{name:'Limit assignment details'})).toBeNull();expect(document.activeElement).toBe(trigger);
 fireEvent.click(trigger);fireEvent.change(screen.getByLabelText('Assignment profile code'),{target:{value:'OTHER'}});expect(screen.queryByRole('dialog',{name:'Limit assignment details'})).toBeNull();expect(ApiClient.post).not.toHaveBeenCalled();expect(ApiClient.patch).not.toHaveBeenCalled();
});
