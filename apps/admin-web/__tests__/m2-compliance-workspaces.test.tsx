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
 principal(['risk_fraud.manage_fraud_case']);const old=deferred();(ApiClient.get as jest.Mock).mockReturnValueOnce(old.promise).mockResolvedValueOnce([{id:'new-fraud',category:'FRAUD',status:'OPEN',reason:'new case'}]);
 render(<RiskFraudScreen/>);fireEvent.change(screen.getByLabelText('Customer UUID'),{target:{value:'old'}});fireEvent.click(screen.getByRole('button',{name:'Search FRAUD cases'}));fireEvent.change(screen.getByLabelText('Customer UUID'),{target:{value:'new'}});fireEvent.click(screen.getByRole('button',{name:'Search FRAUD cases'}));
 expect(await screen.findByText('new case')).toBeTruthy();await act(async()=>{old.resolve([{id:'old-fraud',category:'FRAUD',status:'OPEN',reason:'old case'}]);await old.promise;});expect(screen.queryByText('old case')).toBeNull();
});
test('KYC submission distinguishes an incomplete receipt and keeps successful feedback visible after refresh',async()=>{
 principal(['kyc.view','kyc.approve']);(ApiClient.get as jest.Mock).mockResolvedValue({customerId:'synthetic-customer',level:'LEVEL_1',status:'APPROVED'});(ApiClient.post as jest.Mock).mockResolvedValueOnce({}).mockResolvedValueOnce({id:'assessment',customerId:'synthetic-customer',level:'LEVEL_1',status:'APPROVED'});
 render(<ComplianceScreen mode="kyc"/>);fireEvent.change(screen.getByLabelText('Customer UUID'),{target:{value:'synthetic-customer'}});fireEvent.click(screen.getByRole('button',{name:'Submit Assessment'}));
 expect(await screen.findByText(/Assessment outcome not confirmed/)).toBeTruthy();fireEvent.click(screen.getByRole('button',{name:'Submit Assessment'}));expect(await screen.findByText('KYC assessment submitted.')).toBeTruthy();expect(await screen.findByText(/Level LEVEL_1/)).toBeTruthy();expect(screen.getByText('KYC assessment submitted.')).toBeTruthy();
});
