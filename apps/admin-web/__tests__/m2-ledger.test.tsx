import React from 'react';
import {act,fireEvent,render,screen} from '@testing-library/react';
import {LedgerOperationsScreen} from '../src/screens/authenticated/LedgerOperationsScreen';
import {ApiClient} from '../src/services/api-client';
import {useAuthStore} from '../src/store/auth-store';
jest.mock('../src/services/api-client',()=>({ApiClient:{get:jest.fn(),post:jest.fn()}}));
const account=(id:string)=>({id,code:id,name:`Account ${id}`,currency:'NGN',balanceMinor:'100',accountType:'ASSET',normalBalance:'DEBIT'});
const journal={id:'journal',status:'POSTED',currency:'NGN',accountingUnit:'CUSTOMER_FUNDS',lines:[]};
const principal=(id='one')=>useAuthStore.setState({principal:{type:'OPERATOR',principalId:id,sessionId:id,audience:'workforce-admin',roles:['FINANCE_CONTROLLER'],scopes:['ledger.view'],customerAccess:'NONE',assuranceLevel:'MFA'}});
function deferred(){let resolve!:(v:any)=>void;const promise=new Promise<any>(r=>resolve=r);return {promise,resolve};}
beforeEach(()=>{jest.resetAllMocks();principal();});
test('ledger account requests do not overwrite the selected currency with older results',async()=>{
 const old=deferred();(ApiClient.get as jest.Mock).mockImplementation((url:string)=>url==='/ledger/accounts'?old.promise:Promise.resolve([account('new')]));render(<LedgerOperationsScreen/>);fireEvent.change(screen.getByLabelText('Account currency'),{target:{value:'NGN'}});expect(await screen.findByText('Account new')).toBeTruthy();await act(async()=>{old.resolve([account('old')]);await old.promise;});expect(screen.queryByText('Account old')).toBeNull();
});
test('a mismatched journal is never made actionable for reversal',async()=>{
 (ApiClient.get as jest.Mock).mockImplementation((url:string)=>url==='/ledger/accounts'?Promise.resolve([]):Promise.resolve({...journal,id:'other'}));render(<LedgerOperationsScreen/>);fireEvent.change(screen.getByLabelText('Audit Journal ID (UUID)'),{target:{value:'journal'}});fireEvent.click(screen.getByRole('button',{name:'Audit Journal'}));expect(await screen.findByText(/invalid or does not match/)).toBeTruthy();expect(screen.queryByRole('button',{name:'Execute Approved Reversal'})).toBeNull();
});
test('a reversal receipt followed by failed reload remains confirmed but not actionable',async()=>{
 let journalReads=0;(ApiClient.get as jest.Mock).mockImplementation((url:string)=>url==='/ledger/accounts'?Promise.resolve([]):++journalReads===1?Promise.resolve(journal):Promise.reject(new Error('Synthetic reload failure')));(ApiClient.post as jest.Mock).mockResolvedValue({id:'reverse',status:'POSTED',reversalOfJournalId:'journal'});
 render(<LedgerOperationsScreen/>);fireEvent.change(screen.getByLabelText('Audit Journal ID (UUID)'),{target:{value:'journal'}});fireEvent.click(screen.getByRole('button',{name:'Audit Journal'}));await screen.findByRole('button',{name:'Execute Approved Reversal'});fireEvent.change(screen.getByLabelText('Audit Reason for Reversal (must match the approved request exactly)'),{target:{value:'synthetic reason'}});fireEvent.change(screen.getByLabelText('Approved Maker-Checker Request ID'),{target:{value:'synthetic-approval'}});fireEvent.click(screen.getByRole('button',{name:'Execute Approved Reversal'}));
 expect(await screen.findByText(/Reversal was recorded, but journal refresh failed/)).toBeTruthy();expect(screen.getByText('Governed journal reversal executed from the approved request.')).toBeTruthy();expect(screen.queryByRole('button',{name:'Execute Approved Reversal'})).toBeNull();
});
