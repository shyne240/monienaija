import React from 'react';
import {act,fireEvent,render,screen,within} from '@testing-library/react';
import {AgentClassesScreen} from '../src/screens/authenticated/AgentClassesScreen';
import {ApiClient} from '../src/services/api-client';
import {useAuthStore} from '../src/store/auth-store';
jest.mock('../src/services/api-client',()=>({ApiClient:{get:jest.fn(),post:jest.fn(),patch:jest.fn()}}));
const cls=(id:string)=>({id,reference:`REF-${id}`,code:`CODE-${id}`,name:`Class ${id}`,description:null,isActive:true,requirements:null,requiredInformation:null,requiredDocumentCategories:null,applicableServices:null,applicableLimits:null,version:2,createdAt:'2026-01-01',updatedAt:'2026-01-01'});
const page=(data:any[], page=1, total=data.length, limit=20)=>({data,page,total,limit,totalPages:Math.ceil(total/limit),hasNextPage:page<Math.ceil(total/limit)});
const limit=(id:string,subjectId='a',version:any=1,isActive=true)=>({id,subjectType:'AGENT_CLASS',subjectId,limitProfileCode:'SYNTHETIC_PROFILE',isActive,version});
function deferred(){let resolve!:(v:any)=>void;const promise=new Promise<any>(r=>resolve=r);return {promise,resolve};}
beforeEach(()=>{jest.resetAllMocks();useAuthStore.setState({principal:{type:'OPERATOR',principalId:'synthetic',sessionId:'synthetic',audience:'workforce-admin',roles:['AGENT_NETWORK_MANAGER'],scopes:['agent.view','agent.manage_classes','limit.view','limit.modify'],customerAccess:'NONE',assuranceLevel:'MFA'}})});
test('failed catalogue refresh is unavailable, not empty, and retains the draft for retry',async()=>{
 (ApiClient.get as jest.Mock).mockResolvedValueOnce([cls('a')]).mockRejectedValueOnce(new Error('Catalogue unavailable')).mockResolvedValueOnce([cls('a')]);
 render(<AgentClassesScreen/>);fireEvent.click(await screen.findByRole('button',{name:'Review / edit'}));fireEvent.change(screen.getByLabelText('Class name'),{target:{value:'Draft class'}});fireEvent.click(screen.getByRole('button',{name:'Refresh'}));
 expect(await screen.findByText(/Agent class catalogue unavailable/)).toBeTruthy();expect(screen.queryByText('No Agent classes returned by the authorized API.')).toBeNull();expect(screen.queryByRole('button',{name:'Save class'})).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'Refresh'}));expect(await screen.findByLabelText('Class name')).toHaveProperty('value','Draft class');
});
test('late limit results never appear under the newly selected class',async()=>{
 const old=deferred();(ApiClient.get as jest.Mock).mockImplementation((url:string)=>url==='/internal/agents/classes'?Promise.resolve([cls('a'),cls('b')]):url.includes('/agent-class/a?')?old.promise:Promise.resolve(page([])));
 render(<AgentClassesScreen/>);await screen.findByText('REF-a');fireEvent.click(screen.getAllByRole('button',{name:'Review / edit'})[0]);fireEvent.click(screen.getByRole('button',{name:'Load class limit assignments'}));fireEvent.click(screen.getAllByRole('button',{name:'Review / edit'})[1]);
 await act(async()=>{old.resolve(page([{...limit('old-limit'),limitProfileCode:'OLD_PROFILE'}]));await old.promise;});expect(screen.queryByText('OLD_PROFILE')).toBeNull();expect(screen.getByRole('button',{name:'Load class limit assignments'})).toBeTruthy();
});
test('missing optimistic limit version is not invented for an action',async()=>{
 (ApiClient.get as jest.Mock).mockImplementation((url:string)=>url==='/internal/agents/classes'?Promise.resolve([cls('a')]):Promise.resolve(page([{...limit('limit'),version:undefined}])));
 render(<AgentClassesScreen/>);fireEvent.click(await screen.findByRole('button',{name:'Review / edit'}));fireEvent.click(screen.getByRole('button',{name:'Load class limit assignments'}));expect(await screen.findByText('SYNTHETIC_PROFILE')).toBeTruthy();
 expect(within(screen.getByLabelText('Agent class limit assignments')).getByText(/version unavailable/)).toBeTruthy();expect((screen.getByRole('button',{name:'Deactivate class limit'}) as HTMLButtonElement).disabled).toBe(true);expect(ApiClient.patch).not.toHaveBeenCalled();
});
test('a changed catalogue version preserves the draft but blocks saving it as current',async()=>{
 (ApiClient.get as jest.Mock).mockResolvedValueOnce([cls('a')]).mockResolvedValueOnce([{...cls('a'),version:3}]);
 render(<AgentClassesScreen/>);fireEvent.click(await screen.findByRole('button',{name:'Review / edit'}));fireEvent.change(screen.getByLabelText('Class name'),{target:{value:'Draft class'}});fireEvent.click(screen.getByRole('button',{name:'Refresh'}));
 expect(await screen.findByText(/catalogue has changed/)).toBeTruthy();expect(screen.getByLabelText('Class name')).toHaveProperty('value','Draft class');expect((screen.getByRole('button',{name:'Save class'}) as HTMLButtonElement).disabled).toBe(true);expect(ApiClient.patch).not.toHaveBeenCalled();
});

