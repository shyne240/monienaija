import React from 'react';
import {act,fireEvent,render,screen} from '@testing-library/react';
import {LimitAssignmentScreen} from '../src/screens/authenticated/LimitAssignmentScreen';
import {ApiClient} from '../src/services/api-client';
import {useAuthStore} from '../src/store/auth-store';
jest.mock('../src/services/api-client',()=>({ApiClient:{get:jest.fn(),post:jest.fn(),patch:jest.fn()}}));
const principal=(id='one')=>useAuthStore.setState({principal:{type:'OPERATOR',principalId:id,sessionId:id,audience:'workforce-admin',roles:['FINANCE_CONTROLLER'],scopes:['limit.view','limit.modify'],customerAccess:'NONE',assuranceLevel:'MFA'}});
const row={id:'synthetic-id',subjectType:'AGENT_CLASS',subjectId:'synthetic-class',limitProfileCode:'CLASS_STANDARD',isActive:true};
function deferred(){let resolve!:(v:any)=>void;const promise=new Promise<any>(r=>resolve=r);return {promise,resolve};}
beforeEach(()=>{jest.resetAllMocks();principal();});
test('an assignment without a version is displayed without inventing one and cannot be changed',async()=>{
 (ApiClient.get as jest.Mock).mockResolvedValue({data:[row],total:1});render(<LimitAssignmentScreen/>);expect(await screen.findByText('Unavailable')).toBeTruthy();const button=screen.getByRole('button',{name:'Deactivate CLASS_STANDARD for AGENT_CLASS synthetic-class'}) as HTMLButtonElement;expect(button.disabled).toBe(true);fireEvent.click(button);expect(ApiClient.patch).not.toHaveBeenCalled();
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
   if(url.includes('page=2')) return Promise.resolve({data:[{...row,id:'page-two',limitProfileCode:'SECOND_PROFILE',version:2}],total:21,page:2,totalPages:2});
   return Promise.resolve({data:[{...row,version:1}],total:21,page:1,totalPages:2});
 });
 render(<LimitAssignmentScreen/>);await screen.findByText('CLASS_STANDARD');fireEvent.change(screen.getByLabelText('Assignment subject type'),{target:{value:'AGENT_CLASS'}});fireEvent.click(screen.getByRole('button',{name:'Filter assignments'}));await screen.findByText('21 assignments · Page 1 of 2');fireEvent.click(screen.getByRole('button',{name:'Next assignments'}));expect(await screen.findByText('SECOND_PROFILE')).toBeTruthy();expect(ApiClient.get).toHaveBeenCalledWith('/internal/limit-assignments?page=2&subjectType=AGENT_CLASS');expect(screen.getByText('21 assignments · Page 2 of 2')).toBeTruthy();
});
test('assignment page metadata cannot claim a different requested page',async()=>{
 (ApiClient.get as jest.Mock).mockImplementation((url:string)=>Promise.resolve({data:[{...row,version:1}],total:21,page:1,totalPages:2}));render(<LimitAssignmentScreen/>);await screen.findByText('21 assignments · Page 1 of 2');fireEvent.click(screen.getByRole('button',{name:'Next assignments'}));expect(await screen.findByText(/invalid or mismatched page/)).toBeTruthy();expect(screen.queryByText('21 assignments · Page 1 of 2')).toBeNull();
});


test('an unconfirmed toggle hides stale rows until a fresh read and does not assert success',async()=>{
 (ApiClient.get as jest.Mock).mockResolvedValue({data:[{...row,version:1}],page:1,total:1,totalPages:1});
 (ApiClient.patch as jest.Mock).mockResolvedValue({id:'wrong',status:'DISABLED'});
 render(<LimitAssignmentScreen/>);fireEvent.click(await screen.findByRole('button',{name:'Deactivate CLASS_STANDARD for AGENT_CLASS synthetic-class'}));
 expect(await screen.findByText(/Assignment update not confirmed/)).toBeTruthy();expect(screen.queryByRole('button',{name:/Deactivate CLASS_STANDARD/})).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'Filter assignments'}));expect(await screen.findByRole('button',{name:'Deactivate CLASS_STANDARD for AGENT_CLASS synthetic-class'})).toBeTruthy();expect(screen.queryByText(/Assignment update not confirmed/)).toBeNull();
});

test('customer context keeps toggle feedback and reload inside the assignment workspace',async()=>{
 (ApiClient.get as jest.Mock).mockResolvedValue({data:[{...row,version:1}]});(ApiClient.patch as jest.Mock).mockRejectedValue(new Error('offline'));
 render(<LimitAssignmentScreen initialCustomerId="customer-1"/>);fireEvent.click(await screen.findByRole('button',{name:'Deactivate CLASS_STANDARD for AGENT_CLASS synthetic-class'}));
 expect(await screen.findByText(/Assignment update not confirmed/)).toBeTruthy();expect(screen.queryByRole('button',{name:/Deactivate CLASS_STANDARD/})).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'Reload assignments'}));expect(await screen.findByRole('button',{name:/Deactivate CLASS_STANDARD/})).toBeTruthy();expect(ApiClient.get).toHaveBeenCalledWith('/internal/limit-assignments/customer/customer-1');
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
