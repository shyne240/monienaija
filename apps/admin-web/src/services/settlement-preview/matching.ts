import type {
  InternalRecord,
  PreviewResult,
  ProviderRow,
  ReviewItem,
  SettlementMatch,
  StatementEntry,
  TransactionMatch,
} from './types';

/**
 * Provider-neutral matching workflow. No provider field names appear in this file: it consumes the
 * normalised ProviderRow produced by an adapter. Adding a NIBSS adapter therefore needs no change
 * to matching, review or display logic.
 *
 * Read-only rule: this module only compares in-memory rows. It cannot post, retry, refund, update
 * a balance or call an API.
 */

const equivalentStatus = (kind: ProviderRow['kind'], providerStatus: string, internalStatus: string): boolean => {
  const provider = providerStatus.toUpperCase().trim();
  const internal = internalStatus.toUpperCase().trim();
  const groups: Record<string, string[]> = {
    PAID: ['PAID', 'CREDITED', 'COMPLETED', 'SUCCESS', 'SETTLED'],
    OVERPAID: ['OVERPAID'],
    PARTIALLY_PAID: ['PARTIALLY_PAID', 'UNDERPAID'],
    PENDING: ['PENDING', 'UNVERIFIED', 'AWAITING_VERIFICATION'],
    FAILED: ['FAILED'],
    REVERSED: ['REVERSED', 'RETURNED', 'APPROVED_FOR_RETURN'],
    SUCCESS: ['SUCCESS', 'COMPLETED', 'PAID', 'CREDITED'],
    IN_PROGRESS: ['IN_PROGRESS', 'PENDING', 'PENDING_AUTHORIZATION'],
    SETTLEMENT_COMPLETED: ['SETTLEMENT_COMPLETED', 'SETTLED', 'RECONCILED', 'CREDITED', 'COMPLETED'],
  };
  if (provider === internal) return true;
  const aliases = groups[provider] ?? [];
  if (aliases.includes(internal)) return true;
  // Payout rows use SUCCESS while an internal record may keep the collection vocabulary.
  if (kind === 'PAYOUTS' && provider === 'SUCCESS' && internal === 'SUCCESS') return true;
  return false;
};

interface CandidateKey {
  type: 'PROVIDER_TRANSACTION_REFERENCE' | 'NIP_SESSION_ID' | 'MERCHANT_REFERENCE' | 'SETTLEMENT_REFERENCE_WITH_AMOUNT';
  value: string;
}

const candidateKeys = (row: ProviderRow): CandidateKey[] => {
  const keys: CandidateKey[] = [];
  if (row.providerTransactionReference)
    keys.push({ type: 'PROVIDER_TRANSACTION_REFERENCE', value: row.providerTransactionReference });
  if (row.nipSessionId) keys.push({ type: 'NIP_SESSION_ID', value: row.nipSessionId });
  if (row.merchantReference) keys.push({ type: 'MERCHANT_REFERENCE', value: row.merchantReference });
  if (row.settlementReference)
    keys.push({
      type: 'SETTLEMENT_REFERENCE_WITH_AMOUNT',
      value: `${row.settlementReference}|${row.amountMinor}`,
    });
  return keys;
};

const recordsForKey = (key: CandidateKey, record: InternalRecord): boolean => {
  switch (key.type) {
    case 'PROVIDER_TRANSACTION_REFERENCE':
      return record.providerTransactionReference === key.value || record.businessReference === key.value;
    case 'NIP_SESSION_ID':
      return record.nipSessionId === key.value;
    case 'MERCHANT_REFERENCE':
      return record.reference === key.value || record.businessReference === key.value;
    case 'SETTLEMENT_REFERENCE_WITH_AMOUNT': {
      const [reference, amount] = key.value.split('|');
      return record.settlementReference === reference && record.amountMinor === amount;
    }
  }
};

const uniqueById = (records: InternalRecord[]): InternalRecord[] => {
  const seen = new Set<string>();
  return records.filter((record) => {
    if (seen.has(record.id)) return false;
    seen.add(record.id);
    return true;
  });
};

const naturalKey = (row: ProviderRow): string =>
  [
    row.provider,
    row.kind,
    row.providerTransactionReference ?? '',
    row.nipSessionId ?? '',
    row.merchantReference ?? '',
    row.amountMinor,
  ].join('|');

