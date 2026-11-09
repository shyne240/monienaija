import React from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { AgentNetworkScreen } from '../src/screens/authenticated/AgentNetworkScreen';
import { useAuthStore } from '../src/store/auth-store';
import { ApiClient } from '../src/services/api-client';
jest.mock('../src/services/api-client', () => ({ ApiClient: { get: jest.fn(), post: jest.fn(), patch: jest.fn() } }));
const agent = (id: string) => ({ id, reference: `AG-${id}`, status: 'ACTIVE', agentClassId: null, createdAt: '2026-01-01', updatedAt: '2026-01-01' });
const position = (id: string) => ({ agentId: id, walletExists: true, walletId: `wallet-${id}`, currency: 'NGN', balanceMinor: '100' });
const walletRow = { transferId: 'actual-transfer-id', direction: 'SENT', amountMinor: '12345', currency: 'NGN', status: 'COMPLETED', reference: null, createdAt: '2026-01-01' };
const c2cRow = (id: string) => ({ id: 'cash-row', agentId: id, beneficiaryPhoneMasked: '•••••••1234', principalMinor: '10000', currency: 'NGN', status: 'UNCLAIMED', redemptionMethod: null, reference: 'C2C-ONE', createdAt: '2026-01-01' });
beforeEach(() => {
 jest.resetAllMocks();
 useAuthStore.setState({principal: { type: 'OPERATOR', principalId: 'manager', sessionId: 'session', audience: 'workforce-admin', roles: [], scopes: ['agent.view', 'transaction.view'], customerAccess: 'NONE', assuranceLevel: 'MFA' }});
});
async function open() { render(<AgentNetworkScreen />); await screen.findByText('AG-one'); fireEvent.click(screen.getAllByRole('button', { name: 'View' })[0]); return screen.getByLabelText('Agent transaction and Cash-to-Cash visibility'); }

test('renders actual wallet transferId contract and labels first-page scope', async () => {
 (ApiClient.get as jest.Mock).mockImplementation((path: string) => path.startsWith('/internal/agents?') ? Promise.resolve({ data: [agent('one')], total: 1 }) : path.endsWith('/financial-position') ? Promise.resolve(position('one')) : path.startsWith('/wallets/') ? Promise.resolve({ items: [walletRow] }) : path.includes('/cash-to-cash/transfers') ? Promise.resolve({ data: [c2cRow('one')] }) : Promise.resolve([]));
 const section = await open(); await screen.findByText('wallet-one'); fireEvent.click(within(section).getByRole('button', { name: 'Load Agent transactions' }));
 expect(await within(section).findByText(/actual-t/)).toBeTruthy(); expect(within(section).getByText('C2C-ONE')).toBeTruthy();
 expect(within(section).getByText('Wallet transfers · first page (up to 10)')).toBeTruthy(); expect(within(section).getByText('Cash-to-Cash transfers · first page (up to 10)')).toBeTruthy();
});

test('position failure and independent failed history do not become empty records or a missing wallet', async () => {
 (ApiClient.get as jest.Mock).mockImplementation((path: string) => path.startsWith('/internal/agents?') ? Promise.resolve({ data: [agent('one')], total: 1 }) : path.endsWith('/financial-position') ? Promise.reject(new Error('Position unavailable')) : path.includes('/cash-to-cash/transfers') ? Promise.reject(new Error('C2C unavailable')) : Promise.resolve([]));
 const section = await open(); await screen.findByText('Position unavailable'); fireEvent.click(within(section).getByRole('button', { name: 'Load Agent transactions' }));
 expect(await within(section).findByText('Wallet position is unavailable; wallet transfers could not be queried.')).toBeTruthy(); expect(within(section).getByText('Cash-to-Cash transfers are unavailable.')).toBeTruthy();
 expect(within(section).queryByText(/No Cash-to-Cash transfers/)).toBeNull(); expect((ApiClient.get as jest.Mock).mock.calls.some(([path]) => path.startsWith('/wallets/'))).toBe(false);
});

test('malformed and wrong-Agent responses are unavailable rather than empty', async () => {
 (ApiClient.get as jest.Mock).mockImplementation((path: string) => path.startsWith('/internal/agents?') ? Promise.resolve({ data: [agent('one')], total: 1 }) : path.endsWith('/financial-position') ? Promise.resolve(position('one')) : path.startsWith('/wallets/') ? Promise.resolve({ items: [null] }) : path.includes('/cash-to-cash/transfers') ? Promise.resolve({ data: [c2cRow('other')] }) : Promise.resolve([]));
 const section = await open(); await screen.findByText('wallet-one'); fireEvent.click(within(section).getByRole('button', { name: 'Load Agent transactions' }));
 expect(await within(section).findByText('Wallet transfers are unavailable.')).toBeTruthy(); expect(within(section).getByText('Cash-to-Cash transfers are unavailable.')).toBeTruthy(); expect(within(section).queryByText(/No Cash-to-Cash transfers/)).toBeNull();
});

test('late reads for one Agent cannot populate or lock another Agent workspace', async () => {
 let resolve!: (v: unknown) => void; const delayed = new Promise(r => { resolve = r; });
 (ApiClient.get as jest.Mock).mockImplementation((path: string) => path.startsWith('/internal/agents?') ? Promise.resolve({ data: [agent('one'), agent('two')], total: 2 }) : path.includes('/one/financial-position') ? Promise.resolve(position('one')) : path.includes('/two/financial-position') ? Promise.resolve(position('two')) : path.includes('agentId=one') ? delayed : path.includes('agentId=two') ? Promise.resolve({ data: [c2cRow('two')] }) : path.startsWith('/wallets/') ? Promise.resolve({ items: [] }) : Promise.resolve([]));
 const section = await open(); await screen.findByText('wallet-one'); fireEvent.click(within(section).getByRole('button', { name: 'Load Agent transactions' }));
 fireEvent.click(screen.getAllByRole('button', { name: 'View' })[1]); await screen.findByText('wallet-two'); fireEvent.click(screen.getByRole('button', { name: 'Load Agent transactions' })); await screen.findByText('C2C-ONE');
 await act(async () => { resolve({ data: [{ ...c2cRow('one'), reference: 'OLD-AGENT' }] }); await delayed; });
 expect(screen.queryByText('OLD-AGENT')).toBeNull(); expect(screen.getByRole('button', { name: 'Refresh Agent transactions' })).toBeTruthy();
});
