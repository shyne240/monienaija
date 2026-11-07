import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { TransactionSummaryWidget, TransactionTrendWidget } from '../src/components/dashboard/widgets';
import { ApiClient } from '../src/services/api-client';
jest.mock('../src/services/api-client', () => ({ ApiClient: { get: jest.fn() } }));
const summary=(period='7d')=>({period,from:'2026-11-01T00:00:00Z',to:'2026-11-07T23:59:59Z',currency:'NGN',totalCompletedCount:1,totalCompletedValueMinor:'12345',totalFailedCount:0,totalPendingCount:0,successRatePercent:100,totalFeeRevenueMinor:'25',feeRevenueNote:'Fee note',commissionNote:'No commission source',byType:[{type:'W2W',completedCount:1,completedValueMinor:'12345',failedCount:0,pendingCount:0,feeRevenueMinor:'25'}]});
const trend=(period='30d')=>({period,from:'2026-11-01T00:00:00Z',to:'2026-11-07T23:59:59Z',currency:'NGN',definition:'Synthetic daily trend',daily:[{date:'2026-11-01',completedCount:1,completedValueMinor:'12345'}]});
function deferred(){let resolve!:(value:any)=>void;const promise=new Promise<any>(r=>{resolve=r;});return{promise,resolve};}
beforeEach(()=>jest.resetAllMocks());

test.each([
 ['missing breakdown',{...summary(),byType:undefined}],
 ['wrong period',summary('today')],
 ['invalid amount',{...summary(),totalCompletedValueMinor:'123.45'}],
 ['invalid count',{...summary(),byType:[{...summary().byType[0],completedCount:null}]}],
 ['invalid comparison',{...summary(),comparison:{definition:'bad',completedCountChangePercent:'99',completedValueChangePercent:null}}],
])('summary rejects %s instead of displaying a malformed result',async(_label,payload)=>{
 (ApiClient.get as jest.Mock).mockResolvedValue(payload);render(<TransactionSummaryWidget/>);expect((await screen.findByRole('alert')).textContent).toContain('Invalid transaction summary response.');expect(screen.queryByText('₦123.45')).toBeNull();
});
test('trend rejects malformed data without crashing or showing an empty state',async()=>{
 (ApiClient.get as jest.Mock).mockResolvedValue({...trend(),daily:'invalid'});render(<TransactionTrendWidget/>);expect((await screen.findByRole('alert')).textContent).toContain('Invalid transaction trend response.');expect(screen.queryByText(/No data available/)).toBeNull();
});
test('custom days are inclusive UTC and incomplete dates never trigger a request',async()=>{
 (ApiClient.get as jest.Mock).mockImplementation((url:string)=>Promise.resolve(summary(url.includes('period=custom')?'custom':'7d')));render(<TransactionSummaryWidget/>);await screen.findByText('Completed (volume / count)');
 fireEvent.change(screen.getByLabelText('Period'),{target:{value:'custom'}});expect(await screen.findByText(/Choose both dates for the custom UTC range/)).toBeTruthy();expect(ApiClient.get).toHaveBeenCalledTimes(1);
 fireEvent.change(screen.getByLabelText('From date'),{target:{value:'2026-11-01'}});expect(ApiClient.get).toHaveBeenCalledTimes(1);fireEvent.change(screen.getByLabelText('To date'),{target:{value:'2026-11-07'}});
 await waitFor(()=>expect(ApiClient.get).toHaveBeenCalledWith(expect.stringContaining('from=2026-11-01T00%3A00%3A00.000Z&to=2026-11-07T23%3A59%3A59.999Z')));expect(screen.getByText('Inclusive UTC days')).toBeTruthy();
});
test('trend does not send inverted dates or more than 92 days',async()=>{
 (ApiClient.get as jest.Mock).mockResolvedValue(trend());render(<TransactionTrendWidget/>);await screen.findByText('View daily trend data');fireEvent.change(screen.getByLabelText('Period'),{target:{value:'custom'}});fireEvent.change(screen.getByLabelText('From date'),{target:{value:'2026-04-01'}});fireEvent.change(screen.getByLabelText('To date'),{target:{value:'2026-03-01'}});expect(await screen.findByText(/start on or before the end/)).toBeTruthy();
 fireEvent.change(screen.getByLabelText('To date'),{target:{value:'2026-08-01'}});expect(await screen.findByText(/at most 92 UTC days/)).toBeTruthy();expect(ApiClient.get).toHaveBeenCalledTimes(1);
});
test('late summary result from a previous period cannot replace the selected period',async()=>{
 const old=deferred();(ApiClient.get as jest.Mock).mockReturnValueOnce(old.promise).mockResolvedValueOnce({...summary('today'),totalCompletedCount:77});render(<TransactionSummaryWidget/>);fireEvent.change(screen.getByLabelText('Period'),{target:{value:'today'}});expect(await screen.findByText('77')).toBeTruthy();await act(async()=>{old.resolve({...summary(),totalCompletedCount:99});await old.promise;});expect(screen.queryByText('99')).toBeNull();
});
test('comparison requires a response and preserves null no-baseline changes',async()=>{
 (ApiClient.get as jest.Mock).mockResolvedValueOnce(summary()).mockResolvedValueOnce({...summary(),comparison:{definition:'No baseline',completedCountChangePercent:null,completedValueChangePercent:null}});render(<TransactionSummaryWidget/>);await screen.findByText('Completed (volume / count)');fireEvent.click(screen.getByLabelText('Compare to prior period'));expect(await screen.findByText('No baseline')).toBeTruthy();expect(screen.getAllByText('— vs prior period')).toHaveLength(2);
});
