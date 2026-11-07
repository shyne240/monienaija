import React from 'react';
import { act, render, screen } from '@testing-library/react';
import { ReconciliationStatusWidget, StatusCountWidget } from '../src/components/dashboard/widgets';
import { ApiClient } from '../src/services/api-client';

jest.mock('../src/services/api-client', () => ({ ApiClient: { get: jest.fn() } }));
const dimension = (balanced = true) => ({ currency:'NGN', accountingUnit:'DEFAULT', totalDebitsMinor:'100', totalCreditsMinor:balanced ? '100' : '99', balanced });
const response = (balanced = true) => ({ report:{status:'WARNING',generatedAt:'2026-11-01T10:00:00Z',checks:[{name:'binding',status:'WARNING',message:'Review binding discrepancy'}]}, trialBalance:{generatedAt:'2026-11-01T10:01:00Z',balanced,dimensions:[dimension(balanced)],rows:[]} });
function deferred() { let resolve!: (value:any)=>void; const promise=new Promise<any>(r=>{resolve=r;}); return {promise,resolve}; }
beforeEach(() => jest.resetAllMocks());

test('reconciliation displays independently reported run and trial results',async()=>{
  (ApiClient.get as jest.Mock).mockResolvedValue(response(false)); render(<ReconciliationStatusWidget/>);
  expect((await screen.findAllByText('WARNING')).length).toBeGreaterThan(0); expect(screen.getByText('Out of balance')).toBeTruthy(); expect(screen.getByText('Review binding discrepancy')).toBeTruthy(); expect(screen.getByText(/Reconciliation:/)).toBeTruthy(); expect(screen.getByText(/Trial balance:/)).toBeTruthy();
});
test.each([
  ['missing trial result', {report:response().report}],
  ['missing balance', {...response(),trialBalance:{...response().trialBalance,balanced:undefined}}],
  ['contradictory dimension', {...response(),trialBalance:{...response().trialBalance,dimensions:[{...dimension(),totalCreditsMinor:'99'}]}}],
  ['contradictory aggregate', {...response(false),trialBalance:{...response(false).trialBalance,balanced:true}}],
  ['malformed checks', {...response(),report:{...response().report,checks:[{name:'broken',status:'MISSING',message:'x'}]}}],
])('reconciliation rejects %s without displaying invented financial status',async(_label,payload)=>{
  (ApiClient.get as jest.Mock).mockResolvedValue(payload); render(<ReconciliationStatusWidget/>); expect((await screen.findByRole('alert')).textContent).toContain('Invalid reconciliation widget response.'); expect(screen.queryByText('Balanced')).toBeNull(); expect(screen.queryByText('Out of balance')).toBeNull();
});
test('empty dimensions do not imply account activity',async()=>{
  (ApiClient.get as jest.Mock).mockResolvedValue({...response(),trialBalance:{...response().trialBalance,dimensions:[],rows:[]}}); render(<ReconciliationStatusWidget/>); expect(await screen.findByText('Balanced')).toBeTruthy(); expect(screen.getByText(/does not establish account activity/)).toBeTruthy();
});
test('status summary displays actual counts including an authorized empty list',async()=>{
  (ApiClient.get as jest.Mock).mockResolvedValue({byStatus:[],pendingApplicationCount:0}); render(<StatusCountWidget widgetKey="agent-lifecycle-summary" title="Agents" description="Synthetic"/>); expect(await screen.findByText('Pending Applications')).toBeTruthy(); expect(screen.getByText('0')).toBeTruthy(); expect(screen.queryByText('No data available for this period.')).toBeNull();
});
test.each([
  ['missing byStatus',{pendingApplicationCount:0}],
  ['missing count',{byStatus:[{status:'ACTIVE'}],pendingApplicationCount:0}],
  ['negative count',{byStatus:[{status:'ACTIVE',count:-1}],pendingApplicationCount:0}],
  ['missing pending count',{byStatus:[]}],
])('status summary rejects %s rather than inventing zero',async(_label,payload)=>{
  (ApiClient.get as jest.Mock).mockResolvedValue(payload); render(<StatusCountWidget widgetKey="agent-lifecycle-summary" title="Agents" description="Synthetic"/>); expect((await screen.findByRole('alert')).textContent).toContain('Invalid status summary response.'); expect(screen.queryByText('0')).toBeNull();
});
test('late status data cannot replace a newly selected widget',async()=>{
  const old=deferred(); (ApiClient.get as jest.Mock).mockReturnValueOnce(old.promise).mockResolvedValueOnce({byStatus:[{status:'NEW',count:2}]});
  const view=render(<StatusCountWidget widgetKey="kyc-queue-summary" title="KYC" description="Synthetic"/>); view.rerender(<StatusCountWidget widgetKey="fraud-case-summary" title="Fraud" description="Synthetic"/>); expect(await screen.findByText(/NEW:/)).toBeTruthy(); await act(async()=>{old.resolve({byStatus:[{status:'OLD',count:1}]});await old.promise;}); expect(screen.queryByText(/OLD:/)).toBeNull();
});
