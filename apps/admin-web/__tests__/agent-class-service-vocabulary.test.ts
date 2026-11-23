/**
 * Agent class service vocabulary — Admin Web ↔ backend parity.
 *
 * The backend canonical Agent V1 service vocabulary lives in
 * `src/agent/agent-service.enum.ts` (`CANONICAL_AGENT_SERVICES`): WALLET_TRANSFER, CASH_IN,
 * CASH_OUT, CASH_TO_CASH, AGENT_FUNDING, AGENT_DEFUNDING, EXTERNAL_BANK_TRANSFER — with
 * `AGENT_SERVICE_ALIASES` normalizing CASH_TO_WALLET→CASH_IN, WALLET_TO_CASH→CASH_OUT,
 * BANK_TRANSFER / BANK_TRANSFER_OUT→EXTERNAL_BANK_TRANSFER.
 *
 * The Admin Web class editor previously carried only the five cash/funding codes. That had two
 * operational consequences: (1) administrators could not grant WALLET_TRANSFER or
 * EXTERNAL_BANK_TRANSFER, so the fail-closed Agent Mobile home gating could never surface the
 * Send Money / Withdraw-to-bank journeys; and (2) a class record legitimately configured with
 * those backend-canonical tokens was flagged "non-canonical" and the tokens were discarded on
 * save — silently stripping permissions the backend recognizes. These tests lock the aligned
 * vocabulary in.
 */
import {
  CANONICAL_AGENT_SERVICES,
  normalizeApplicableServicesInput,
  summarizeCanonicalServices,
} from '../src/services/ordinary-agent-admin-api';

describe('Admin Web canonical Agent service vocabulary matches the backend enum', () => {
  test('carries exactly the seven backend canonical services', () => {
    const codes = CANONICAL_AGENT_SERVICES.map((service) => service.code);
    expect(codes).toEqual([
      'WALLET_TRANSFER',
      'CASH_IN',
      'CASH_OUT',
      'CASH_TO_CASH',
      'AGENT_FUNDING',
      'AGENT_DEFUNDING',
      'EXTERNAL_BANK_TRANSFER',
    ]);
    // Every option carries an operator-facing label and description (no blank checkbox rows).
    for (const service of CANONICAL_AGENT_SERVICES) {
      expect(service.label.trim().length).toBeGreaterThan(0);
      expect(service.description.trim().length).toBeGreaterThan(0);
    }
  });

  test('WALLET_TRANSFER and EXTERNAL_BANK_TRANSFER load as canonical, never unknown', () => {
    const normalized = normalizeApplicableServicesInput([
      'WALLET_TRANSFER',
      'CASH_IN',
      'EXTERNAL_BANK_TRANSFER',
    ]);
    expect(normalized.canonical).toEqual([
      'WALLET_TRANSFER',
      'CASH_IN',
      'EXTERNAL_BANK_TRANSFER',
    ]);
    expect(normalized.unknownTokens).toEqual([]);
    expect(normalized.legacyAliasesMapped).toEqual([]);
    expect(normalized.nonArrayConfigured).toBe(false);
  });

  test('backend bank-transfer aliases map to EXTERNAL_BANK_TRANSFER instead of being discarded', () => {
    const normalized = normalizeApplicableServicesInput(['BANK_TRANSFER', 'BANK_TRANSFER_OUT']);
    expect(normalized.canonical).toEqual(['EXTERNAL_BANK_TRANSFER']);
    expect(normalized.unknownTokens).toEqual([]);
    expect(normalized.legacyAliasesMapped).toEqual([
      { from: 'BANK_TRANSFER', to: 'EXTERNAL_BANK_TRANSFER' },
      { from: 'BANK_TRANSFER_OUT', to: 'EXTERNAL_BANK_TRANSFER' },
    ]);
  });

  test('genuinely unknown tokens remain flagged (vocabulary is aligned, not permissive)', () => {
    const normalized = normalizeApplicableServicesInput([
      'EXTERNAL_BANK_TRANSFER',
      'UNKNOWN_FREEFORM_SVC',
    ]);
    expect(normalized.canonical).toEqual(['EXTERNAL_BANK_TRANSFER']);
    expect(normalized.unknownTokens).toEqual(['UNKNOWN_FREEFORM_SVC']);
  });

  test('summary renders the extended services for class lists', () => {
    expect(summarizeCanonicalServices(['WALLET_TRANSFER', 'EXTERNAL_BANK_TRANSFER'])).toBe(
      'WALLET_TRANSFER, EXTERNAL_BANK_TRANSFER',
    );
  });
});
