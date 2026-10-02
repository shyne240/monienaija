import React from 'react';
import { Share } from 'react-native';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

import {
  AgentReceipt,
  receiptFromCashInResult,
  receiptFromCashToCashResult,
  receiptFromHistoryItem,
} from '../src/components/AgentReceipt';
import type { AgentCashInResult, AgentCashToCashResult, AgentHistoryItem } from '../src/services/agent-api';

const completedResult: AgentCashInResult = {
  status: 'COMPLETED',
  journalId: 'internal-journal-9',
  agentId: 'internal-agent-1',
  recipientCustomerId: 'internal-customer-1',
  recipientReceivingNumber: '8000000001',
  amountMinor: '250000',
  currency: 'NGN',
  idempotencyKey: 'c2w-abc',
  requestHash: 'internal-hash',
  replayed: false,
  reference: 'CASH_IN-c2w-abc',
  createdAt: '2026-06-01T12:30:00.000Z',
};

const completedCashToCashResult: AgentCashToCashResult = {
  status: 'COMPLETED',
  transferId: 'c2c-transfer-uuid',
  journalId: 'internal-journal-10',
  agentId: 'internal-agent-1',
  beneficiaryPhone: '8098765000',
  principalMinor: '500000',
  feeMinor: '0',
  vatMinor: '0',
  totalMinor: '500000',
  currency: 'NGN',
  amountMinor: '500000',
  idempotencyKey: 'c2c-xyz',
  requestHash: 'internal-hash-c2c',
  replayed: false,
  reference: 'CASH_TO_CASH-c2c-xyz',
  createdAt: '2026-06-01T12:30:00.000Z',
  transferCode: 'SECRET_CODE_9999',
};

const SECRET_MARKERS = [
  'transferCode',
  'SECRET_CODE_9999',
  'internal-journal-9',
  'internal-journal-10',
  'internal-customer-1',
  'internal-hash',
  'internal-agent-1',
];

function expectSecretFree(text: string) {
  for (const marker of SECRET_MARKERS) {
    expect(text).not.toContain(marker);
  }
  expect(text).not.toContain('1234'); // never a PIN
  expect(text).not.toContain('4261'); // never an OTP
}

