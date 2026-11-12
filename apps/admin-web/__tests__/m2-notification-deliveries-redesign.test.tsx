import React from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { NotificationManagementScreen } from '../src/screens/authenticated/NotificationManagementScreen';
import { NotificationManagementApi } from '../src/services/notification-management-api';
import { ApiClient } from '../src/services/api-client';
import { useAuthStore } from '../src/store/auth-store';

jest.mock('../src/services/api-client', () => ({ ApiClient: { get: jest.fn(), post: jest.fn() }, ApiError: class extends Error { status = 503; } }));
const deferred = () => { let resolve!: (value: any) => void; const promise = new Promise<any>(r => { resolve = r; }); return {promise, resolve}; };
const delivery = (id: string, status = 'SENT') => ({id,eventType:'transfer.completed',eventKey:'synthetic',channel:'SMS',recipientType:'CUSTOMER',recipientId:'11111111-1111-4111-8111-111111111111',status,attempts:1,providerRef:null,errorCode:null,correlationId:null,createdAt:'2026-11-01T00:00:00Z',sentAt:null,failedAt:null});
const page = (rows: any[]) => ({ status:'LIVE', data:{data:rows,total:rows.length,page:1,limit:20,totalPages:1,hasNextPage:false} }) as any;
beforeEach(() => {
  jest.restoreAllMocks(); (ApiClient.get as jest.Mock).mockReset().mockRejectedValue(new Error('Synthetic unavailable')); (ApiClient.post as jest.Mock).mockReset();
  useAuthStore.setState({principal:{type:'OPERATOR',principalId:'one',sessionId:'one',audience:'workforce-admin',roles:['OPERATIONS'],scopes:['notification.view_deliveries'],customerAccess:'NONE',assuranceLevel:'MFA'}});
});
test('latest applied delivery filter wins over a late earlier read and inspector focus returns', async () => {
  const old = deferred();
  jest.spyOn(NotificationManagementApi,'listDeliveries').mockReturnValueOnce(old.promise).mockResolvedValueOnce(page([delivery('fresh','FAILED')]));
  jest.spyOn(NotificationManagementApi,'listOutboxReceipts').mockResolvedValue(page([]));
  render(<NotificationManagementScreen initialTab="deliveries" />);
  fireEvent.change(screen.getByLabelText('Delivery status'), {target:{value:'FAILED'}});
  fireEvent.click(screen.getByTestId('apply-delivery-filters-btn'));
  expect(await screen.findByTestId('delivery-row-fresh')).toBeTruthy();
  await act(async () => { old.resolve(page([delivery('old')])); await old.promise; });
  expect(screen.queryByTestId('delivery-row-old')).toBeNull();
  const results = screen.getByRole('region',{name:'Delivery results'});
  expect(within(results).getByText(/Filters applied: FAILED/)).toBeTruthy();
  const trigger = screen.getByRole('button',{name:'Inspect delivery fresh'}); trigger.focus(); fireEvent.click(trigger);
  expect(screen.getByRole('dialog',{name:'Delivery diagnostic inspector'})).toBeTruthy();
  expect(document.activeElement).toBe(screen.getByRole('button',{name:'Close Inspector'}));
  fireEvent.click(screen.getByRole('button',{name:'Close Inspector'})); expect(document.activeElement).toBe(trigger);
  expect(ApiClient.post).not.toHaveBeenCalled();
});
test('outbox read errors do not claim an empty page or zero totals', async () => {
  jest.spyOn(NotificationManagementApi,'listDeliveries').mockResolvedValue(page([]));
  jest.spyOn(NotificationManagementApi,'listOutboxReceipts').mockRejectedValue(new Error('Synthetic receipt failure'));
  render(<NotificationManagementScreen initialTab="deliveries" />);
  expect(await screen.findByTestId('outbox-receipts-error')).toBeTruthy();
  expect(screen.getByText('Outbox receipts unavailable.')).toBeTruthy();
  expect(screen.queryByText('No notification outbox receipts matched the selected status filter.')).toBeNull();
  expect(screen.queryByTestId('outbox-receipts-pager')).toBeNull();
});
test('invalid filter keeps the last applied results instead of presenting a read failure', async () => {
  jest.spyOn(NotificationManagementApi,'listDeliveries').mockResolvedValue(page([delivery('current')]));
  jest.spyOn(NotificationManagementApi,'listOutboxReceipts').mockResolvedValue(page([]));
  render(<NotificationManagementScreen initialTab="deliveries" />); await screen.findByTestId('delivery-row-current');
  fireEvent.change(screen.getByLabelText('Recipient UUID filter'),{target:{value:'not-a-uuid'}});
  fireEvent.click(screen.getByTestId('apply-delivery-filters-btn'));
  expect(screen.getByTestId('delivery-filter-error').textContent).toMatch(/valid UUID/);
  expect(screen.getByTestId('delivery-row-current')).toBeTruthy(); expect(screen.queryByText('Delivery records unavailable.')).toBeNull();
});
test('latest outbox status filter wins over a late earlier read', async () => {
  const old = deferred();
  jest.spyOn(NotificationManagementApi,'listDeliveries').mockResolvedValue(page([]));
  jest.spyOn(NotificationManagementApi,'listOutboxReceipts').mockReturnValueOnce(old.promise).mockResolvedValueOnce(page([{outboxEventId:'new-receipt',status:'FAILED',reason:null,attempts:1,updatedAt:'2026-11-01T00:00:00Z'}]));
  render(<NotificationManagementScreen initialTab="deliveries" />);
  fireEvent.change(screen.getByLabelText('Outbox receipt status'),{target:{value:'FAILED'}});
  expect(await screen.findByTestId('outbox-receipt-row-new-receipt')).toBeTruthy();
  await act(async () => { old.resolve(page([{outboxEventId:'old-receipt',status:'MATERIALIZED',reason:null,attempts:1}])); await old.promise; });
  expect(screen.queryByTestId('outbox-receipt-row-old-receipt')).toBeNull();
  expect(screen.getByTestId('outbox-receipt-row-new-receipt')).toBeTruthy();
});
test('malformed or wrong-context diagnostic pages are not shown as empty results', async () => {
  (ApiClient.get as jest.Mock).mockImplementation((path:string)=>path.startsWith('/internal/notifications/deliveries?') ? Promise.resolve({}) : path.startsWith('/internal/notifications/outbox-receipts?') ? Promise.resolve({data:[],total:0,page:2,limit:20,totalPages:0,hasNextPage:false}) : Promise.reject(new Error('unavailable')));
  render(<NotificationManagementScreen initialTab="deliveries" />);
  expect(await screen.findByText('Delivery records unavailable.')).toBeTruthy();
  expect(await screen.findByText('Outbox receipts unavailable.')).toBeTruthy();
  expect(screen.queryByTestId('notification-deliveries-pager')).toBeNull(); expect(screen.queryByTestId('outbox-receipts-pager')).toBeNull();
  expect(ApiClient.post).not.toHaveBeenCalled();
});
test('delivery and outbox reads reject rows from a different applied status',async()=>{
  (ApiClient.get as jest.Mock).mockResolvedValueOnce({data:[delivery('synthetic','SENT')],total:1,page:1,limit:20,totalPages:1,hasNextPage:false});
  await expect(NotificationManagementApi.listDeliveries({status:'FAILED'})).rejects.toThrow(/could not be verified/);
  (ApiClient.get as jest.Mock).mockResolvedValueOnce({data:[{outboxEventId:'synthetic',status:'MATERIALIZED',attempts:1,createdAt:'2026-11-01T00:00:00Z',updatedAt:'2026-11-01T00:00:00Z'}],total:1,page:1,limit:15,totalPages:1,hasNextPage:false});
  await expect(NotificationManagementApi.listOutboxReceipts({status:'FAILED'})).rejects.toThrow(/could not be verified/);
});
