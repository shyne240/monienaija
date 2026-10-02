import React from 'react';
import { Share, StyleSheet, Text, View } from 'react-native';

import { theme } from '../theme';
import { Card } from './Card';
import { Button } from './Button';
import type {
  AgentCashInResult,
  AgentCashOutResult,
  AgentCashToCashClaimResult,
  AgentCashToCashResult,
  AgentHistoryItem,
  SafeCashToCashResult,
} from '../services/agent-api';
import { formatNairaFromMinor } from '../utils/format';
import { historyDirectionSign, formatHistoryTimestamp } from './TransactionRow';

/**
 * Shared Agent receipt renderer (V1-AGENT-MOBILE-06, audit dependency RCP-1).
 *
 * Architecture: authoritative server data → small presentation view-model
 * (never persisted; nothing secret) → one Card + optional text-share via the
 * React-Native core `Share` API (no new dependency, no image export).
 *
 * SECURITY RULES enforced by construction:
 *  - The view-model accepts ONLY safe fields; internal ids (row/journal/
 *    wallet/ledger/customer), PIN/OTP/bearer/transferCode values must
 *    never be assigned (types list no such keys and tests assert absence).
 *  - Cash→Cash display-once transferCode is NEVER part of this model.
 *  - Wallet→Cash PINs and OTPs are NEVER part of this model.
 */

export interface AgentReceiptLine {
  label: string;
  value: string;
  selectable?: boolean;
}

export interface AgentReceiptViewModel {
  /** e.g. 'Cash→Wallet Receipt' | 'Cash→Cash Receipt' | 'Wallet→Cash Receipt' */
  heading: string;
  /** Server-verbatim status, e.g. 'COMPLETED' | 'REPLAYED' | 'UNCLAIMED' */
  stateLabel: string;
  stateTone: 'success' | 'warning' | 'info';
  lines: AgentReceiptLine[];
  footerNote?: string;
  /** Text-only share payload — built ONLY from the same safe lines. */
  shareText: string;
}

/** Cash→Wallet result → receipt (covers C2W-11/RCP-1 integration). */
export function receiptFromCashInResult(
  result: AgentCashInResult,
  recipientDisplay?: string,
): AgentReceiptViewModel {
  const replayed = result.replayed === true || result.status === 'REPLAYED';
  const lines: AgentReceiptLine[] = [
    {
      label: 'Amount credited',
      value: `${formatNairaFromMinor(result.amountMinor)} ${result.currency}`,
    },
    ...(recipientDisplay ? [{ label: 'You credited wallet of', value: recipientDisplay }] : []),
    { label: 'Recipient wallet', value: result.recipientReceivingNumber, selectable: true },
  ];
  if (result.reference) {
    lines.push({ label: 'Transaction reference', value: result.reference, selectable: true });
  }
  if (result.createdAt) {
    lines.push({ label: 'Time', value: formatHistoryTimestamp(result.createdAt) });
  }
  if (result.correlationId) {
    lines.push({ label: 'Operation id', value: result.correlationId, selectable: true });
  }

  const note = replayed
    ? 'Idempotent replay — this matched an earlier successful submission; a new credit was NOT created.'
    : 'The server has credited the recipient wallet. Keep physical cash receipts per MoneyNaija policy.';

  return {
    heading: 'Cash→Wallet Receipt',
    stateLabel: replayed ? 'REPLAYED' : result.status,
    stateTone: replayed ? 'info' : 'success',
    lines,
    footerNote: note,
    shareText: buildShareText(
      'Cash→Wallet Receipt',
      replayed ? 'REPLAYED' : result.status,
      lines,
      note,
    ),
  };
}

