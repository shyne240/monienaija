import React from 'react';
import {act,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {SystemHealthScreen} from '../src/screens/authenticated/SystemHealthScreen';
import {AuditTrailScreen} from '../src/screens/authenticated/AuditTrailScreen';
import {ApiClient} from '../src/services/api-client';
import {useAuthStore} from '../src/store/auth-store';
jest.mock('../src/services/api-client',()=>({ApiClient:{get:jest.fn()}}));
const principal=(id='one',scopes=['notification.view_deliveries'])=>useAuthStore.setState({principal:{type:'OPERATOR',principalId:id,sessionId:id,audience:'workforce-admin',roles:['OPERATIONS'],scopes,customerAccess:'NONE',assuranceLevel:'MFA'}});
function deferred(){let resolve!:(v:any)=>void;const promise=new Promise<any>(r=>resolve=r);return {promise,resolve};}
const page = (data: any[]) => ({data,page:1,limit:20,total:data.length,totalPages:data.length ? 1 : 0,hasNextPage:false});
const delivery = (id:string,eventType:string,channel='SMS') => ({id,eventType,eventKey:'synthetic',status:'FAILED',channel,recipientType:'CUSTOMER',recipientId:'synthetic-customer',attempts:1,createdAt:'2026-11-01T00:00:00Z'});
beforeEach(()=>jest.resetAllMocks());
test('invalid delivery pages are errors rather than zero matches',async()=>{
 principal();(ApiClient.get as jest.Mock).mockResolvedValue({unexpected:'shape'});render(<SystemHealthScreen/>);expect(await screen.findByText(/response could not be verified/)).toBeTruthy();expect(screen.queryByText(/matching delivery records/)).toBeNull();expect(screen.queryByText(/No notification deliveries were returned/)).toBeNull();
});
test('a late delivery page from another principal cannot replace the new workspace',async()=>{
 principal();const old=deferred();let calls=0;(ApiClient.get as jest.Mock).mockImplementation(()=>++calls===1?old.promise:Promise.resolve(page([delivery('fresh','FRESH_EVENT')])));render(<SystemHealthScreen/>);await waitFor(()=>expect(calls).toBe(1));act(()=>principal('two'));expect((await screen.findAllByText('FRESH_EVENT')).length).toBeGreaterThan(0);await act(async()=>{old.resolve(page([delivery('old','OLD_EVENT')]));await old.promise;});expect(screen.queryByText('OLD_EVENT')).toBeNull();
});
test('editing the audit query invalidates late search results',async()=>{
 principal('one',['audit.search']);const pending=deferred();(ApiClient.get as jest.Mock).mockReturnValue(pending.promise);render(<AuditTrailScreen/>);fireEvent.change(screen.getByLabelText('Entity ID (optional)'),{target:{value:'old'}});fireEvent.click(screen.getByRole('button',{name:'Search'}));fireEvent.change(screen.getByLabelText('Entity ID (optional)'),{target:{value:'new'}});await act(async()=>{pending.resolve([{id:'audit',actor:'OLD ACTOR',action:'OLD',entityType:'CUSTOMER',entityId:'old'}]);await pending.promise;});expect(screen.queryByText('OLD ACTOR')).toBeNull();expect(screen.getByText('Enter an entity ID or search all events.')).toBeTruthy();
});
test('audit results are cleared on principal change even when the scope remains',async()=>{
 principal('one',['audit.search']);(ApiClient.get as jest.Mock).mockResolvedValue([{id:'audit',actor:'FIRST ACTOR',action:'READ',entityType:'CUSTOMER',entityId:'old',occurredAt:'2026-11-01T00:00:00Z'}]);render(<AuditTrailScreen/>);fireEvent.click(screen.getByRole('button',{name:'Search'}));await screen.findByText('FIRST ACTOR');act(()=>principal('two',['audit.search']));expect(screen.queryByText('FIRST ACTOR')).toBeNull();
});

test('health panels resolve independently and delivery filtering does not reload unrelated sources',async()=>{
 principal('one',['metrics.view','diagnostics.view','outbox.view','notification.view_deliveries']);const diagnostic=deferred();
 (ApiClient.get as jest.Mock).mockImplementation((path:string)=>{
  if(path==='/internal/metrics')return Promise.resolve({generatedAt:'2026-11-01',metrics:{SYNTHETIC_METRIC:'8'}});
  if(path==='/internal/diagnostics')return diagnostic.promise;
  if(path==='/internal/outbox')return Promise.resolve([]);
  if(path.startsWith('/internal/notifications/deliveries'))return Promise.resolve(page([]));
  return Promise.reject(new Error('Unexpected request'));
 });
 render(<SystemHealthScreen/>);expect(await screen.findByText('SYNTHETIC_METRIC')).toBeTruthy();expect(screen.getByText('Loading diagnostics…')).toBeTruthy();await screen.findByText('No notification deliveries were returned for these filters.');
 fireEvent.change(screen.getByLabelText('Channel'),{target:{value:'EMAIL'}});expect(screen.getByText(/Filters changed; search to apply/)).toBeTruthy();fireEvent.click(screen.getByRole('button',{name:'Search'}));
 await waitFor(()=>expect(ApiClient.get).toHaveBeenCalledWith('/internal/notifications/deliveries?page=1&limit=20&channel=EMAIL'));expect(screen.getByText('Applied filters: Channel: EMAIL')).toBeTruthy();
 expect((ApiClient.get as jest.Mock).mock.calls.filter(([path])=>path==='/internal/metrics')).toHaveLength(1);
 await act(async()=>{diagnostic.resolve({status:'ok'});await diagnostic.promise;});expect(screen.queryByText('Loading diagnostics…')).toBeNull();
});

test('a newer delivery search replaces an in-flight search and late results are ignored',async()=>{
 principal();const older=deferred(),newer=deferred();(ApiClient.get as jest.Mock).mockImplementation((path:string)=>path.includes('channel=EMAIL')?older.promise:path.includes('channel=SMS')?newer.promise:Promise.resolve(page([])));
 render(<SystemHealthScreen/>);await screen.findByText('No notification deliveries were returned for these filters.');
 fireEvent.change(screen.getByLabelText('Channel'),{target:{value:'EMAIL'}});fireEvent.click(screen.getByRole('button',{name:'Search'}));
 fireEvent.change(screen.getByLabelText('Channel'),{target:{value:'SMS'}});fireEvent.click(screen.getByRole('button',{name:'Search'}));
 await act(async()=>{newer.resolve(page([delivery('new','NEW_EVENT')]));await newer.promise;});expect((await screen.findAllByText('NEW_EVENT')).length).toBeGreaterThan(0);
 await act(async()=>{older.resolve(page([delivery('old','OLD_EVENT')]));await older.promise;});expect(screen.queryByText('OLD_EVENT')).toBeNull();expect(screen.getByText('Applied filters: Channel: SMS')).toBeTruthy();
});

test('receipt inspection stays independently available when delivery reads fail',async()=>{
 principal();(ApiClient.get as jest.Mock).mockImplementation((path:string)=>path.includes('outbox-receipts')?Promise.resolve(page([{outboxEventId:'receipt-1',status:'FAILED',attempts:1,createdAt:'2026-11-01T00:00:00Z',updatedAt:'2026-11-01T00:00:00Z'}])):Promise.reject(new Error('delivery unavailable')));
 render(<SystemHealthScreen/>);expect(await screen.findByText('delivery unavailable')).toBeTruthy();fireEvent.click(screen.getByRole('button',{name:'Inspect Outbox Receipts'}));expect((await screen.findAllByText('receipt-1')).length).toBeGreaterThan(0);expect(ApiClient.get).toHaveBeenCalledWith('/internal/notifications/outbox-receipts?page=1&limit=20');
});

test('section navigation and requests follow each independent function grant',async()=>{
 principal('one',['metrics.view']);(ApiClient.get as jest.Mock).mockResolvedValue({metrics:{jobs:'2'}});render(<SystemHealthScreen/>);await screen.findByText('jobs');
 expect(screen.getByRole('link',{name:'Metrics'})).toBeTruthy();expect(screen.queryByRole('link',{name:'Deliveries & receipts'})).toBeNull();expect(screen.queryByRole('region',{name:'Notification deliveries'})).toBeNull();expect(ApiClient.get).toHaveBeenCalledTimes(1);
});
test('system health rejects malformed receipts without manufacturing an empty list',async()=>{
 principal();(ApiClient.get as jest.Mock).mockImplementation((path:string)=>path.includes('outbox-receipts')?Promise.resolve({data:[]}):Promise.resolve(page([])));
 render(<SystemHealthScreen/>);await screen.findByText('No notification deliveries were returned for these filters.');fireEvent.click(screen.getByRole('button',{name:'Inspect Outbox Receipts'}));
 expect(await screen.findByText(/Diagnostic response could not be verified/)).toBeTruthy();expect(screen.queryByText('No notification outbox receipts returned.')).toBeNull();
});
test('system health rejects deliveries that do not match the applied filter',async()=>{
 principal();(ApiClient.get as jest.Mock).mockImplementation((path:string)=>Promise.resolve(path.includes('channel=EMAIL')?page([delivery('wrong','WRONG_EVENT','SMS')]):page([])));
 render(<SystemHealthScreen/>);await screen.findByText('No notification deliveries were returned for these filters.');fireEvent.change(screen.getByLabelText('Channel'),{target:{value:'EMAIL'}});fireEvent.click(screen.getByRole('button',{name:'Search'}));
 expect(await screen.findByText(/Diagnostic response could not be verified/)).toBeTruthy();expect(screen.queryByText('WRONG_EVENT')).toBeNull();expect(screen.queryByText('No notification deliveries were returned for these filters.')).toBeNull();
});
test('notification diagnostic details discard unexpected message and payload fields',async()=>{
 principal();(ApiClient.get as jest.Mock).mockImplementation((path:string)=>path.includes('outbox-receipts')?Promise.resolve(page([{outboxEventId:'receipt',status:'FAILED',attempts:1,createdAt:'2026-11-01T00:00:00Z',updatedAt:'2026-11-01T00:00:00Z',payload:'PRIVATE_RECEIPT_PAYLOAD'}])):Promise.resolve(page([{...delivery('row','EVENT'),message:'PRIVATE_MESSAGE',destination:'PRIVATE_DESTINATION',payload:'PRIVATE_DELIVERY_PAYLOAD'}])));
 render(<SystemHealthScreen/>);await screen.findAllByText('EVENT');fireEvent.click(screen.getByRole('button',{name:'Inspect Outbox Receipts'}));await screen.findAllByText('receipt');
 for(const secret of ['PRIVATE_MESSAGE','PRIVATE_DESTINATION','PRIVATE_DELIVERY_PAYLOAD','PRIVATE_RECEIPT_PAYLOAD']) expect(screen.queryByText(secret)).toBeNull();
});

test('metric search is local to the authorized loaded response and distinguishes no match',async()=>{
 principal('one',['metrics.view']);(ApiClient.get as jest.Mock).mockResolvedValue({metrics:{jobs:2, failures:0}});render(<SystemHealthScreen/>);
 await screen.findByText('jobs');const search=screen.getByLabelText('Search loaded metrics');fireEvent.change(search,{target:{value:'failure'}});
 expect(screen.queryByText('jobs')).toBeNull();expect(screen.getByText('failures')).toBeTruthy();expect(screen.getByText(/Showing 1 of 2 loaded metrics/)).toBeTruthy();
 fireEvent.change(search,{target:{value:'missing'}});expect(screen.getByText('No loaded metrics match this search.')).toBeTruthy();
 fireEvent.click(screen.getByRole('button',{name:'Clear search'}));expect(screen.getByText('jobs')).toBeTruthy();expect(ApiClient.get).toHaveBeenCalledTimes(1);
});
