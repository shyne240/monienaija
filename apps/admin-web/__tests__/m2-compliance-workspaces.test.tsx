import React from 'react';
import {act,fireEvent,render,screen} from '@testing-library/react';
import {ComplianceScreen} from '../src/screens/authenticated/ComplianceScreen';
import {RiskFraudScreen} from '../src/screens/authenticated/RiskFraudScreen';
import {ApiClient} from '../src/services/api-client';
import {useAuthStore} from '../src/store/auth-store';
jest.mock('../src/services/api-client',()=>({ApiClient:{get:jest.fn(),post:jest.fn()}}));
const principal=(scopes:string[])=>useAuthStore.setState({principal:{type:'OPERATOR',principalId:'synthetic',sessionId:'synthetic',audience:'workforce-admin',roles:['COMPLIANCE'],scopes,customerAccess:'NONE',assuranceLevel:'MFA'}});
function deferred(){let resolve!:(v:any)=>void;const promise=new Promise<any>(r=>resolve=r);return {promise,resolve};}
beforeEach(()=>jest.resetAllMocks());
test('KYC response for a previous lookup cannot appear after changing the customer',async()=>{
 principal(['kyc.view']);const old=deferred();(ApiClient.get as jest.Mock).mockReturnValueOnce(old.promise).mockResolvedValueOnce({customerId:'new',level:'LEVEL_2',status:'PENDING'});
 render(<ComplianceScreen mode="kyc"/>);fireEvent.change(screen.getByLabelText('Customer UUID'),{target:{value:'old'}});fireEvent.click(screen.getByRole('button',{name:'Search'}));
 fireEvent.change(screen.getByLabelText('Customer UUID'),{target:{value:'new'}});fireEvent.click(screen.getByRole('button',{name:'Search'}));
 expect(await screen.findByText(/Level LEVEL_2/)).toBeTruthy();await act(async()=>{old.resolve({customerId:'old',level:'LEVEL_3',status:'APPROVED'});await old.promise;});
 expect(screen.queryByText(/LEVEL_3/)).toBeNull();expect(screen.getByText(/Level LEVEL_2/)).toBeTruthy();
});
test('switching the fraud customer clears prior results and ignores obsolete responses',async()=>{
 principal(['risk_fraud.manage_fraud_case']);const old=deferred();(ApiClient.get as jest.Mock).mockReturnValueOnce(old.promise).mockResolvedValueOnce([{id:'new-fraud',customerId:'new',caseNumber:'new case',category:'FRAUD',severity:'HIGH',status:'OPEN'}]);
 render(<RiskFraudScreen/>);fireEvent.change(screen.getByLabelText('Customer UUID'),{target:{value:'old'}});fireEvent.click(screen.getByRole('button',{name:'Search FRAUD cases'}));fireEvent.change(screen.getByLabelText('Customer UUID'),{target:{value:'new'}});fireEvent.click(screen.getByRole('button',{name:'Search FRAUD cases'}));
 expect(await screen.findByText('new case')).toBeTruthy();await act(async()=>{old.resolve([{id:'old-fraud',customerId:'old',caseNumber:'old case',category:'FRAUD',severity:'HIGH',status:'OPEN'}]);await old.promise;});expect(screen.queryByText('old case')).toBeNull();
});
test('KYC submission distinguishes an incomplete receipt and keeps successful feedback visible after refresh',async()=>{
 principal(['kyc.view','kyc.approve']);(ApiClient.get as jest.Mock).mockResolvedValue({customerId:'synthetic-customer',level:'LEVEL_1',status:'APPROVED'});(ApiClient.post as jest.Mock).mockResolvedValueOnce({}).mockResolvedValueOnce({id:'assessment',customerId:'synthetic-customer',level:'LEVEL_1',status:'APPROVED'});
 render(<ComplianceScreen mode="kyc"/>);fireEvent.change(screen.getByLabelText('Customer UUID'),{target:{value:'synthetic-customer'}});fireEvent.click(screen.getByRole('button',{name:'Submit Assessment'}));
 expect(await screen.findByText(/Assessment outcome not confirmed/)).toBeTruthy();fireEvent.click(screen.getByRole('button',{name:'Submit Assessment'}));expect(await screen.findByText('KYC assessment submitted.')).toBeTruthy();expect(await screen.findByText(/Level LEVEL_1/)).toBeTruthy();expect(screen.getByText('KYC assessment submitted.')).toBeTruthy();
});
test('a 404 does not imply whether the customer or assessment was absent',async()=>{
 principal(['kyc.view']);(ApiClient.get as jest.Mock).mockRejectedValue(Object.assign(new Error('Not found'),{status:404}));
 render(<ComplianceScreen mode="kyc"/>);fireEvent.change(screen.getByLabelText('Customer UUID'),{target:{value:'missing'}});fireEvent.click(screen.getByRole('button',{name:'Search'}));
 expect(await screen.findByText('Customer or current KYC assessment not found.')).toBeTruthy();expect(screen.queryByText('No KYC assessment found for this customer.')).toBeNull();
});
test('an incomplete case row or a case for another customer is an error, not an empty result',async()=>{
 principal(['compliance.manage_case']);(ApiClient.get as jest.Mock).mockResolvedValueOnce([{id:'case',customerId:'one',caseNumber:'CASE-1',status:'OPEN',severity:'HIGH'}]).mockResolvedValueOnce([{id:'case',customerId:'other',caseNumber:'CASE-1',category:'AML',status:'OPEN',severity:'HIGH'}]);
 render(<ComplianceScreen mode="cases"/>);fireEvent.change(screen.getByLabelText('Customer UUID'),{target:{value:'one'}});fireEvent.click(screen.getByRole('button',{name:'Search'}));
 expect(await screen.findByText('Compliance lookup returned an invalid response.')).toBeTruthy();expect(screen.queryByText(/No compliance cases match/)).toBeNull();fireEvent.click(screen.getByRole('button',{name:'Search'}));expect(await screen.findByText('Compliance lookup returned an invalid response.')).toBeTruthy();
});
test('review-only KYC functions cannot select an approval or rejection',()=>{
 principal(['kyc.review']);render(<ComplianceScreen mode="kyc"/>);expect(screen.getByRole('option',{name:'PENDING'})).toBeTruthy();expect(screen.queryByRole('option',{name:'APPROVED'})).toBeNull();expect(screen.queryByRole('option',{name:'REJECTED'})).toBeNull();
});
test('a new session for the same reviewer clears the prior customer and draft',()=>{
 principal(['kyc.view','kyc.review']);render(<ComplianceScreen mode="kyc"/>);fireEvent.change(screen.getByLabelText('Customer UUID'),{target:{value:'one'}});fireEvent.change(screen.getByLabelText('Assessment reason (optional)'),{target:{value:'sensitive draft'}});
 act(()=>useAuthStore.setState(state=>({principal:{...state.principal!,sessionId:'new-session'}})));expect((screen.getByLabelText('Customer UUID') as HTMLInputElement).value).toBe('');expect((screen.getByLabelText('Assessment reason (optional)') as HTMLInputElement).value).toBe('');
});