/** Cash→Cash result → receipt (C2C-8 / RCP-1 integration). transferCode is NEVER included. */
export function receiptFromCashToCashResult(
  result: AgentCashToCashResult | SafeCashToCashResult,
): AgentReceiptViewModel {
  const replayed = result.replayed === true || result.status === 'REPLAYED';
  const lines: AgentReceiptLine[] = [
    {
      label: 'Amount sent',
      value: `${formatNairaFromMinor(result.principalMinor || result.amountMinor)} ${result.currency}`,
    },
    { label: 'Beneficiary phone', value: result.beneficiaryPhone, selectable: true },
  ];
  if (result.feeMinor && result.feeMinor !== '0') {
    lines.push({
      label: 'Fee',
      value: `${formatNairaFromMinor(result.feeMinor)} ${result.currency}`,
    });
  }
  if (result.totalMinor && result.totalMinor !== (result.principalMinor || result.amountMinor)) {
    lines.push({
      label: 'Total debited',
      value: `${formatNairaFromMinor(result.totalMinor)} ${result.currency}`,
    });
  }
  if (result.reference) {
    lines.push({ label: 'Transaction reference', value: result.reference, selectable: true });
  }
  if (result.createdAt) {
    lines.push({ label: 'Time', value: formatHistoryTimestamp(result.createdAt) });
  }
  if (result.correlationId) {
    lines.push({ label: 'Operation id', value: result.correlationId, selectable: true });
  }

  const note = replayed
    ? 'Idempotent replay — this matched an earlier successful submission; a new transfer was NOT created.'
    : 'Funds have been reserved on the electronic ledger. The beneficiary can claim physical cash at an agent outlet.';

  return {
    heading: 'Cash→Cash Receipt',
    stateLabel: replayed ? 'REPLAYED' : result.status,
    stateTone: replayed ? 'info' : 'success',
    lines,
    footerNote: note,
    shareText: buildShareText(
      'Cash→Cash Receipt',
      replayed ? 'REPLAYED' : result.status,
      lines,
      note,
    ),
  };
}

/** Wallet→Cash result → receipt (V1-AGENT-MOBILE-08 / W2C-8). PINs and OTP are NEVER included. */
export function receiptFromCashOutResult(
  result: AgentCashOutResult,
  customerDisplay?: string,
  customerReceivingNumber?: string,
): AgentReceiptViewModel {
  const replayed = result.replayed === true || result.status === 'REPLAYED';
  const lines: AgentReceiptLine[] = [
    {
      label: 'Amount cashed out',
      value: `${formatNairaFromMinor(result.amountMinor)} ${result.currency}`,
    },
    ...(customerDisplay ? [{ label: 'Customer', value: customerDisplay }] : []),
    ...(customerReceivingNumber
      ? [{ label: 'Customer wallet', value: customerReceivingNumber, selectable: true }]
      : []),
  ];
  if (result.reference) {
    lines.push({ label: 'Transaction reference', value: result.reference, selectable: true });
  }
  if (result.createdAt) {
    lines.push({ label: 'Time', value: formatHistoryTimestamp(result.createdAt) });
  }
  if (result.correlationId) {
    lines.push({ label: 'Operation id', value: result.correlationId, selectable: true });
  }

  const note = replayed
    ? 'Idempotent replay — this matched an earlier successful submission; no new debit was created.'
    : 'The customer wallet was debited and your Agent float credited. Physical cash was handed over outside the ledger.';

  return {
    heading: 'Wallet→Cash Receipt',
    stateLabel: replayed ? 'REPLAYED' : result.status,
    stateTone: replayed ? 'info' : 'success',
    lines,
    footerNote: note,
    shareText: buildShareText(
      'Wallet→Cash Receipt',
      replayed ? 'REPLAYED' : result.status,
      lines,
      note,
    ),
  };
}


