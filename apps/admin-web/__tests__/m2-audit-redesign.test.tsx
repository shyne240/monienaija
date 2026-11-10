import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { AuditTrailScreen } from '../src/screens/authenticated/AuditTrailScreen';
import { ApiClient } from '../src/services/api-client';
import { useAuthStore } from '../src/store/auth-store';
jest.mock('../src/services/api-client',()=>({ApiClient:{get:jest.fn()}}));
function session(scopes:string[]) { useAuthStore.setState({isAuthenticated:true, token:'s', sessionId:'s', principal:{type:'OPERATOR',principalId:'operator',sessionId:'s',audience:'workforce-admin',roles:['OPERATIONS'],scopes,customerAccess:'NONE',assuranceLevel:'MFA'}}); }
function deferred(){let resolve!:(value:any)=>void;const promise=new Promise<any>(r=>{resolve=r;});return {promise,resolve};}
beforeEach(()=>{jest.resetAllMocks();session(['audit.search']);});

test('all supported filters are sent exactly and the result limit is disclosed',async()=>{
  (ApiClient.get as jest.Mock).mockResolvedValue(Array.from({length:100},(_,i)=>({id:`audit-${i}`,entityType:'CUSTOMER',entityId:'customer-1',actor:'operator',action:'READ',occurredAt:'2026-11-01T00:00:00Z',newValues:{secret:'not-rendered'}})));
  render(<AuditTrailScreen />);
  fireEvent.change(screen.getByLabelText('Entity ID (optional)'),{target:{value:' customer-1 '}});
  fireEvent.change(screen.getByLabelText('Entity type (optional)'),{target:{value:'CUSTOMER'}});
  fireEvent.change(screen.getByLabelText('Correlation ID (optional)'),{target:{value:'flow / 1'}});
  fireEvent.click(screen.getByRole('button',{name:'Search'}));
  expect(await screen.findByText('100 returned')).toBeTruthy();
  expect(ApiClient.get).toHaveBeenCalledWith('/internal/audit?limit=100&entityId=customer-1&entityType=CUSTOMER&correlationId=flow+%2F+1');
  expect(screen.getByText(/The result limit was reached/)).toBeTruthy();expect(screen.getByText('Type: CUSTOMER')).toBeTruthy();expect(screen.queryByText('not-rendered')).toBeNull();
  fireEvent.click(screen.getByRole('button',{name:'Clear filters'}));expect(screen.queryByText('100 returned')).toBeNull();expect((screen.getByLabelText('Entity type (optional)') as HTMLInputElement).value).toBe('');
});

test('editing any criterion invalidates an outstanding search',async()=>{
  const pending=deferred();(ApiClient.get as jest.Mock).mockReturnValue(pending.promise);render(<AuditTrailScreen />);
  fireEvent.click(screen.getByRole('button',{name:'Search'}));fireEvent.change(screen.getByLabelText('Correlation ID (optional)'),{target:{value:'next'}});
  await act(async()=>{pending.resolve([{id:'old',actor:'OLD ACTOR'}]);await pending.promise;});expect(screen.queryByText('OLD ACTOR')).toBeNull();expect(screen.getByText('Enter an entity ID or search all events.')).toBeTruthy();
});

test('customer context pre-fills and queries automatically, then clears cleanly',async()=>{
  (ApiClient.get as jest.Mock).mockResolvedValue([]);render(<AuditTrailScreen initialCustomerId="customer-1" />);
  expect(await screen.findByText(/No audit events/)).toBeTruthy();expect(ApiClient.get).toHaveBeenCalledWith('/internal/audit?limit=100&entityId=customer-1');
  fireEvent.click(screen.getByRole('button',{name:'Clear filters'}));expect((screen.getByLabelText('Entity ID (optional)') as HTMLInputElement).value).toBe('');expect(screen.queryByText(/No audit events/)).toBeNull();
});

test('missing audit.search scope renders no query controls or requests',()=>{
 session(['audit.view']);render(<AuditTrailScreen />);expect(screen.getByRole('alert').textContent).toContain('audit.search');expect(screen.queryByRole('button',{name:'Search'})).toBeNull();expect(ApiClient.get).not.toHaveBeenCalled();
});


