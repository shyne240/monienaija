import React from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { NotificationTemplateWorkspace } from '../src/components/NotificationTemplateWorkspace';
import { BASELINE_CODE_EVENT_CATALOGUE, BASELINE_CODE_TEMPLATES, deriveNotificationPermissions } from '../src/services/notification-domain';
import { NotificationManagementApi } from '../src/services/notification-management-api';
import { WorkforcePrincipal } from '../src/store/auth-store';

const principal: WorkforcePrincipal = { type: 'OPERATOR', principalId: 'synthetic', sessionId: 'synthetic', audience: 'workforce-admin', roles: ['SUPER_ADMIN'], scopes: ['notification.view_deliveries'], customerAccess: 'NONE', assuranceLevel: 'MFA' };
const props = { channel: 'SMS' as const, events: BASELINE_CODE_EVENT_CATALOGUE, templates: BASELINE_CODE_TEMPLATES, templatesRegistryBlocked: true, emailChannelBlocked: false, permissions: deriveNotificationPermissions(principal), currentPrincipalId: principal.principalId, initialEventType: 'transfer.completed' };

afterEach(() => jest.restoreAllMocks());

test('code reference versions never claim confirmed runtime activation when registry is unavailable', () => {
  render(<NotificationTemplateWorkspace {...props} />);
  expect(screen.getByText(/Active SMS: Not confirmed/)).toBeTruthy();
  expect(screen.getByText('REFERENCE · activation unconfirmed')).toBeTruthy();
  expect(within(screen.getByTestId('template-version-history-table')).queryByText('ACTIVE')).toBeNull();
});

test('a late server preview cannot replace the preview of an edited draft', async () => {
  let resolve!: (value: any) => void;
  const pending = new Promise<any>(r => { resolve = r; });
  jest.spyOn(NotificationManagementApi, 'previewTemplate').mockReturnValue(pending);
  render(<NotificationTemplateWorkspace {...props} templatesRegistryBlocked={false} />);
  fireEvent.click(screen.getByRole('button', { name: 'Verify via Server Preview' }));
  fireEvent.change(screen.getByLabelText(/SMS Message Body/), { target: { value: 'New draft {{reference}}' } });
  await act(async () => { resolve({ status: 'LIVE', data: { renderedBody: 'STALE SERVER CONTENT', renderedSubject: null, usedVariables: [], warnings: [] } }); await pending; });
  expect(screen.queryByText('STALE SERVER CONTENT')).toBeNull();
  expect(screen.getByRole('button', { name: 'Verify via Server Preview' })).toBeTruthy();
});

test('read-only notification principals retain read access but cannot mutate any notification surface', () => {
  const perms = deriveNotificationPermissions({ ...principal, roles: ['SUPER_ADMIN', 'FINANCE_CONTROLLER'], readOnlyPrincipal: true, scopes: ['notification.view_deliveries', 'notification.manage_templates', 'notification.approve_templates', 'notification.manage_configuration', 'notification.approve_configuration', 'notification.provider.view', 'notification.provider.configure', 'notification.test_send', 'privileged:approve'] });
  expect(perms.canViewDeliveries).toBe(true); expect(perms.canViewProviderConfig).toBe(true);
  for (const key of ['canManageTemplates','canApproveTemplates','canManageConfiguration','canApproveConfiguration','canProposeProviderConfig','canApproveProviderConfig','canActivateProviderConfig','canTestSend','canUseWorkforceApprovalEndpoint'] as const) expect(perms[key]).toBe(false);
});