/** Cash→Cash Claim result → receipt (V1-AGENT-MOBILE-09 / CLM-6). transferCode and OTP are NEVER included. */
export function receiptFromCashToCashClaimResult(
  result: AgentCashToCashClaimResult,
  customerDisplay?: string,
  customerReceivingNumber?: string,
): AgentReceiptViewModel {
  const replayed = result.replayed === true || result.status === 'REPLAYED';
  const lines: AgentReceiptLine[] = [
    {
      label: 'Amount claimed',
      value: `${formatNairaFromMinor(result.principalMinor || result.amountMinor)} ${result.currency}`,
    },
    ...(customerDisplay ? [{ label: 'Beneficiary', value: customerDisplay }] : []),
    {
      label: 'Beneficiary phone',
      value: customerReceivingNumber || result.beneficiaryPhone,
      selectable: true,
    },
  ];
  if (result.reference) {
    lines.push({ label: 'Transaction reference', value: result.reference, selectable: true });
  }
  if (result.claimedAt) {
    lines.push({ label: 'Time', value: formatHistoryTimestamp(String(result.claimedAt)) });
  }
  if (result.correlationId) {
    lines.push({ label: 'Operation id', value: result.correlationId, selectable: true });
  }

  const note = replayed
    ? 'Idempotent replay — this matched an earlier successful claim; no new credit was created.'
    : 'The transfer was claimed to the customer wallet. Physical cash was handed over outside the ledger.';

  return {
    heading: 'Cash→Cash Claim Receipt',
    stateLabel: replayed ? 'REPLAYED' : result.status,
    stateTone: replayed ? 'info' : 'success',
    lines,
    footerNote: note,
    shareText: buildShareText(
      'Cash→Cash Claim Receipt',
      replayed ? 'REPLAYED' : result.status,
      lines,
      note,
    ),
  };
}

/** History item → receipt (RCP-5: receipts re-renderable after restart). */
export function receiptFromHistoryItem(item: AgentHistoryItem): AgentReceiptViewModel {
  const typeLabel =
    {
      CASH_IN: 'Cash→Wallet',
      CASH_OUT: 'Wallet→Cash',
      CASH_TO_CASH: 'Cash→Cash',
      AGENT_FUNDING: 'Agent Funding',
      AGENT_DEFUNDING: 'Agent Defunding',
    }[item.type] ?? item.type;

  const sign = historyDirectionSign(item.direction);
  const lines: AgentReceiptLine[] = [
    { label: 'Amount', value: `${sign}${formatNairaFromMinor(item.amountMinor)} ${item.currency}` },
    { label: 'Type', value: typeLabel },
    { label: 'Initiated', value: formatHistoryTimestamp(item.createdAt) },
  ];
  if (item.completedAt) {
    lines.push({ label: 'Completed', value: formatHistoryTimestamp(item.completedAt) });
  }
  if (item.counterparty?.type === 'CUSTOMER') {
    lines.push({
      label: 'Counterparty',
      value: item.counterparty.beneficiaryPhone
        ? `Customer · beneficiary ${item.counterparty.beneficiaryPhone}`
        : 'Customer wallet',
    });
  } else if (item.counterparty?.type === 'AGGREGATOR') {
    lines.push({ label: 'Counterparty', value: 'Aggregator' });
  } else if (item.counterparty?.type === 'WORKFORCE') {
    lines.push({ label: 'Counterparty', value: 'MoneyNaija Workforce' });
  }
  if (item.reference) {
    lines.push({ label: 'Reference', value: item.reference, selectable: true });
  }
  if (item.feeMinor && item.feeMinor !== '0') {
    lines.push({ label: 'Fee', value: `${formatNairaFromMinor(item.feeMinor)} ${item.currency}` });
  }
  if (item.commission) {
    lines.push({
      label: 'Commission',
      value: `${formatNairaFromMinor(item.commission.commissionMinor)} ${item.currency}`,
    });
  }
  if (item.narration) {
    lines.push({ label: 'Narration', value: item.narration });
  }

  return {
    heading: `${typeLabel} Receipt`,
    stateLabel: item.status,
    stateTone: item.status === 'COMPLETED' || item.status === 'CLAIMED' ? 'success' : 'info',
    lines,
    footerNote: 'Values are server-recorded entries from your Agent history.',
    shareText: buildShareText(`${typeLabel} Receipt`, item.status, lines),
  };
}