export interface MatchInput {
  rows: ProviderRow[];
  /** Collection rows embedded in a settlement notification, kept distinct from net settlement rows. */
  embeddedCollections?: ProviderRow[];
  internalRecords: InternalRecord[];
  statementEntries: StatementEntry[];
  generatedAt: string;
}

const matchTransactions = (
  rows: ProviderRow[],
  internalRecords: InternalRecord[],
): TransactionMatch[] => {
  const seenDocuments = new Map<string, Set<string>>();
  const seenNaturalKeys = new Map<string, string>();

  return rows.map((row) => {
    const documentKeys =
      seenDocuments.get(row.documentFingerprint) ?? new Set<string>();
    const rowIdentity = `${row.kind}#${row.rowNumber}`;
    const alreadyUploaded = documentKeys.has(rowIdentity);
    documentKeys.add(rowIdentity);
    seenDocuments.set(row.documentFingerprint, documentKeys);

    if (alreadyUploaded) {
      return {
        row,
        outcome: 'DUPLICATE_UPLOAD',
        keyUsed: null,
        reasons: [
          `This document fingerprint (${row.documentFingerprint}) was already uploaded for ${row.kind}. The row was not matched a second time.`,
        ],
        internalRecord: null,
        candidates: [],
        settlementEstablished: false,
      };
    }

    const key = naturalKey(row);
    const priorUpload = seenNaturalKeys.get(key);
    seenNaturalKeys.set(key, `${row.fileName}#${row.rowNumber}`);
    if (priorUpload) {
      return {
        row,
        outcome: 'DUPLICATE_UPLOAD',
        keyUsed: null,
        reasons: [
          `The same provider reference and amount appeared in ${priorUpload}; this row was not counted again.`,
        ],
        internalRecord: null,
        candidates: [],
        settlementEstablished: false,
      };
    }

    const keys = candidateKeys(row);
    if (keys.length === 0) {
      return {
        row,
        outcome: 'UNMATCHED',
        keyUsed: null,
        reasons: ['No documented provider transaction reference, session ID or merchant reference is present.'],
        internalRecord: null,
        candidates: [],
        settlementEstablished: false,
      };
    }

    const matches = new Map<string, InternalRecord[]>();
    for (const candidate of keys) {
      const found = uniqueById(
        internalRecords.filter((record) => recordsForKey(candidate, record)),
      );
      if (found.length > 0) matches.set(candidate.type, found);
    }

    if (matches.size === 0) {
      return {
        row,
        outcome: 'UNMATCHED',
        keyUsed: null,
        reasons: [
          'No scoped internal record carries the provider transaction reference, NIP session ID, merchant reference or settlement/amount pair.',
        ],
        internalRecord: null,
        candidates: [],
        settlementEstablished: false,
      };
    }

    const candidates = uniqueById(Array.from(matches.values()).flat());
    if (candidates.length > 1 || Array.from(matches.values()).some((records) => records.length > 1)) {
      return {
        row,
        outcome: 'AMBIGUOUS',
        keyUsed: Array.from(matches.keys()).join(', '),
        reasons: [
          'More than one internal record matches the available references. Finance review must select the correct record; nothing was auto-resolved.',
          ...Array.from(matches.entries()).map(
            ([type, records]) => `${type} matched ${records.length} internal record(s).`,
          ),
        ],
        internalRecord: null,
        candidates,
        settlementEstablished: false,
      };
    }

    const internalRecord = candidates[0];
    const reasons: string[] = [];
    if (row.amountMinor !== internalRecord.amountMinor)
      reasons.push(
        `Amount mismatch: provider ${row.amountMinor} minor units vs internal ${internalRecord.amountMinor} minor units.`,
      );
    if (!equivalentStatus(row.kind, row.status, internalRecord.status))
      reasons.push(`Status mismatch: provider ${row.status} vs internal ${internalRecord.status}.`);
    if (!row.currency || row.currency !== internalRecord.currency)
      reasons.push(`Currency mismatch: provider ${row.currency} vs internal ${internalRecord.currency}.`);

    return {
      row,
      outcome: reasons.length > 0 ? 'MISMATCH' : 'MATCHED',
      keyUsed: Array.from(matches.keys()).join(', '),
      reasons:
        reasons.length > 0
          ? reasons
          : ['Reference, amount, currency and status agree. This is a transaction match only.'],
      internalRecord,
      candidates: [],
      settlementEstablished: false,
    };
  });
};