test('class limits paginate using backend metadata and never display another class assignment',async()=>{
 (ApiClient.get as jest.Mock).mockImplementation((url:string)=>url==='/internal/agents/classes'?Promise.resolve([cls('a')]):Promise.resolve(url.includes('page=2')?page([{...limit('second'),limitProfileCode:'SECOND_PROFILE'}],2,21):page([limit('first')],1,21)));
 render(<AgentClassesScreen/>);fireEvent.click(await screen.findByRole('button',{name:'Review / edit'}));fireEvent.click(screen.getByRole('button',{name:'Load class limit assignments'}));
 expect(await screen.findByText('Page 1 of 2 · 21 assignments')).toBeTruthy();fireEvent.click(screen.getByRole('button',{name:'Next'}));expect(await screen.findByText('SECOND_PROFILE')).toBeTruthy();expect(screen.queryByText('SYNTHETIC_PROFILE')).toBeNull();
 expect(ApiClient.get).toHaveBeenCalledWith('/internal/limit-assignments/agent-class/a?page=2&limit=20');fireEvent.click(screen.getByRole('button',{name:'Previous'}));expect(await screen.findByText('SYNTHETIC_PROFILE')).toBeTruthy();
});
test('rejects class limit pages containing another class and does not offer row actions',async()=>{
 (ApiClient.get as jest.Mock).mockImplementation((url:string)=>url==='/internal/agents/classes'?Promise.resolve([cls('a')]):Promise.resolve(page([limit('foreign','b')])));
 render(<AgentClassesScreen/>);fireEvent.click(await screen.findByRole('button',{name:'Review / edit'}));fireEvent.click(screen.getByRole('button',{name:'Load class limit assignments'}));expect(await screen.findByText(/Invalid Agent class limit assignments response/)).toBeTruthy();expect(screen.queryByRole('button',{name:'Deactivate class limit'})).toBeNull();
});
test('rejects an unrelated class limit create receipt and retains the profile code',async()=>{
 (ApiClient.get as jest.Mock).mockResolvedValue([cls('a')]);(ApiClient.post as jest.Mock).mockResolvedValue({...limit('new','b'),limitProfileCode:'NEW_PROFILE'});
 render(<AgentClassesScreen/>);fireEvent.click(await screen.findByRole('button',{name:'Review / edit'}));fireEvent.change(screen.getByLabelText('Class limit profile code'),{target:{value:'new_profile'}});fireEvent.click(screen.getByRole('button',{name:'Assign class limit'}));
 expect(await screen.findByText(/assignment outcome could not be confirmed/)).toBeTruthy();expect(screen.queryByText(/Assigned limit profile NEW_PROFILE/)).toBeNull();expect(screen.getByLabelText('Class limit profile code')).toHaveProperty('value','new_profile');
});
test('confirms a matching class limit create receipt even when refresh fails',async()=>{
 (ApiClient.get as jest.Mock).mockImplementation((url:string)=>url==='/internal/agents/classes'?Promise.resolve([cls('a')]):Promise.reject(new Error('Limits unavailable')));(ApiClient.post as jest.Mock).mockResolvedValue({...limit('new'),limitProfileCode:'NEW_PROFILE'});
 render(<AgentClassesScreen/>);fireEvent.click(await screen.findByRole('button',{name:'Review / edit'}));fireEvent.change(screen.getByLabelText('Class limit profile code'),{target:{value:'NEW_PROFILE'}});fireEvent.click(screen.getByRole('button',{name:'Assign class limit'}));
 expect(await screen.findByText(/Assigned limit profile NEW_PROFILE/)).toBeTruthy();expect(await screen.findByText('Limits unavailable')).toBeTruthy();expect(screen.getByLabelText('Class limit profile code')).toHaveProperty('value','');
});
test('rejects an unrelated toggle receipt, hides stale row and requires a reload',async()=>{
 (ApiClient.get as jest.Mock).mockImplementation((url:string)=>url==='/internal/agents/classes'?Promise.resolve([cls('a')]):Promise.resolve(page([limit('first')])));(ApiClient.patch as jest.Mock).mockResolvedValue(limit('other','a',2,false));
 render(<AgentClassesScreen/>);fireEvent.click(await screen.findByRole('button',{name:'Review / edit'}));fireEvent.click(screen.getByRole('button',{name:'Load class limit assignments'}));fireEvent.click(await screen.findByRole('button',{name:'Deactivate class limit'}));
 expect(await screen.findByText(/update outcome could not be confirmed/)).toBeTruthy();expect(screen.queryByText(/SYNTHETIC_PROFILE deactivated/)).toBeNull();expect(screen.queryByRole('button',{name:'Deactivate class limit'})).toBeNull();
});
test('confirms a matching toggle receipt and reloads its selected page',async()=>{
 (ApiClient.get as jest.Mock).mockImplementation((url:string)=>url==='/internal/agents/classes'?Promise.resolve([cls('a')]):Promise.resolve(url.includes('page=2')?page([limit('second')],2,21):page([limit('first')],1,21)));(ApiClient.patch as jest.Mock).mockResolvedValue(limit('second','a',2,false));
 render(<AgentClassesScreen/>);fireEvent.click(await screen.findByRole('button',{name:'Review / edit'}));fireEvent.click(screen.getByRole('button',{name:'Load class limit assignments'}));fireEvent.click(await screen.findByRole('button',{name:'Next'}));fireEvent.click(await screen.findByRole('button',{name:'Deactivate class limit'}));
 expect(await screen.findByText(/Class limit SYNTHETIC_PROFILE deactivated/)).toBeTruthy();expect((ApiClient.get as jest.Mock).mock.calls.filter(([url])=>url.includes('page=2'))).toHaveLength(2);
});
test('blocks concurrent class save while a class limit write is pending',async()=>{
 const pending=deferred();(ApiClient.get as jest.Mock).mockResolvedValue([cls('a')]);(ApiClient.post as jest.Mock).mockReturnValue(pending.promise);
 render(<AgentClassesScreen/>);fireEvent.click(await screen.findByRole('button',{name:'Review / edit'}));fireEvent.change(screen.getByLabelText('Class limit profile code'),{target:{value:'NEW_PROFILE'}});fireEvent.click(screen.getByRole('button',{name:'Assign class limit'}));expect((screen.getByRole('button',{name:'Save class'}) as HTMLButtonElement).disabled).toBe(true);expect(ApiClient.patch).not.toHaveBeenCalled();
 await act(async()=>{pending.resolve({...limit('new'),limitProfileCode:'NEW_PROFILE'});await pending.promise;});
});
test('a session change clears class drafts and ignores a late class limit write',async()=>{
 const pending=deferred();(ApiClient.get as jest.Mock).mockImplementation((url:string)=>url==='/internal/agents/classes'?Promise.resolve([cls('a')]):Promise.resolve(page([])));(ApiClient.post as jest.Mock).mockReturnValue(pending.promise);
 render(<AgentClassesScreen/>);fireEvent.click(await screen.findByRole('button',{name:'Review / edit'}));fireEvent.change(screen.getByLabelText('Class limit profile code'),{target:{value:'NEW_PROFILE'}});fireEvent.click(screen.getByRole('button',{name:'Assign class limit'}));
 act(()=>useAuthStore.setState(state=>({principal:state.principal?{...state.principal,sessionId:'another-session'}:null})));await act(async()=>{pending.resolve({...limit('new'),limitProfileCode:'NEW_PROFILE'});await pending.promise;});
 expect(screen.queryByText(/Assigned limit profile NEW_PROFILE/)).toBeNull();expect(screen.queryByLabelText('Class limit profile code')).toBeNull();
});
test('read-only governance cannot create or modify classes and class limits',async()=>{
 act(()=>useAuthStore.setState(state=>({principal:state.principal?{...state.principal,scopes:['agent.view','limit.view']}:null})));(ApiClient.get as jest.Mock).mockImplementation((url:string)=>url==='/internal/agents/classes'?Promise.resolve([cls('a')]):Promise.resolve(page([limit('first')])));
 render(<AgentClassesScreen/>);fireEvent.click(await screen.findByRole('button',{name:'Review'}));fireEvent.click(screen.getByRole('button',{name:'Load class limit assignments'}));expect(await screen.findByText('SYNTHETIC_PROFILE')).toBeTruthy();expect(screen.queryByRole('button',{name:'Create class'})).toBeNull();expect(screen.queryByRole('button',{name:'Deactivate class limit'})).toBeNull();expect(screen.queryByRole('button',{name:'Assign class limit'})).toBeNull();expect(ApiClient.post).not.toHaveBeenCalled();expect(ApiClient.patch).not.toHaveBeenCalled();
});
test('an unrelated class update receipt cannot confirm a save',async()=>{
 (ApiClient.get as jest.Mock).mockResolvedValue([cls('a')]);(ApiClient.patch as jest.Mock).mockResolvedValue({...cls('b'),name:'Draft class',version:3});
 render(<AgentClassesScreen/>);fireEvent.click(await screen.findByRole('button',{name:'Review / edit'}));fireEvent.change(screen.getByLabelText('Class name'),{target:{value:'Draft class'}});fireEvent.click(screen.getByRole('button',{name:'Save class'}));expect(await screen.findByText(/Class update response is incomplete/)).toBeTruthy();expect(screen.queryByText(/saved at version/)).toBeNull();expect(screen.getByLabelText('Class name')).toHaveProperty('value','Draft class');
});

