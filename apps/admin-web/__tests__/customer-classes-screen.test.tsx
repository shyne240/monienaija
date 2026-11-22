import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { CustomerClassesScreen } from '../src/screens/authenticated/CustomerClassesScreen';
import { ApiClient } from '../src/services/api-client';
import { useAuthStore } from '../src/store/auth-store';

jest.mock('../src/services/api-client', () => ({
  ApiClient: { get: jest.fn(), post: jest.fn(), patch: jest.fn() },
}));
const record = {
  id: 'id-1',
  code: 'STANDARD',
  name: 'Standard',
  status: 'ACTIVE',
  enabled: true,
  configurationStatus: 'CONFIGURED',
  isDefault: true,
  version: 7,
};
function principal(scopes: string[], readOnlyPrincipal = false) {
  useAuthStore.setState({
    principal: {
      type: 'OPERATOR',
      principalId: 'operator',
      sessionId: 'session',
      audience: 'workforce-admin',
      roles: [],
      scopes,
      customerAccess: 'NONE',
      assuranceLevel: 'MFA',
      readOnlyPrincipal,
    },
  });
}
beforeEach(() => {
  jest.resetAllMocks();
  (ApiClient.get as jest.Mock).mockResolvedValue([record]);
});

test('read-only principal can see classes but cannot edit them', async () => {
  principal(['customer.view', 'customer.manage_classes'], true);
  render(<CustomerClassesScreen />);
  expect(await screen.findByText(/Standard \(STANDARD\)/)).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Create' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Save name' })).toBeNull();
});

test('manager changes a name with optimistic version evidence', async () => {
  principal(['customer.view', 'customer.manage_classes']);
  (ApiClient.patch as jest.Mock).mockResolvedValue({});
  render(<CustomerClassesScreen />);
  const input = await screen.findByLabelText('Edit name for STANDARD');
  fireEvent.change(input, { target: { value: 'Everyday' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save name' }));
  await waitFor(() =>
    expect(ApiClient.patch).toHaveBeenCalledWith('/internal/customer-classes/id-1', {
      name: 'Everyday',
      expectedVersion: 7,
    }),
  );
});