describe('Shared Agent receipt renderer', () => {
  test('C1: completed C2W result renders heading/status/amount/reference/time safely', () => {
    const receipt = receiptFromCashInResult(completedResult, 'Ada Nnaji');
    const { getByTestId, getByText, queryByText } = render(<AgentReceipt receipt={receipt} />);

    expect(getByText('MoneyNaija Agent')).toBeTruthy();
    expect(getByTestId('receipt-heading').props.children).toBe('Cash→Wallet Receipt');
    expect(getByTestId('receipt-status').props.children).toBe('COMPLETED');
    expect(getByText('₦2,500.00 NGN')).toBeTruthy();
    expect(getByText('Ada Nnaji')).toBeTruthy();
    expect(getByText('8000000001')).toBeTruthy();
    expect(getByText('CASH_IN-c2w-abc')).toBeTruthy();
    for (const marker of SECRET_MARKERS) {
      expect(queryByText(new RegExp(marker))).toBeNull();
    }
  });

  test('C1c: completed Cash→Cash result renders safely WITHOUT transferCode', () => {
    const receipt = receiptFromCashToCashResult(completedCashToCashResult);
    const { getByTestId, getByText, queryByText } = render(<AgentReceipt receipt={receipt} />);

    expect(getByText('MoneyNaija Agent')).toBeTruthy();
    expect(getByTestId('receipt-heading').props.children).toBe('Cash→Cash Receipt');
    expect(getByTestId('receipt-status').props.children).toBe('COMPLETED');
    expect(getByText('₦5,000.00 NGN')).toBeTruthy();
    expect(getByText('8098765000')).toBeTruthy();
    expect(getByText('CASH_TO_CASH-c2c-xyz')).toBeTruthy();

    // transferCode must NOT be anywhere in rendered text, view model, or share text:
    expect(queryByText(/SECRET_CODE_9999/)).toBeNull();
    expectSecretFree(JSON.stringify(receipt));
    expectSecretFree(receipt.shareText);
  });

  test('C2: replayed result renders honest REPLAYED state and note', () => {
    const receipt = receiptFromCashInResult({ ...completedResult, status: 'REPLAYED', replayed: true });
    const { getByTestId, getByText } = render(<AgentReceipt receipt={receipt} />);
    expect(getByTestId('receipt-status').props.children).toBe('REPLAYED');
    expect(getByText(/new credit was NOT created/)).toBeTruthy();
  });

  test('C2b: replayed Cash→Cash result renders honest REPLAYED state and note', () => {
    const receipt = receiptFromCashToCashResult({
      ...completedCashToCashResult,
      status: 'REPLAYED',
      replayed: true,
      transferCode: undefined,
    });
    const { getByTestId, getByText } = render(<AgentReceipt receipt={receipt} />);
    expect(getByTestId('receipt-status').props.children).toBe('REPLAYED');
    expect(getByText(/new transfer was NOT created/)).toBeTruthy();
  });

  test('C3: history item receipt includes fee/commission/narration only when authoritative', () => {
    const item: AgentHistoryItem = {
      id: 'id-scm-1', type: 'CASH_TO_CASH', status: 'CLAIMED', amountMinor: '500000', currency: 'NGN',
      direction: 'DEBIT', createdAt: '2026-06-03T09:00:00.000Z', completedAt: '2026-06-03T11:00:00.000Z',
      reference: 'C2C-x1', narration: 'Cash→Cash for 08030000099', feeMinor: '5000',
      counterparty: { type: 'CUSTOMER', beneficiaryPhone: '08030000099' },
      commission: { commissionMinor: '2500', payable: true, treatment: 'ACCRUE' },
      failureCode: null, failureMessage: null,
    };
    const receipt = receiptFromHistoryItem(item);
    const { getByText } = render(<AgentReceipt receipt={receipt} />);
    expect(getByText('Cash→Cash Receipt')).toBeTruthy();
    expect(getByText('CLAIMED')).toBeTruthy();
    expect(getByText('−₦5,000.00 NGN')).toBeTruthy();
    expect(getByText('₦50.00 NGN')).toBeTruthy(); // fee
    expect(getByText('₦25.00 NGN')).toBeTruthy(); // commission
    expect(getByText('Cash→Cash for 08030000099')).toBeTruthy();
  });

  test('C4: missing optional fields are omitted gracefully', () => {
    const item: AgentHistoryItem = {
      id: 'id-x', type: 'CASH_IN', status: 'COMPLETED', amountMinor: '10000', currency: 'NGN',
      direction: 'DEBIT', createdAt: '2026-06-01T08:00:00.000Z', completedAt: null,
      reference: null, narration: null, feeMinor: '0',
      counterparty: { type: 'CUSTOMER' }, commission: null,
      failureCode: null, failureMessage: null,
    };
    const receipt = receiptFromHistoryItem(item);
    const { getByText, queryByText } = render(<AgentReceipt receipt={receipt} />);
    expect(getByText('Cash→Wallet Receipt')).toBeTruthy();
    expect(queryByText('Reference')).toBeNull();
    expect(queryByText('Fee')).toBeNull();
    expect(queryByText('Commission')).toBeNull();
  });

  test('C1b: no PIN/OTP exists anywhere in the receipt architecture (model accepts only safe fields)', () => {
    // Type contract inspection: the view model has no secret keys at all.
    const receipt = receiptFromCashInResult(completedResult);
    const keys = JSON.stringify(Object.keys(receipt)) + JSON.stringify(receipt.lines.map((l) => Object.keys(l)));
    expectSecretFree(keys);
    expectSecretFree(receipt.shareText);
  });

  test('share action asks RN Share with sanitized text only (no image export)', async () => {
    const shareSpy = jest.spyOn(Share, 'share').mockResolvedValueOnce({ action: 'sharedAction' } as never);
    const receipt = receiptFromCashToCashResult(completedCashToCashResult);
    const { getByTestId } = render(<AgentReceipt receipt={receipt} />);
    fireEvent.press(getByTestId('receipt-share'));
    await waitFor(() => expect(shareSpy).toHaveBeenCalled());
    const payload = shareSpy.mock.calls[0]?.[0] as { message: string };
    expect(payload.message).toContain('MoneyNaija — Agent Receipt');
    expect(payload.message).toContain('Status: COMPLETED');
    expectSecretFree(payload.message);
    shareSpy.mockRestore();
  });

  test('E: transferCode-leak guard — even a leaked look-alike field never renders', () => {
    // History items never carry transferCode by contract; assert a hacked row
    // still can't smuggle display-once secrets into the receipt model.
    const hacked = receiptFromHistoryItem({
      id: 'hacked-id', type: 'CASH_TO_CASH', status: 'UNCLAIMED', amountMinor: '100000', currency: 'NGN',
      direction: 'DEBIT', createdAt: '2026-06-04T10:00:00.000Z', completedAt: null,
      reference: 'C2C-h', narration: null, feeMinor: '0',
      counterparty: { type: 'CUSTOMER' }, commission: null,
      failureCode: null, failureMessage: null,
      // @ts-expect-error deliberately polluted fixture simulating a leak attempt
      transferCode: 'ABCD-1234',
    });
    const { queryByText } = render(<AgentReceipt receipt={hacked} />);
    expect(JSON.stringify(hacked)).not.toContain('ABCD-1234');
    expect(queryByText('ABCD-1234')).toBeNull();
  });
});
