import 'reflect-metadata';

import { parseUploadFields } from '../src/customer-proof-of-address/customer-proof-of-address.dto';

describe('parseUploadFields', () => {
  const base = {
    residentialAddressId: '14a2a111-a08a-4da7-8ead-0e3dbe480834',
    category: 'UTILITY',
    documentType: 'UTILITY_BILL',
  };

  it('accepts only the allowlisted multipart metadata and normalizes optional values', () => {
    expect(
      parseUploadFields({
        ...base,
        issuerName: '  Abuja Electricity Distribution  ',
        documentDate: '2024-02-29',
        supersedesSubmissionId: '920f2feb-4d6e-4785-a266-0ce11d177e2c',
      }),
    ).toEqual({
      ...base,
      issuerName: 'Abuja Electricity Distribution',
      documentDate: '2024-02-29',
      supersedesSubmissionId: '920f2feb-4d6e-4785-a266-0ce11d177e2c',
    });
  });

  it('rejects invalid UUIDs, calendar dates, oversized values, and unknown multipart fields', () => {
    expect(() =>
      parseUploadFields({ ...base, residentialAddressId: 'other-customer-address' }),
    ).toThrow(/residentialAddressId must be a UUID/);
    expect(() =>
      parseUploadFields({ ...base, supersedesSubmissionId: '../other-document' }),
    ).toThrow(/supersedesSubmissionId must be a UUID/);
    expect(() => parseUploadFields({ ...base, documentDate: '2025-02-29' })).toThrow(
      /valid YYYY-MM-DD calendar date/,
    );
    expect(() => parseUploadFields({ ...base, unexpected: 'value' })).toThrow(
      /Unexpected upload field/,
    );
    expect(() => parseUploadFields({ ...base, issuerName: 'x'.repeat(201) })).toThrow(
      /issuerName is too long/,
    );
  });
});