test.each([
  ['wrong entity', { id:'event', entityType:'CUSTOMER', entityId:'other', actor:'operator', action:'READ', occurredAt:'2026-11-01T00:00:00Z' }],
  ['wrong type', { id:'event', entityType:'AGENT', entityId:'customer-1', actor:'operator', action:'READ', occurredAt:'2026-11-01T00:00:00Z' }],
  ['invalid time', { id:'event', entityType:'CUSTOMER', entityId:'customer-1', actor:'operator', action:'READ', occurredAt:'bad' }],
  ['missing actor', { id:'event', entityType:'CUSTOMER', entityId:'customer-1', action:'READ', occurredAt:'2026-11-01T00:00:00Z' }],
])('rejects %s rather than presenting a trustworthy audit result', async (_case, row) => {
  (ApiClient.get as jest.Mock).mockResolvedValue([row]); render(<AuditTrailScreen />);
  fireEvent.change(screen.getByLabelText('Entity ID (optional)'), { target:{ value:'customer-1' } });
  fireEvent.change(screen.getByLabelText('Entity type (optional)'), { target:{ value:'CUSTOMER' } });
  fireEvent.click(screen.getByRole('button',{name:'Search'}));
  expect(await screen.findByText('Audit search response could not be verified.')).toBeTruthy();
  expect(screen.queryByText(/No audit events returned/)).toBeNull();
  expect(screen.queryByText('1 returned')).toBeNull();
});

test('rejects duplicate events and oversized responses',async()=>{
 const row={id:'same',entityType:'CUSTOMER',entityId:'customer-1',actor:'operator',action:'READ',occurredAt:'2026-11-01T00:00:00Z'};
 (ApiClient.get as jest.Mock).mockResolvedValueOnce([row,row]).mockResolvedValueOnce(Array.from({length:101},(_,i)=>({...row,id:String(i)})));
 render(<AuditTrailScreen />); fireEvent.click(screen.getByRole('button',{name:'Search'}));
 expect(await screen.findByText('Audit search response could not be verified.')).toBeTruthy();
 fireEvent.click(screen.getByRole('button',{name:'Search'}));
 expect(await screen.findByText('Audit search response could not be verified.')).toBeTruthy();
});


test('limit profile lookup validates and scopes returned profile events',async()=>{
 const row={id:'profile-event',entityType:'LIMIT_PROFILE',entityId:'surrogate',actor:'operator',action:'CREATED',occurredAt:'2026-11-01T00:00:00Z',newValues:{limitProfileCode:'AGENT_STANDARD'}};
 (ApiClient.get as jest.Mock).mockResolvedValueOnce([row]).mockResolvedValueOnce([{...row,newValues:{limitProfileCode:'OTHER'}}]);
 render(<AuditTrailScreen />);
 fireEvent.change(screen.getByLabelText('Limit profile code (optional)'),{target:{value:' agent_standard '}});
 fireEvent.click(screen.getByRole('button',{name:'Search'}));
 expect(await screen.findByText('1 returned')).toBeTruthy();expect(screen.getByText('Limit profile: AGENT_STANDARD')).toBeTruthy();
 expect(ApiClient.get).toHaveBeenCalledWith('/internal/audit?limit=100&limitProfileCode=AGENT_STANDARD');
 fireEvent.click(screen.getByRole('button',{name:'Search'}));
 expect(await screen.findByText('Audit search response could not be verified.')).toBeTruthy();expect(screen.queryByText('1 returned')).toBeNull();
 fireEvent.change(screen.getByLabelText('Entity ID (optional)'),{target:{value:'other'}});fireEvent.click(screen.getByRole('button',{name:'Search'}));
 expect(await screen.findByText('Limit profile code cannot be combined with another entity ID or type.')).toBeTruthy();expect(ApiClient.get).toHaveBeenCalledTimes(2);
});

test('audit drawer only displays verified projection and restores focus on dismissal',async()=>{
 (ApiClient.get as jest.Mock).mockResolvedValue([{id:'event-1',entityType:'CUSTOMER',entityId:'customer-1',actor:'operator',action:'READ',occurredAt:'2026-11-01T00:00:00Z',newValues:{secret:'not-rendered'}}]);
 render(<AuditTrailScreen/>);fireEvent.click(screen.getByRole('button',{name:'Search'}));
 const trigger=await screen.findByRole('button',{name:'View audit event event-1'});trigger.focus();fireEvent.click(trigger);
 const dialog=screen.getByRole('dialog',{name:'Audit event details'});expect(dialog.textContent).toContain('event-1');expect(dialog.textContent).not.toContain('not-rendered');
 fireEvent.keyDown(document,{key:'Escape'});expect(screen.queryByRole('dialog',{name:'Audit event details'})).toBeNull();expect(document.activeElement).toBe(trigger);
});
