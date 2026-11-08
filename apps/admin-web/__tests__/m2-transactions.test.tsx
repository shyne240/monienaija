import React from 'react';
import {act,fireEvent,render,screen} from '@testing-library/react';
import {TransactionObservabilityScreen} from '../src/screens/authenticated/TransactionObservabilityScreen';
import {ApiClient} from '../src/services/api-client';
import {useAuthStore} from '../src/store/auth-store';
jest.mock('../src/services/api-client',()=>({ApiClient:{get:jest.fn(),post:jest.fn()}}));
const principal=(id='synthetic',scopes=['transaction.view'])=>useAuthStore.setState({principal:{type:'OPERATOR',principalId:id,sessionId:id,audience:'workforce-admin',roles:['OPERATIONS'],scopes,customerAccess:'NONE',assuranceLevel:'MFA'}});
beforeEach(()=>{jest.resetAllMocks();principal();});
test('simulation converts naira exactly without float rounding and clears results on edit',async()=>{
 (ApiClient.post as jest.Mock).mockResolvedValue({paymentType:'VIRTUAL_ACCOUNT',currency:'NGN',amountMinor:'9007199254740991',feeMinor:'1',vatMinor:'0',totalMinor:'9007199254740992'});render(<TransactionObservabilityScreen/>);
 fireEvent.change(screen.getByLabelText('Transaction Amount (NGN)'),{target:{value:'90071992547409.91'}});fireEvent.change(screen.getByLabelText('Flat Fee Rule (NGN)'),{target:{value:'0.01'}});fireEvent.change(screen.getByLabelText('Variable Fee (BPS)'),{target:{value:'0'}});fireEvent.change(screen.getByLabelText('VAT Tax Rate (BPS)'),{target:{value:'0'}});fireEvent.click(screen.getByRole('button',{name:'Run Simulation'}));
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

test('a mathematically inconsistent but self-adding fee response cannot confirm the scenario',async()=>{
 (ApiClient.post as jest.Mock).mockResolvedValue({paymentType:'VIRTUAL_ACCOUNT',currency:'NGN',amountMinor:'100000',feeMinor:'5000',vatMinor:'375',totalMinor:'105375'});render(<TransactionObservabilityScreen/>);fireEvent.click(screen.getByRole('button',{name:'Run Simulation'}));expect(await screen.findByText(/invalid or inconsistent result/)).toBeTruthy();expect(screen.queryByText('Fee Calculation Results')).toBeNull();
});
test('read-only workforce session cannot call the POST simulator',async()=>{
 act(()=>useAuthStore.setState(state=>({principal:state.principal?{...state.principal,readOnlyPrincipal:true}:null})));render(<TransactionObservabilityScreen/>);expect(screen.getByText(/read-only session cannot run/)).toBeTruthy();expect((screen.getByRole('button',{name:'Run Simulation'}) as HTMLButtonElement).disabled).toBe(true);expect(ApiClient.post).not.toHaveBeenCalled();
});
test('switching sessions with the same principal invalidates an in-flight trace',async()=>{
 let resolve!:(v:any)=>void;const pending=new Promise<any>(r=>resolve=r);(ApiClient.get as jest.Mock).mockReturnValue(pending);render(<TransactionObservabilityScreen/>);fireEvent.change(screen.getByLabelText('Transaction ID (UUID)'),{target:{value:'old'}});fireEvent.click(screen.getByRole('button',{name:'Track'}));act(()=>useAuthStore.setState(state=>({principal:state.principal?{...state.principal,sessionId:'new-session'}:null})));
 await act(async()=>{resolve({id:'old',status:'COMPLETED',currency:'NGN',amountMinor:'100',createdAt:'2026-01-01'});await pending;});expect(screen.queryByText('TRANSFER Detail View')).toBeNull();expect((screen.getByLabelText('Transaction ID (UUID)') as HTMLInputElement).value).toBe('');
});
test('customer history rejects a mismatched page instead of showing it as current',async()=>{
 principal('customer-reviewer',['customer.view_transactions']);(ApiClient.get as jest.Mock).mockResolvedValue({items:[],pagination:{page:2,limit:20,total:0,totalPages:0,hasNextPage:false}});render(<TransactionObservabilityScreen initialCustomerId="customer-1"/>);expect(await screen.findByText(/Transaction history returned an invalid response/)).toBeTruthy();expect(screen.queryByText(/No transactions found/)).toBeNull();
});

test('an empty later customer history page is recoverable without claiming no history exists',async()=>{
 principal('customer-reviewer',['customer.view_transactions']);const item={id:'one',type:'FUNDING',status:'APPROVED',direction:'CREDIT',currency:'NGN',amountMinor:'100',createdAt:'2026-01-01'};
 (ApiClient.get as jest.Mock).mockImplementation((path:string)=>path.includes('page=2')?Promise.resolve({items:[],pagination:{page:2,limit:20,total:1,totalPages:1,hasNextPage:false}}):Promise.resolve({items:[item],pagination:{page:1,limit:20,total:21,totalPages:2,hasNextPage:true}}));
 render(<TransactionObservabilityScreen initialCustomerId="customer-1"/>);await screen.findByText('FUNDING');fireEvent.click(screen.getByRole('button',{name:'Next'}));expect(await screen.findByText('No transactions on this page. Return to an earlier page.')).toBeTruthy();expect(screen.queryByText(/No transactions found for this customer/)).toBeNull();fireEvent.click(screen.getByRole('button',{name:'Previous'}));expect(await screen.findByText('FUNDING')).toBeTruthy();
});