test('switching class or closing a dirty editor requires explicit discard',async()=>{
 (ApiClient.get as jest.Mock).mockResolvedValue([cls('a'),cls('b')]);
 render(<AgentClassesScreen/>);await screen.findByText('REF-a');fireEvent.click(screen.getAllByRole('button',{name:'Review / edit'})[0]);fireEvent.change(screen.getByLabelText('Class name'),{target:{value:'Local edits'}});screen.getAllByRole('button',{name:'Review / edit'})[1].focus();fireEvent.click(screen.getAllByRole('button',{name:'Review / edit'})[1]);
 expect(screen.getByRole('group',{name:'Discard class changes'})).toBeTruthy();expect(document.activeElement).toBe(screen.getByRole('button',{name:'Keep editing'}));fireEvent.click(screen.getByRole('button',{name:'Keep editing'}));expect(screen.getByLabelText('Class name')).toHaveProperty('value','Local edits');expect(document.activeElement).toBe(screen.getAllByRole('button',{name:'Review / edit'})[1]);
 fireEvent.click(screen.getByRole('button',{name:'Close'}));fireEvent.click(screen.getByRole('button',{name:'Discard changes'}));expect(screen.queryByLabelText('Class name')).toBeNull();expect(ApiClient.patch).not.toHaveBeenCalled();
});
test('unconfirmed class save blocks retry until refresh and explicit reselection',async()=>{
 (ApiClient.get as jest.Mock).mockResolvedValue([cls('a')]);(ApiClient.patch as jest.Mock).mockResolvedValue({...cls('b'),name:'Local edits',version:3});
 render(<AgentClassesScreen/>);fireEvent.click(await screen.findByRole('button',{name:'Review / edit'}));fireEvent.change(screen.getByLabelText('Class name'),{target:{value:'Local edits'}});fireEvent.click(screen.getByRole('button',{name:'Save class'}));
 expect(await screen.findByText(/last class outcome is unconfirmed/)).toBeTruthy();expect((screen.getByRole('button',{name:'Save class'}) as HTMLButtonElement).disabled).toBe(true);expect((screen.getByRole('button',{name:'Review / edit'}) as HTMLButtonElement).disabled).toBe(true);
 fireEvent.click(screen.getByRole('button',{name:'Refresh'}));await screen.findByRole('button',{name:'I reviewed the class and audit history'});expect((screen.getByRole('button',{name:'Review / edit'}) as HTMLButtonElement).disabled).toBe(true);const confirm=jest.spyOn(window,'confirm').mockReturnValue(false);fireEvent.click(screen.getByRole('button',{name:'I reviewed the class and audit history'}));expect(screen.getByLabelText('Class name')).toHaveProperty('value','Local edits');confirm.mockReturnValue(true);fireEvent.click(screen.getByRole('button',{name:'I reviewed the class and audit history'}));fireEvent.click(screen.getByRole('button',{name:'Review / edit'}));expect(screen.getByLabelText('Class name')).toHaveProperty('value','Class a');expect((screen.getByRole('button',{name:'Save class'}) as HTMLButtonElement).disabled).toBe(false);expect(ApiClient.patch).toHaveBeenCalledTimes(1);confirm.mockRestore();
});
test('readOnlyPrincipal overrides mutation scopes in the class workspace',async()=>{
 act(()=>useAuthStore.setState(state=>({principal:state.principal?{...state.principal,readOnlyPrincipal:true}:null})));(ApiClient.get as jest.Mock).mockImplementation((url:string)=>url==='/internal/agents/classes'?Promise.resolve([cls('a')]):Promise.resolve(page([limit('first')])));
 render(<AgentClassesScreen/>);fireEvent.click(await screen.findByRole('button',{name:'Review'}));fireEvent.click(screen.getByRole('button',{name:'Load class limit assignments'}));await screen.findByText('SYNTHETIC_PROFILE');expect(screen.queryByRole('button',{name:'Create class'})).toBeNull();expect(screen.queryByRole('button',{name:'Assign class limit'})).toBeNull();expect(screen.queryByRole('button',{name:'Deactivate class limit'})).toBeNull();
});
test('an unconfirmed limit assignment blocks retry even after selecting another class',async()=>{
 (ApiClient.get as jest.Mock).mockImplementation((url:string)=>url==='/internal/agents/classes'?Promise.resolve([cls('a'),cls('b')]):Promise.resolve(page([])));(ApiClient.post as jest.Mock).mockResolvedValue({...limit('wrong','b'),limitProfileCode:'NEW_PROFILE'});
 render(<AgentClassesScreen/>);await screen.findByText('REF-a');fireEvent.click(screen.getAllByRole('button',{name:'Review / edit'})[0]);fireEvent.change(screen.getByLabelText('Class limit profile code'),{target:{value:'NEW_PROFILE'}});fireEvent.click(screen.getByRole('button',{name:'Assign class limit'}));await screen.findByText(/assignment outcome could not be confirmed/);
 fireEvent.click(screen.getAllByRole('button',{name:'Review / edit'})[1]);fireEvent.click(screen.getByRole('button',{name:'Discard changes'}));expect((screen.getByRole('button',{name:'Assign class limit'}) as HTMLButtonElement).disabled).toBe(true);fireEvent.click(screen.getAllByRole('button',{name:'Review / edit'})[0]);fireEvent.click(screen.getByRole('button',{name:'Load class limit assignments'}));await screen.findByRole('button',{name:'I reviewed the class limits and audit history'});expect((screen.getByRole('button',{name:'Assign class limit'}) as HTMLButtonElement).disabled).toBe(true);fireEvent.click(screen.getByRole('button',{name:'I reviewed the class limits and audit history'}));expect((screen.getByRole('button',{name:'Assign class limit'}) as HTMLButtonElement).disabled).toBe(false);expect(ApiClient.post).toHaveBeenCalledTimes(1);
});

