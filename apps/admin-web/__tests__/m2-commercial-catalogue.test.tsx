import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { CommercialRulesScreen } from '../src/screens/authenticated/CommercialRulesScreen';
import { ApiClient } from '../src/services/api-client';
import { useAuthStore } from '../src/store/auth-store';
jest.mock('../src/services/api-client', () => ({ ApiClient: { get: jest.fn(), post: jest.fn() } }));
function session(scopes: string[], id = 'one') { useAuthStore.setState({ isAuthenticated: true, token: id, sessionId: id, principal: { type: 'OPERATOR', principalId: 'synthetic', sessionId: id, audience: 'workforce-admin', roles: ['FINANCE_CONTROLLER'], scopes, customerAccess: 'NONE', assuranceLevel: 'MFA' } }); }
function page(data: object[], number = 1, total = data.length) { return { data, total, page: number, limit: 20, totalPages: Math.ceil(total / 20), hasNextPage: number < Math.ceil(total / 20) }; }
function deferred<T>() { let resolve!: (v: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
beforeEach(() => jest.clearAllMocks());

test('fee registry shows real backend fields, pages independently and searches only current visible columns', async () => {
  session(['fee_rule.view']);
  (ApiClient.get as jest.Mock).mockImplementation((url: string) => Promise.resolve(url.includes('page=2') ? page([{ id: 'fee-two', productCode: 'CASH_OUT', currency: 'USD', flatFeeMinor: '1234', isActive: false }], 2, 21) : page([{ id: 'fee-one', productCode: 'TRANSFER', currency: 'NGN', flatFeeMinor: '100', isActive: true }], 1, 21)));
  render(<CommercialRulesScreen initialTab="fees" />);
  expect(await screen.findAllByText('fee-one')).toBeTruthy(); expect(screen.getByText('21 total records · Page 1 of 2')).toBeTruthy();
  expect(screen.getByRole('columnheader', {name:'Rule ID'})).toBeTruthy(); expect(screen.getByRole('columnheader', {name:'Active'})).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Search Fees on this page'), {target:{value:'missing'}});
  expect(screen.getByText('No records match this search on the current page.')).toBeTruthy();
  expect(screen.getByText('21 total records · Page 1 of 2 · 0 matching on this page')).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Search Fees on this page'), {target:{value:''}});
  fireEvent.click(screen.getByRole('button',{name:'Next Fees page'}));
  expect(await screen.findAllByText('fee-two')).toBeTruthy(); expect(screen.getByText('21 total records · Page 2 of 2')).toBeTruthy();
  expect(ApiClient.get).toHaveBeenCalledWith('/internal/fee-rules?page=2&limit=20');
  expect((screen.getByRole('button',{name:'Next Fees page'}) as HTMLButtonElement).disabled).toBe(true);
  expect(ApiClient.post).not.toHaveBeenCalled();
});

test('limit profiles and rules have independent paging and failure states', async () => {
  session(['limit.view']);
  (ApiClient.get as jest.Mock).mockImplementation((url: string) => {
    if (url.includes('limit-profiles')) return Promise.resolve(url.includes('page=2') ? page([{code:'PROFILE-B', name:'Second'}],2,21) : page([{code:'PROFILE-A', name:'First'}],1,21));
    return Promise.reject(new Error('Rules unavailable'));
  });
  render(<CommercialRulesScreen initialTab="limits" />);
  await screen.findAllByText('PROFILE-A'); expect(await screen.findByText(/Rules unavailable/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:'Next Limit profiles page'})); await screen.findAllByText('PROFILE-B');
  expect(screen.getByText(/Rules unavailable/)).toBeTruthy();
  expect(ApiClient.get).toHaveBeenCalledWith('/internal/limit-profiles?page=2&limit=20');
  expect((ApiClient.get as jest.Mock).mock.calls.filter(([url]) => url.includes('limit-rules'))).toHaveLength(1);
});

test('incorrect pagination is an error, not a fabricated empty catalogue', async () => {
  session(['product.view']); (ApiClient.get as jest.Mock).mockResolvedValue({...page([],1,0),hasNextPage:true});
  render(<CommercialRulesScreen initialTab="products" />);
  expect(await screen.findByText(/Products returned an invalid page/)).toBeTruthy();
  expect(screen.queryByText(/No products were returned/)).toBeNull();
});

test('tab and session changes do not show late registry results or preserve the search', async () => {
  session(['fee_rule.view','commission_rule.view']); const late = deferred<unknown>();
  (ApiClient.get as jest.Mock).mockImplementation((url: string) => url.includes('fee-rules') ? late.promise : Promise.resolve(page([{id:'commission',productCode:'TRANSFER'}])));
  render(<CommercialRulesScreen initialTab="fees" />); fireEvent.change(screen.getByLabelText('Search Fees on this page'),{target:{value:'old search'}});
  fireEvent.click(screen.getByRole('tab',{name:'Commissions'})); await screen.findAllByText('commission');
  await act(async () => {late.resolve(page([{id:'stale-fee'}])); await late.promise;});
  expect(screen.queryByText('stale-fee')).toBeNull();
  act(() => session(['fee_rule.view'],'two'));
  await waitFor(() => expect(screen.queryByRole('tab',{name:'Commissions'})).toBeNull());
  expect((screen.getByLabelText('Search Fees on this page') as HTMLInputElement).value).toBe('');
});

test('an unpaginated legacy array is explicitly labelled and does not invent a total', async () => {
  session(['reward_rule.view']); (ApiClient.get as jest.Mock).mockResolvedValue([{id:'reward-one',productCode:'TRANSFER'}]);
  render(<CommercialRulesScreen initialTab="rewards" />);
  expect(await screen.findAllByText('reward-one')).toBeTruthy();
  expect(screen.getByText('1 record returned · Total and pagination unavailable')).toBeTruthy();
  expect(screen.queryByRole('button',{name:'Next Rewards page'})).toBeNull();
});
