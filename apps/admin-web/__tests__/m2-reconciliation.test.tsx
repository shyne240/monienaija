import React from 'react';
import {act,fireEvent,render,screen} from '@testing-library/react';
import {ReconciliationObservabilityScreen} from '../src/screens/authenticated/ReconciliationObservabilityScreen';
import {ApiClient} from '../src/services/api-client';
import {useAuthStore} from '../src/store/auth-store';
jest.mock('../src/services/api-client',()=>({ApiClient:{get:jest.fn()}}));
const principal=(id:string,scopes=['reconciliation.view'])=>useAuthStore.setState({principal:{type:'OPERATOR',principalId:id,sessionId:id,audience:'workforce-admin',roles:['FINANCE_AUDITOR'],scopes,customerAccess:'NONE',assuranceLevel:'MFA'}});
beforeEach(()=>{jest.resetAllMocks();principal('one');});
test('non-boolean and contradictory trial balance cannot render a balanced fact',async()=>{
 (ApiClient.get as jest.Mock).mockResolvedValue({generatedAt:'2026-01-01',balanced:'false',dimensions:[],rows:[]});render(<ReconciliationObservabilityScreen/>);fireEvent.click(screen.getByRole('button',{name:/General Trial Balance/}));expect(await screen.findByText(/invalid or inconsistent response/)).toBeTruthy();expect(screen.queryByText('BALANCED FACT')).toBeNull();
});
test('finance refresh rejects a contradictory balanced claim and marks previous report stale',async()=>{
 const good={generatedAt:'2026-01-01',journalIntegrity:{balanced:true,totalJournals:1,invalidJournals:0,orphanLines:0},totalAssets:[],totalLiabilities:[]};(ApiClient.get as jest.Mock).mockResolvedValueOnce(good).mockResolvedValueOnce({...good,journalIntegrity:{...good.journalIntegrity,invalidJournals:1}});
 render(<ReconciliationObservabilityScreen/>);fireEvent.click(screen.getByRole('button',{name:/Finance Verification & Activity/}));await screen.findByTestId('finance-verification-summary');fireEvent.click(screen.getByRole('button',{name:'Refresh Finance Verification'}));expect(await screen.findByText(/invalid or inconsistent response/)).toBeTruthy();expect(screen.getByRole('alert').textContent).toContain('Previous results are stale');
});
test('old reconciliation response cannot cross principals',async()=>{
 let resolve!:(v:any)=>void;const pending=new Promise<any>(r=>resolve=r);(ApiClient.get as jest.Mock).mockReturnValue(pending);render(<ReconciliationObservabilityScreen/>);fireEvent.click(screen.getByRole('button',{name:'Execute In-House Reconciliation Match'}));act(()=>principal('two'));
 await act(async()=>{resolve({status:'PASS',generatedAt:'2026-01-01',checks:[],binding:{summary:{bindingsChecked:1,discrepancies:0},discrepancies:[]}});await pending;});expect(screen.queryByText('Run Result Summary')).toBeNull();
});
