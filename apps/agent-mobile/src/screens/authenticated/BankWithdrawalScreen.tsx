import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { theme } from '../../theme';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { AmountInput } from '../../components/AmountInput';
import { ApiError } from '../../services/api-client';
import { AgentBankWithdrawalApi, type AgentBankBeneficiary } from '../../services/bank-withdrawal';
import { BankDirectoryApi } from '../../services/bank-directory';
import { AgentBankTransferPricingApi, type BankTransferPricing } from '../../services/bank-transfer-pricing';
import { clearPendingAgentBankWithdrawalIntent, isStaleAgentIntent, loadPendingAgentBankWithdrawalIntent, matchesPendingAgentBankIntent, savePendingAgentBankWithdrawalIntent } from '../../services/pending-bank-withdrawal';
import { ApiClient } from '../../services/api-client';
import { formatMinor } from '../../utils/presentation';
import { RootStackParamList } from '../../navigation/types';

type Nav = NativeStackNavigationProp<RootStackParamList, 'BankWithdrawal'>;

function minor(value: string): string | null {
  const match = /^(\d{1,15})(?:\.(\d{0,2}))?$/.exec(value.trim());
  if (!match) return null;
  const result = `${match[1]}${(match[2] ?? '').padEnd(2, '0')}`.replace(/^0+/, '') || '0';
  return result === '0' ? null : result;
}

