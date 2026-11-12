import React from 'react';
import {act,fireEvent,render,screen} from '@testing-library/react';
import {CashToCashOperationsScreen} from '../src/screens/authenticated/CashToCashOperationsScreen';
import {ApiClient} from '../src/services/api-client';
import {fetchCashToCashExpiryStatus} from '../src/services/ordinary-agent-admin-api';
import {useAuthStore} from '../src/store/auth-store';
jest.mock('../src/services/api-client',()=>({ApiClient:{get:jest.fn()}}));
jest.mock('../src/services/ordinary-agent-admin-api',()=>({fetchCashToCashExpiryStatus:jest.fn()}));
const principal=(id='one')=>useAuthStore.setState({principal:{type:'OPERATOR',principalId:id,sessionId:id,audience:'workforce-admin',roles:['OPERATIONS'],scopes:['transaction.view','ledger.view'],customerAccess:'NONE',assuranceLevel:'MFA'}});
const row={id:'synthetic-transfer',agentId:'synthetic-agent',beneficiaryPhoneMasked:'***',principalMinor:'1000',feeMinor:'0',vatMinor:'0',totalMinor:'1000',currency:'NGN',status:'UNCLAIMED',journalId:'synthetic-journal',createdAt:'2026-01-01',expiresAt:'2026-02-01'};
function deferred(){let resolve!:(v:any)=>void;const promise=new Promise<any>(r=>resolve=r);return {promise,resolve};}
beforeEach(()=>{jest.resetAllMocks();principal();(fetchCashToCashExpiryStatus as jest.Mock).mockResolvedValue({status:'LIVE',data:{recognized:true,workerEnabled:false}});});
test('invalid monetary data is unavailable rather than rendered as a receipt',async()=>{
 (ApiClient.get as jest.Mock).mockResolvedValue({data:[{...row,totalMinor:'invalid'}],total:1,page:1,limit:20,totalPages:1});render(<CashToCashOperationsScreen/>);expect(await screen.findByText(/invalid or mismatched response/)).toBeTruthy();expect(screen.queryByRole('button',{name:'Inspect receipt'})).toBeNull();
});
test('unrecognized expiry status is explicitly unconfirmed',async()=>{
 (ApiClient.get as jest.Mock).mockResolvedValue({data:[],total:0,page:1,limit:20,totalPages:0});(fetchCashToCashExpiryStatus as jest.Mock).mockResolvedValue({status:'LIVE',data:{recognized:false}});render(<CashToCashOperationsScreen/>);expect(await screen.findByText(/Expiry status could not be confirmed/)).toBeTruthy();
});
test('old principal list cannot enter a new principal workspace',async()=>{
 const pending=deferred();let calls=0;(ApiClient.get as jest.Mock).mockImplementation(()=>++calls===1?pending.promise:Promise.resolve({data:[],total:0,page:1,limit:20,totalPages:0}));render(<CashToCashOperationsScreen/>);act(()=>principal('two'));await screen.findByText('No Cash-to-Cash transfers match these filters.');await act(async()=>{pending.resolve({data:[row],total:1,page:1,limit:20,totalPages:1});await pending.promise;});expect(screen.queryByText('synthetic-transfer')).toBeNull();
});
test('malformed journal lines cannot imply a balanced posting',async()=>{
 (ApiClient.get as jest.Mock).mockImplementation((url:string)=>url.includes('/ledger/journals/')?Promise.resolve({id:'synthetic-journal',status:'POSTED',currency:'NGN',lines:[null]}):Promise.resolve({data:[row],total:1,page:1,limit:20,totalPages:1}));render(<CashToCashOperationsScreen/>);fireEvent.click(await screen.findByRole('button',{name:'Inspect receipt'}));fireEvent.click(screen.getByRole('button',{name:'Inspect initiation journal'}));expect(await screen.findByText(/Ledger journal response is invalid/)).toBeTruthy();expect(screen.queryByText('BALANCED')).toBeNull();
});

