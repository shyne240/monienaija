import React from 'react';
import { render, screen, within } from '@testing-library/react';
import { AuditTrailWidget, GenericDirectWidget, LedgerSummaryWidget, RecentTransactionsWidget, WidgetRenderer, WorkforceOverviewWidget } from '../src/components/dashboard/widgets';
import { ApiClient } from '../src/services/api-client';
import type { ResolvedWidget } from '../src/components/dashboard/types';
jest.mock('../src/services/api-client',()=>({ApiClient:{get:jest.fn()}}));
beforeEach(()=>jest.resetAllMocks());
const widget=(widgetKey:string,endpoint:string):ResolvedWidget=>({widgetKey,displayName:'Synthetic',description:'Synthetic',order:1,fetchMode:'direct',endpoint,kind:'table',authorized:true});
test('audit widget renders only approved summary fields',async()=>{
 (ApiClient.get as jest.Mock).mockResolvedValue([{id:'audit-1',entityType:'AGENT',action:'UPDATED',actor:'operator',occurredAt:'2026-11-01T10:00:00Z',newValues:{secret:'should-not-render'}}]);render(<AuditTrailWidget/>);expect(await screen.findByText('UPDATED')).toBeTruthy();expect(screen.getByText('operator')).toBeTruthy();expect(screen.queryByText('should-not-render')).toBeNull();expect(ApiClient.get).toHaveBeenCalledWith('/internal/a2/workforce/dashboard/widgets/audit-trail');
});
test.each([
 ['audit',<AuditTrailWidget/>,[{id:'x',action:'UPDATED'}]],
 ['recent',<RecentTransactionsWidget/>,{unexpected:'data'}],
 ['ledger',<LedgerSummaryWidget/>,[{currency:'NGN',accounting_unit:'unit',journal_count:'1',debits_minor:'bad',credits_minor:'0'}]],
 ['workforce',<WorkforceOverviewWidget/>,{activeWorkforceHeadcount:1,activeSessionCount:0,roleDistribution:[{roleKey:'OPERATIONS'}]}],
])('%s widget shows unavailable for invalid payload instead of fabricated or empty data',async(_name,component,payload)=>{
 (ApiClient.get as jest.Mock).mockResolvedValue(payload);render(component);expect(await screen.findByRole('alert')).toBeTruthy();expect(screen.queryByText(/No data available/)).toBeNull();
});
test('recent and ledger widgets preserve non-NGN units',async()=>{
 (ApiClient.get as jest.Mock).mockImplementation((url:string)=>Promise.resolve(url.endsWith('recent-transactions')?[{type:'W2W',reference:'synthetic-reference',amountMinor:'12345',feeMinor:null,currency:'USD',status:'COMPLETED',createdAt:'2026-11-01T00:00:00Z',completedAt:null}]:[{currency:'USD',accounting_unit:'main',journal_count:'1',debits_minor:'900719925474099301',credits_minor:'0'}]));
 render(<><RecentTransactionsWidget/><LedgerSummaryWidget/></>);expect(await screen.findByText('USD 12,345 minor units')).toBeTruthy();expect(await screen.findByText('USD 900,719,925,474,099,301 minor units')).toBeTruthy();
});
test('support widget interprets paginated items, declares all statuses and hides sensitive descriptions',async()=>{
 (ApiClient.get as jest.Mock).mockResolvedValue({items:[{id:'ticket-1',reference:'SYN-TICKET',status:'CLOSED',description:'sensitive description'}],pagination:{total:21,page:1,limit:20,totalPages:2,hasNextPage:true}});render(<GenericDirectWidget widgetKey="support-ticket-queue" title="Support Tickets" description="Synthetic"/>);
 expect(await screen.findByText('SYN-TICKET')).toBeTruthy();expect(screen.getByText('CLOSED')).toBeTruthy();expect(screen.getByText(/all statuses.*1 of 21/)).toBeTruthy();expect(screen.queryByText('sensitive description')).toBeNull();
});
test('metrics widget reports only metrics and avoids calling diagnostics or queues',async()=>{
 (ApiClient.get as jest.Mock).mockResolvedValue({generatedAt:'2026-11-01T00:00:00Z',metrics:{requests:'12'}});render(<GenericDirectWidget widgetKey="system-health" title="Operational Metrics" description="Synthetic"/>);expect(await screen.findByText('12')).toBeTruthy();expect(screen.getByText(/Diagnostics and outbox are not included/)).toBeTruthy();expect(ApiClient.get).toHaveBeenCalledTimes(1);expect(ApiClient.get).toHaveBeenCalledWith('/internal/metrics');
});
test('direct source mismatch never causes arbitrary requests',()=>{
 render(<WidgetRenderer widget={widget('agent-applications-queue','https://example.com/untrusted')}/>);expect(screen.getByText(/not yet supported/)).toBeTruthy();expect(ApiClient.get).not.toHaveBeenCalled();
});
test('restricted audit widget never fetches data',()=>{
 render(<WidgetRenderer widget={{...widget('audit-trail',''),fetchMode:'proxy',authorized:false}}/>);expect(screen.getByText(/Restricted/)).toBeTruthy();expect(ApiClient.get).not.toHaveBeenCalled();
});
test('one invalid widget does not hide another loaded widget',async()=>{
 (ApiClient.get as jest.Mock).mockImplementation((url:string)=>Promise.resolve(url.endsWith('workforce-overview')?{activeWorkforceHeadcount:4,activeSessionCount:2,roleDistribution:[{roleKey:'OPERATIONS',count:4}]}:{}));render(<><RecentTransactionsWidget/><WorkforceOverviewWidget/></>);expect(await screen.findByRole('alert')).toBeTruthy();const section=screen.getByText('Workforce Overview').closest('section')!;expect(within(section).getByText('Active Headcount')).toBeTruthy();expect(within(section).getAllByText('4').length).toBeGreaterThan(0);
});