const matchSettlements = (
  settlements: ProviderRow[],
  embeddedCollections: ProviderRow[],
  statementEntries: StatementEntry[],
): SettlementMatch[] => {
  if (settlements.length === 0) {
    return [
      {
        settlement: null,
        outcome: 'NOT_PERFORMED',
        reasons: [
          'No settlement report row was uploaded. Transaction matching is not a substitute for net settlement matching.',
        ],
        keyUsed: null,
        statementEntry: null,
        candidates: [],
        expectedNetMinor: null,
      },
    ];
  }

  const seenSettlementRows = new Set<string>();
  return settlements.map((settlement) => {
    const settlementIdentity = `${settlement.documentFingerprint}|${settlement.rowNumber}|${settlement.settlementReference}`;
    if (seenSettlementRows.has(settlementIdentity)) {
      seenSettlementRows.add(settlementIdentity);
      return {
        settlement,
        outcome: 'DUPLICATE_UPLOAD',
        reasons: ['This settlement row was already uploaded in another document; it was not counted again.'],
        keyUsed: null,
        statementEntry: null,
        candidates: [],
        expectedNetMinor: null,
      };
    }
    seenSettlementRows.add(settlementIdentity);
    const expectedRows = embeddedCollections.filter(
      (row) => row.settlementReference === settlement.settlementReference && row.status === 'PAID',
    );
    const expectedNetMinor =
      expectedRows.length > 0
        ? String(
            expectedRows.reduce(
              (sum, row) => sum + Number(row.settlementAmountMinor ?? row.amountMinor),
              0,
            ),
          )
        : null;
    const reasons: string[] = [];
    if (expectedNetMinor !== null && expectedNetMinor !== settlement.amountMinor) {
      reasons.push(
        `Batch composition mismatch: settlement row ${settlement.amountMinor} minor units vs summed settlementAmount ${expectedNetMinor} minor units.`,
      );
    }

    const destination = settlement.settlementDestination?.accountNumber;
    if (!destination) {
      reasons.push(
        'The settlement destination account is absent from the confirmed provider format. Net-to-statement agreement cannot be established.',
      );
      return {
        settlement,
        outcome: 'UNVERIFIED_DESTINATION',
        reasons,
        keyUsed: null,
        statementEntry: null,
        candidates: [],
        expectedNetMinor,
      };
    }
    if (statementEntries.length === 0) {
      reasons.push(
        'No statement lines were supplied. Net settlement-to-statement matching was not performed.',
      );
      return {
        settlement,
        outcome: 'NOT_PERFORMED',
        reasons,
        keyUsed: null,
        statementEntry: null,
        candidates: [],
        expectedNetMinor,
      };
    }

    const byReference = settlement.settlementReference
      ? statementEntries.filter((entry) => entry.settlementReference === settlement.settlementReference)
      : [];
    const byDestination = statementEntries.filter(
      (entry) =>
        entry.destinationAccountNumber === destination && entry.amountMinor === settlement.amountMinor,
    );
    const candidates = Array.from(
      new Map(
        [...byReference, ...byDestination].map((entry) => [entry.id, entry]),
      ).values(),
    );
    const keyUsed = byReference.length > 0 ? 'SETTLEMENT_REFERENCE' : 'DESTINATION_AND_AMOUNT';

    if (candidates.length === 0) {
      reasons.push(
        'No statement line matches the settlement reference or the actual destination account plus net amount.',
      );
      return {
        settlement,
        outcome: 'UNMATCHED',
        reasons,
        keyUsed: null,
        statementEntry: null,
        candidates: [],
        expectedNetMinor,
      };
    }
    if (candidates.length > 1) {
      reasons.push('More than one statement line could represent this net settlement. Finance review is required.');
      return {
        settlement,
        outcome: 'AMBIGUOUS',
        reasons,
        keyUsed,
        statementEntry: null,
        candidates,
        expectedNetMinor,
      };
    }

    const statementEntry = candidates[0];
    if (statementEntry.amountMinor !== settlement.amountMinor)
      reasons.push(
        `Net amount mismatch: provider ${settlement.amountMinor} minor units vs statement ${statementEntry.amountMinor} minor units.`,
      );
    if (statementEntry.currency !== settlement.currency)
      reasons.push(`Currency mismatch: provider ${settlement.currency} vs statement ${statementEntry.currency}.`);
    if (statementEntry.destinationAccountNumber !== destination)
      reasons.push(
        `Destination mismatch: provider ${destination} vs statement ${statementEntry.destinationAccountNumber ?? 'absent'}.`,
      );

    return {
      settlement,
      outcome: reasons.length > 0 ? 'MISMATCH' : 'MATCHED',
      reasons:
        reasons.length > 0
          ? reasons
          : ['Net settlement reference, destination account, currency and amount agree with the statement.'],
      keyUsed,
      statementEntry,
      candidates: [],
      expectedNetMinor,
    };
  });
};

