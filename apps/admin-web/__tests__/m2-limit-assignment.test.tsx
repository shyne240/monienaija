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
 (ApiClient.get as jest.Mock).mockResolvedValue({data:[row],total:1});render(<LimitAssignmentScreen/>);expect(await screen.findByText('Unavailable')).toBeTruthy();const button=screen.getByRole('button',{name:'Deactivate'}) as HTMLButtonElement;expect(button.disabled).toBe(true);fireEvent.click(button);expect(ApiClient.patch).not.toHaveBeenCalled();
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
