import React, { useCallback, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { theme } from '../../theme';
import { Card } from '../../components/Card';
import { Button } from '../../components/Button';
import { getAgentFinancialPosition } from '../../services/agent-api';
import { AgentBankingApi, type AgentDeposit } from '../../services/agent-banking';

/**
 * Agent funding account.
 *
 * An agent's float has to arrive from somewhere, and the honest instrument is a bank transfer into an
 * account bound to that agent, its institution and one provider. This screen shows that account — or
 * the honest reason there isn't one.
 *
 * What it deliberately does NOT do:
 *
 * - It never shows a number the bank has not issued. Every non-issued state renders as words.
 * - It never implies the float was credited. A transfer that arrived is reported as 'Received — credit
 *   pending' until the inbound verification path actually posts the float, because an agent who reads
 *   'credited' and then sees an unchanged balance will assume the platform lost their money.
 * - It never offers a retry while an earlier request is `UNKNOWN`. A second submission can open a second
 *   real account, and that account cannot be safely closed.
 */
export const FundingAccountScreen: React.FC = () => {
  const queryClient = useQueryClient();
  const [notice, setNotice] = useState('');
  const [copied, setCopied] = useState(false);

  // The wallet id comes from the ledger-derived financial position, not from a stored guess: this is the
  // authoritative statement of which wallet is the agent's.
  const positionQuery = useQuery({
    queryKey: ['agent-financial-position'],
    queryFn: getAgentFinancialPosition,
    staleTime: 15_000,
  });
  const walletId = positionQuery.data?.walletId ?? null;

  const accountQuery = useQuery({
    queryKey: ['agent-funding-account', walletId],
    queryFn: () => AgentBankingApi.fundingAccount(walletId!),
    enabled: !!walletId,
    staleTime: 15_000,
    // A 404 here means "not this agent's wallet", which is a refusal, not a transient failure: do not
    // hammer it.
    retry: false,
  });

  const depositsQuery = useQuery({
    queryKey: ['agent-funding-deposits', walletId],
    queryFn: () => AgentBankingApi.deposits(walletId!),
    enabled: !!walletId,
    staleTime: 15_000,
    retry: false,
  });

  const requestMutation = useMutation({
    mutationFn: () => AgentBankingApi.requestFundingAccount(walletId!),
    onSuccess: (next) => {
      if (next.state === 'PROVISIONED' && next.accountNumber) {
        setNotice('Your funding account is ready. Transfers will appear below once confirmed.');
      } else if (next.state === 'UNKNOWN') {
        setNotice(
          'We are still confirming your account with the bank. Do not request another — it may create a duplicate account.',
        );
      } else if (next.state === 'PENDING') {
        setNotice('The bank is still setting up your account. Check back shortly.');
      } else {
        setNotice('No account could be created right now. Nothing has changed on your float.');
      }
      void queryClient.invalidateQueries({ queryKey: ['agent-funding-account', walletId] });
    },
    onError: () => {
      setNotice('We could not request an account. Nothing has changed on your float.');
    },
  });

  const copy = useCallback(async (value: string) => {
    try {
      await Clipboard.setStringAsync(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }, []);

  const refresh = useCallback(() => {
    void positionQuery.refetch();
    void accountQuery.refetch();
    void depositsQuery.refetch();
  }, [positionQuery, accountQuery, depositsQuery]);

  const account = accountQuery.data;
  const deposits: AgentDeposit[] = depositsQuery.data ?? [];
  const isRefreshing = positionQuery.isRefetching || accountQuery.isRefetching;

  return (
    <ScrollView
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl
          refreshing={isRefreshing}
          onRefresh={refresh}
          tintColor={theme.colors.primary.main}
        />
      }
    >
      <Text style={styles.eyebrow}>Float</Text>
      <Text style={styles.title}>Funding account</Text>
      <Text style={styles.subtitle}>
        Send float to this account from your bank. It is yours alone and is tied to your agent
        wallet.
      </Text>

      {!!notice && (
        <View style={styles.notice} accessibilityLiveRegion="polite">
          <Text style={styles.noticeText}>{notice}</Text>
        </View>
      )}

      {positionQuery.isLoading || accountQuery.isLoading ? (
        <Card>
          <Text style={styles.body}>Checking your funding details…</Text>
        </Card>
      ) : !walletId ? (
        <Card>
          <Text style={styles.cardTitle}>No agent wallet yet</Text>
          <Text style={styles.body}>
            MonieNaija has not provisioned a float wallet for this agent, so there is nothing to
            fund. Funding becomes available once a wallet exists.
          </Text>
        </Card>
      ) : accountQuery.isError ? (
        <Card>
          <Text style={styles.cardTitle}>Funding details unavailable</Text>
          <Text style={styles.body}>
            We could not load your funding account right now. Your float balance and existing
            transactions are unaffected — pull down to try again.
          </Text>
        </Card>
      ) : account?.state === 'PROVISIONED' && account.accountNumber ? (
        <Card>
          <Text style={styles.cardTitle}>{account.bankName ?? 'Your bank'}</Text>
          <Text style={styles.rowLabel}>Account name</Text>
          <Text style={styles.body}>{account.accountName ?? '—'}</Text>
          <Text style={styles.rowLabel}>Account number</Text>
          <Text style={styles.accountNumber} selectable>
            {account.accountNumber}
          </Text>
          <Button
            label={copied ? 'Copied' : 'Copy account number'}
            variant="secondary"
            onPress={() => void copy(account.accountNumber ?? '')}
          />
          <Text style={styles.hint}>
            MonieNaija will never ask you to send float to a different account. Check this number in
            the app before every transfer.
          </Text>
        </Card>
      ) : account?.state === 'UNKNOWN' ? (
        <Card>
          <Text style={styles.cardTitle}>Still confirming your account</Text>
          <Text style={styles.body}>
            We asked the bank for your funding account and have not received a final answer yet.
          </Text>
          <Text style={styles.hint}>
            Do not request another account. A second request could open a duplicate real account
            that cannot be safely closed. This screen updates once the bank confirms.
          </Text>
        </Card>
      ) : account?.state === 'PENDING' ? (
        <Card>
          <Text style={styles.cardTitle}>Account being set up</Text>
          <Text style={styles.body}>
            The bank is still creating your funding account. Check back shortly.
          </Text>
        </Card>
      ) : account?.state === 'NO_INSTITUTION' ? (
        <Card>
          <Text style={styles.cardTitle}>No funding account available</Text>
          <Text style={styles.body}>
            Your agent wallet is not yet linked to a banking institution, so no account can be
            issued. This is something MonieNaija resolves — you do not need to do anything.
          </Text>
        </Card>
      ) : account?.state === 'WALLET_NOT_AGENT_OWNED' ? (
        <Card>
          <Text style={styles.cardTitle}>Wallet not eligible</Text>
          <Text style={styles.body}>
            This wallet is not an agent float wallet, so it cannot have a funding account. Contact
            your supervisor if you believe this is wrong.
          </Text>
        </Card>
      ) : (
        <Card>
          <Text style={styles.cardTitle}>No funding account yet</Text>
          <Text style={styles.body}>
            You do not have a funding account. Requesting one is free and takes a moment.
          </Text>
          <Button
            label={requestMutation.isPending ? 'Requesting…' : 'Get my funding account'}
            onPress={() => requestMutation.mutate()}
            disabled={requestMutation.isPending}
          />
        </Card>
      )}

      <Card>
        <Text style={styles.cardTitle}>Float received</Text>
        {deposits.length === 0 ? (
          <Text style={styles.body}>No transfers have arrived yet.</Text>
        ) : (
          deposits.slice(0, 10).map((deposit) => (
            <View key={deposit.id} style={styles.depositRow}>
              <Text style={styles.depositAmount}>
                {deposit.currency} {(Number(deposit.amountMinor) / 100).toLocaleString()}
              </Text>
              {/*
                'Credited' and 'Received' are different facts. Saying 'credited' before the float is
                posted would make an agent believe their balance is wrong.
              */}
              <Text style={styles.depositState}>
                {deposit.state === 'FLOAT_CREDITED'
                  ? 'Credited to float'
                  : deposit.state === 'VERIFIED_AWAITING_FLOAT_CREDIT'
                    ? 'Received — credit pending'
                    : deposit.state === 'CONFIRMING'
                      ? 'Confirming with bank'
                      : 'Rejected'}
              </Text>
            </View>
          ))
        )}
      </Card>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  content: { padding: theme.spacing.lg, gap: theme.spacing.md },
  eyebrow: {
    fontSize: theme.typography.sizes.xs,
    color: theme.colors.neutral.slate,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  title: {
    fontSize: theme.typography.sizes.xl,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.primary.dark,
  },
  subtitle: {
    fontSize: theme.typography.sizes.sm,
    color: theme.colors.neutral.slate,
    lineHeight: 20,
  },
  cardTitle: {
    fontSize: theme.typography.sizes.base,
    fontWeight: theme.typography.weights.semibold,
    color: theme.colors.primary.dark,
  },
  body: { fontSize: theme.typography.sizes.sm, color: theme.colors.neutral.slate, lineHeight: 20 },
  rowLabel: {
    fontSize: theme.typography.sizes.xs,
    color: theme.colors.neutral.slate,
    marginTop: theme.spacing.sm,
  },
  accountNumber: {
    fontSize: theme.typography.sizes.lg,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.primary.dark,
    letterSpacing: 2,
  },
  hint: { fontSize: theme.typography.sizes.xs, color: theme.colors.neutral.slate, lineHeight: 18 },
  notice: {
    backgroundColor: theme.colors.feedback.infoLight,
    borderRadius: 10,
    padding: theme.spacing.md,
  },
  noticeText: { fontSize: theme.typography.sizes.sm, color: theme.colors.primary.dark },
  depositRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6 },
  depositAmount: {
    fontSize: theme.typography.sizes.sm,
    fontWeight: theme.typography.weights.semibold,
    color: theme.colors.primary.dark,
  },
  depositState: { fontSize: theme.typography.sizes.xs, color: theme.colors.neutral.slate },
});
