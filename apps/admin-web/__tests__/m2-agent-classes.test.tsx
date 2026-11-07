import React from 'react';
import {act,fireEvent,render,screen,within} from '@testing-library/react';
import {AgentClassesScreen} from '../src/screens/authenticated/AgentClassesScreen';
import {ApiClient} from '../src/services/api-client';
import {useAuthStore} from '../src/store/auth-store';
jest.mock('../src/services/api-client',()=>({ApiClient:{get:jest.fn(),post:jest.fn(),patch:jest.fn()}}));
const cls=(id:string)=>({id,reference:`REF-${id}`,code:`CODE-${id}`,name:`Class ${id}`,description:null,isActive:true,requirements:null,requiredInformation:null,requiredDocumentCategories:null,applicableServices:null,applicableLimits:null,version:2,createdAt:'2026-01-01',updatedAt:'2026-01-01'});
function deferred(){let resolve!:(v:any)=>void;const promise=new Promise<any>(r=>resolve=r);return {promise,resolve};}
beforeEach(()=>{jest.resetAllMocks();useAuthStore.setState({principal:{type:'OPERATOR',principalId:'synthetic',sessionId:'synthetic',audience:'workforce-admin',roles:['AGENT_NETWORK_MANAGER'],scopes:['agent.view','agent.manage_classes','limit.view','limit.modify'],customerAccess:'NONE',assuranceLevel:'MFA'}})});
test('failed catalogue refresh is unavailable, not empty, and retains the draft for retry',async()=>{
 (ApiClient.get as jest.Mock).mockResolvedValueOnce([cls('a')]).mockRejectedValueOnce(new Error('Catalogue unavailable')).mockResolvedValueOnce([cls('a')]);
 render(<AgentClassesScreen/>);fireEvent.click(await screen.findByRole('button',{name:'Review / edit'}));fireEvent.change(screen.getByLabelText('Class name'),{target:{value:'Draft class'}});fireEvent.click(screen.getByRole('button',{name:'Refresh'}));
 expect(await screen.findByText(/Agent class catalogue unavailable/)).toBeTruthy();expect(screen.queryByText('No Agent classes returned by the authorized API.')).toBeNull();expect(screen.queryByRole('button',{name:'Save class'})).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'Refresh'}));expect(await screen.findByLabelText('Class name')).toHaveProperty('value','Draft class');
});
test('late limit results never appear under the newly selected class',async()=>{
 const old=deferred();(ApiClient.get as jest.Mock).mockImplementation((url:string)=>url==='/internal/agents/classes'?Promise.resolve([cls('a'),cls('b')]):url.endsWith('/a')?old.promise:Promise.resolve([]));
 render(<AgentClassesScreen/>);await screen.findByText('REF-a');fireEvent.click(screen.getAllByRole('button',{name:'Review / edit'})[0]);fireEvent.click(screen.getByRole('button',{name:'Load class limit assignments'}));fireEvent.click(screen.getAllByRole('button',{name:'Review / edit'})[1]);
 await act(async()=>{old.resolve([{id:'old-limit',limitProfileCode:'OLD_PROFILE',isActive:true,version:1}]);await old.promise;});expect(screen.queryByText('OLD_PROFILE')).toBeNull();expect(screen.getByRole('button',{name:'Load class limit assignments'})).toBeTruthy();
});
test('missing optimistic limit version is not invented for an action',async()=>{
 (ApiClient.get as jest.Mock).mockImplementation((url:string)=>url==='/internal/agents/classes'?Promise.resolve([cls('a')]):Promise.resolve([{id:'limit',limitProfileCode:'SYNTHETIC_PROFILE',isActive:true}]));
 render(<AgentClassesScreen/>);fireEvent.click(await screen.findByRole('button',{name:'Review / edit'}));fireEvent.click(screen.getByRole('button',{name:'Load class limit assignments'}));expect(await screen.findByText('SYNTHETIC_PROFILE')).toBeTruthy();
 expect(within(screen.getByLabelText('Agent class limit assignments')).getByText(/version unavailable/)).toBeTruthy();expect((screen.getByRole('button',{name:'Deactivate class limit'}) as HTMLButtonElement).disabled).toBe(true);expect(ApiClient.patch).not.toHaveBeenCalled();
});
test('a changed catalogue version preserves the draft but blocks saving it as current',async()=>{
 (ApiClient.get as jest.Mock).mockResolvedValueOnce([cls('a')]).mockResolvedValueOnce([{...cls('a'),version:3}]);
 render(<AgentClassesScreen/>);fireEvent.click(await screen.findByRole('button',{name:'Review / edit'}));fireEvent.change(screen.getByLabelText('Class name'),{target:{value:'Draft class'}});fireEvent.click(screen.getByRole('button',{name:'Refresh'}));
 expect(await screen.findByText(/catalogue has changed/)).toBeTruthy();expect(screen.getByLabelText('Class name')).toHaveProperty('value','Draft class');expect((screen.getByRole('button',{name:'Save class'}) as HTMLButtonElement).disabled).toBe(true);expect(ApiClient.patch).not.toHaveBeenCalled();
});
