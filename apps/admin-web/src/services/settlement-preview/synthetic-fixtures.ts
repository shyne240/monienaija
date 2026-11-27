/**
 * Synthetic preview fixtures. Every value here is invented for demonstration and tests; no real
 * customer, account, transaction, journal or provider record is represented.
 */

export const SYNTHETIC_COLLECTIONS = JSON.stringify(
  {
    eventType: 'SUCCESSFUL_TRANSACTION',
    eventData: {
      product: { reference: 'B2W-DEMO-0001', type: 'RESERVED_ACCOUNT' },
      transactionReference: 'MNFY|DEMO|20261125101500|000001',
      paymentReference: 'B2W-DEMO-0001',
      paidOn: '25/11/2026 10:15:00 AM',
      paymentSourceInformation: [
        { bankCode: '999', amountPaid: 12500, accountName: 'DEMO PAYER', sessionId: 'NIPDEMO0001', accountNumber: '0000000001' },
      ],
      destinationAccountInformation: { bankCode: '999', bankName: 'Demo Bank', accountNumber: '9000001234' },
      amountPaid: 12500,
      totalPayable: 12500,
      currency: 'NGN',
      settlementAmount: '12450.00',
      paymentMethod: 'ACCOUNT_TRANSFER',
      paymentStatus: 'PAID',
      customer: { name: 'SYNTHETIC CUSTOMER', email: 'synthetic@example.invalid' },
    },
  },
  null,
  2,
);

export const SYNTHETIC_PAYOUTS = JSON.stringify(
  {
    eventType: 'SUCCESSFUL_DISBURSEMENT',
    eventData: {
      amount: 5000,
      transactionReference: 'MFDS|DEMO|20261125113000|000001',
      reference: 'PAYDEMO0001',
      fee: 25,
      destinationAccountNumber: '0000000002',
      destinationAccountName: 'SYNTHETIC RECIPIENT',
      destinationBankCode: '999',
      destinationBankName: 'Demo Bank',
      sessionId: 'NIPPAY0001',
      createdOn: '25/11/2026 11:30:00 AM',
      completedOn: '25/11/2026 11:30:08 AM',
      narration: 'Synthetic payout',
      currency: 'NGN',
      status: 'SUCCESS',
    },
  },
  null,
  2,
);

export const SYNTHETIC_SETTLEMENTS = JSON.stringify(
  {
    eventType: 'SETTLEMENT',
    eventData: {
      amount: '25800.00',
      settlementTime: '25/11/2026 10:00:00 PM',
      settlementReference: 'SETDEMO0001',
      destinationAccountNumber: '9000001234',
      destinationAccountName: 'SYNTHETIC MERCHANT',
      destinationBankName: 'Demo Bank',
      destinationBankCode: '999',
      transactionsCount: 3,
      transactions: [
        {
          transactionReference: 'MNFY|DEMO|20261125101500|000001',
          paymentReference: 'B2W-DEMO-0001',
          paidOn: '25/11/2026 10:15:00 AM',
          amountPaid: '12500.00',
          totalPayable: '12500.00',
          settlementAmount: '12450.00',
          currency: 'NGN',
          paymentMethod: 'ACCOUNT_TRANSFER',
          paymentStatus: 'PAID',
        },
        {
          transactionReference: 'MNFY|DEMO|20261125101800|000002',
          paymentReference: 'B2W-DEMO-0002',
          paidOn: '25/11/2026 10:18:00 AM',
          amountPaid: '7500.00',
          totalPayable: '7500.00',
          settlementAmount: '7400.00',
          currency: 'NGN',
          paymentMethod: 'ACCOUNT_TRANSFER',
          paymentStatus: 'PAID',
        },
        {
          transactionReference: 'MNFY|DEMO|20261125101900|000003',
          paymentReference: 'B2W-DEMO-0003',
          paidOn: '25/11/2026 10:19:00 AM',
          amountPaid: '6000.00',
          totalPayable: '6000.00',
          settlementAmount: '5950.00',
          currency: 'NGN',
          paymentMethod: 'ACCOUNT_TRANSFER',
          paymentStatus: 'PAID',
        },
      ],
    },
  },
  null,
  2,
);

export const SYNTHETIC_INTERNAL_SNAPSHOT = JSON.stringify(
  [
    {
      id: 'intake-demo-1',
      reference: 'B2W-DEMO-0001',
      businessReference: 'B2W-DEMO-0001',
      providerTransactionReference: 'MNFY|DEMO|20261125101500|000001',
      nipSessionId: 'NIPDEMO0001',
      amountMinor: '1250000',
      currency: 'NGN',
      status: 'CREDITED',
      type: 'BANK_TO_WALLET',
      journalId: 'journal-demo-1',
      institutionId: 'INST-DEMO',
    },
    {
      id: 'intake-demo-2',
      reference: 'B2W-DEMO-0002',
      businessReference: 'B2W-DEMO-0002',
      providerTransactionReference: 'MNFY|DEMO|20261125101800|000002',
      amountMinor: '700000',
      currency: 'NGN',
      status: 'CREDITED',
      type: 'BANK_TO_WALLET',
      journalId: 'journal-demo-2',
      institutionId: 'INST-DEMO',
    },
    {
      id: 'intake-demo-3a',
      reference: 'B2W-DEMO-0003',
      providerTransactionReference: 'MNFY|DEMO|20261125101900|000003',
      amountMinor: '600000',
      currency: 'NGN',
      status: 'CREDITED',
      type: 'BANK_TO_WALLET',
      journalId: 'journal-demo-4',
      institutionId: 'INST-DEMO',
    },
    {
      id: 'intake-demo-3b',
      reference: 'B2W-DEMO-0003',
      providerTransactionReference: 'MNFY|DEMO|20261125101900|000003',
      amountMinor: '600000',
      currency: 'NGN',
      status: 'CREDITED',
      type: 'BANK_TO_WALLET',
      journalId: 'journal-demo-5',
      institutionId: 'INST-DEMO',
    },
    {
      id: 'payout-demo-1',
      reference: 'PAYDEMO0001',
      providerTransactionReference: 'MFDS|DEMO|20261125113000|000001',
      nipSessionId: 'NIPPAY0001',
      amountMinor: '500000',
      currency: 'NGN',
      status: 'SUCCESS',
      type: 'WALLET_TO_BANK',
      journalId: 'journal-demo-3',
      institutionId: 'INST-DEMO',
    },
  ],
  null,
  2,
);

export const SYNTHETIC_STATEMENT = JSON.stringify(
  [
    {
      id: 'statement-demo-1',
      date: '2026-11-25',
      amountMinor: '2580000',
      currency: 'NGN',
      settlementReference: 'SETDEMO0001',
      destinationAccountNumber: '9000001234',
      narration: 'Synthetic Monnify net settlement',
    },
  ],
  null,
  2,
);

export const SYNTHETIC_FILES = [
  { name: 'synthetic-collections.json', content: SYNTHETIC_COLLECTIONS },
  { name: 'synthetic-payouts.json', content: SYNTHETIC_PAYOUTS },
  { name: 'synthetic-settlements.json', content: SYNTHETIC_SETTLEMENTS },
] as const;
