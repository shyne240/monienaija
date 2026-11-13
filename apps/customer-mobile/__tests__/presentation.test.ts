import {
  HIDDEN_BALANCE,
  evidenceLabel,
  formatDateTime,
  formatMinor,
  greetingFor,
  initialsOf,
  isTerminalStatus,
  kycPathwayCopy,
  statusLabel,
  statusTone,
  transactionTypeLabel,
} from '../src/services/presentation';

describe('presentation helpers (ARENA 4 banking surfaces)', () => {
  test('formats minor units as Naira and never invents a value when none was returned', () => {
    expect(formatMinor('250000')).toBe('₦2,500.00');
    expect(formatMinor(0)).toBe('₦0.00');
    expect(formatMinor(null)).toBe('—');
    expect(formatMinor(undefined)).toBe('—');
    expect(formatMinor('not-a-number')).toBe('—');
    expect(HIDDEN_BALANCE).toBe('••••••');
  });

  test('labels statuses without promoting a pending state to success', () => {
    expect(statusLabel('COMPLETED')).toBe('Completed');
    expect(statusLabel('PENDING')).toBe('Pending');
    expect(statusLabel('PENDING_RECOVERY')).toBe('Pending');
    expect(statusLabel('UNCLAIMED')).toBe('Pending');
    expect(statusLabel('FAILED')).toBe('Failed');
    expect(statusLabel('REVERSED')).toBe('Reversed');
    expect(statusTone('COMPLETED')).toBe('SUCCESS');
    expect(statusTone('PENDING_RECOVERY')).toBe('PENDING');
    expect(statusTone('UNCLAIMED')).toBe('PENDING');
    expect(statusTone('EXPIRED')).toBe('EXPIRED');
    expect(statusTone('SUSPENDED')).toBe('SUSPENDED');
  });

  test('knows which statuses are terminal (so unresolved work cannot read as settled)', () => {
    expect(isTerminalStatus('COMPLETED')).toBe(true);
    expect(isTerminalStatus('FAILED')).toBe(true);
    expect(isTerminalStatus('PENDING')).toBe(false);
    expect(isTerminalStatus('PROCESSING')).toBe(false);
    expect(isTerminalStatus('PENDING_RECOVERY')).toBe(false);
    expect(isTerminalStatus(null)).toBe(false);
  });

  test('greets by local hour and derives initials safely', () => {
    expect(greetingFor(8)).toBe('Good morning');
    expect(greetingFor(13)).toBe('Good afternoon');
    expect(greetingFor(21)).toBe('Good evening');
    expect(initialsOf('Amaka Obi')).toBe('AO');
    expect(initialsOf('')).toBe('MN');
    expect(initialsOf(null)).toBe('MN');
  });

  test('formats timestamps and degrades to an em dash on bad input', () => {
    expect(formatDateTime('2026-11-13T10:30:00.000Z')).not.toBe('—');
    expect(formatDateTime('nope')).toBe('—');
    expect(formatDateTime(null)).toBe('—');
  });

  test('translates evidence and transaction codes into human labels', () => {
    expect(evidenceLabel('BVN')).toBe('Bank Verification Number (BVN)');
    expect(evidenceLabel('UTILITY_BILL')).toBe('Utility bill');
    expect(evidenceLabel('SOMETHING_NEW')).toBe('SOMETHING NEW');
    expect(transactionTypeLabel('CASH_IN')).toBe('Cash deposit (agent)');
    expect(transactionTypeLabel(null)).toBe('Transaction');
  });

  test('KYC pathway copy follows the backend status and never promises an upgrade', () => {
    const unavailable = kycPathwayCopy('EVIDENCE_UNAVAILABLE', 'LEVEL_2', 'Tier 1 · Verified');
    expect(unavailable.title).toContain('not yet assessable');
    expect(unavailable.body).toContain('cannot yet assess');
    expect(unavailable.actionLabel).toBe('See what the upgrade needs');

    const top = kycPathwayCopy('TOP_TIER', null, 'Tier 2 · Enhanced');
    expect(top.title).toBe('You are on the highest supported tier');
    expect(top.actionLabel).toBeNull();

    const manual = kycPathwayCopy('MANUAL_REVIEW', 'LEVEL_2', 'Tier 1 · Verified');
    expect(manual.title).toBe('Your verification is under review');

    const unconfigured = kycPathwayCopy('POLICY_NOT_CONFIGURED', 'LEVEL_1', 'Tier 0 · Unverified');
    expect(unconfigured.body).toContain('not published');
    expect(unconfigured.actionLabel).toBeNull();

    // Unknown/undefined pathway must fail closed rather than imply eligibility.
    const unknown = kycPathwayCopy(undefined, 'LEVEL_1', 'Tier 0 · Unverified');
    expect(unknown.title).toBe('Tier requirements are not published yet');
  });
});
