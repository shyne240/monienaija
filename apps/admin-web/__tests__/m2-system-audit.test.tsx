import React from 'react';
import {act,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {SystemHealthScreen} from '../src/screens/authenticated/SystemHealthScreen';
import {AuditTrailScreen} from '../src/screens/authenticated/AuditTrailScreen';
import {ApiClient} from '../src/services/api-client';
import {useAuthStore} from '../src/store/auth-store';
jest.mock('../src/services/api-client',()=>({ApiClient:{get:jest.fn()}}));
const principal=(id='one',scopes=['notification.view_deliveries'])=>useAuthStore.setState({principal:{type:'OPERATOR',principalId:id,sessionId:id,audience:'workforce-admin',roles:['OPERATIONS'],scopes,customerAccess:'NONE',assuranceLevel:'MFA'}});
function deferred(){let resolve!:(v:any)=>void;const promise=new Promise<any>(r=>resolve=r);return {promise,resolve};}
beforeEach(()=>jest.resetAllMocks());
test('invalid delivery pages are errors rather than zero matches',async()=>{
 principal();(ApiClient.get as jest.Mock).mockResolvedValue({unexpected:'shape'});render(<SystemHealthScreen/>);expect(await screen.findByText(/invalid or mismatched response/)).toBeTruthy();expect(screen.queryByText(/matching delivery records/)).toBeNull();expect(screen.queryByText(/No notification deliveries were returned/)).toBeNull();
});
test('a late delivery page from another principal cannot replace the new workspace',async()=>{
 principal();const old=deferred();let calls=0;(ApiClient.get as jest.Mock).mockImplementation(()=>++calls===1?old.promise:Promise.resolve({data:[{id:'fresh',status:'FAILED',eventType:'FRESH_EVENT'}],page:1,total:1,hasNextPage:false}));render(<SystemHealthScreen/>);await waitFor(()=>expect(calls).toBe(1));act(()=>principal('two'));expect((await screen.findAllByText('FRESH_EVENT')).length).toBeGreaterThan(0);await act(async()=>{old.resolve({data:[{id:'old',eventType:'OLD_EVENT'}],page:1,total:1,hasNextPage:false});await old.promise;});expect(screen.queryByText('OLD_EVENT')).toBeNull();
});
test('editing the audit query invalidates late search results',async()=>{
 principal('one',['audit.search']);const pending=deferred();(ApiClient.get as jest.Mock).mockReturnValue(pending.promise);render(<AuditTrailScreen/>);fireEvent.change(screen.getByLabelText('Entity ID (optional)'),{target:{value:'old'}});fireEvent.click(screen.getByRole('button',{name:'Search'}));fireEvent.change(screen.getByLabelText('Entity ID (optional)'),{target:{value:'new'}});await act(async()=>{pending.resolve([{id:'audit',actor:'OLD ACTOR',action:'OLD',entityType:'CUSTOMER',entityId:'old'}]);await pending.promise;});expect(screen.queryByText('OLD ACTOR')).toBeNull();expect(screen.getByText('Enter an entity ID or search all events.')).toBeTruthy();
});
test('audit results are cleared on principal change even when the scope remains',async()=>{
 principal('one',['audit.search']);(ApiClient.get as jest.Mock).mockResolvedValue([{id:'audit',actor:'FIRST ACTOR',action:'READ',entityType:'CUSTOMER',entityId:'old'}]);render(<AuditTrailScreen/>);fireEvent.click(screen.getByRole('button',{name:'Search'}));await screen.findByText('FIRST ACTOR');act(()=>principal('two',['audit.search']));expect(screen.queryByText('FIRST ACTOR')).toBeNull();
});