function buildShareText(
  heading: string,
  status: string,
  lines: AgentReceiptLine[],
  note?: string,
): string {
  const parts = [
    `MoneyNaija — Agent Receipt`,
    heading,
    `Status: ${status}`,
    ...lines.map((l) => `${l.label}: ${l.value}`),
  ];
  if (note) parts.push(note);
  return parts.join('\n');
}

interface AgentReceiptProps {
  receipt: AgentReceiptViewModel;
  /** Show the text-share action (RN core Share sheet). Default true. */
  showShare?: boolean;
  testID?: string;
}

export const AgentReceipt: React.FC<AgentReceiptProps> = ({
  receipt,
  showShare = true,
  testID,
}) => {
  const handleShare = () => {
    void Share.share({ message: receipt.shareText });
  };

  return (
    <View testID={testID ?? 'agent-receipt'}>
      <Card style={styles.card}>
        <Text style={styles.brand}>MoneyNaija Agent</Text>
        <Text style={styles.heading} testID="receipt-heading">
          {receipt.heading}
        </Text>
        <View
          style={[
            styles.statePill,
            receipt.stateTone === 'success'
              ? styles.stateSuccess
              : receipt.stateTone === 'warning'
                ? styles.stateWarning
                : styles.stateInfo,
          ]}
        >
          <Text style={styles.stateText} testID="receipt-status">
            {receipt.stateLabel}
          </Text>
        </View>

        {receipt.lines.map((line) => (
          <View style={styles.line} key={`${line.label}:${line.value}`}>
            <Text style={styles.lineLabel}>{line.label}</Text>
            <Text
              selectable={line.selectable}
              style={styles.lineValue}
              testID={`receipt-line-${line.label}`}
            >
              {line.value}
            </Text>
          </View>
        ))}

        {receipt.footerNote && (
          <Text style={styles.footer} testID="receipt-footer">
            {receipt.footerNote}
          </Text>
        )}
      </Card>

      {showShare && (
        <Button
          label="Share receipt (text)"
          variant="outline"
          onPress={handleShare}
          testID="receipt-share"
        />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  card: { marginBottom: theme.spacing.md, alignItems: 'stretch' },
  brand: {
    fontSize: theme.typography.sizes.xs,
    fontWeight: theme.typography.weights.bold,
    letterSpacing: 2,
    color: theme.colors.secondary.dark,
    textTransform: 'uppercase',
    marginBottom: 4,
    textAlign: 'center',
  },
  heading: {
    fontSize: theme.typography.sizes.lg,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.primary.main,
    textAlign: 'center',
    marginBottom: theme.spacing.sm,
  },
  statePill: {
    alignSelf: 'center',
    borderRadius: 12,
    paddingVertical: 3,
    paddingHorizontal: theme.spacing.md,
    marginBottom: theme.spacing.md,
  },
  stateSuccess: { backgroundColor: theme.colors.feedback.successLight },
  stateWarning: { backgroundColor: theme.colors.feedback.warningLight },
  stateInfo: { backgroundColor: theme.colors.feedback.infoLight },
  stateText: {
    fontSize: theme.typography.sizes.xs,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.primary.main,
  },
  line: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: theme.spacing.md,
    paddingVertical: theme.spacing.xs,
  },
  lineLabel: {
    fontSize: theme.typography.sizes.sm,
    color: theme.colors.neutral.slate,
    flexShrink: 1,
  },
  lineValue: {
    fontSize: theme.typography.sizes.sm,
    fontWeight: theme.typography.weights.semibold,
    color: theme.colors.neutral.charcoal,
    flexShrink: 1,
    textAlign: 'right',
  },
  footer: {
    marginTop: theme.spacing.sm,
    fontSize: theme.typography.sizes.xs,
    color: theme.colors.neutral.gray,
    lineHeight: 17,
  },
});
