/**
 * PostgreSQL unique-constraint fragments used to map receiving-number
 * issuance races deterministically. Kept together so the migration and the
 * service cannot silently drift apart.
 */
export const RECEIVING_NUMBER_ISSUE_UNIQUE_VIOLATION_NUMBERS =
  'uq_customer_receiving_numbers_number';
export const RECEIVING_NUMBER_ISSUE_UNIQUE_VIOLATION_WALLETS =
  'uq_customer_receiving_numbers_active_wallet';