export const AgentBankWithdrawalScreen: React.FC = () => {
  const navigation = useNavigation<Nav>();
  const [beneficiaries, setBeneficiaries] = useState<AgentBankBeneficiary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [amountStr, setAmountStr] = useState('');
  const [amountMinor, setAmountMinor] = useState(0);
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [pricing, setPricing] = useState<BankTransferPricing | null>(null);
  const [pricingBusy, setPricingBusy] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [bankCode, setBankCode] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [nickname, setNickname] = useState('');
  const [enquiry, setEnquiry] = useState<{ outcome: string; accountName?: string; bankCode: string; accountNumber: string } | null>(null);
  const [result, setResult] = useState<{ commitmentId: string; operationReference: string | null; state: string; replayed?: boolean } | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState(() => `agent-bank-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  const [walletId, setWalletId] = useState<string | undefined>(undefined);
  const [staleIntent, setStaleIntent] = useState<import('../../services/pending-bank-withdrawal').PendingAgentBankWithdrawalIntent | null>(null);
  const [restoredIntent, setRestoredIntent] = useState<import('../../services/pending-bank-withdrawal').PendingAgentBankWithdrawalIntent | null>(null);

  const load = useCallback(async () => {
    setError('');
    try {
      const [bens, wallets] = await Promise.all([
        AgentBankWithdrawalApi.listBankBeneficiaries(),
        (async () => { try { const r = await ApiClient.get<{ id: string }[]>('/agents/me/wallets'); return r; } catch { return []; } })(),
      ]);
      setBeneficiaries(bens);
      const first = Array.isArray(wallets) && wallets[0] ? (wallets[0] as unknown as { id: string }).id : undefined;
      if (first) setWalletId(first);
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed to load.'); }
    finally { setIsLoading(false); }
  }, []);

  const isExactPendingUnresolvedOnServer = useCallback(async (idempotencyKey: string): Promise<boolean> => {
    try {
      const res = await ApiClient.get<{ state: string }>(`/agents/me/banking/bank-transfers/by-idempotency/${encodeURIComponent(idempotencyKey)}`);
      return (res as any)?.state === 'RESERVED';
    } catch (e: unknown) {
      const status = (e as { status?: number })?.status;
      if (status === 404) return false;
      return true;
    }
  }, []);

  const handleClearStale = useCallback(async () => {
    setError('');
    const anchor = staleIntent ?? restoredIntent;
    if (anchor) {
      const unresolved = await isExactPendingUnresolvedOnServer(anchor.idempotencyKey);
      if (unresolved) { setError('This withdrawal is still pending confirmation on the server. Check history or transfer status before clearing. Nothing was discarded.'); return; }
    }
    try { await clearPendingAgentBankWithdrawalIntent('agent'); } catch {}
    setStaleIntent(null); setRestoredIntent(null); setError('');
  }, [staleIntent, restoredIntent, isExactPendingUnresolvedOnServer]);

  useEffect(() => {
    void (async () => {
      try {
        const pending = await loadPendingAgentBankWithdrawalIntent('agent');
        if (pending) { setIdempotencyKey(pending.idempotencyKey); setRestoredIntent(pending); if (isStaleAgentIntent(pending)) setStaleIntent(pending); }
      } catch {}
    })();
  }, []);
  useEffect(() => { void load(); }, [load]);

  const selected = useMemo(() => beneficiaries.find((b) => b.id === selectedId) ?? null, [beneficiaries, selectedId]);

  useEffect(() => {
    const parsed = minor(amountStr);
    if (!parsed || !selected) { setPricing(null); return; }
    setPricingBusy(true);
    AgentBankTransferPricingApi.preview({ beneficiaryId: selected.id, amountMinor: parsed, walletId })
      .then(setPricing).catch(() => setPricing(null)).finally(() => setPricingBusy(false));
  }, [amountStr, selected, walletId]);

  const enquire = async () => {
    setError(''); setEnquiry(null);
    if (!bankCode.trim() || !/^\d{10}$/.test(accountNumber.trim())) { setError('Enter bank and 10-digit account number.'); return; }
    setBusy(true);
    try {
      const r = await BankDirectoryApi.enquire({ bankCode: bankCode.trim().toUpperCase(), accountNumber: accountNumber.trim(), walletId });
      setEnquiry(r as unknown as typeof enquiry);
      if (r.outcome === 'NOT_FOUND') setError('Account not found.');
      if (r.outcome === 'UNAVAILABLE') setError('Verification unavailable, try again.');
    } catch (e) { setError(e instanceof Error ? e.message : 'Enquiry failed.'); }
    finally { setBusy(false); }
  };

  const saveBeneficiary = async () => {
    if (!enquiry || enquiry.outcome !== 'RESOLVED') { setError('Verify first.'); return; }
    setBusy(true); setError('');
    try {
      await AgentBankWithdrawalApi.createBankBeneficiary({ bankCode: enquiry.bankCode, accountNumber: enquiry.accountNumber, nickname: nickname.trim() || undefined, walletId });
      setShowAdd(false); setBankCode(''); setAccountNumber(''); setNickname(''); setEnquiry(null); void load();
    } catch (e) { setError(e instanceof Error ? e.message : 'Save failed.'); }
    finally { setBusy(false); }
  };

  const submit = async () => {
    if (busy) return;
    if (!selected) { setError('Select destination.'); return; }
    const parsed = minor(amountStr);
    if (!parsed) { setError('Enter amount.'); return; }
    if (!/^\d{4,12}$/.test(pin)) { setError('Enter PIN.'); return; }
    let effectiveIdempotencyKey = idempotencyKey;
    let effectiveCreatedAt = restoredIntent?.createdAt ?? (staleIntent ? staleIntent.createdAt : null);
    if (staleIntent || restoredIntent) {
      const anchor = (staleIntent ?? restoredIntent)!;
      const candidate = { walletAccountId: walletId, beneficiaryId: selected!.id, amountMinor: parsed, currency: 'NGN' as const };
      const matches = matchesPendingAgentBankIntent(anchor, candidate);
      if (!matches) {
        const unresolved = await isExactPendingUnresolvedOnServer(anchor.idempotencyKey);
        if (unresolved) { setError('A previous withdrawal is still pending confirmation. Check your history or transfer status before starting a new one. Nothing was sent.'); return; }
        effectiveIdempotencyKey = `agent-bank-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        effectiveCreatedAt = new Date().toISOString();
        setIdempotencyKey(effectiveIdempotencyKey);
      } else {
        effectiveIdempotencyKey = anchor.idempotencyKey;
        effectiveCreatedAt = anchor.createdAt;
        setIdempotencyKey(effectiveIdempotencyKey);
      }
    } else {
      effectiveCreatedAt = new Date().toISOString();
    }
    setBusy(true); setError('');
    const pinSnap = pin; setPin('');
    try {
      await savePendingAgentBankWithdrawalIntent({ agentId: 'agent', beneficiaryId: selected.id, amountMinor: parsed, currency: 'NGN', idempotencyKey: effectiveIdempotencyKey, createdAt: effectiveCreatedAt ?? new Date().toISOString() });
    } catch {
      setError('Could not save recovery information. Nothing was sent.');
      setBusy(false); return;
    }
    try {
      const r = await AgentBankWithdrawalApi.initiate({ walletAccountId: walletId, beneficiaryId: selected.id, amountMinor: parsed, pin: pinSnap }, effectiveIdempotencyKey);
      setResult(r as unknown as typeof result);
      try { await clearPendingAgentBankWithdrawalIntent('agent'); } catch {}
    } catch (e) {
      const status = e instanceof ApiError ? e.status : 0;
      if (status === 401 || status === 403) setError('PIN or session rejected.');
      else if (status === 409 || status === 400) setError(e instanceof ApiError ? e.message : 'Could not complete.');
      else setError('Could not confirm outcome — check history, do not retry blindly.');
    } finally { setBusy(false); }
  };

  if (isLoading) return <View style={styles.loading}><Text>Loading…</Text></View>;
  if (result) {
    return (
      <View style={styles.flex}>
        <ScrollView contentContainerStyle={styles.content}>
          <Card variant="flat"><Text style={styles.title} testID="agent-bank-withdrawal-success">{result.state === 'RESERVED' ? 'Withdrawal authorised' : result.state}</Text><Text selectable>{result.operationReference ?? result.commitmentId}</Text></Card>
          <Button label="Done" onPress={() => navigation.navigate('Home' as never)} />
        </ScrollView>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.flex}>
      <ScrollView contentContainerStyle={styles.content}>
        {!!staleIntent && (
          <Card variant="flat" testID="stale-recovery-banner" style={{ gap: 8 }}>
            <Text style={styles.title}>Unconfirmed withdrawal</Text>
            <Text style={styles.muted}>Amount {formatMinor(staleIntent.amountMinor)} from {new Date(staleIntent.createdAt).toLocaleDateString()}. It may still be processing.</Text>
            <Button label="Resume with same details" onPress={() => { setSelectedId(staleIntent.beneficiaryId); setAmountStr((Number(staleIntent.amountMinor)/100).toString()); }} testID="stale-resume" />
            <Button label="Clear after confirming resolved" onPress={handleClearStale} testID="stale-clear" variant="outline" />
          </Card>
        )}
        <Text style={styles.title}>Withdraw to bank</Text>
        {!!error && <View style={styles.error}><Text style={styles.errorText}>{error}</Text></View>}

        {beneficiaries.length === 0 ? (
          <Card variant="flat"><Text>No verified bank account yet. Add one below.</Text></Card>
        ) : (
          <>
            <Text style={styles.label}>Destination</Text>
            {beneficiaries.map((b) => (
              <TouchableOpacity key={b.id} testID={`beneficiary-${b.id}`} onPress={() => setSelectedId(b.id)} style={[styles.row, b.id === selectedId && styles.active]}>
                <Text>{b.nickname ?? b.displayName}</Text><Text style={styles.muted}>{b.bankCode} · {(b.receivingNumber ?? '').replace(/.(?=.{4})/g, '•')}</Text>
              </TouchableOpacity>
            ))}
          </>
        )}

        <Button label={showAdd ? 'Close' : 'Add bank account'} onPress={() => setShowAdd((v) => !v)} testID="toggle-add-beneficiary" />
        {showAdd && (
          <Card style={{ gap: 8 }}>
            <TextInput placeholder="Bank code" value={bankCode} onChangeText={(v) => setBankCode(v.toUpperCase())} style={styles.input} testID="add-bank-code" autoCapitalize="characters" />
            <TextInput placeholder="10-digit account" value={accountNumber} onChangeText={setAccountNumber} style={styles.input} testID="add-account-number" keyboardType="number-pad" maxLength={10} />
            <TextInput placeholder="Nickname" value={nickname} onChangeText={setNickname} style={styles.input} testID="add-nickname" />
            <Button label={busy ? 'Checking…' : 'Verify'} onPress={enquire} disabled={busy} testID="add-enquire" />
            {enquiry?.outcome === 'RESOLVED' && <Text style={styles.ok} testID="enquiry-account-name">{enquiry.accountName} · {enquiry.bankCode}</Text>}
            <Button label="Save" onPress={saveBeneficiary} disabled={busy || enquiry?.outcome !== 'RESOLVED'} testID="add-save" />
            <Text style={styles.muted}>Only a resolved account can be saved.</Text>
          </Card>
        )}

        <AmountInput label="Amount (NGN)" value={amountStr} inputTestID="bank-amount" onChangeValue={(s, m) => { setAmountStr(s); setAmountMinor(m); }} />
        {pricing && <Card variant="flat" testID="pricing-preview"><Text>Fee {formatMinor(pricing.feeMinor)} · VAT {formatMinor(pricing.vatMinor)} · Total {formatMinor(pricing.totalDebitMinor)}</Text><Text style={styles.muted}>Source {pricing.pricingSource}</Text></Card>}
        {pricingBusy && <Text style={styles.muted}>Loading pricing…</Text>}
        <Text style={styles.label}>Transaction PIN</Text>
        <TextInput testID="bank-pin" style={styles.input} secureTextEntry keyboardType="number-pad" maxLength={12} placeholder="4–12 digits" value={pin} onChangeText={setPin} />
        <Button testID="bank-submit" label="Authorise withdrawal" onPress={submit} loading={busy} disabled={!selected || busy} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: theme.colors.surface.cream },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { padding: theme.spacing.lg, gap: theme.spacing.md },
  title: { fontSize: theme.typography.sizes.xl, fontWeight: '700', color: theme.colors.primary.dark },
  label: { fontSize: theme.typography.sizes.sm, fontWeight: '700', color: theme.colors.neutral.slate, textTransform: 'uppercase' },
  row: { borderWidth: 1, borderColor: theme.colors.surface.hairline, borderRadius: 12, padding: 12, backgroundColor: '#fff', gap: 2 },
  active: { borderColor: theme.colors.primary.main, borderWidth: 2 },
  muted: { color: theme.colors.neutral.slate, fontSize: 12 },
  input: { borderWidth: 1, borderColor: theme.colors.neutral.slate, borderRadius: 10, padding: 12, backgroundColor: '#fff' },
  error: { backgroundColor: theme.colors.feedback.errorLight, borderRadius: 10, padding: 12 },
  errorText: { color: theme.colors.feedback.error },
  ok: { color: theme.colors.feedback.success, fontWeight: '600' },
});
