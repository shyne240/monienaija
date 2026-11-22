import { canAccessAdminView } from '../src/screens/authenticated/navigation-access';

/**
 * ARENA 4 navigation must be gated by exactly the catalogue functions the backend enforces on the
 * corresponding route policy; a menu entry the API would reject (or a hidden entry that would work)
 * is a defect.
 */
const allowed = (view: Parameters<typeof canAccessAdminView>[0], scopes: string[]) =>
  canAccessAdminView(view, scopes, []);

describe('ARENA 4 administrative operations navigation', () => {
  test('notification operations requires notification.view_deliveries', () => {
    expect(allowed('notificationOperations', ['notification.view_deliveries'])).toBe(true);
    expect(allowed('notificationOperations', ['notification.provider.view'])).toBe(false);
    expect(allowed('notificationOperations', ['audit.view'])).toBe(false);
  });

  test('workforce directory requires workforce.role.view', () => {
    expect(allowed('workforceDirectory', ['workforce.role.view'])).toBe(true);
    expect(allowed('workforceDirectory', ['workforce.user.view'])).toBe(false);
  });

  test('audit inspection requires both audit.view and audit.search', () => {
    expect(allowed('auditInspection', ['audit.view', 'audit.search'])).toBe(true);
    expect(allowed('auditInspection', ['audit.view'])).toBe(false);
    expect(allowed('auditInspection', ['audit.search'])).toBe(false);
  });

  test('an empty session sees none of the ARENA 4 surfaces', () => {
    for (const view of [
      'notificationOperations',
      'workforceDirectory',
      'auditInspection',
    ] as const) {
      expect(allowed(view, [])).toBe(false);
    }
  });
});