test('class edits are frozen and duplicate saves are blocked while a write is pending',async()=>{
 const pending=deferred();(ApiClient.get as jest.Mock).mockResolvedValue([cls('a')]);(ApiClient.patch as jest.Mock).mockReturnValue(pending.promise);
 render(<AgentClassesScreen/>);fireEvent.click(await screen.findByRole('button',{name:'Review / edit'}));fireEvent.change(screen.getByLabelText('Class name'),{target:{value:'New name'}});fireEvent.click(screen.getByRole('button',{name:'Save class'}));fireEvent.click(screen.getByRole('button',{name:'Saving…'}));expect(ApiClient.patch).toHaveBeenCalledTimes(1);expect(screen.getByLabelText('Class name').matches(':disabled')).toBe(true);
 await act(async()=>{pending.resolve({...cls('a'),name:'New name',version:3});await pending.promise;});
});

test('class draft and unconfirmed outcome report a guard and request browser unload warning',async()=>{
 const report=jest.fn();(ApiClient.get as jest.Mock).mockResolvedValue([cls('a')]);(ApiClient.patch as jest.Mock).mockResolvedValue({...cls('b'),version:3,name:'Local'});render(<AgentClassesScreen onClassGuardChange={report}/>);fireEvent.click(await screen.findByRole('button',{name:'Review / edit'}));fireEvent.change(screen.getByLabelText('Class name'),{target:{value:'Local'}});expect(report).toHaveBeenLastCalledWith(true,false);const event=new Event('beforeunload',{cancelable:true});window.dispatchEvent(event);expect(event.defaultPrevented).toBe(true);fireEvent.click(screen.getByRole('button',{name:'Save class'}));await screen.findByText(/last class outcome is unconfirmed/);expect(report).toHaveBeenLastCalledWith(true,false);fireEvent.click(screen.getByRole('button',{name:'Close'}));fireEvent.click(screen.getByRole('button',{name:'Discard changes'}));expect(screen.queryByLabelText('Class name')).toBeNull();expect(report).toHaveBeenLastCalledWith(true,false);expect(screen.getByText(/cannot exclude a late commit/)).toBeTruthy();
});

