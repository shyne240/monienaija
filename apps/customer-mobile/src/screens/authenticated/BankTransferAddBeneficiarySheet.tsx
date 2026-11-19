import React, { useCallback, useEffect, useState } from 'react';
import { FlatList, StyleSheet, Text, TextInput, View } from 'react-native';

import { theme } from '../../theme';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { BankDirectoryApi, type BankDirectoryEntry, type AccountEnquiryResult } from '../../services/bank-directory';

export type AddBeneficiaryResult = { id: string; accountName: string; bankCode: string; accountNumber: string };

export const BankTransferAddBeneficiarySheet: React.FC<{
  walletId?: string;
  onCreated: (r: AddBeneficiaryResult) => void;
  onCancel: () => void;
  create: (input: { bankCode: string; accountNumber: string; nickname?: string; walletId?: string }) => Promise<{ id: string; accountName: string }>;
}> = ({ walletId, onCreated, onCancel, create }) => {
  const [banks, setBanks] = useState<BankDirectoryEntry[]>([]);
  const [search, setSearch] = useState('');
  const [bankCode, setBankCode] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [nickname, setNickname] = useState('');
  const [enquiry, setEnquiry] = useState<AccountEnquiryResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async (q?: string) => {
    try { setBanks(await BankDirectoryApi.list(q)); } catch { /* ignore */ }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { const t = setTimeout(() => void load(search || undefined), 350); return () => clearTimeout(t); }, [search, load]);

  const enquire = async () => {
    setError(''); setEnquiry(null);
    if (!bankCode.trim() || !/^\d{10}$/.test(accountNumber.trim())) { setError('Enter bank and 10-digit account number.'); return; }
    setBusy(true);
    try {
      const r = await BankDirectoryApi.enquire({ bankCode: bankCode.trim().toUpperCase(), accountNumber: accountNumber.trim(), walletId });
      setEnquiry(r);
      if (r.outcome === 'NOT_FOUND') setError('Account not found at that bank.');
      if (r.outcome === 'UNAVAILABLE') setError('Verification temporarily unavailable. Try again.');
    } catch (e) { setError(e instanceof Error ? e.message : 'Enquiry failed.'); }
    finally { setBusy(false); }
  };

  const save = async () => {
    if (!enquiry || enquiry.outcome !== 'RESOLVED') { setError('Verify the account first.'); return; }
    setBusy(true); setError('');
    try {
      const created = await create({ bankCode: enquiry.bankCode, accountNumber: enquiry.accountNumber, nickname: nickname.trim() || undefined, walletId });
      onCreated({ id: created.id, accountName: created.accountName, bankCode: enquiry.bankCode, accountNumber: enquiry.accountNumber });
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not save beneficiary.'); }
    finally { setBusy(false); }
  };

  return (
    <Card style={styles.card}>
      <Text style={styles.title}>Add bank account</Text>
      <TextInput placeholder="Search banks" value={search} onChangeText={setSearch} style={styles.input} testID="add-bank-search" />
      <FlatList
        data={banks.slice(0, 8)}
        keyExtractor={(b) => b.bankCode}
        renderItem={({ item }) => (
          <Text onPress={() => setBankCode(item.bankCode)} style={[styles.bankLine, item.bankCode === bankCode && styles.bankActive]} testID={`bank-${item.bankCode}`}>{item.bankName} · {item.bankCode}</Text>
        )}
        style={{ maxHeight: 160 }}
      />
      <TextInput placeholder="Bank code" value={bankCode} onChangeText={(v) => setBankCode(v.toUpperCase())} style={styles.input} testID="add-bank-code" autoCapitalize="characters" />
      <TextInput placeholder="10-digit account number" value={accountNumber} onChangeText={setAccountNumber} style={styles.input} testID="add-account-number" keyboardType="number-pad" maxLength={10} />
      <TextInput placeholder="Nickname (optional)" value={nickname} onChangeText={setNickname} style={styles.input} testID="add-nickname" />
      <Button label={busy ? 'Checking…' : 'Verify account'} onPress={enquire} disabled={busy} testID="add-enquire" />
      {enquiry && enquiry.outcome === 'RESOLVED' && <Text style={styles.ok} testID="enquiry-account-name">{enquiry.accountName} · {enquiry.bankCode} · {enquiry.accountNumber}</Text>}
      {!!error && <Text style={styles.err} testID="add-error">{error}</Text>}
      <View style={styles.row}>
        <Button label="Cancel" variant="outline" onPress={onCancel} />
        <Button label="Save" onPress={save} disabled={busy || enquiry?.outcome !== 'RESOLVED'} testID="add-save" />
      </View>
      <Text style={styles.hint}>Only a resolved account can be saved. The verified account name is shown as confirmation.</Text>
    </Card>
  );
};

const styles = StyleSheet.create({
  card: { gap: 10, padding: 14 },
  title: { fontWeight: '700', fontSize: 16 },
  input: { borderWidth: 1, borderColor: theme.colors.surface.hairline, borderRadius: 10, padding: 10 },
  bankLine: { paddingVertical: 6, color: theme.colors.neutral.slate },
  bankActive: { color: theme.colors.primary.main, fontWeight: '700' },
  ok: { color: theme.colors.feedback.success, fontWeight: '600' },
  err: { color: theme.colors.feedback.error },
  row: { flexDirection: 'row', gap: 10 },
  hint: { color: theme.colors.neutral.slate, fontSize: 12 },
});
