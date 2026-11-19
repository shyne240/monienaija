import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { AgentContactCard } from '../src/screens/authenticated/AgentContactCard';
import { ApiClient } from '../src/services/api-client';

jest.mock('../src/services/api-client', () => ({
  ApiClient: { get: jest.fn(), post: jest.fn(), patch: jest.fn() },
}));
const unverified = { registeredPhone: null, verifiedAt: null, smsEnabled: false };
const verified = {
  registeredPhone: '8012345678',
  verifiedAt: '2026-01-01T00:00:00Z',
  smsEnabled: false,
};

beforeEach(() => {
  jest.clearAllMocks();
  (ApiClient.get as jest.Mock).mockResolvedValue(unverified);
  (ApiClient.post as jest.Mock).mockImplementation(async (path: string) => {
    if (path.endsWith('/otp/verify')) return { verificationToken: 'temporary-proof' };
    if (path.endsWith('/contact/phone')) return verified;
    return { status: 'OTP_REQUEST_ACCEPTED' };
  });
  (ApiClient.patch as jest.Mock).mockResolvedValue({ ...verified, smsEnabled: true });
});

test('verifies registered phone via existing OTP and explicitly opts in to SMS', async () => {
  const screen = render(<AgentContactCard />);
  await waitFor(() => expect(ApiClient.get).toHaveBeenCalled());
  fireEvent.changeText(screen.getByTestId('agent-contact-phone'), '08012345678');
  fireEvent.press(screen.getByText('Request verification code'));
  await waitFor(() => expect(screen.getByTestId('agent-contact-code')).toBeTruthy());
  fireEvent.changeText(screen.getByTestId('agent-contact-code'), '123456');
  fireEvent.press(screen.getByText('Verify phone'));
  await waitFor(() => expect(screen.getByText('Verified: 8012345678')).toBeTruthy());
  expect(ApiClient.post).toHaveBeenCalledWith('api/v1/agents/me/contact/phone', {
    phone: '08012345678',
    verificationToken: 'temporary-proof',
  });
  expect(screen.queryByTestId('agent-contact-code')).toBeNull();
  fireEvent.press(screen.getByText('Enable SMS notifications'));
  await waitFor(() => expect(screen.getByText('SMS notifications: Enabled')).toBeTruthy());
  expect(ApiClient.patch).toHaveBeenCalledWith(
    'api/v1/agents/me/contact/notification-preferences',
    { smsEnabled: true },
  );
});

test('editing phone invalidates pending OTP and failed proof does not save a contact', async () => {
  const screen = render(<AgentContactCard />);
  await waitFor(() => expect(ApiClient.get).toHaveBeenCalled());
  fireEvent.changeText(screen.getByTestId('agent-contact-phone'), '08012345678');
  fireEvent.press(screen.getByText('Request verification code'));
  await waitFor(() => expect(screen.getByTestId('agent-contact-code')).toBeTruthy());
  fireEvent.changeText(screen.getByTestId('agent-contact-phone'), '08099999999');
  expect(screen.queryByTestId('agent-contact-code')).toBeNull();
  expect(ApiClient.post).toHaveBeenCalledTimes(1);
  fireEvent.press(screen.getByText('Request verification code'));
  await waitFor(() => expect(screen.getByTestId('agent-contact-code')).toBeTruthy());
  (ApiClient.post as jest.Mock).mockRejectedValueOnce(new Error('invalid code'));
  fireEvent.changeText(screen.getByTestId('agent-contact-code'), '123456');
  fireEvent.press(screen.getByText('Verify phone'));
  await waitFor(() =>
    expect(screen.getByTestId('agent-contact-message').props.children).toContain(
      'could not be completed',
    ),
  );
  expect(screen.queryByTestId('agent-contact-code')).toBeNull();
  expect(
    (ApiClient.post as jest.Mock).mock.calls.some(([path]) => path.endsWith('/contact/phone')),
  ).toBe(false);
});
