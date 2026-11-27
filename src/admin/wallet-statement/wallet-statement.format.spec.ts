import { BadRequestException } from '@nestjs/common';

import {
  formatMoney,
  formatSignedMoney,
  lagosDateTime,
  lagosDay,
  maskWalletIdentifier,
  minorUnitsToDecimal,
  parseStatementPeriod,
  sanitizeNarration,
  statementFileName,
  statementNarration,
} from './wallet-statement.format';
import { signedOrUnavailable, moneyOrUnavailable } from './wallet-statement.pdf';
import { financialOrUnavailable } from './wallet-statement.service';

/**
 * The rules a customer-facing financial document must never break, pinned in isolation:
 * Lagos day boundaries, integer money arithmetic, identifier masking, and "unavailable is not
 * zero".
 */
describe('Wallet statement formatting', () => {
  describe('Lagos period boundaries', () => {
    test('a Lagos day starts at 23:00Z the previous UTC day', () => {
      const period = parseStatementPeriod('2026-11-24', '2026-11-24');
      expect(period.fromInstant).toBe('2026-11-23T23:00:00.000Z');
      // The end is exclusive at the NEXT Lagos midnight, so `to` is inclusive without a
      // 23:59:59.999999 guess that would drop a posting at exactly midnight.
      expect(period.toInstantExclusive).toBe('2026-11-24T23:00:00.000Z');
    });

    test('an inclusive multi-day period spans whole Lagos days', () => {
      const period = parseStatementPeriod('2026-11-01', '2026-11-30');
      expect(period.fromInstant).toBe('2026-10-31T23:00:00.000Z');
      expect(period.toInstantExclusive).toBe('2026-11-30T23:00:00.000Z');
    });

    test('a leap day is a real date and an impossible one is refused', () => {
      expect(parseStatementPeriod('2024-02-29', '2024-02-29').fromInstant).toBe(
        '2024-02-28T23:00:00.000Z',
      );
      expect(() => parseStatementPeriod('2026-02-30', '2026-03-01')).toThrow(BadRequestException);
      expect(() => parseStatementPeriod('2026-13-01', '2026-03-01')).toThrow(BadRequestException);
      expect(() => parseStatementPeriod('24-11-2026', '2026-11-24')).toThrow(BadRequestException);
    });

    test('a reversed or over-long period is refused rather than silently adjusted', () => {
      expect(() => parseStatementPeriod('2026-11-25', '2026-11-24')).toThrow(
        'The statement period is reversed',
      );
      expect(() => parseStatementPeriod('2024-01-01', '2026-01-01')).toThrow(
        'A statement covers at most 366 days; choose a shorter period',
      );
      expect(() => parseStatementPeriod('2024-01-01', '2024-12-31')).not.toThrow();
    });

    test('an instant renders on its Lagos day, not its UTC day', () => {
      // 23:30Z on the 24th is 00:30 Lagos on the 25th.
      expect(lagosDay('2026-11-24T23:30:00.000Z')).toBe('2026-11-25');
      expect(lagosDateTime('2026-11-24T23:30:00.000Z')).toBe('2026-11-25 00:30');
      expect(lagosDateTime('2026-11-23T23:00:00.000Z')).toBe('2026-11-24 00:00');
    });
  });

  describe('money arithmetic', () => {
    test.each([
      ['0', '0.00'],
      ['5', '0.05'],
      ['100', '1.00'],
      ['125000', '1250.00'],
      ['-1250', '-12.50'],
      // Beyond Number.MAX_SAFE_INTEGER: a float conversion would round this.
      ['9007199254740993', '90071992547409.93'],
    ])('minor units %s render as %s', (minor, expected) => {
      expect(minorUnitsToDecimal(minor)).toBe(expected);
    });

    test('grouping is exact for large amounts', () => {
      expect(formatMoney('123456789', 'NGN')).toBe('NGN 1,234,567.89');
      expect(formatMoney('0', 'NGN')).toBe('NGN 0.00');
      expect(formatMoney('-50000', 'NGN')).toBe('-NGN 500.00');
    });

    test('a debit is parenthesised so direction is never ambiguous', () => {
      expect(formatSignedMoney('250000', 'NGN')).toBe('NGN 2,500.00');
      expect(formatSignedMoney('-250000', 'NGN')).toBe('(NGN 2,500.00)');
    });

    test('non-integer input is refused instead of coerced', () => {
      expect(() => minorUnitsToDecimal('12.50')).toThrow('Minor units must be an integer string');
    });
  });

  describe('unavailable is never zero', () => {
    test('every renderer prints Unavailable for a null figure', () => {
      expect(moneyOrUnavailable(null, 'NGN')).toBe('Unavailable');
      expect(signedOrUnavailable(null, 'NGN')).toBe('Unavailable');
      expect(financialOrUnavailable(null, 'NGN')).toBe('Unavailable');
    });

    test('a genuine zero balance still prints as zero', () => {
      expect(moneyOrUnavailable('0', 'NGN')).toBe('NGN 0.00');
      expect(financialOrUnavailable('0', 'NGN')).toBe('NGN 0.00');
    });
  });

  describe('wallet identifier masking', () => {
    test('only the last four characters survive', () => {
      const walletId = '8f14e45f-ceea-467a-9a3c-1b2d3e4f5a6b';
      const masked = maskWalletIdentifier(walletId);
      expect(masked).toBe('•••• 5A6B');
      expect(masked).not.toContain('8f14e45f');
      expect(masked).not.toContain('ceea');
    });

    test('a value that is not an identifier is fully masked rather than echoed', () => {
      expect(maskWalletIdentifier('not-a-uuid')).toBe('••••');
      expect(maskWalletIdentifier('')).toBe('••••');
    });
  });

  describe('narration sanitisation', () => {
    test('internal identifiers, emails and long digit runs never reach the page', () => {
      const narration =
        'Cash→Wallet 500 NGN from Agent 3f1c6b2a-1111-4222-8333-444455556666 to Customer 9988776655443322';
      const cleaned = sanitizeNarration(narration);
      expect(cleaned).not.toContain('3f1c6b2a');
      expect(cleaned).not.toContain('9988776655443322');
      expect(cleaned).toContain('Cash→Wallet 500 NGN');
    });

    test('dotted key paths collapse to one placeholder, not a fragment', () => {
      const cleaned = sanitizeNarration(
        'Reversal of journal j.3f1c6b2a-1111-4222-8333-444455556666 failed',
      );
      expect(cleaned).toBe('Reversal of journal [withheld] failed');
    });

    test('email addresses are withheld', () => {
      expect(sanitizeNarration('Contact ada@example.com about this')).toBe(
        'Contact [withheld] about this',
      );
    });

    test('ordinary business narration survives intact', () => {
      expect(sanitizeNarration('Wallet transfer to Ada Obi')).toBe('Wallet transfer to Ada Obi');
      expect(sanitizeNarration('CASH_IN-CASH_IN-4f1a2b')).toBe('CASH_IN-CASH_IN-4f1a2b');
    });

    test('empty or absent narration becomes null rather than an empty cell', () => {
      expect(sanitizeNarration('   ')).toBeNull();
      expect(sanitizeNarration(null)).toBeNull();
      expect(sanitizeNarration(undefined)).toBeNull();
    });

    test('narration is bounded', () => {
      expect(sanitizeNarration('a'.repeat(400))?.length).toBe(240);
    });

    test('a reversal never prints the operator note that explains it', () => {
      // Reversals store the reviewer's reason as the journal description: an internal note.
      expect(
        statementNarration({
          description: 'Suspected fraud — confirmed by compliance on 12 Nov, case #4471',
          reversalOfJournalId: '5b1c2d3e-0000-4000-8000-000000000000',
        }),
      ).toBe('Reversal of an earlier posting');
    });

    test('a normal journal renders its sanitised narration', () => {
      expect(
        statementNarration({
          description: 'Wallet transfer to Ada Obi',
          reversalOfJournalId: null,
        }),
      ).toBe('Wallet transfer to Ada Obi');
    });
  });

  test('the file name identifies the wallet by its mask, never by its id', () => {
    const name = statementFileName({
      walletId: '8f14e45f-ceea-467a-9a3c-1b2d3e4f5a6b',
      from: '2026-11-01',
      to: '2026-11-30',
    });
    expect(name).toBe('monienaija-wallet-statement-5A6B-2026-11-01_2026-11-30.pdf');
    expect(name).not.toContain('8f14e45f');
  });
});
