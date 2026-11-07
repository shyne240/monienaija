import React from 'react';
import {act,fireEvent,render,screen} from '@testing-library/react';
import {TransactionObservabilityScreen} from '../src/screens/authenticated/TransactionObservabilityScreen';
import {ApiClient} from '../src/services/api-client';
import {useAuthStore} from '../src/store/auth-store';
jest.mock('../src/services/api-client',()=>({ApiClient:{get:jest.fn(),post:jest.fn()}}));
const principal=(id='synthetic',scopes=['transaction.view'])=>useAuthStore.setState({principal:{type:'OPERATOR',principalId:id,sessionId:id,audience:'workforce-admin',roles:['OPERATIONS'],scopes,customerAccess:'NONE',assuranceLevel:'MFA'}});
beforeEach(()=>{jest.resetAllMocks();principal();});
test('simulation converts naira exactly without float rounding and clears results on edit',async()=>{
 (ApiClient.post as jest.Mock).mockResolvedValue({feeMinor:'1',vatMinor:'0',totalMinor:'9007199254740992'});render(<TransactionObservabilityScreen/>);
 fireEvent.change(screen.getByLabelText('Transaction Amount (NGN)'),{target:{value:'90071992547409.91'}});fireEvent.change(screen.getByLabelText('Flat Fee Rule (NGN)'),{target:{value:'0.01'}});fireEvent.click(screen.getByRole('button',{name:'Run Simulation'}));
 expect(await screen.findByText('₦90,071,992,547,409.92')).toBeTruthy();expect(ApiClient.post).toHaveBeenCalledWith('/fees/calculate',expect.objectContaining({amountMinor:'9007199254740991',flatFeeMinor:'1'}));
 fireEvent.change(screen.getByLabelText('Transaction Amount (NGN)'),{target:{value:'2'}});expect(screen.queryByText('₦90,071,992,547,409.92')).toBeNull();
});
test('fractional kobo is rejected rather than rounded into a different financial value',async()=>{
 render(<TransactionObservabilityScreen/>);fireEvent.change(screen.getByLabelText('Transaction Amount (NGN)'),{target:{value:'1.005'}});fireEvent.click(screen.getByRole('button',{name:'Run Simulation'}));expect(await screen.findByText(/at most two decimal places/)).toBeTruthy();expect(ApiClient.post).not.toHaveBeenCalled();
});
test('a mismatched trace or inconsistent fee response cannot appear as authoritative',async()=>{
 (ApiClient.get as jest.Mock).mockResolvedValue({id:'another',status:'COMPLETED',currency:'NGN',amountMinor:'100',createdAt:'2026-01-01'});(ApiClient.post as jest.Mock).mockResolvedValue({feeMinor:'1',vatMinor:'0',totalMinor:'1'});
 render(<TransactionObservabilityScreen/>);fireEvent.change(screen.getByLabelText('Transaction ID (UUID)'),{target:{value:'requested'}});fireEvent.click(screen.getByRole('button',{name:'Track'}));expect(await screen.findByText(/invalid or mismatched record/)).toBeTruthy();
 fireEvent.click(screen.getByRole('button',{name:'Run Simulation'}));expect(await screen.findByText(/invalid or inconsistent result/)).toBeTruthy();expect(screen.queryByText('Fee Calculation Results')).toBeNull();
});
test('late trace is ignored when the principal changes',async()=>{
 let resolve!:(v:any)=>void;const pending=new Promise<any>(r=>resolve=r);(ApiClient.get as jest.Mock).mockReturnValue(pending);render(<TransactionObservabilityScreen/>);
 fireEvent.change(screen.getByLabelText('Transaction ID (UUID)'),{target:{value:'old'}});fireEvent.click(screen.getByRole('button',{name:'Track'}));act(()=>principal('other'));
 await act(async()=>{resolve({id:'old',status:'COMPLETED',currency:'NGN',amountMinor:'100',createdAt:'2026-01-01'});await pending;});expect(screen.queryByText('TRANSFER Detail View')).toBeNull();
});
