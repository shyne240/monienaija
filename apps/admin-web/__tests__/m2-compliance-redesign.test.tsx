import React from 'react';
import {fireEvent,render,screen,within} from '@testing-library/react';
import {ComplianceScreen} from '../src/screens/authenticated/ComplianceScreen';
import {RiskFraudScreen} from '../src/screens/authenticated/RiskFraudScreen';
import {ApiClient} from '../src/services/api-client';
import {useAuthStore} from '../src/store/auth-store';
jest.mock('../src/services/api-client',()=>({ApiClient:{get:jest.fn(),post:jest.fn()}}));
function principal(scopes:string[]){useAuthStore.setState({principal:{type:'OPERATOR',principalId:'reviewer',sessionId:'session',audience:'workforce-admin',roles:['COMPLIANCE'],scopes,customerAccess:'NONE',assuranceLevel:'MFA'}});}
const row=(category:string)=>({id:category,customerId:'customer',caseNumber:`${category}-1`,category,status:'OPEN',severity:'HIGH',openedAt:'2026-11-01T00:00:00Z'});
beforeEach(()=>jest.resetAllMocks());

test('compliance case search submits with the form and filters only non-fraud returned records',async()=>{
 principal(['compliance.manage_case']);(ApiClient.get as jest.Mock).mockResolvedValue([row('AML'),row('KYC'),row('FRAUD')]);render(<ComplianceScreen mode="cases"/>);
 fireEvent.change(screen.getByLabelText('Customer UUID'),{target:{value:'customer'}});fireEvent.submit(screen.getByRole('button',{name:'Search'}).closest('form')!);
 expect(await screen.findByText('AML-1')).toBeTruthy();expect(screen.queryByText('FRAUD-1')).toBeNull();
 fireEvent.change(screen.getByLabelText('Category'),{target:{value:'KYC'}});expect(screen.queryByText('AML-1')).toBeNull();expect(screen.getByText('KYC-1')).toBeTruthy();expect(screen.getByText('1 shown · 2 non-FRAUD records returned')).toBeTruthy();
 expect(ApiClient.post).not.toHaveBeenCalled();
});

test('fraud lookup displays only returned fraud rows and keeps category boundary explicit',async()=>{
 principal(['risk_fraud.manage_fraud_case']);(ApiClient.get as jest.Mock).mockResolvedValue([row('AML'),row('FRAUD')]);render(<RiskFraudScreen/>);
 fireEvent.change(screen.getByLabelText('Customer UUID'),{target:{value:'customer'}});fireEvent.submit(screen.getByRole('button',{name:'Search FRAUD cases'}).closest('form')!);
 expect(await screen.findByText('FRAUD-1')).toBeTruthy();expect(screen.queryByText('AML-1')).toBeNull();expect(screen.getByText('1 shown')).toBeTruthy();
 expect(screen.getByText(/server returns cases in categories authorized/)).toBeTruthy();
});

test('review-only KYC mode keeps read restriction explicit and clears a reason when customer changes',()=>{
 const confirm=jest.spyOn(window,'confirm').mockReturnValue(true);principal(['kyc.review']);render(<ComplianceScreen mode="kyc"/>);
 expect(screen.getByText(/Assessment lookup requires/)).toBeTruthy();
 const decision=screen.getByRole('region',{name:'Submit KYC assessment decision'});
 expect(within(decision).queryByRole('option',{name:'APPROVED'})).toBeNull();
 fireEvent.change(screen.getByLabelText('Customer UUID'),{target:{value:'customer-one'}});
 fireEvent.change(screen.getByLabelText('Assessment reason (optional)'),{target:{value:'previous customer note'}});
 fireEvent.change(screen.getByLabelText('Customer UUID'),{target:{value:'customer-two'}});
 expect((screen.getByLabelText('Assessment reason (optional)') as HTMLInputElement).value).toBe('');confirm.mockRestore();
});

test('fraud permission does not grant compliance or KYC access',()=>{
 principal(['risk_fraud.manage_fraud_case']);const view=render(<ComplianceScreen mode="cases"/>);expect(screen.getByRole('alert').textContent).toContain('compliance.manage_case');view.unmount();
 render(<ComplianceScreen mode="kyc"/>);expect(screen.getByRole('alert').textContent).toContain('kyc.view');expect(ApiClient.get).not.toHaveBeenCalled();
});

test.each([['cases','compliance.manage_case','AML'],['fraud','risk_fraud.manage_fraud_case','FRAUD']])('%s drawer shows only the authorized customer case and restores focus',async(mode,scope,category)=>{
 principal([scope]);(ApiClient.get as jest.Mock).mockResolvedValue([row(category),row(category==='AML'?'FRAUD':'AML')]);
 render(mode==='cases'?<ComplianceScreen mode="cases"/>:<RiskFraudScreen/>);fireEvent.change(screen.getByLabelText('Customer UUID'),{target:{value:'customer'}});fireEvent.click(screen.getByRole('button',{name:mode==='cases'?'Search':'Search FRAUD cases'}));
 const trigger=await screen.findByRole('button',{name:`View case ${category}-1`});trigger.focus();fireEvent.click(trigger);
 const dialog=screen.getByRole('dialog',{name:'Case details'});expect(dialog.textContent).toContain(`${category}-1`);expect(dialog.textContent).toContain('customer');expect(screen.queryByRole('button',{name:`View case ${category==='AML'?'FRAUD':'AML'}-1`})).toBeNull();
 fireEvent.keyDown(document,{key:'Escape'});expect(screen.queryByRole('dialog',{name:'Case details'})).toBeNull();expect(document.activeElement).toBe(trigger);expect(ApiClient.post).not.toHaveBeenCalled();
});