const reviewItems = (
  transactions: TransactionMatch[],
  settlements: SettlementMatch[],
): ReviewItem[] => {
  const items: ReviewItem[] = [];
  transactions.forEach((match) => {
    const reference =
      match.row.providerTransactionReference ??
      match.row.merchantReference ??
      match.row.nipSessionId ??
      `row ${match.row.rowNumber}`;
    if (match.outcome === 'MATCHED') return;
    items.push({
      id: `txn-${match.row.fileName}-${match.row.rowNumber}`,
      category:
        match.outcome === 'DUPLICATE_UPLOAD'
          ? 'DUPLICATE_UPLOAD'
          : match.outcome === 'MISMATCH'
            ? 'MISMATCH'
            : match.outcome,
      severity: match.outcome === 'MISMATCH' ? 'CRITICAL' : 'REVIEW',
      reference,
      detail: match.reasons.join(' '),
    });
  });
  settlements.forEach((match, index) => {
    if (match.outcome === 'MATCHED') return;
    items.push({
      id: `settlement-${match.settlement?.settlementReference ?? index}`,
      category: match.outcome === 'DUPLICATE_UPLOAD' ? 'DUPLICATE_UPLOAD' : 'SETTLEMENT',
      severity: match.outcome === 'MISMATCH' || match.outcome === 'UNVERIFIED_DESTINATION' ? 'CRITICAL' : 'REVIEW',
      reference: match.settlement?.settlementReference ?? 'no settlement row',
      detail: match.reasons.join(' '),
    });
  });
  return items;
};

export const reconcilePreview = ({
  rows,
  embeddedCollections = [],
  internalRecords,
  statementEntries,
  generatedAt,
}: MatchInput): PreviewResult => {
  const transactions = matchTransactions(rows, internalRecords);
  const compositionRows = new Map<string, ProviderRow>();
  for (const row of [...rows.filter((row) => row.kind === 'COLLECTIONS'), ...embeddedCollections]) {
    compositionRows.set(
      `${row.fileName}|${row.rowNumber}|${row.providerTransactionReference ?? row.merchantReference ?? ''}`,
      row,
    );
  }
  const settlements = matchSettlements(
    rows.filter((row) => row.kind === 'SETTLEMENTS'),
    Array.from(compositionRows.values()),
    statementEntries,
  );
  const reviewQueue = reviewItems(transactions, settlements);
  const count = (outcome: TransactionMatch['outcome']) =>
    transactions.filter((match) => match.outcome === outcome).length;
  return {
    generatedAt,
    transactions,
    settlements,
    reviewQueue,
    summary: {
      providerRows: rows.length,
      matched: count('MATCHED'),
      unmatched: count('UNMATCHED'),
      mismatches: count('MISMATCH'),
      ambiguous: count('AMBIGUOUS'),
      duplicateUploads: count('DUPLICATE_UPLOAD'),
      netSettlementMatches: settlements.filter((match) => match.outcome === 'MATCHED').length,
      netSettlementProblems: settlements.filter((match) => match.outcome !== 'MATCHED').length,
      reconciliationEstablished: false,
    },
  };
};
