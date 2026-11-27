import { BadRequestException } from '@nestjs/common';
import {
  integerMinorString,
  majorDecimalToMinor,
  maskBankAccountNumber,
  sanitizeNarrationMaskingAccounts,
} from '../src/settlement-reconciliation/settlement-reconciliation.types';
import { parseCsvTable } from '../src/settlement-reconciliation/adapters/csv-parser';
import { MonnifySettlementReportAdapter } from '../src/settlement-reconciliation/adapters/monnify-settlement-report.adapter';
import { BankStatementReportAdapter } from '../src/settlement-reconciliation/adapters/bank-statement-report.adapter';
import { NibssSettlementReportAdapter } from '../src/settlement-reconciliation/adapters/nibss-report.adapter';
import { SettlementReportAdapterRegistry } from '../src/settlement-reconciliation/adapters/settlement-report-adapter.registry';
import { RoutePolicyRegistry } from '../src/authorization/route-policy-registry';

describe('Settlement Report & Statement Adapters (Unit)', () => {
  const monnify = new MonnifySettlementReportAdapter();
  const bankStmt = new BankStatementReportAdapter();
  const nibss = new NibssSettlementReportAdapter();
  const registry = new SettlementReportAdapterRegistry([monnify, bankStmt, nibss]);

  describe('maskBankAccountNumber & minor-unit math', () => {
    it('masks raw account numbers to last-4 bullets and never returns full digits', () => {
      expect(maskBankAccountNumber('0123456789')).toBe('••••••6789');
      expect(maskBankAccountNumber('0123-456-789')).toBe('••••••6789');
      expect(maskBankAccountNumber('••••••6789')).toBe('••••••6789');
      expect(maskBankAccountNumber('9876')).toBe('••••••9876');
      expect(maskBankAccountNumber('')).toBeNull();
      expect(maskBankAccountNumber(null)).toBeNull();
      expect(sanitizeNarrationMaskingAccounts('Transfer from 0123456789 to merchant')).toBe(
        'Transfer from ••••••6789 to merchant',
      );
    });

    it('converts major Naira decimals and minor kobo strings accurately without float drift', () => {
      expect(majorDecimalToMinor(10000.55)).toBe('1000055');
      expect(majorDecimalToMinor('₦1,250,000.05')).toBe('125000005');
      expect(integerMinorString('7800000')).toBe('7800000');
      expect(majorDecimalToMinor('10.999')).toBeNull();
      expect(majorDecimalToMinor('abc')).toBeNull();
    });

    it('parses RFC-4180 CSV with UTF-8 BOM, quoted commas, and escaped quotes', () => {
      const csv =
        '\uFEFFTransaction Reference,Amount Paid,Fee,Narration\r\n' +
        'MNFY|01,1000.50,15.00,"Settlement for ""Batch A"", Lagos"\r\n';
      const parsed = parseCsvTable(csv);
      expect(parsed.headers).toEqual([
        'Transaction Reference',
        'Amount Paid',
        'Fee',
        'Narration',
      ]);
      expect(parsed.rows).toHaveLength(1);
      expect(parsed.rows[0]!.values.narration).toBe('Settlement for "Batch A", Lagos');
    });
  });

  describe('Monnify official JSON vs unverified CSV formats', () => {
    it('parses official Monnify Collections API JSON as VERIFIED_OFFICIAL_API_JSON and masks accounts', () => {
      const payload = JSON.stringify({
        requestSuccessful: true,
        responseBody: {
          content: [
            {
              transactionReference: 'MNFY|20261126|000001',
              paymentReference: 'MNJ-B2W-001',
              amountPaid: 10000.0,
              totalPayable: 10000.0,
              settlementAmount: '9850.00',
              fee: 150.0,
              currency: 'NGN',
              paymentStatus: 'PAID',
              paidOn: '2026-11-26 10:15:30.0',
              paymentMethod: 'ACCOUNT_TRANSFER',
              accountDetails: {
                accountNumber: '0123456789',
                bankCode: '058',
                amountPaid: 10000.0,
              },
              destinationAccountInformation: {
                accountNumber: '8012345678',
                bankCode: '50515',
              },
            },
          ],
        },
      });

      const res = monnify.parse({
        reportType: 'COLLECTIONS',
        fileName: 'monnify-collections.json',
        content: payload,
      });

      expect(res.verificationStatus).toBe('VERIFIED_OFFICIAL_API_JSON');
      expect(res.missingSampleNeeded).toBeNull();
      expect(res.validRows).toHaveLength(1);
      expect(res.rejectedRows).toHaveLength(0);

      const row = res.validRows[0]!;
      expect(row.providerTransactionReference).toBe('MNFY|20261126|000001');
      expect(row.paymentReference).toBe('MNJ-B2W-001');
      expect(row.grossAmountMinor).toBe('1000000');
      expect(row.providerFeeMinor).toBe('15000');
      expect(row.netAmountMinor).toBe('985000');
      expect(row.maskedCounterpartyAccount).toBe('••••••6789');
      expect(row.maskedDestinationAccount).toBe('••••••5678');
      expect(JSON.stringify(row.normalizedAttributes)).not.toContain('0123456789');
      expect(JSON.stringify(row.normalizedAttributes)).not.toContain('8012345678');
    });

    it('parses Monnify Payouts JSON including 30-digit NIP sessionId', () => {
      const nipSessionId = '000013261126102030000001234567';
      const payload = JSON.stringify({
        responseBody: [
          {
            transactionReference: 'MFDS|20261126|000777',
            reference: 'MNJ-W2B-777',
            amount: 5000,
            fee: 35,
            currency: 'NGN',
            status: 'SUCCESS',
            sessionId: nipSessionId,
            destinationAccountNumber: '0099887766',
            destinationBankCode: '044',
            createdOn: '2026-11-26T10:20:30.000Z',
          },
        ],
      });

      const res = monnify.parse({
        reportType: 'PAYOUTS',
        fileName: 'payouts.json',
        content: payload,
      });

      expect(res.verificationStatus).toBe('VERIFIED_OFFICIAL_API_JSON');
      expect(res.validRows).toHaveLength(1);
      expect(res.validRows[0]!.nipSessionId).toBe(nipSessionId);
      expect(res.validRows[0]!.grossAmountMinor).toBe('500000');
      expect(res.validRows[0]!.providerFeeMinor).toBe('3500');
      expect(res.validRows[0]!.netAmountMinor).toBe('503500');
      expect(res.validRows[0]!.maskedCounterpartyAccount).toBe('••••••7766');
    });

    it('marks Monnify CSV exports as UNVERIFIED_MISSING_REDACTED_EXPORT and rejects malformed / invalid-currency rows', () => {
      const csv = [
        'Transaction Reference,Payment Reference,Amount Paid,Fee,Settlement Amount,Currency,Payment Status,Paid On,Payer Account Number',
        'MNFY|CSV|01,MNJ-CSV-01,2000.00,30.00,1970.00,NGN,PAID,2026-11-26T09:00:00Z,1122334455',
        'MNFY|CSV|02,MNJ-CSV-02,NOT_A_NUMBER,10.00,0.00,NGN,PAID,2026-11-26T09:05:00Z,1122334455',
        'MNFY|CSV|03,MNJ-CSV-03,500.00,5.00,495.00,NGN_BAD,PAID,2026-11-26T09:10:00Z,1122334455',
      ].join('\n');

      const res = monnify.parse({
        reportType: 'COLLECTIONS',
        fileName: 'monnify-dashboard-export.csv',
        content: csv,
      });

      expect(res.verificationStatus).toBe('UNVERIFIED_MISSING_REDACTED_EXPORT');
      expect(res.missingSampleNeeded).toContain('Transactions');
      expect(res.validRows).toHaveLength(1);
      expect(res.validRows[0]!.maskedCounterpartyAccount).toBe('••••••4455');
      expect(res.rejectedRows).toHaveLength(2);
      expect(res.rejectedRows.map((r) => r.reasonCode)).toEqual(
        expect.arrayContaining(['INVALID_AMOUNT', 'INVALID_CURRENCY']),
      );
      expect(JSON.stringify(res.rejectedRows)).not.toContain('1122334455');
    });
  });

  describe('Commercial Bank Statement & NIBSS planned adapter', () => {
    it('parses bank statement CSV as UNVERIFIED_MISSING_REDACTED_EXPORT and extracts settlementReference from narration', () => {
      const csv = [
        'Value Date,Reference,Narration,Credit,Debit,Running Balance,Currency,Account Number',
        '2026-11-26,BNK-CR-001,MONNIFY SETTLEMENT SET-20261126-A,9850.00,0.00,109850.00,NGN,2030405060',
      ].join('\n');

      const res = bankStmt.parse({
        reportType: 'BANK_STATEMENT',
        fileName: 'gtb-settlement.csv',
        content: csv,
      });

      expect(res.verificationStatus).toBe('UNVERIFIED_MISSING_REDACTED_EXPORT');
      expect(res.validRows).toHaveLength(1);
      expect(res.validRows[0]!.direction).toBe('STATEMENT_CREDIT');
      expect(res.validRows[0]!.netAmountMinor).toBe('985000');
      expect(res.validRows[0]!.settlementReference).toBe('SET-20261126-A');
      expect(res.validRows[0]!.maskedDestinationAccount).toBe('••••••5060');
    });

    it('rejects NIBSS_NIP imports honestly until a verified schedule sample is provided', () => {
      expect(() =>
        nibss.parse({
          reportType: 'SETTLEMENTS',
          fileName: 'nibss.csv',
          content: 'SessionID,Amount\n123,100\n',
        }),
      ).toThrow(BadRequestException);
    });

    it('exposes complete format verification descriptors across MONNIFY, COMMERCIAL_BANK_STATEMENT, and NIBSS_NIP', () => {
      const descriptors = registry.listFormatDescriptors();
      expect(descriptors.some((d) => d.verificationStatus === 'VERIFIED_OFFICIAL_API_JSON')).toBe(
        true,
      );
      expect(
        descriptors.some((d) => d.verificationStatus === 'UNVERIFIED_MISSING_REDACTED_EXPORT'),
      ).toBe(true);
      expect(descriptors.some((d) => d.providerKey === 'NIBSS_NIP' && !d.supported)).toBe(true);
    });

    it('protects all 16 settlement-reconciliation HTTP routes with WORKFORCE_SESSION + ledger.view and blocks customer/agent/aggregator', () => {
      const policyRegistry = new RoutePolicyRegistry();
      const base = '/api/v1/internal/finance-operations/settlement-reconciliation';
      const id = '11111111-1111-4111-8111-111111111111';
      const routes: Array<[string, string]> = [
        ['GET', `${base}/overview`],
        ['GET', `${base}/imports`],
        ['POST', `${base}/imports/preview`],
        ['POST', `${base}/imports`],
        ['GET', `${base}/imports/${id}`],
        ['GET', `${base}/transaction-matches`],
        ['GET', `${base}/transaction-matches/${id}`],
        ['POST', `${base}/transaction-matches/${id}/propose`],
        ['POST', `${base}/transaction-matches/${id}/review`],
        ['GET', `${base}/settlement-batches`],
        ['GET', `${base}/settlement-batches/${id}`],
        ['POST', `${base}/settlement-batches/${id}/propose`],
        ['POST', `${base}/settlement-batches/${id}/review`],
        ['GET', `${base}/return-dispute-cases`],
        ['GET', `${base}/return-dispute-cases/${id}`],
        ['POST', `${base}/return-dispute-cases/${id}/propose`],
        ['POST', `${base}/return-dispute-cases/${id}/review`],
      ];

      for (const [method, url] of routes) {
        const res = policyRegistry.resolve({ method, url });
        expect(res.public).toBe(false);
        expect(res.authenticationMode).toBe('WORKFORCE_SESSION');
        expect(res.policy?.requiredFunctions).toEqual(['ledger.view']);
        expect(res.policy?.customerAccess).toBe('NONE');
        expect(res.policy?.agentAccess).toBe('NONE');
        expect(res.policy?.aggregatorAccess).toBe('NONE');
        expect(res.auditDeniedWorkforceFunction).toBe(true);
      }
    });
  });
});
