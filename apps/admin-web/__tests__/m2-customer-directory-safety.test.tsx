import React from 'react';
import {act,fireEvent,render,screen} from '@testing-library/react';
import {CustomerDirectoryScreen} from '../src/screens/authenticated/CustomerDirectoryScreen';
import {ApiClient} from '../src/services/api-client';
import {useAuthStore} from '../src/store/auth-store';
jest.mock('../src/services/api-client',()=>({ApiClient:{get:jest.fn()}}));
jest.mock('../src/screens/authenticated/CustomerRegistrationWizard',()=>{const React=require('react');return {CustomerRegistrationWizard:React.forwardRef((props:any,_ref:any)=><button type="button" onClick={()=>props.onOpenCustomer('new')}>Open saved customer</button>)};});
jest.mock('../src/screens/authenticated/Customer360Workspace',()=>({Customer360Workspace:({customer,onBack}:any)=><div><h2>{customer.displayName}</h2><button onClick={onBack}>Back</button></div>}));
const row=(id:string)=>({id,reference:'SYNTHETIC',type:'INDIVIDUAL',status:'DRAFT',kycLevel:'NONE',kycStatus:'NOT_STARTED',displayName:id,createdAt:'2026-01-01'});
function deferred(){let resolve!:(value:any)=>void;const promise=new Promise(r=>resolve=r);return {promise,resolve};}
beforeEach(()=>{jest.resetAllMocks();useAuthStore.setState({sessionId:'session',principal:{type:'OPERATOR',principalId:'operator',sessionId:'session',audience:'workforce-admin',roles:['OPERATIONS'],scopes:['customer.view','customer.create'],assuranceLevel:'MFA',customerAccess:'NONE'}});});
test('late saved customer lookup does not replace a subsequently selected directory customer',async()=>{
 const late=deferred();(ApiClient.get as jest.Mock).mockImplementation((path:string)=>path.includes('?')?Promise.resolve({data:[row('existing')],total:1,page:1,limit:20,totalPages:1,hasNextPage:false,hasPreviousPage:false}):late.promise);render(<CustomerDirectoryScreen/>);await screen.findByText('existing');fireEvent.click(screen.getByRole('button',{name:'New Customer'}));fireEvent.click(screen.getByRole('button',{name:'Open saved customer'}));fireEvent.click(screen.getByRole('button',{name:'Open Customer 360° for existing'}));await act(async()=>{late.resolve(row('new'));await late.promise;});expect(screen.getByRole('heading',{name:'existing'})).toBeTruthy();expect(screen.queryByRole('heading',{name:'new'})).toBeNull();
});
test('saved customer lookup opens the requested matching record',async()=>{
 (ApiClient.get as jest.Mock).mockImplementation((path:string)=>Promise.resolve(path.includes('?')?{data:[row('existing')],total:1,page:1,limit:20,totalPages:1,hasNextPage:false,hasPreviousPage:false}:row('new')));render(<CustomerDirectoryScreen/>);await screen.findByText('existing');fireEvent.click(screen.getByRole('button',{name:'New Customer'}));fireEvent.click(screen.getByRole('button',{name:'Open saved customer'}));expect(await screen.findByRole('heading',{name:'new'})).toBeTruthy();
});
