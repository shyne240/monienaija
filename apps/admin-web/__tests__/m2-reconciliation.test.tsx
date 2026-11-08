import React from 'react';
import {act,fireEvent,render,screen} from '@testing-library/react';
import {ReconciliationObservabilityScreen} from '../src/screens/authenticated/ReconciliationObservabilityScreen';
import {ApiClient} from '../src/services/api-client';
import {useAuthStore} from '../src/store/auth-store';
jest.mock('../src/services/api-client',()=>({ApiClient:{get:jest.fn()}}));
const principal=(id:string,scopes=['reconciliation.view'])=>useAuthStore.setState({principal:{type:'OPERATOR',principalId:id,sessionId:id,audience:'workforce-admin',roles:['FINANCE_AUDITOR'],scopes,customerAccess:'NONE',assuranceLevel:'MFA'}});
beforeEach(()=>{jest.resetAllMocks();principal('one');});
test('non-boolean and contradictory trial balance cannot render a balanced fact',async()=>{
 (ApiClient.get as jest.Mock).mockResolvedValue({generatedAt:'2026-01-01',balanced:'false',dimensions:[],rows:[]});render(<ReconciliationObservabilityScreen/>);fireEvent.click(screen.getByRole('button',{name:/General Trial Balance/}));expect(await screen.findByText(/invalid or inconsistent response/)).toBeTruthy();expect(screen.queryByText('REPORTED BALANCED')).toBeNull();
});
test('finance refresh rejects a contradictory balanced claim and marks previous report stale',async()=>{
 const good={generatedAt:'2026-01-01',journalIntegrity:{balanced:true,totalJournals:1,invalidJournals:0,orphanLines:0},totalAssets:[],totalLiabilities:[]};(ApiClient.get as jest.Mock).mockResolvedValueOnce(good).mockResolvedValueOnce({...good,journalIntegrity:{...good.journalIntegrity,invalidJournals:1}});
 render(<ReconciliationObservabilityScreen/>);fireEvent.click(screen.getByRole('button',{name:/Finance Verification & Activity/}));await screen.findByTestId('finance-verification-summary');fireEvent.click(screen.getByRole('button',{name:'Refresh Finance Verification'}));expect(await screen.findByText(/invalid or inconsistent response/)).toBeTruthy();expect(screen.getByRole('alert').textContent).toContain('Previous results are stale');
});
test('old reconciliation response cannot cross principals',async()=>{
 let resolve!:(v:any)=>void;const pending=new Promise<any>(r=>resolve=r);(ApiClient.get as jest.Mock).mockReturnValue(pending);render(<ReconciliationObservabilityScreen/>);fireEvent.click(screen.getByRole('button',{name:'Execute In-House Reconciliation Match'}));act(()=>principal('two'));
 await act(async()=>{resolve({status:'PASS',generatedAt:'2026-01-01',checks:[],binding:{summary:{bindingsChecked:1,discrepancies:0},discrepancies:[]}});await pending;});expect(screen.queryByText('Run Result Summary')).toBeNull();
});
test('same-principal session replacement clears data and rejects late results',async()=>{
 let resolve!:(v:any)=>void;const pending=new Promise<any>(r=>resolve=r);(ApiClient.get as jest.Mock).mockReturnValue(pending);render(<ReconciliationObservabilityScreen/>);fireEvent.click(screen.getByRole('button',{name:/General Trial Balance/}));act(()=>useAuthStore.setState(state=>({principal:state.principal?{...state.principal,sessionId:'new-session'}:null})));await act(async()=>{resolve({generatedAt:'2026-01-01',balanced:true,dimensions:[],rows:[]});await pending;});expect(screen.queryByText('REPORTED BALANCED')).toBeNull();expect(screen.getByRole('button',{name:/Run Verification Audits/}).getAttribute('aria-pressed')).toBe('true');
});
test('contradictory report aggregate or missing discrepancies cannot appear as a passing result',async()=>{
 (ApiClient.get as jest.Mock).mockResolvedValue({status:'PASS',generatedAt:'2026-01-01',checks:[{name:'broken',status:'ERROR',message:'problem'}],binding:{summary:{bindingsChecked:1,discrepancies:0,errors:0,warnings:0},discrepancies:[]}});render(<ReconciliationObservabilityScreen/>);fireEvent.click(screen.getByRole('button',{name:'Execute In-House Reconciliation Match'}));expect(await screen.findByText(/invalid response/)).toBeTruthy();expect(screen.queryByText('Run Result Summary')).toBeNull();
});
test('empty trial balance is presented as a report without evidence of activity',async()=>{
 (ApiClient.get as jest.Mock).mockResolvedValue({generatedAt:'2026-01-01',balanced:true,dimensions:[],rows:[]});render(<ReconciliationObservabilityScreen/>);fireEvent.click(screen.getByRole('button',{name:/General Trial Balance/}));expect(await screen.findByText(/No dimensions were returned/)).toBeTruthy();expect(screen.getByText('REPORTED BALANCED')).toBeTruthy();
});
test('trial balance account inspection moves focus and refreshes finance context',async()=>{
 const row={accountId:'acc',accountCode:'1001',accountName:'Test account',accountType:'ASSET',currency:'NGN',accountingUnit:'CUSTOMER_FUNDS',entryCount:1,totalDebitsMinor:'5',totalCreditsMinor:'5',balanceMinor:'0'};const trial={generatedAt:'2026-01-01',balanced:true,dimensions:[{currency:'NGN',accountingUnit:'CUSTOMER_FUNDS',totalDebitsMinor:'5',totalCreditsMinor:'5',balanced:true}],rows:[row]};const finance={generatedAt:'2026-01-01',journalIntegrity:{balanced:true,totalJournals:1,invalidJournals:0,orphanLines:0},totalAssets:[],totalLiabilities:[]};(ApiClient.get as jest.Mock).mockImplementation((url:string)=>Promise.resolve(url.endsWith('trial-balance')?trial:url.endsWith('/activity')?[row]:finance));render(<ReconciliationObservabilityScreen/>);fireEvent.click(screen.getByRole('button',{name:/General Trial Balance/}));fireEvent.click(await screen.findByRole('button',{name:'Inspect activity'}));expect(document.activeElement).toBe(screen.getByRole('heading',{name:'Account Activity Inspector'}));await screen.findByTestId('account-activity-table');expect(ApiClient.get).toHaveBeenCalledWith('/internal/reconciliation/finance');expect(ApiClient.get).toHaveBeenCalledWith('/internal/reconciliation/accounts/acc/activity');
});
