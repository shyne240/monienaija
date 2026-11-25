import {
  CSV_COLUMNS,
  csvCell,
  csvText,
  exportFileName,
  lagosTimestamp,
  minorUnitsToDecimal,
  neutralizeFormula,
  renderCsv,
  utcTimestamp,
} from './transaction-history-csv';

describe('Transaction history CSV serialisation', () => {
  test('column names are stable and ordered', () => {
    expect(CSV_COLUMNS).toEqual([
      'transaction_reference',
      'product',
      'product_label',
      'status',
      'created_at_lagos',
      'created_at_utc',
      'amount',
      'currency',
      'fee',
      'fee_recorded',
      'business_transaction_id',
    ]);
  });

  test.each([
    ['0', '0.00'],
    ['5', '0.05'],
    ['50', '0.50'],
    ['100', '1.00'],
    ['125000', '1250.00'],
    ['-1250', '-12.50'],
    ['-5', '-0.05'],
    // Beyond Number.MAX_SAFE_INTEGER: a float conversion would round this.
    ['9007199254740993', '90071992547409.93'],
    ['123456789012345678901234567890', '1234567890123456789012345678.90'],
  ])('converts minor units %s exactly to %s', (minor, decimal) => {
    expect(minorUnitsToDecimal(minor)).toBe(decimal);
  });

  test('refuses a non-integer minor amount instead of silently rounding', () => {
    for (const bad of ['1.5', '', 'abc', '1e5', ' 10'])
      expect(() => minorUnitsToDecimal(bad)).toThrow();
  });

  test('Lagos rendering is a fixed UTC+01:00 wall clock, not server time', () => {
    expect(lagosTimestamp('2026-11-24T12:00:00Z')).toBe('2026-11-24 13:00:00');
    // 23:30 Lagos on 24 Nov is 22:30Z — the same Lagos day.
    expect(lagosTimestamp('2026-11-24T22:30:00Z')).toBe('2026-11-24 23:30:00');
    // 23:00Z is already 00:00 on the next Lagos day.
    expect(lagosTimestamp('2026-11-24T23:00:00Z')).toBe('2026-11-25 00:00:00');
    expect(utcTimestamp('2026-11-24T23:00:00Z')).toBe('2026-11-24 23:00:00');
    expect(() => lagosTimestamp('not-a-date')).toThrow();
  });

  test('neutralises every spreadsheet formula trigger, including the tab/CR bypass', () => {
    for (const trigger of ['=', '+', '-', '@', '\t', '\r'])
      expect(neutralizeFormula(`${trigger}cmd`)).toBe(`'${trigger}cmd`);
    // Legitimate values, including an internal hyphen or plus, are untouched.
    for (const safe of ['SYN-C2C-001', 'A+B', 'MONIE 2026', "'already-quoted"])
      expect(neutralizeFormula(safe)).toBe(safe);
  });

  test('quotes delimiters, quotes, newlines and edge whitespace per RFC 4180', () => {
    expect(csvCell('plain')).toBe('plain');
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('line\nbreak')).toBe('"line\nbreak"');
    expect(csvCell('carriage\rreturn')).toBe('"carriage\rreturn"');
    expect(csvCell(' padded')).toBe('" padded"');
    expect(csvText('=1+1,"x"')).toBe(`"'=1+1,""x"""`);
  });

  test('an injected reference cannot break out of its cell or execute', () => {
    const csv = renderCsv([
      {
        id: '11111111-1111-4111-8111-111111111111',
        type: 'CASH_IN',
        status: 'COMPLETED',
        reference: '=HYPERLINK("http://evil.invalid","click")',
        createdAt: '2026-11-24T12:00:00Z',
        amountMinor: '100',
        feeMinor: '0',
        currency: 'NGN',
      },
    ]);
    // Exactly one data row: the embedded comma/quote/newline cannot add lines.
    const lines = csv.replace(/^\uFEFF/, '').split('\r\n');
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain(`"'=HYPERLINK(""http://evil.invalid"",""click"")"`);
    expect(lines[1]).not.toMatch(/(^|,)=/);
    expect(lines[1]).not.toMatch(/(^|,)\+/);
  });

  test('distinguishes an unrecorded fee from a recorded zero fee', () => {
    const base = {
      id: '11111111-1111-4111-8111-111111111111',
      type: 'WALLET_TRANSFER',
      status: 'COMPLETED',
      reference: 'SYN-1',
      createdAt: '2026-11-24T12:00:00Z',
      amountMinor: '250000',
      currency: 'NGN',
    };
    const csv = renderCsv([
      { ...base, feeMinor: null },
      { ...base, id: '22222222-2222-4222-8222-222222222222', feeMinor: '0' },
    ]);
    const [header = '', unrecorded = '', zero = ''] = csv.replace(/^\uFEFF/, '').split('\r\n');
    expect(header).toContain('fee,fee_recorded');
    // fee cell empty, fee_recorded=false
    expect(unrecorded.split(',')).toContain('');
    expect(unrecorded).toContain('SYN-1,WALLET_TRANSFER,Wallet transfer,COMPLETED,');
    expect(unrecorded.endsWith(',false,11111111-1111-4111-8111-111111111111')).toBe(true);
    expect(zero).toContain('2500.00,NGN,0.00,true,');
  });

  test('Excel compatibility: UTF-8 BOM, CRLF, no trailing blank row', () => {
    const one = renderCsv([
      {
        id: '11111111-1111-4111-8111-111111111111',
        type: 'CASH_IN',
        status: 'POSTED',
        reference: 'SYN-1',
        createdAt: '2026-11-24T12:00:00Z',
        amountMinor: '100',
        feeMinor: null,
        currency: 'NGN',
      },
    ]);
    expect(one.startsWith('\uFEFF')).toBe(true);
    expect(one.split('\r\n')).toHaveLength(2);
    expect(one.endsWith('\r\n')).toBe(false);
  });

  test('an empty result still produces a header-only document', () => {
    const csv = renderCsv([]);
    expect(csv.replace(/^\uFEFF/, '').split('\r\n')).toEqual([CSV_COLUMNS.join(',')]);
  });

  test('file names contain no user-controlled characters', () => {
    expect(exportFileName({ from: '2026-11-24', to: '2026-11-25', type: 'CASH_IN' })).toBe(
      'transaction-history_2026-11-24_to_2026-11-25_cash_in.csv',
    );
    expect(exportFileName({})).toBe('transaction-history_all-dates.csv');
    expect(exportFileName({ from: '2026-11-24' })).toBe(
      'transaction-history_2026-11-24_to_now.csv',
    );
    expect(exportFileName({ type: 'BANK_TO_WALLET' })).toBe(
      'transaction-history_all-dates_bank_to_wallet.csv',
    );
  });
});
