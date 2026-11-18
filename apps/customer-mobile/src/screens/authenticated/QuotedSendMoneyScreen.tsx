import React, { useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { ApiClient } from '../../services/api-client';
import { SecureStorage } from '../../services/secure-storage';
import { useAuthStore } from '../../store/auth-store';
import { Button } from '../../components/Button';

interface Recipient {
  ownerType: 'CUSTOMER' | 'AGENT';
  ownerId: string;
  walletId: string;
  receivingNumber: string;
  display: string;
  status: string;
}
interface SavedBeneficiary {
  id: string;
  nickname: string;
  receivingNumber: string | null;
  isActive: boolean;
  recipientType?: 'CUSTOMER' | 'AGENT' | null;
  recipientId?: string | null;
}
interface Quote {
  quoteId: string;
  sourceWalletId: string;
  destinationWalletId: string;
  recipientType: 'CUSTOMER' | 'AGENT';
  recipientId: string;
  amountMinor: string;
  feeMinor: string;
  vatMinor: string;
  totalDebitMinor: string;
  currency: string;
  expiresAt: string;
  status: string;
}
interface Receipt {
  id: string;
  status: string;
  paymentReference: string | null;
  completedAt: string | null;
}
interface Pending {
  ownerId: string;
  quote: Quote;
  recipient: Recipient;
  key: string;
}
interface QuoteStatus extends Quote {
  sessionMatches: boolean;
  receipt: Receipt | null;
}

// Decimal string conversion avoids floating point and unsafe integer rounding.
function minor(value: string): string | null {
  const match = /^(\d{1,15})(?:\.(\d{0,2}))?$/.exec(value.trim());
  if (!match) return null;
  const result = `${match[1]}${(match[2] ?? '').padEnd(2, '0')}`.replace(/^0+/, '') || '0';
  return result === '0' ? null : result;
}
function money(value: string): string {
  const v = value.padStart(3, '0');
  return `₦${v.slice(0, -2)}.${v.slice(-2)}`;
}
function validPending(value: unknown, ownerId: string): value is Pending {
  if (!value || typeof value !== 'object') return false;
  const p = value as Pending;
  return (
    p.ownerId === ownerId &&
    typeof p.key === 'string' &&
    !!p.quote &&
    typeof p.quote.quoteId === 'string' &&
    typeof p.quote.amountMinor === 'string' &&
    typeof p.quote.totalDebitMinor === 'string' &&
    typeof p.quote.feeMinor === 'string' &&
    typeof p.quote.vatMinor === 'string' &&
    !!p.recipient &&
    typeof p.recipient.display === 'string'
  );
}

/** One outstanding confirmation per owner. No PIN is persisted or put in navigation state. */
export const QuotedSendMoneyScreen: React.FC = () => {
  const ownerId = useAuthStore((s) => s.customerId);
  // Discard all in-memory recipient, receipt and PIN state when the signed-in owner changes.
  return <QuotedSendMoneyForOwner key={ownerId ?? 'missing'} ownerId={ownerId} />;
};

const QuotedSendMoneyForOwner: React.FC<{ ownerId: string | null | undefined }> = ({ ownerId }) => {
  const navigation = useNavigation<any>();
  const [ready, setReady] = useState(false);
  const [storageError, setStorageError] = useState('');
  const [pending, setPending] = useState<Pending | null>(null);
  const [recipient, setRecipient] = useState<Recipient | null>(null);
  const [identifier, setIdentifier] = useState('');
  const [amount, setAmount] = useState('');
  const [pin, setPin] = useState('');
  const [quote, setQuote] = useState<Quote | null>(null);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [canRetry, setCanRetry] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const [walletId, setWalletId] = useState('');
  const [beneficiaries, setBeneficiaries] = useState<SavedBeneficiary[]>([]);
  const [selectedSaved, setSelectedSaved] = useState<SavedBeneficiary | null>(null);
  const storageKey = `p2p.confirm.${ownerId ?? 'missing'}`;
  const base = '/customers/me';
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        if (!ownerId) throw new Error('Missing signed-in owner');
        const raw = await SecureStorage.getDurable(storageKey);
        if (raw) {
          const value: unknown = JSON.parse(raw);
          if (!validPending(value, ownerId)) throw new Error('Recovery state is unreadable');
          if (alive) {
            // A restored record may belong to a previous login. Require a fresh status
            // check before offering a PIN retry, even when this owner is signed in again.
            setCanRetry(false);
            setPending(value);
            setQuote(value.quote);
            setRecipient(value.recipient);
          }
        }
        try {
          const wallets =
            await ApiClient.get<Array<{ id: string; currency: string; status: string }>>(
              '/customers/me/wallets',
            );
          if (alive)
            setWalletId(
              wallets.find((w) => w.currency === 'NGN' && w.status === 'ACTIVE')?.id ?? '',
            );
        } catch {
          /* Recovery remains accessible even if wallet listing is unavailable. */
        }
        try {
          const list = await ApiClient.get<{ items: SavedBeneficiary[] }>(
            '/customers/me/beneficiaries',
          );
          if (alive) setBeneficiaries(list.items ?? []);
        } catch {
          /* Optional saved recipients; direct lookup remains available. */
        }
      } catch {
        if (alive)
          setStorageError(
            'Recovery storage is unavailable. Do not start another transfer; check history or contact support.',
          );
      } finally {
        if (alive) setReady(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, [ownerId, storageKey]);

  const verify = async () => {
    if (inFlight.current || pending) return;
    inFlight.current = true;
    setBusy(true);
    setError('');
    setRecipient(null);
    setQuote(null);
    try {
      const r = await ApiClient.get<Recipient>(
        `${base}/transfer-recipient?identifier=${encodeURIComponent(identifier.trim())}&currency=NGN`,
      );
      if (r.status !== 'ACTIVE' || !r.walletId || !r.ownerId)
        throw new Error('Recipient unavailable');
      if (
        selectedSaved?.recipientId &&
        (selectedSaved.recipientId !== r.ownerId || selectedSaved.recipientType !== r.ownerType)
      )
        throw new Error('Saved recipient identity changed');
      setRecipient(r);
    } catch {
      setError('Could not verify this recipient. Check the number and try again.');
    } finally {
      setBusy(false);
      inFlight.current = false;
    }
  };
  const saveRecipient = async () => {
    if (inFlight.current || pending || !recipient) return;
    inFlight.current = true;
    setBusy(true);
    setError('');
    try {
      const saved = await ApiClient.post<SavedBeneficiary>('/customers/me/beneficiaries', {
        beneficiaryIdentifier: recipient.receivingNumber,
        nickname: recipient.display,
      });
      setBeneficiaries((items) => [...items.filter((item) => item.id !== saved.id), saved]);
    } catch {
      setError('Could not save this recipient. You can still send using their number.');
    } finally {
      setBusy(false);
      inFlight.current = false;
    }
  };
  const getQuote = async () => {
    if (inFlight.current || pending || !recipient) return;
    const amountMinor = minor(amount);
    if (!amountMinor) {
      setError('Enter an amount greater than zero, with at most two decimal places.');
      return;
    }
    if (!walletId) {
      setError('No active NGN wallet is available.');
      return;
    }
    inFlight.current = true;
    setBusy(true);
    setError('');
    try {
      const q = await ApiClient.post<Quote>(
        `${base}/transfer-quotes`,
        {
          sourceWalletId: walletId,
          destinationWalletId: recipient.walletId,
          ...(selectedSaved?.recipientType && selectedSaved.recipientId
            ? { beneficiaryId: selectedSaved.id }
            : {}),
          amountMinor,
          currency: 'NGN',
        },
        { idempotencyKey: `quote-${Date.now()}-${Math.random().toString(36).slice(2)}` },
      );
      if (
        q.destinationWalletId !== recipient.walletId ||
        q.recipientId !== recipient.ownerId ||
        q.recipientType !== recipient.ownerType ||
        q.amountMinor !== amountMinor ||
        q.currency !== 'NGN'
      )
        throw new Error('Recipient mismatch');
      setQuote(q);
    } catch {
      setError('Could not prepare a transfer quote. Verify the recipient and try again.');
    } finally {
      setBusy(false);
      inFlight.current = false;
    }
  };
  const finish = async (record: Pending, r: Receipt) => {
    if (r.status !== 'COMPLETED') throw new Error('Transfer not completed');
    setReceipt(r);
    try {
      await SecureStorage.removeDurable(storageKey);
      setPending(null);
    } catch {
      setError(
        'Receipt is available, but recovery storage could not be cleared. Check history before sending again.',
      );
    }
  };
  const confirm = async () => {
    if (inFlight.current || !quote || !recipient || !ownerId || !canRetry) return;
    if (!/^\d{4,12}$/.test(pin)) {
      setError('Enter your 4–12 digit transaction PIN.');
      return;
    }
    inFlight.current = true;
    setBusy(true);
    setError('');
    const secret = pin;
    setPin('');
    try {
      const record: Pending = pending ?? {
        ownerId,
        quote,
        recipient,
        key: `confirm:${quote.quoteId}`,
      };
      if (!pending) {
        await SecureStorage.setDurable(storageKey, JSON.stringify(record));
        setPending(record);
      }
      const result = await ApiClient.post<Receipt>(
        `${base}/transfer-quotes/${encodeURIComponent(record.quote.quoteId)}/confirm`,
        { pin: secret },
        { idempotencyKey: record.key, preserveSessionOn401: true },
      );
      await finish(record, result);
    } catch {
      setError(
        'The outcome may be unknown. Check status or retry this exact confirmation; do not start a new transfer.',
      );
    } finally {
      setBusy(false);
      inFlight.current = false;
    }
  };
  const check = async () => {
    if (inFlight.current || !pending) return;
    inFlight.current = true;
    setBusy(true);
    setError('');
    try {
      const status = await ApiClient.get<QuoteStatus>(
        `${base}/transfer-quotes/${encodeURIComponent(pending.quote.quoteId)}`,
      );
      if (status.status === 'USED' && status.receipt) await finish(pending, status.receipt);
      else if (status.status === 'ACTIVE') {
        setCanRetry(status.sessionMatches);
        setError(
          status.sessionMatches
            ? 'Not completed yet. You may retry this same confirmation with your PIN.'
            : 'This quote belongs to an earlier session. Check status again after it expires; confirmation cannot move to a new session.',
        );
      } else if (status.status === 'EXPIRED' && !status.receipt) {
        // Server observed expiry with the quote locked, so this quote can no longer post.
        try {
          await SecureStorage.removeDurable(storageKey);
        } catch {
          setError(
            'Could not clear recovery storage. Check status again before starting another transfer.',
          );
          return;
        }
        setPending(null);
        setQuote(null);
        setPin('');
        setCanRetry(true);
        setError('This quote expired without a completed transfer. Request a new quote.');
      } else
        setError(
          'This quote is no longer active. Check transaction history and contact support before trying again.',
        );
    } catch {
      setError(
        'Status is unavailable for this session. Check history or contact support before trying again.',
      );
    } finally {
      setBusy(false);
      inFlight.current = false;
    }
  };
  const reset = () => {
    if (pending) return;
    setReceipt(null);
    setCanRetry(true);
    setQuote(null);
    setRecipient(null);
    setIdentifier('');
    setAmount('');
    setPin('');
    setError('');
  };
  return (
    <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      <Text style={styles.title}>Send Money</Text>
      {!!storageError && <Text style={styles.error}>{storageError}</Text>}
      {!!error && (
        <Text style={styles.error} testID="send-error">
          {error}
        </Text>
      )}
      {!ready && <Text>Loading recovery state…</Text>}
      {ready && !storageError && !receipt && (
        <>
          {pending && (
            <Text testID="pending-notice">
              A transfer needs recovery. Check its status before retrying a restored confirmation.
              Do not send it again as a new transfer.
            </Text>
          )}
          {!pending && (
            <>
              <Text>Recipient phone or receiving number</Text>
              <TextInput
                testID="recipient-number"
                style={styles.input}
                keyboardType="phone-pad"
                value={identifier}
                onChangeText={(v) => {
                  setIdentifier(v);
                  setSelectedSaved(null);
                  setRecipient(null);
                  setQuote(null);
                }}
              />
              <Button label="Verify recipient" onPress={verify} loading={busy} />
              {beneficiaries
                .filter((b) => b.isActive && b.receivingNumber)
                .map((b) => (
                  <Button
                    key={b.id}
                    label={`Saved: ${b.nickname}`}
                    variant="outline"
                    onPress={() => {
                      setIdentifier(b.receivingNumber!);
                      setSelectedSaved(b);
                      setRecipient(null);
                      setQuote(null);
                    }}
                  />
                ))}
            </>
          )}
          {recipient && (
            <Text testID="recipient-name">
              {recipient.display} · {recipient.ownerType} · {recipient.receivingNumber}
            </Text>
          )}
          {recipient && !pending && (
            <>
              <Button
                label="Save recipient"
                variant="outline"
                onPress={saveRecipient}
                loading={busy}
              />
              <Text>Amount in NGN</Text>
              <TextInput
                testID="send-amount"
                style={styles.input}
                keyboardType="decimal-pad"
                value={amount}
                onChangeText={(v) => {
                  setAmount(v);
                  setQuote(null);
                }}
              />
              <Button label="Review fees" onPress={getQuote} loading={busy} />
            </>
          )}
          {quote && (
            <View style={styles.summary} testID="quote-summary">
              <Text>Amount: {money(quote.amountMinor)}</Text>
              <Text>Fee: {money(quote.feeMinor)}</Text>
              <Text>VAT: {money(quote.vatMinor)}</Text>
              <Text>Total debit: {money(quote.totalDebitMinor)}</Text>
              <Text>Quote expires: {new Date(quote.expiresAt).toLocaleString()}</Text>
              <Text>Transaction PIN</Text>
              <TextInput
                testID="send-pin"
                style={styles.input}
                secureTextEntry
                keyboardType="number-pad"
                maxLength={12}
                value={pin}
                onChangeText={setPin}
              />
              <Button
                label={pending ? 'Retry same confirmation' : 'Confirm transfer'}
                onPress={confirm}
                disabled={!canRetry}
                loading={busy}
              />
            </View>
          )}
          {pending && (
            <Button
              label="Check transfer status"
              variant="outline"
              onPress={check}
              loading={busy}
            />
          )}
        </>
      )}
      {receipt && quote && (
        <View style={styles.summary} testID="transfer-receipt">
          <Text style={styles.title}>Transfer completed</Text>
          <Text>Recipient: {recipient?.display}</Text>
          <Text>Amount: {money(quote.amountMinor)}</Text>
          <Text>Fee: {money(quote.feeMinor)}</Text>
          <Text>VAT: {money(quote.vatMinor)}</Text>
          <Text>Total debit: {money(quote.totalDebitMinor)}</Text>
          <Text>Reference: {receipt.paymentReference ?? receipt.id}</Text>
          <Button
            label="Transaction history"
            variant="outline"
            onPress={() => navigation.navigate('Transactions')}
          />
          {pending && (
            <Button
              label="Check transfer status"
              variant="outline"
              onPress={check}
              loading={busy}
            />
          )}
          {!pending && <Button label="Make another transfer" onPress={reset} />}
        </View>
      )}
    </ScrollView>
  );
};
const styles = StyleSheet.create({
  container: { padding: 20, gap: 12 },
  title: { fontSize: 22, fontWeight: '700' },
  input: { borderWidth: 1, borderColor: '#94A3B8', borderRadius: 8, padding: 12 },
  summary: { gap: 10, padding: 16, backgroundColor: '#E6F0EB', borderRadius: 8 },
  error: { color: '#A00000' },
});
