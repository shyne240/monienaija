import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { CustomerClassAssignmentPanel } from '../src/components/CustomerClassAssignmentPanel';
import { ApiClient } from '../src/services/api-client';

jest.mock('../src/services/api-client', () => ({ ApiClient: { get: jest.fn(), post: jest.fn() } }));
const options = [
  {
    code: 'STANDARD',
    name: 'Standard',
    enabled: true,
    status: 'ACTIVE',
    configurationStatus: 'CONFIGURED',
  },
  {
    code: 'PREMIUM',
    name: 'Premium',
    enabled: true,
    status: 'ACTIVE',
    configurationStatus: 'CONFIGURED',
  },
  {
    code: 'NOT_READY',
    name: 'Unavailable',
    enabled: false,
    status: 'ACTIVE',
    configurationStatus: 'NOT_CONFIGURED',
  },
];
const current = { classCode: 'STANDARD', className: 'Standard', version: 4 };
const history = [
  {
    classCode: 'STANDARD',
    assignmentVersion: 4,
    isActive: true,
    reason: 'Initial assignment',
    createdAt: '2026-01-01',
  },
];
beforeEach(() => {
  jest.resetAllMocks();
  (ApiClient.get as jest.Mock).mockImplementation((path: string) =>
    Promise.resolve(
      path.endsWith('/history') ? history : path.endsWith('/class') ? current : options,
    ),
  );
});

test('shows class and history without edit controls for a viewer', async () => {
  render(<CustomerClassAssignmentPanel customerId="one" canManage={false} />);
  expect(await screen.findByText('Standard (STANDARD)', { selector: 'p' })).toBeTruthy();
  fireEvent.click(screen.getByText('Assignment history'));
  expect(screen.getByText(/Initial assignment/)).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Assign class' })).toBeNull();
});

test('submits the visible assignment version and requires refresh after conflict', async () => {
  (ApiClient.post as jest.Mock).mockRejectedValue(new Error('conflict'));
  render(<CustomerClassAssignmentPanel customerId="one" canManage />);
  await screen.findByText('Standard (STANDARD)', { selector: 'p' });
  expect(screen.queryByRole('option', { name: 'Unavailable (NOT_READY)' })).toBeNull();
  fireEvent.change(screen.getByLabelText(/Target class/), { target: { value: 'PREMIUM' } });
  fireEvent.change(screen.getByLabelText(/Reason/), { target: { value: 'Upgrade' } });
  fireEvent.click(screen.getByRole('button', { name: 'Assign class' }));
  await screen.findByRole('alert');
  expect(ApiClient.post).toHaveBeenCalledWith('/internal/customers/one/class', {
    classCode: 'PREMIUM',
    reason: 'Upgrade',
    expectedVersion: 4,
  });
  expect(screen.queryByRole('button', { name: 'Assign class' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Reload' }));
  await screen.findByRole('button', { name: 'Assign class' });
});

test('late assignment response cannot overwrite the next customer', async () => {
  let finish!: () => void;
  (ApiClient.post as jest.Mock).mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const view = render(<CustomerClassAssignmentPanel customerId="one" canManage />);
  await screen.findByText('Standard (STANDARD)', { selector: 'p' });
  fireEvent.change(screen.getByLabelText(/Target class/), { target: { value: 'PREMIUM' } });
  fireEvent.change(screen.getByLabelText(/Reason/), { target: { value: 'Upgrade' } });
  fireEvent.click(screen.getByRole('button', { name: 'Assign class' }));
  view.rerender(<CustomerClassAssignmentPanel customerId="two" canManage />);
  await screen.findByText('Standard (STANDARD)', { selector: 'p' });
  const callsBefore = (ApiClient.get as jest.Mock).mock.calls.length;
  await act(async () => {
    finish();
    await Promise.resolve();
  });
  await waitFor(() => expect((ApiClient.get as jest.Mock).mock.calls.length).toBe(callsBefore));
  expect(screen.getByText('Standard (STANDARD)', { selector: 'p' })).toBeTruthy();
});