test('failed catalogue review cannot clear an uncertain class write',async()=>{
 (ApiClient.get as jest.Mock).mockResolvedValueOnce([cls('a')]).mockRejectedValueOnce(new Error('offline'));(ApiClient.patch as jest.Mock).mockResolvedValue({...cls('b'),version:3,name:'Local'});render(<AgentClassesScreen/>);fireEvent.click(await screen.findByRole('button',{name:'Review / edit'}));fireEvent.change(screen.getByLabelText('Class name'),{target:{value:'Local'}});fireEvent.click(screen.getByRole('button',{name:'Save class'}));await screen.findByText(/last class outcome is unconfirmed/);fireEvent.click(screen.getByRole('button',{name:'Refresh'}));await screen.findByText(/Agent class catalogue unavailable/);expect(screen.queryByRole('button',{name:'I reviewed the class and audit history'})).toBeNull();expect(screen.queryByRole('button',{name:'Save class'})).toBeNull();
});

test('a write-only class limit principal may acknowledge externally authorized review',async()=>{
 act(()=>useAuthStore.setState(state=>({principal:state.principal?{...state.principal,scopes:['agent.view','limit.modify']}:null})));(ApiClient.get as jest.Mock).mockResolvedValue([cls('a')]);(ApiClient.post as jest.Mock).mockResolvedValue({});render(<AgentClassesScreen/>);fireEvent.click(await screen.findByRole('button',{name:'Review'}));fireEvent.change(screen.getByLabelText('Class limit profile code'),{target:{value:'NEW_PROFILE'}});fireEvent.click(screen.getByRole('button',{name:'Assign class limit'}));await screen.findByText(/assignment outcome could not be confirmed/);expect((screen.getByRole('button',{name:'Assign class limit'}) as HTMLButtonElement).disabled).toBe(true);fireEvent.click(screen.getByRole('button',{name:'I reviewed the class limits and audit history'}));expect((screen.getByRole('button',{name:'Assign class limit'}) as HTMLButtonElement).disabled).toBe(false);expect(ApiClient.get).toHaveBeenCalledTimes(1);
});