test('receipt focus returns to its trigger after closing',async()=>{
 (ApiClient.get as jest.Mock).mockResolvedValue({data:[row],total:1,page:1,limit:20,totalPages:1});render(<CashToCashOperationsScreen/>);const trigger=await screen.findByRole('button',{name:'Inspect receipt'});trigger.focus();fireEvent.click(trigger);expect(document.activeElement).toBe(screen.getByRole('heading',{name:'Transfer receipt and ledger references'}));fireEvent.click(screen.getByRole('button',{name:'Close'}));expect(document.activeElement).toBe(trigger);
});
test('response that does not match applied filters is unavailable rather than a misleading result',async()=>{
 (ApiClient.get as jest.Mock).mockResolvedValue({data:[row],total:1,page:1,limit:20,totalPages:1});render(<CashToCashOperationsScreen/>);await screen.findByRole('button',{name:'Inspect receipt'});fireEvent.click(screen.getByRole('button',{name:'Claimed'}));expect(screen.getByText('Applied: All transfers')).toBeTruthy();fireEvent.click(screen.getByRole('button',{name:'Search'}));expect(await screen.findByText(/invalid or mismatched response/)).toBeTruthy();expect(screen.getByText('Applied: status: CLAIMED')).toBeTruthy();expect(screen.queryByRole('button',{name:'Inspect receipt'})).toBeNull();
});
test('journal inspection is invalidated if a refresh changes its journal reference',async()=>{
 const journal={id:'synthetic-journal',status:'POSTED',currency:'NGN',lines:[{id:'d',accountId:'a',direction:'DEBIT',amountMinor:'1000'},{id:'c',accountId:'b',direction:'CREDIT',amountMinor:'1000'}]};let listReads=0;
 (ApiClient.get as jest.Mock).mockImplementation((url:string)=>url.includes('/ledger/journals/')?Promise.resolve(journal):Promise.resolve({data:[{...row,journalId:++listReads===1?'synthetic-journal':'new-journal'}],total:1,page:1,limit:20,totalPages:1}));
 render(<CashToCashOperationsScreen/>);fireEvent.click(await screen.findByRole('button',{name:'Inspect receipt'}));fireEvent.click(screen.getByRole('button',{name:'Inspect initiation journal'}));expect(await screen.findByText('BALANCED')).toBeTruthy();fireEvent.click(screen.getByRole('button',{name:'Refresh'}));expect(await screen.findByText('new-journal')).toBeTruthy();expect(screen.queryByText('BALANCED')).toBeNull();
});
test('unauthorized principal cannot load transfer data even if a scope is present',async()=>{
 act(()=>useAuthStore.setState(state=>({principal:state.principal?{...state.principal,type:'CUSTOMER'} as any:null})));render(<CashToCashOperationsScreen/>);expect(screen.getByText(/Cash-to-Cash operations require/)).toBeTruthy();expect(ApiClient.get).not.toHaveBeenCalled();expect(fetchCashToCashExpiryStatus).not.toHaveBeenCalled();
});

test('receipt drawer Escape restores focus and invalidates an in-flight journal read',async()=>{
 const pending=deferred();
 (ApiClient.get as jest.Mock).mockImplementation((url:string)=>url.includes('/ledger/journals/')?pending.promise:Promise.resolve({data:[row],total:1,page:1,limit:20,totalPages:1}));
 render(<CashToCashOperationsScreen/>);const trigger=await screen.findByRole('button',{name:'Inspect receipt'});trigger.focus();fireEvent.click(trigger);
 expect(screen.getByRole('dialog',{name:'Cash-to-Cash receipt details'})).toBeTruthy();fireEvent.click(screen.getByRole('button',{name:'Inspect initiation journal'}));
 fireEvent.keyDown(document,{key:'Escape'});expect(screen.queryByRole('dialog',{name:'Cash-to-Cash receipt details'})).toBeNull();expect(document.activeElement).toBe(trigger);
 await act(async()=>{pending.resolve({id:'synthetic-journal',status:'POSTED',currency:'NGN',lines:[]});await pending.promise;});expect(screen.queryByTestId('c2c-inspected-journal')).toBeNull();
});