test('shell warns before discarding an Agent class draft',async()=>{
 const {Layout}=await import('../src/screens/authenticated/Layout');(ApiClient.get as jest.Mock).mockResolvedValue([cls('a')]);useAuthStore.setState({isAuthenticated:true});const view=render(<Layout/>);fireEvent.click(view.getByTestId('nav-agentClasses'));fireEvent.click(await view.findByRole('button',{name:'Review / edit'}));fireEvent.change(view.getByLabelText('Class name'),{target:{value:'Local class'}});fireEvent.click(view.getByTestId('nav-dashboard'));expect(view.getByRole('dialog',{name:'Leave Agent class review?'})).toBeTruthy();fireEvent.click(view.getByRole('button',{name:'Keep working'}));expect(view.getByLabelText('Class name')).toHaveProperty('value','Local class');fireEvent.click(view.getByTestId('nav-dashboard'));fireEvent.click(view.getByRole('button',{name:'Discard and leave'}));expect(view.queryByLabelText('Class name')).toBeNull();
});

test('class catalogue filters returned data without discarding an open draft or mutating records',async()=>{
 (ApiClient.get as jest.Mock).mockResolvedValue([cls('a'),{...cls('b'),isActive:false}]);render(<AgentClassesScreen/>);
 fireEvent.click((await screen.findAllByRole('button',{name:'Review / edit'}))[0]);fireEvent.change(screen.getByLabelText('Class name'),{target:{value:'Unsaved draft'}});
 fireEvent.click(screen.getByRole('button',{name:'Inactive'}));expect(screen.queryByText('REF-a')).toBeNull();expect(screen.getByText('REF-b')).toBeTruthy();expect(screen.getByLabelText('Class name')).toHaveProperty('value','Unsaved draft');
 fireEvent.change(screen.getByLabelText('Search returned classes'),{target:{value:'missing'}});expect(screen.getByText('No returned classes match these filters.')).toBeTruthy();expect(screen.getByLabelText('Class name')).toHaveProperty('value','Unsaved draft');expect(ApiClient.post).not.toHaveBeenCalled();expect(ApiClient.patch).not.toHaveBeenCalled();
});
