import React, { useCallback, useEffect, useState } from 'react';
import {
  ManagedProviderChannel,
  NotificationPermissions,
  normalizeWorkforceSmsDestination,
  ProposeProviderConfigPayload,
  ProviderChannelSnapshot,
  ProviderConfigProposal,
  ProviderConfigurationOverview,
  ProviderCredentialAction,
  ProviderLifecycleState,
  validateProviderConfigProposalDraft,
} from '../services/notification-domain';
import { NotificationManagementApi } from '../services/notification-management-api';

interface ProviderConfigurationWorkspaceProps {
  principalId: string | null;
  principalRoles: string[];
  permissions: NotificationPermissions;
  onRefreshParentStatus?: () => void;
}

function lifecycleBadgeVisual(state: ProviderLifecycleState): {
  label: string;
  bg: string;
  fg: string;
  border: string;
  summary: string;
} {
  switch (state) {
    case 'PRODUCTION_READY':
      return {
        label: 'PRODUCTION_READY · Confirmed Live Delivery',
        bg: '#dcfce7',
        fg: '#166534',
        border: '#86efac',
        summary: 'Configured, verified, enabled, live test-send confirmed, and background worker/domain checks satisfied.',
      };
    case 'DELIVERY_TESTED':
      return {
        label: 'DELIVERY_TESTED · Confirmed Live Test-Send',
        bg: '#d1fae5',
        fg: '#065f46',
        border: '#6ee7b7',
        summary: 'Controlled live provider test-send succeeded. Complete background worker / DNS authentication gates for full PRODUCTION_READY status.',
      };
    case 'ENABLED':
      return {
        label: 'ENABLED · Awaiting Live Test-Send',
        bg: '#dbeafe',
        fg: '#1e40af',
        border: '#93c5fd',
        summary: 'Provider is enabled for live dispatch, but controlled live delivery has not yet been confirmed for the active credential.',
      };
    case 'VERIFIED':
      return {
        label: 'VERIFIED · Disabled (Staged)',
        bg: '#e0e7ff',
        fg: '#3730a3',
        border: '#a5b4fc',
        summary: 'Credentials and configuration verified, but provider remains disabled (fail-closed) until enabled via maker-checker.',
      };
    case 'CONFIGURED':
      return {
        label: 'CONFIGURED · Saved (Not Yet Verified / Enabled)',
        bg: '#fef9c3',
        fg: '#854d0e',
        border: '#fde047',
        summary: 'Encrypted credentials saved. Run connection verification, enable via maker-checker, and execute a controlled test-send.',
      };
    case 'CONSOLE_ONLY':
      return {
        label: 'CONSOLE_ONLY · Dev Simulation (No Live Delivery)',
        bg: '#fef3c7',
        fg: '#92400e',
        border: '#fcd34d',
        summary: 'Development/test console adapter only — logs locally and never transmits real SMS or Email.',
      };
    case 'MISCONFIGURED':
      return {
        label: 'MISCONFIGURED · Fail-Closed',
        bg: '#fee2e2',
        fg: '#991b1b',
        border: '#fca5a5',
        summary: 'Missing server encryption key, undecryptable secret, or invalid sender — all dispatches fail closed.',
      };
    case 'NOT_CONFIGURED':
    default:
      return {
        label: 'NOT_CONFIGURED · Dark / Fail-Closed',
        bg: '#f1f5f9',
        fg: '#475569',
        border: '#cbd5e1',
        summary: 'No external provider credentials active on this channel.',
      };
  }
}

function describeError(err: unknown): string {
  if (!err) return 'Operation failed.';
  if (typeof err === 'object' && err !== null) {
    const rec = err as { status?: number; message?: string; details?: { message?: string; detail?: string } };
    const msg = rec.details?.detail || rec.details?.message || rec.message || 'Request failed';
    if (rec.status === 401) return `Authentication required (401): ${msg}`;
    if (rec.status === 403) return `Access or governance policy denied (403): ${msg}`;
    if (rec.status === 409) return `Concurrency or state conflict (409): ${msg}`;
    if (rec.status === 429) return `Rate limit reached (429): ${msg}`;
    return msg;
  }
  return String(err);
}

const GATE_LABELS: Array<{ key: keyof ProviderChannelSnapshot['gates']; label: string }> = [
  { key: 'configured', label: 'CONFIGURED' },
  { key: 'verified', label: 'VERIFIED' },
  { key: 'enabled', label: 'ENABLED' },
  { key: 'deliveryTested', label: 'DELIVERY_TESTED' },
  { key: 'productionReady', label: 'PRODUCTION_READY' },
];

export const ProviderConfigurationWorkspace: React.FC<ProviderConfigurationWorkspaceProps> = ({
  principalId,
  permissions,
  onRefreshParentStatus,
}) => {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [overview, setOverview] = useState<ProviderConfigurationOverview | null>(null);
  const [proposals, setProposals] = useState<ProviderConfigProposal[]>([]);

  // SMS (Robase) draft state — API key is kept strictly in ephemeral React state and wiped on submit
  const [smsProvider, setSmsProvider] = useState<'robase' | 'console'>('robase');
  const [smsEnabled, setSmsEnabled] = useState(false);
  const [smsBaseUrl, setSmsBaseUrl] = useState('https://api.robase.dev');
  const [smsSenderId, setSmsSenderId] = useState('MonieNaija');
  const [smsTimeoutMs, setSmsTimeoutMs] = useState(10000);
  const [smsCredAction, setSmsCredAction] = useState<ProviderCredentialAction>('SET_ENCRYPTED');
  const [smsApiKey, setSmsApiKey] = useState('');
  const [smsReason, setSmsReason] = useState('');
  const [smsFormErrors, setSmsFormErrors] = useState<string[]>([]);
  const [smsFeedback, setSmsFeedback] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [smsBusy, setSmsBusy] = useState(false);

  // SMS quick test-send state
  const [smsTestDest, setSmsTestDest] = useState('');
  const [smsTestConfirmed, setSmsTestConfirmed] = useState(false);
  const [smsTestBusy, setSmsTestBusy] = useState(false);
  const [smsTestMsg, setSmsTestMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  // Email (Brevo) draft state — API key is kept strictly in ephemeral React state and wiped on submit
  const [emailProvider, setEmailProvider] = useState<'brevo' | 'resend' | 'none' | 'console'>('brevo');
  const [emailEnabled, setEmailEnabled] = useState(false);
  const [emailBaseUrl, setEmailBaseUrl] = useState('https://api.brevo.com');
  const [emailFromAddress, setEmailFromAddress] = useState('');
  const [emailFromName, setEmailFromName] = useState('MonieNaija');
  const [emailReplyTo, setEmailReplyTo] = useState('');
  const [emailTimeoutMs, setEmailTimeoutMs] = useState(10000);
  const [emailCredAction, setEmailCredAction] = useState<ProviderCredentialAction>('SET_ENCRYPTED');
  const [emailApiKey, setEmailApiKey] = useState('');
  const [emailSpf, setEmailSpf] = useState(false);
  const [emailDkim, setEmailDkim] = useState(false);
  const [emailDmarc, setEmailDmarc] = useState(false);
  const [emailReason, setEmailReason] = useState('');
  const [emailFormErrors, setEmailFormErrors] = useState<string[]>([]);
  const [emailFeedback, setEmailFeedback] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [emailBusy, setEmailBusy] = useState(false);

  // Email quick test-send state
  const [emailTestDest, setEmailTestDest] = useState('');
  const [emailTestConfirmed, setEmailTestConfirmed] = useState(false);
  const [emailTestBusy, setEmailTestBusy] = useState(false);
  const [emailTestMsg, setEmailTestMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  // Governance queue state
  const [decisionComments, setDecisionComments] = useState<Record<string, string>>({});
  const [queueBusyId, setQueueBusyId] = useState<string | null>(null);
  const [queueBanner, setQueueBanner] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const hydrateFormsFromSnapshot = useCallback((data: ProviderConfigurationOverview) => {
    const sms = data.sms;
    setSmsProvider(sms.provider === 'console' ? 'console' : 'robase');
    setSmsEnabled(sms.source === 'DATABASE' ? sms.enabled : false);
    setSmsBaseUrl(sms.baseUrl || 'https://api.robase.dev');
    setSmsSenderId(sms.senderId || 'MonieNaija');
    setSmsTimeoutMs(sms.requestTimeoutMs || 10000);
    setSmsCredAction(sms.hasStoredCredential ? 'KEEP_EXISTING' : 'SET_ENCRYPTED');

    const email = data.email;
    setEmailProvider(
      email.provider === 'resend' || email.provider === 'console' || email.provider === 'none'
        ? email.provider
        : 'brevo',
    );
    setEmailEnabled(email.source === 'DATABASE' ? email.enabled : false);
    setEmailBaseUrl(
      email.baseUrl ||
        (email.provider === 'resend' ? 'https://api.resend.com' : 'https://api.brevo.com'),
    );
    setEmailFromAddress(email.fromEmail || '');
    setEmailFromName(email.fromName || 'MonieNaija');
    setEmailReplyTo(email.replyToEmail || '');
    setEmailTimeoutMs(email.requestTimeoutMs || 10000);
    setEmailCredAction(email.hasStoredCredential ? 'KEEP_EXISTING' : 'SET_ENCRYPTED');
    setEmailSpf(Boolean(email.domainAuthentication?.spfConfigured));
    setEmailDkim(Boolean(email.domainAuthentication?.dkimConfigured));
    setEmailDmarc(Boolean(email.domainAuthentication?.dmarcConfigured));
  }, []);

  const loadWorkspace = useCallback(
    async (rehydrateDrafts = false) => {
      if (!permissions.canViewProviderConfig) {
        setLoading(false);
        return;
      }
      setLoading(true);
      setLoadError(null);
      try {
        const [cfgRes, propRes] = await Promise.all([
          NotificationManagementApi.getProviderConfiguration(),
          NotificationManagementApi.listProviderConfigProposals({ limit: 25 }),
        ]);
        if (cfgRes.status === 'BLOCKED') {
          setLoadError(cfgRes.message);
          setOverview(null);
        } else {
          setOverview(cfgRes.data);
          if (rehydrateDrafts) {
            hydrateFormsFromSnapshot(cfgRes.data);
          }
        }
        if (propRes.status === 'LIVE') {
          setProposals(propRes.data);
        } else {
          setProposals([]);
        }
      } catch (err) {
        setLoadError(describeError(err));
      } finally {
        setLoading(false);
      }
    },
    [permissions.canViewProviderConfig, hydrateFormsFromSnapshot],
  );

  useEffect(() => {
    void loadWorkspace(true);
  }, [loadWorkspace]);

  const handleSubmitSmsProposal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!overview) return;
    setSmsFeedback(null);

    const payload: ProposeProviderConfigPayload = {
      channel: 'SMS',
      expectedVersion: overview.sms.version,
      provider: smsProvider,
      enabled: smsEnabled,
      baseUrl: smsProvider === 'robase' ? smsBaseUrl.trim() : null,
      requestTimeoutMs: Number(smsTimeoutMs),
      senderId: smsSenderId.trim() || null,
      credentialAction: smsProvider === 'console' ? 'CLEAR' : smsCredAction,
      ...(smsProvider !== 'console' && smsCredAction === 'SET_ENCRYPTED'
        ? { apiKey: smsApiKey.trim() }
        : {}),
      reason: smsReason.trim(),
    };

    const validationErrors = validateProviderConfigProposalDraft(
      payload,
      overview.sms.hasStoredCredential,
    );
    if (
      payload.credentialAction === 'SET_ENCRYPTED' &&
      !overview.encryption.available
    ) {
      validationErrors.push(
        'Server encryption key is not configured (set NOTIFICATION_PROVIDER_ENCRYPTION_KEYRING_JSON or NOTIFICATION_PROVIDER_ENCRYPTION_KEY on the server before storing encrypted credentials).',
      );
    }
    setSmsFormErrors(validationErrors);
    if (validationErrors.length > 0) return;

    setSmsBusy(true);
    try {
      const created = await NotificationManagementApi.proposeProviderConfig(payload);
      // Immediately clear plaintext API key from component memory!
      setSmsApiKey('');
      setSmsReason('');
      setSmsFeedback({
        kind: 'ok',
        text: `SMS proposal ${created.id.slice(0, 8)} submitted (status: ${created.status}). An independent FINANCE_CONTROLLER with MFA must approve before activation.`,
      });
      await loadWorkspace(false);
    } catch (err) {
      setSmsFeedback({ kind: 'err', text: describeError(err) });
    } finally {
      setSmsBusy(false);
    }
  };

  const handleSubmitEmailProposal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!overview) return;
    setEmailFeedback(null);

    const isExternal = emailProvider === 'brevo' || emailProvider === 'resend';
    const payload: ProposeProviderConfigPayload = {
      channel: 'EMAIL',
      expectedVersion: overview.email.version,
      provider: emailProvider,
      enabled: emailProvider === 'none' ? false : emailEnabled,
      baseUrl: isExternal ? emailBaseUrl.trim() : null,
      requestTimeoutMs: Number(emailTimeoutMs),
      fromEmail: isExternal ? emailFromAddress.trim() : null,
      fromName: isExternal ? emailFromName.trim() || null : null,
      replyToEmail: isExternal && emailReplyTo.trim() ? emailReplyTo.trim() : null,
      credentialAction: isExternal ? emailCredAction : 'CLEAR',
      ...(isExternal && emailCredAction === 'SET_ENCRYPTED'
        ? { apiKey: emailApiKey.trim() }
        : {}),
      spfConfigured: emailSpf,
      dkimConfigured: emailDkim,
      dmarcConfigured: emailDmarc,
      reason: emailReason.trim(),
    };

    const validationErrors = validateProviderConfigProposalDraft(
      payload,
      overview.email.hasStoredCredential,
    );
    if (
      payload.credentialAction === 'SET_ENCRYPTED' &&
      !overview.encryption.available
    ) {
      validationErrors.push(
        'Server encryption key is not configured (set NOTIFICATION_PROVIDER_ENCRYPTION_KEYRING_JSON or NOTIFICATION_PROVIDER_ENCRYPTION_KEY on the server before storing encrypted credentials).',
      );
    }
    setEmailFormErrors(validationErrors);
    if (validationErrors.length > 0) return;

    setEmailBusy(true);
    try {
      const created = await NotificationManagementApi.proposeProviderConfig(payload);
      // Immediately clear plaintext API key from component memory!
      setEmailApiKey('');
      setEmailReason('');
      setEmailFeedback({
        kind: 'ok',
        text: `Email proposal ${created.id.slice(0, 8)} submitted (status: ${created.status}). An independent FINANCE_CONTROLLER with MFA must approve before activation.`,
      });
      await loadWorkspace(false);
    } catch (err) {
      setEmailFeedback({ kind: 'err', text: describeError(err) });
    } finally {
      setEmailBusy(false);
    }
  };

  const handleVerifyChannel = async (channel: ManagedProviderChannel) => {
    const setFeedback = channel === 'SMS' ? setSmsFeedback : setEmailFeedback;
    const setBusy = channel === 'SMS' ? setSmsBusy : setEmailBusy;
    setFeedback(null);
    setBusy(true);
    try {
      const res = await NotificationManagementApi.verifyProviderChannel(channel);
      if (res.verified) {
        setFeedback({
          kind: 'ok',
          text: `${channel} verification succeeded (${res.verificationMethod ?? 'VERIFIED'}).${res.liveEndpointNote ? ` ${res.liveEndpointNote}` : ''}`,
        });
      } else {
        setFeedback({
          kind: 'err',
          text: `${channel} verification failed: ${res.errorCode ?? 'VERIFY_FAILED'}. Verify API key and sender configuration.`,
        });
      }
      await loadWorkspace(false);
      onRefreshParentStatus?.();
    } catch (err) {
      setFeedback({ kind: 'err', text: describeError(err) });
    } finally {
      setBusy(false);
    }
  };

  const handleQuickTestSend = async (channel: ManagedProviderChannel) => {
    const rawDest = channel === 'SMS' ? smsTestDest : emailTestDest;
    const confirmed = channel === 'SMS' ? smsTestConfirmed : emailTestConfirmed;
    const setBusy = channel === 'SMS' ? setSmsTestBusy : setEmailTestBusy;
    const setMsg = channel === 'SMS' ? setSmsTestMsg : setEmailTestMsg;

    setMsg(null);
    if (!confirmed) {
      setMsg({
        kind: 'err',
        text: 'Confirm that the test destination belongs to an authorized workforce operator.',
      });
      return;
    }

    let destination = rawDest.trim();
    if (channel === 'SMS') {
      const normalized = normalizeWorkforceSmsDestination(destination);
      if (!normalized) {
        setMsg({
          kind: 'err',
          text: 'Enter a valid E.164 or Nigerian workforce phone number (e.g. +2348012345678).',
        });
        return;
      }
      destination = normalized;
    } else {
      if (!/^[^@\s,;"'<>()\\]+@[^@\s,;"'<>()\\]+\.[^@\s,;"'<>()\\]{2,63}$/.test(destination)) {
        setMsg({
          kind: 'err',
          text: 'Enter a valid workforce email address (e.g. ops@monienaija.ng).',
        });
        return;
      }
      destination = destination.toLowerCase();
    }

    setBusy(true);
    try {
      const outcome = await NotificationManagementApi.submitTestSend({
        channel,
        eventType: 'notification.test_send',
        destination,
        reason: `Authorized ${channel} provider readiness verification`,
        workforceDestinationConfirmed: true,
      });
      if (outcome.status === 'BLOCKED') {
        setMsg({ kind: 'err', text: outcome.message });
      } else if (outcome.data.status === 'SENT') {
        setMsg({
          kind: 'ok',
          text: `${channel} controlled test-send accepted by provider (ref: ${outcome.data.providerRef ?? 'n/a'}).`,
        });
      } else {
        setMsg({
          kind: 'err',
          text: `${channel} test-send failed: ${outcome.data.lastError ?? 'PROVIDER_FAILURE'}.`,
        });
      }
      await loadWorkspace(false);
      onRefreshParentStatus?.();
    } catch (err) {
      setMsg({ kind: 'err', text: describeError(err) });
    } finally {
      setBusy(false);
    }
  };

  const handleProposalAction = async (
    proposal: ProviderConfigProposal,
    action: 'approve' | 'reject' | 'activate',
  ) => {
    setQueueBanner(null);
    setQueueBusyId(proposal.id);
    try {
      const comment = decisionComments[proposal.id]?.trim();
      if (action === 'approve') {
        await NotificationManagementApi.approveProviderConfigProposal(proposal.id, comment);
        setQueueBanner({
          kind: 'ok',
          text: `Proposal ${proposal.id.slice(0, 8)} (${proposal.channel}) approved. Ready for governed activation.`,
        });
      } else if (action === 'reject') {
        await NotificationManagementApi.rejectProviderConfigProposal(proposal.id, comment);
        setQueueBanner({
          kind: 'ok',
          text: `Proposal ${proposal.id.slice(0, 8)} (${proposal.channel}) rejected.`,
        });
      } else {
        const res = await NotificationManagementApi.activateProviderConfigProposal(proposal.id);
        setQueueBanner({
          kind: 'ok',
          text: `Activated ${res.configuration.channel} provider "${res.configuration.provider}" (v${res.configuration.version}, state: ${res.configuration.lifecycleState}).`,
        });
      }
      await loadWorkspace(true);
      onRefreshParentStatus?.();
    } catch (err) {
      setQueueBanner({ kind: 'err', text: describeError(err) });
    } finally {
      setQueueBusyId(null);
    }
  };

  if (!permissions.canViewProviderConfig) {
    return (
      <div
        data-testid="provider-config-denied"
        style={{
          padding: 20,
          borderRadius: 10,
          background: '#fef2f2',
          border: '1px solid #fecaca',
          color: '#991b1b',
        }}
      >
        <strong>Access Restricted:</strong> Viewing notification provider configuration requires{' '}
        <code>notification.provider.view</code>.
      </div>
    );
  }

  if (loading && !overview) {
    return (
      <div data-testid="provider-config-loading" style={{ padding: 20, color: '#475569' }}>
        Loading governed SMS (Robase) and Email (Brevo) provider configuration…
      </div>
    );
  }

  if (loadError && !overview) {
    return (
      <div
        data-testid="provider-config-error"
        style={{
          padding: 20,
          borderRadius: 10,
          background: '#fffbeb',
          border: '1px solid #fde68a',
          color: '#92400e',
        }}
      >
        <strong>Provider Configuration Unavailable:</strong> {loadError}
      </div>
    );
  }

  if (!overview) return null;

  const smsVisual = lifecycleBadgeVisual(overview.sms.lifecycleState);
  const emailVisual = lifecycleBadgeVisual(overview.email.lifecycleState);

  return (
    <div data-testid="provider-config-workspace" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Top Governance & Server Encryption Key Health Banner */}
      <div
        data-testid="provider-encryption-banner"
        style={{
          padding: 16,
          borderRadius: 10,
          background: overview.encryption.available ? '#f0fdf4' : '#fef2f2',
          border: `1px solid ${overview.encryption.available ? '#86efac' : '#fca5a5'}`,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          gap: 16,
          flexWrap: 'wrap',
        }}
      >
        <div>
          <div style={{ fontWeight: 700, fontSize: 14, color: overview.encryption.available ? '#166534' : '#991b1b' }}>
            {overview.encryption.available
              ? `AES-256-GCM Secret Encryption Active (${overview.encryption.mode}, key version "${overview.encryption.activeKeyVersion}")`
              : 'Server Secret Encryption Key Not Configured — Credential Storage Fail-Closed'}
          </div>
          <div style={{ fontSize: 12, color: '#334155', marginTop: 4 }}>
            {overview.encryption.available
              ? 'Provider API keys entered below are encrypted server-side with AES-256-GCM before PostgreSQL persistence. Stored keys are never returned in GET responses, logs, or audit trails.'
              : 'Configure NOTIFICATION_PROVIDER_ENCRYPTION_KEYRING_JSON or NOTIFICATION_PROVIDER_ENCRYPTION_KEY (32-byte base64) in the backend server environment before saving encrypted Robase or Brevo API keys.'}
          </div>
        </div>
        <button
          type="button"
          data-testid="refresh-provider-config-btn"
          onClick={() => void loadWorkspace(false)}
          style={{
            padding: '7px 14px',
            borderRadius: 6,
            border: '1px solid #cbd5e1',
            background: '#ffffff',
            fontWeight: 600,
            fontSize: 12,
            cursor: 'pointer',
          }}
        >
          Refresh Configuration
        </button>
      </div>

      {/* Dual-Column SMS (Robase) and Email (Brevo) Panels */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(440px, 1fr))',
          gap: 20,
        }}
      >
        {/* ==================== SMS (ROBASE) PANEL ==================== */}
        <section
          data-testid="sms-provider-config-panel"
          style={{
            background: '#ffffff',
            border: '1px solid #e2e8f0',
            borderRadius: 12,
            padding: 20,
            display: 'flex',
            flexDirection: 'column',
            gap: 14,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, flexWrap: 'wrap' }}>
            <div>
              <h3 style={{ margin: 0, fontSize: 16, color: '#0f172a' }}>SMS Provider Configuration (Robase)</h3>
              <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>
                Source: <strong>{overview.sms.source}</strong> · Version: <strong>v{overview.sms.version}</strong>
              </div>
            </div>
            <span
              data-testid="sms-lifecycle-badge"
              style={{
                padding: '4px 10px',
                borderRadius: 999,
                fontSize: 11,
                fontWeight: 700,
                background: smsVisual.bg,
                color: smsVisual.fg,
                border: `1px solid ${smsVisual.border}`,
              }}
            >
              {smsVisual.label}
            </span>
          </div>

          <div style={{ fontSize: 12, color: '#475569' }}>{smsVisual.summary}</div>

          {/* 5-Gate Readiness Strip */}
          <div data-testid="sms-readiness-gates" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {GATE_LABELS.map((g) => {
              const passed = overview.sms.gates[g.key];
              return (
                <span
                  key={g.key}
                  data-testid={`sms-gate-${g.key}`}
                  style={{
                    padding: '3px 8px',
                    borderRadius: 6,
                    fontSize: 11,
                    fontWeight: 600,
                    background: passed ? '#dcfce7' : '#f1f5f9',
                    color: passed ? '#166534' : '#64748b',
                    border: `1px solid ${passed ? '#86efac' : '#cbd5e1'}`,
                  }}
                >
                  {passed ? '✓ ' : '○ '}
                  {g.label}
                </span>
              );
            })}
          </div>

          {/* Non-Secret Active SMS Summary */}
          <div
            style={{
              padding: 12,
              borderRadius: 8,
              background: '#f8fafc',
              border: '1px solid #e2e8f0',
              fontSize: 12,
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: 8,
            }}
          >
            <div>
              <strong>Active Provider:</strong> <code>{overview.sms.provider}</code>
            </div>
            <div>
              <strong>Dispatch Enabled:</strong>{' '}
              <strong style={{ color: overview.sms.enabled ? '#166534' : '#991b1b' }}>
                {overview.sms.enabled ? 'YES' : 'NO (Fail-Closed)'}
              </strong>
            </div>
            <div>
              <strong>API Endpoint:</strong>{' '}
              <code>{overview.sms.baseUrl || 'n/a (console)'}</code>
            </div>
            <div>
              <strong>Stored Key Fingerprint:</strong>{' '}
              <code data-testid="sms-key-fingerprint">
                {overview.sms.keyFingerprint || 'Not configured'}
              </code>
            </div>
            <div>
              <strong>Workspace Sender ID:</strong>{' '}
              <code>{overview.sms.senderId || 'Default (Robase workspace)'}</code>
            </div>
            <div>
              <strong>Background Worker:</strong>{' '}
              <span>{overview.worker.enabled ? 'ENABLED' : 'DISABLED (env)'}</span>
            </div>
          </div>

          {overview.sms.misconfigurationCode && (
            <div style={{ padding: 10, borderRadius: 6, background: '#fef2f2', border: '1px solid #fecaca', color: '#991b1b', fontSize: 12 }}>
              <strong>Fail-Closed Reason:</strong> <code>{overview.sms.misconfigurationCode}</code>
            </div>
          )}

          {/* Robase Verified Contract Note */}
          <div style={{ padding: 10, borderRadius: 6, background: '#eff6ff', border: '1px solid #bfdbfe', color: '#1e3a8a', fontSize: 12 }}>
            <strong>Robase Contract Note:</strong> {overview.contracts.robase.verifiedEndpoint}.{' '}
            {overview.contracts.robase.senderIdBehaviour}
          </div>

          {/* Last Verification & Test-Send Result */}
          <div
            data-testid="sms-last-test-card"
            style={{
              padding: 10,
              borderRadius: 6,
              background: '#f8fafc',
              border: '1px solid #e2e8f0',
              fontSize: 12,
            }}
          >
            <div>
              <strong>Verification:</strong>{' '}
              {overview.sms.verification.verifiedAt
                ? `Verified at ${overview.sms.verification.verifiedAt} (${overview.sms.verification.verificationMethod ?? 'OK'})`
                : overview.sms.verification.lastVerificationError
                  ? `Failed (${overview.sms.verification.lastVerificationError})`
                  : 'Not yet verified'}
            </div>
            <div style={{ marginTop: 4 }}>
              <strong>Last Test-Send:</strong>{' '}
              {overview.sms.lastTest.testedAt
                ? `${overview.sms.lastTest.status} to ${overview.sms.lastTest.destinationMasked ?? '***'} at ${overview.sms.lastTest.testedAt}${overview.sms.lastTest.providerRef ? ` (ref: ${overview.sms.lastTest.providerRef})` : ''}${overview.sms.lastTest.errorCode ? ` [error: ${overview.sms.lastTest.errorCode}]` : ''}`
                : 'No test-send recorded for current configuration'}
            </div>
          </div>

          {/* Verify + Quick Test-Send Controls */}
          {permissions.canTestSend && (
            <div style={{ padding: 12, borderRadius: 8, border: '1px dashed #cbd5e1', display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <strong style={{ fontSize: 12 }}>Connection Check & Controlled SMS Test-Send</strong>
                <button
                  type="button"
                  data-testid="verify-sms-provider-btn"
                  disabled={smsBusy || overview.sms.source !== 'DATABASE' || overview.sms.provider === 'console'}
                  onClick={() => void handleVerifyChannel('SMS')}
                  style={{
                    padding: '5px 10px',
                    borderRadius: 6,
                    border: '1px solid #2563eb',
                    background: '#eff6ff',
                    color: '#1d4ed8',
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  Verify SMS Config
                </button>
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <input
                  type="text"
                  data-testid="sms-quick-test-destination"
                  placeholder="+2348012345678 (workforce phone)"
                  value={smsTestDest}
                  onChange={(e) => setSmsTestDest(e.target.value)}
                  style={{ flex: 1, minWidth: 190, padding: '6px 8px', borderRadius: 6, border: '1px solid #cbd5e1', fontSize: 12 }}
                />
                <button
                  type="button"
                  data-testid="sms-quick-test-send-btn"
                  disabled={smsTestBusy}
                  onClick={() => void handleQuickTestSend('SMS')}
                  style={{
                    padding: '6px 12px',
                    borderRadius: 6,
                    border: 'none',
                    background: '#0f172a',
                    color: '#ffffff',
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  {smsTestBusy ? 'Sending…' : 'Send Test SMS'}
                </button>
              </div>
              <label style={{ fontSize: 11, color: '#475569', display: 'flex', alignItems: 'center', gap: 6 }}>
                <input
                  type="checkbox"
                  data-testid="sms-quick-test-confirm"
                  checked={smsTestConfirmed}
                  onChange={(e) => setSmsTestConfirmed(e.target.checked)}
                />
                Destination belongs to an authorized workforce operator (max 5/hour rate limit).
              </label>
              {smsTestMsg && (
                <div
                  data-testid="sms-quick-test-feedback"
                  style={{
                    fontSize: 12,
                    color: smsTestMsg.kind === 'ok' ? '#166534' : '#991b1b',
                  }}
                >
                  {smsTestMsg.text}
                </div>
              )}
            </div>
          )}

          {/* Governed SMS Proposal Form */}
          <form onSubmit={(e) => void handleSubmitSmsProposal(e)} style={{ display: 'flex', flexDirection: 'column', gap: 10, borderTop: '1px solid #e2e8f0', paddingTop: 12 }}>
            <div style={{ fontWeight: 700, fontSize: 13, color: '#0f172a' }}>
              Propose SMS Provider Change (Maker-Checker + MFA)
            </div>

            {!permissions.canProposeProviderConfig && (
              <div style={{ fontSize: 12, color: '#64748b', background: '#f8fafc', padding: 8, borderRadius: 6 }}>
                Read-only view: Proposing provider changes requires <code>SUPER_ADMIN</code> with{' '}
                <code>notification.provider.configure</code> and step-up MFA.
              </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <label style={{ fontSize: 12, display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span>SMS Provider</span>
                <select
                  data-testid="sms-provider-select"
                  value={smsProvider}
                  disabled={!permissions.canProposeProviderConfig}
                  onChange={(e) => {
                    const val = e.target.value as 'robase' | 'console';
                    setSmsProvider(val);
                    if (val === 'robase' && !overview.sms.hasStoredCredential) {
                      setSmsCredAction('SET_ENCRYPTED');
                    }
                  }}
                  style={{ padding: '6px 8px', borderRadius: 6, border: '1px solid #cbd5e1', fontSize: 12 }}
                >
                  <option value="robase">robase (Robase Live SMS API)</option>
                  <option value="console">console (Dev/Test Simulation Only)</option>
                </select>
              </label>

              <label style={{ fontSize: 12, display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span>Workspace Sender ID</span>
                <input
                  type="text"
                  data-testid="sms-sender-id-input"
                  value={smsSenderId}
                  maxLength={11}
                  disabled={!permissions.canProposeProviderConfig}
                  onChange={(e) => setSmsSenderId(e.target.value)}
                  placeholder="MonieNaija"
                  style={{ padding: '6px 8px', borderRadius: 6, border: '1px solid #cbd5e1', fontSize: 12 }}
                />
              </label>
            </div>

            {smsProvider === 'robase' && (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 10 }}>
                  <label style={{ fontSize: 12, display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <span>Robase Base URL (Pinned HTTPS Origin)</span>
                    <input
                      type="url"
                      data-testid="sms-base-url-input"
                      value={smsBaseUrl}
                      readOnly
                      disabled={!permissions.canProposeProviderConfig}
                      style={{
                        padding: '6px 8px',
                        borderRadius: 6,
                        border: '1px solid #cbd5e1',
                        background: '#f8fafc',
                        fontSize: 12,
                      }}
                    />
                  </label>
                  <label style={{ fontSize: 12, display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <span>Timeout (ms)</span>
                    <input
                      type="number"
                      min={1000}
                      max={60000}
                      value={smsTimeoutMs}
                      disabled={!permissions.canProposeProviderConfig}
                      onChange={(e) => setSmsTimeoutMs(Number(e.target.value))}
                      style={{ padding: '6px 8px', borderRadius: 6, border: '1px solid #cbd5e1', fontSize: 12 }}
                    />
                  </label>
                </div>

                <label style={{ fontSize: 12, display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <span>Credential Action</span>
                  <select
                    data-testid="sms-credential-action-select"
                    value={smsCredAction}
                    disabled={!permissions.canProposeProviderConfig}
                    onChange={(e) => setSmsCredAction(e.target.value as ProviderCredentialAction)}
                    style={{ padding: '6px 8px', borderRadius: 6, border: '1px solid #cbd5e1', fontSize: 12 }}
                  >
                    <option value="SET_ENCRYPTED">Set / Rotate Encrypted API Key (AES-256-GCM)</option>
                    <option value="KEEP_EXISTING">Keep Existing Stored Credential</option>
                    <option value="USE_ENV_SECRET">Use Server Environment Secret (ROBASE_API_KEY)</option>
                    <option value="CLEAR">Clear Stored Credential (Requires Disabled)</option>
                  </select>
                </label>

                {smsCredAction === 'SET_ENCRYPTED' && (
                  <label style={{ fontSize: 12, display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <span>Robase Live API Key (write-only; never echoed after save)</span>
                    <input
                      type="password"
                      autoComplete="new-password"
                      data-testid="sms-api-key-input"
                      value={smsApiKey}
                      disabled={!permissions.canProposeProviderConfig}
                      onChange={(e) => setSmsApiKey(e.target.value)}
                      placeholder="Enter Robase live API key (robe_...)"
                      style={{ padding: '6px 8px', borderRadius: 6, border: '1px solid #cbd5e1', fontSize: 12 }}
                    />
                  </label>
                )}
              </>
            )}

            <label style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
              <input
                type="checkbox"
                data-testid="sms-enabled-checkbox"
                checked={smsEnabled}
                disabled={!permissions.canProposeProviderConfig}
                onChange={(e) => setSmsEnabled(e.target.checked)}
              />
              <span>Enable SMS Provider for Runtime Dispatch</span>
            </label>

            <label style={{ fontSize: 12, display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span>Governance Audit Reason (10–500 chars)</span>
              <input
                type="text"
                data-testid="sms-reason-input"
                value={smsReason}
                disabled={!permissions.canProposeProviderConfig}
                onChange={(e) => setSmsReason(e.target.value)}
                placeholder="e.g. Configure Robase live key and stage SMS provider for connectivity verification"
                style={{ padding: '6px 8px', borderRadius: 6, border: '1px solid #cbd5e1', fontSize: 12 }}
              />
            </label>

            {smsFormErrors.length > 0 && (
              <div data-testid="sms-form-errors" style={{ padding: 10, borderRadius: 6, background: '#fef2f2', border: '1px solid #fecaca', color: '#991b1b', fontSize: 12 }}>
                {smsFormErrors.map((err, i) => (
                  <div key={i}>• {err}</div>
                ))}
              </div>
            )}

            {smsFeedback && (
              <div
                data-testid="sms-proposal-feedback"
                style={{
                  padding: 10,
                  borderRadius: 6,
                  background: smsFeedback.kind === 'ok' ? '#f0fdf4' : '#fef2f2',
                  border: `1px solid ${smsFeedback.kind === 'ok' ? '#86efac' : '#fecaca'}`,
                  color: smsFeedback.kind === 'ok' ? '#166534' : '#991b1b',
                  fontSize: 12,
                }}
              >
                {smsFeedback.text}
              </div>
            )}

            <button
              type="submit"
              data-testid="submit-sms-proposal-btn"
              disabled={!permissions.canProposeProviderConfig || !permissions.hasMfaAssurance || smsBusy}
              style={{
                padding: '8px 14px',
                borderRadius: 6,
                border: 'none',
                background:
                  permissions.canProposeProviderConfig && permissions.hasMfaAssurance
                    ? '#2563eb'
                    : '#94a3b8',
                color: '#ffffff',
                fontWeight: 600,
                fontSize: 12,
                cursor:
                  permissions.canProposeProviderConfig && permissions.hasMfaAssurance
                    ? 'pointer'
                    : 'not-allowed',
              }}
            >
              {smsBusy
                ? 'Submitting SMS Proposal…'
                : !permissions.hasMfaAssurance && permissions.canProposeProviderConfig
                  ? 'MFA Required to Propose SMS Change'
                  : 'Submit SMS Configuration Proposal'}
            </button>
          </form>
        </section>

        {/* ==================== EMAIL (BREVO) PANEL ==================== */}
        <section
          data-testid="email-provider-config-panel"
          style={{
            background: '#ffffff',
            border: '1px solid #e2e8f0',
            borderRadius: 12,
            padding: 20,
            display: 'flex',
            flexDirection: 'column',
            gap: 14,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, flexWrap: 'wrap' }}>
            <div>
              <h3 style={{ margin: 0, fontSize: 16, color: '#0f172a' }}>Transactional Email Configuration (Brevo)</h3>
              <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>
                Source: <strong>{overview.email.source}</strong> · Version: <strong>v{overview.email.version}</strong>
              </div>
            </div>
            <span
              data-testid="email-lifecycle-badge"
              style={{
                padding: '4px 10px',
                borderRadius: 999,
                fontSize: 11,
                fontWeight: 700,
                background: emailVisual.bg,
                color: emailVisual.fg,
                border: `1px solid ${emailVisual.border}`,
              }}
            >
              {emailVisual.label}
            </span>
          </div>

          <div style={{ fontSize: 12, color: '#475569' }}>{emailVisual.summary}</div>

          {/* 5-Gate Readiness Strip */}
          <div data-testid="email-readiness-gates" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {GATE_LABELS.map((g) => {
              const passed = overview.email.gates[g.key];
              return (
                <span
                  key={g.key}
                  data-testid={`email-gate-${g.key}`}
                  style={{
                    padding: '3px 8px',
                    borderRadius: 6,
                    fontSize: 11,
                    fontWeight: 600,
                    background: passed ? '#dcfce7' : '#f1f5f9',
                    color: passed ? '#166534' : '#64748b',
                    border: `1px solid ${passed ? '#86efac' : '#cbd5e1'}`,
                  }}
                >
                  {passed ? '✓ ' : '○ '}
                  {g.label}
                </span>
              );
            })}
          </div>

          {/* Non-Secret Active Email Summary */}
          <div
            style={{
              padding: 12,
              borderRadius: 8,
              background: '#f8fafc',
              border: '1px solid #e2e8f0',
              fontSize: 12,
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: 8,
            }}
          >
            <div>
              <strong>Active Provider:</strong> <code>{overview.email.provider}</code>
            </div>
            <div>
              <strong>Dispatch Enabled:</strong>{' '}
              <strong style={{ color: overview.email.enabled ? '#166534' : '#991b1b' }}>
                {overview.email.enabled ? 'YES' : 'NO (Dark / Fail-Closed)'}
              </strong>
            </div>
            <div>
              <strong>API Endpoint:</strong>{' '}
              <code>{overview.email.baseUrl || 'n/a'}</code>
            </div>
            <div>
              <strong>Stored Key Fingerprint:</strong>{' '}
              <code data-testid="email-key-fingerprint">
                {overview.email.keyFingerprint || 'Not configured'}
              </code>
            </div>
            <div>
              <strong>Verified Sender:</strong>{' '}
              <code>
                {overview.email.fromEmail
                  ? overview.email.fromName
                    ? `${overview.email.fromName} <${overview.email.fromEmail}>`
                    : overview.email.fromEmail
                  : 'Not configured'}
              </code>
            </div>
            <div>
              <strong>DNS Auth (SPF/DKIM/DMARC):</strong>{' '}
              <span>
                {overview.email.domainAuthentication?.allConfigured
                  ? '✓ All Confirmed'
                  : `SPF:${overview.email.domainAuthentication?.spfConfigured ? '✓' : '✗'} DKIM:${overview.email.domainAuthentication?.dkimConfigured ? '✓' : '✗'} DMARC:${overview.email.domainAuthentication?.dmarcConfigured ? '✓' : '✗'}`}
              </span>
            </div>
          </div>

          {overview.email.misconfigurationCode && (
            <div style={{ padding: 10, borderRadius: 6, background: '#fef2f2', border: '1px solid #fecaca', color: '#991b1b', fontSize: 12 }}>
              <strong>Fail-Closed Reason:</strong> <code>{overview.email.misconfigurationCode}</code>
            </div>
          )}

          {/* Domain Authentication Guidance (SPF / DKIM / DMARC) */}
          <div
            data-testid="email-domain-auth-guidance"
            style={{
              padding: 10,
              borderRadius: 6,
              background: '#eff6ff',
              border: '1px solid #bfdbfe',
              color: '#1e3a8a',
              fontSize: 12,
            }}
          >
            <strong>Brevo Domain Authentication Guidance (SPF / DKIM / DMARC):</strong>
            <ul style={{ margin: '6px 0 0 18px', padding: 0 }}>
              {overview.contracts.brevo.domainAuthRequirements.map((item, idx) => (
                <li key={idx} style={{ marginBottom: 2 }}>
                  {item}
                </li>
              ))}
            </ul>
          </div>

          {/* Last Verification & Test-Send Result */}
          <div
            data-testid="email-last-test-card"
            style={{
              padding: 10,
              borderRadius: 6,
              background: '#f8fafc',
              border: '1px solid #e2e8f0',
              fontSize: 12,
            }}
          >
            <div>
              <strong>Connection & Sender Check:</strong>{' '}
              {overview.email.verification.verifiedAt
                ? `Verified at ${overview.email.verification.verifiedAt} (${overview.email.verification.verificationMethod ?? 'OK'})`
                : overview.email.verification.lastVerificationError
                  ? `Failed (${overview.email.verification.lastVerificationError})`
                  : 'Not yet verified'}
            </div>
            <div style={{ marginTop: 4 }}>
              <strong>Last Test-Send:</strong>{' '}
              {overview.email.lastTest.testedAt
                ? `${overview.email.lastTest.status} to ${overview.email.lastTest.destinationMasked ?? '***'} at ${overview.email.lastTest.testedAt}${overview.email.lastTest.providerRef ? ` (ref: ${overview.email.lastTest.providerRef})` : ''}${overview.email.lastTest.errorCode ? ` [error: ${overview.email.lastTest.errorCode}]` : ''}`
                : 'No test-send recorded for current configuration'}
            </div>
          </div>

          {/* Verify + Quick Test-Send Controls */}
          {permissions.canTestSend && (
            <div style={{ padding: 12, borderRadius: 8, border: '1px dashed #cbd5e1', display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <strong style={{ fontSize: 12 }}>Brevo Connection Check & Controlled Email Test-Send</strong>
                <button
                  type="button"
                  data-testid="verify-email-provider-btn"
                  disabled={
                    emailBusy ||
                    overview.email.source !== 'DATABASE' ||
                    overview.email.provider === 'none' ||
                    overview.email.provider === 'console'
                  }
                  onClick={() => void handleVerifyChannel('EMAIL')}
                  style={{
                    padding: '5px 10px',
                    borderRadius: 6,
                    border: '1px solid #2563eb',
                    background: '#eff6ff',
                    color: '#1d4ed8',
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  Verify Brevo Connection & Sender
                </button>
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <input
                  type="email"
                  data-testid="email-quick-test-destination"
                  placeholder="ops@monienaija.ng (workforce email)"
                  value={emailTestDest}
                  onChange={(e) => setEmailTestDest(e.target.value)}
                  style={{ flex: 1, minWidth: 190, padding: '6px 8px', borderRadius: 6, border: '1px solid #cbd5e1', fontSize: 12 }}
                />
                <button
                  type="button"
                  data-testid="email-quick-test-send-btn"
                  disabled={emailTestBusy}
                  onClick={() => void handleQuickTestSend('EMAIL')}
                  style={{
                    padding: '6px 12px',
                    borderRadius: 6,
                    border: 'none',
                    background: '#0f172a',
                    color: '#ffffff',
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  {emailTestBusy ? 'Sending…' : 'Send Test Email'}
                </button>
              </div>
              <label style={{ fontSize: 11, color: '#475569', display: 'flex', alignItems: 'center', gap: 6 }}>
                <input
                  type="checkbox"
                  data-testid="email-quick-test-confirm"
                  checked={emailTestConfirmed}
                  onChange={(e) => setEmailTestConfirmed(e.target.checked)}
                />
                Destination belongs to an authorized workforce operator (max 5/hour rate limit).
              </label>
              {emailTestMsg && (
                <div
                  data-testid="email-quick-test-feedback"
                  style={{
                    fontSize: 12,
                    color: emailTestMsg.kind === 'ok' ? '#166534' : '#991b1b',
                  }}
                >
                  {emailTestMsg.text}
                </div>
              )}
            </div>
          )}

          {/* Governed Email Proposal Form */}
          <form onSubmit={(e) => void handleSubmitEmailProposal(e)} style={{ display: 'flex', flexDirection: 'column', gap: 10, borderTop: '1px solid #e2e8f0', paddingTop: 12 }}>
            <div style={{ fontWeight: 700, fontSize: 13, color: '#0f172a' }}>
              Propose Email Provider Change (Maker-Checker + MFA)
            </div>

            {!permissions.canProposeProviderConfig && (
              <div style={{ fontSize: 12, color: '#64748b', background: '#f8fafc', padding: 8, borderRadius: 6 }}>
                Read-only view: Proposing provider changes requires <code>SUPER_ADMIN</code> with{' '}
                <code>notification.provider.configure</code> and step-up MFA.
              </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <label style={{ fontSize: 12, display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span>Email Provider</span>
                <select
                  data-testid="email-provider-select"
                  value={emailProvider}
                  disabled={!permissions.canProposeProviderConfig}
                  onChange={(e) => {
                    const next = e.target.value as 'brevo' | 'resend' | 'none' | 'console';
                    setEmailProvider(next);
                    if (next === 'brevo') setEmailBaseUrl('https://api.brevo.com');
                    if (next === 'resend') setEmailBaseUrl('https://api.resend.com');
                    if ((next === 'brevo' || next === 'resend') && !overview.email.hasStoredCredential) {
                      setEmailCredAction('SET_ENCRYPTED');
                    }
                  }}
                  style={{ padding: '6px 8px', borderRadius: 6, border: '1px solid #cbd5e1', fontSize: 12 }}
                >
                  <option value="brevo">brevo (Brevo v3 Transactional Email API)</option>
                  <option value="resend">resend (Resend HTTP Email API)</option>
                  <option value="none">none (Email Channel Dark / Disabled)</option>
                  <option value="console">console (Dev/Test Simulation Only)</option>
                </select>
              </label>

              <label style={{ fontSize: 12, display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span>Timeout (ms)</span>
                <input
                  type="number"
                  min={1000}
                  max={60000}
                  value={emailTimeoutMs}
                  disabled={!permissions.canProposeProviderConfig}
                  onChange={(e) => setEmailTimeoutMs(Number(e.target.value))}
                  style={{ padding: '6px 8px', borderRadius: 6, border: '1px solid #cbd5e1', fontSize: 12 }}
                />
              </label>
            </div>

            {(emailProvider === 'brevo' || emailProvider === 'resend') && (
              <>
                <label style={{ fontSize: 12, display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <span>API Base URL (Pinned HTTPS Origin)</span>
                  <input
                    type="url"
                    data-testid="email-base-url-input"
                    value={emailBaseUrl}
                    readOnly
                    disabled={!permissions.canProposeProviderConfig}
                    style={{
                      padding: '6px 8px',
                      borderRadius: 6,
                      border: '1px solid #cbd5e1',
                      background: '#f8fafc',
                      fontSize: 12,
                    }}
                  />
                </label>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <label style={{ fontSize: 12, display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <span>Verified Sender Email</span>
                    <input
                      type="email"
                      data-testid="email-from-address-input"
                      value={emailFromAddress}
                      disabled={!permissions.canProposeProviderConfig}
                      onChange={(e) => setEmailFromAddress(e.target.value)}
                      placeholder="notifications@monienaija.ng"
                      style={{ padding: '6px 8px', borderRadius: 6, border: '1px solid #cbd5e1', fontSize: 12 }}
                    />
                  </label>
                  <label style={{ fontSize: 12, display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <span>Sender Display Name</span>
                    <input
                      type="text"
                      data-testid="email-from-name-input"
                      value={emailFromName}
                      disabled={!permissions.canProposeProviderConfig}
                      onChange={(e) => setEmailFromName(e.target.value)}
                      placeholder="MonieNaija"
                      style={{ padding: '6px 8px', borderRadius: 6, border: '1px solid #cbd5e1', fontSize: 12 }}
                    />
                  </label>
                </div>

                <label style={{ fontSize: 12, display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <span>Reply-To Email (Optional)</span>
                  <input
                    type="email"
                    data-testid="email-reply-to-input"
                    value={emailReplyTo}
                    disabled={!permissions.canProposeProviderConfig}
                    onChange={(e) => setEmailReplyTo(e.target.value)}
                    placeholder="support@monienaija.ng"
                    style={{ padding: '6px 8px', borderRadius: 6, border: '1px solid #cbd5e1', fontSize: 12 }}
                  />
                </label>

                <label style={{ fontSize: 12, display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <span>Credential Action</span>
                  <select
                    data-testid="email-credential-action-select"
                    value={emailCredAction}
                    disabled={!permissions.canProposeProviderConfig}
                    onChange={(e) => setEmailCredAction(e.target.value as ProviderCredentialAction)}
                    style={{ padding: '6px 8px', borderRadius: 6, border: '1px solid #cbd5e1', fontSize: 12 }}
                  >
                    <option value="SET_ENCRYPTED">Set / Rotate Encrypted API Key (AES-256-GCM)</option>
                    <option value="KEEP_EXISTING">Keep Existing Stored Credential</option>
                    <option value="USE_ENV_SECRET">Use Server Environment Secret</option>
                    <option value="CLEAR">Clear Stored Credential (Requires Disabled)</option>
                  </select>
                </label>

                {emailCredAction === 'SET_ENCRYPTED' && (
                  <label style={{ fontSize: 12, display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <span>
                      {emailProvider === 'brevo'
                        ? 'Brevo v3 REST API Key (xkeysib-... — NOT xsmtpsib- SMTP password)'
                        : 'Resend API Key (re_...)'}
                    </span>
                    <input
                      type="password"
                      autoComplete="new-password"
                      data-testid="email-api-key-input"
                      value={emailApiKey}
                      disabled={!permissions.canProposeProviderConfig}
                      onChange={(e) => setEmailApiKey(e.target.value)}
                      placeholder={
                        emailProvider === 'brevo'
                          ? 'Enter Brevo v3 REST API key (xkeysib-...)'
                          : 'Enter Resend API key (re_...)'
                      }
                      style={{ padding: '6px 8px', borderRadius: 6, border: '1px solid #cbd5e1', fontSize: 12 }}
                    />
                  </label>
                )}

                <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 12 }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    <input
                      type="checkbox"
                      data-testid="email-spf-checkbox"
                      checked={emailSpf}
                      disabled={!permissions.canProposeProviderConfig}
                      onChange={(e) => setEmailSpf(e.target.checked)}
                    />
                    SPF DNS Confirmed
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    <input
                      type="checkbox"
                      data-testid="email-dkim-checkbox"
                      checked={emailDkim}
                      disabled={!permissions.canProposeProviderConfig}
                      onChange={(e) => setEmailDkim(e.target.checked)}
                    />
                    DKIM DNS Confirmed
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    <input
                      type="checkbox"
                      data-testid="email-dmarc-checkbox"
                      checked={emailDmarc}
                      disabled={!permissions.canProposeProviderConfig}
                      onChange={(e) => setEmailDmarc(e.target.checked)}
                    />
                    DMARC DNS Confirmed
                  </label>
                </div>
              </>
            )}

            {emailProvider !== 'none' && (
              <label style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
                <input
                  type="checkbox"
                  data-testid="email-enabled-checkbox"
                  checked={emailEnabled}
                  disabled={!permissions.canProposeProviderConfig}
                  onChange={(e) => setEmailEnabled(e.target.checked)}
                />
                <span>Enable Email Provider for Customer Outbox & Transactional Dispatch</span>
              </label>
            )}

            <label style={{ fontSize: 12, display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span>Governance Audit Reason (10–500 chars)</span>
              <input
                type="text"
                data-testid="email-reason-input"
                value={emailReason}
                disabled={!permissions.canProposeProviderConfig}
                onChange={(e) => setEmailReason(e.target.value)}
                placeholder="e.g. Configure Brevo v3 REST API key and verified sender identity"
                style={{ padding: '6px 8px', borderRadius: 6, border: '1px solid #cbd5e1', fontSize: 12 }}
              />
            </label>

            {emailFormErrors.length > 0 && (
              <div data-testid="email-form-errors" style={{ padding: 10, borderRadius: 6, background: '#fef2f2', border: '1px solid #fecaca', color: '#991b1b', fontSize: 12 }}>
                {emailFormErrors.map((err, i) => (
                  <div key={i}>• {err}</div>
                ))}
              </div>
            )}

            {emailFeedback && (
              <div
                data-testid="email-proposal-feedback"
                style={{
                  padding: 10,
                  borderRadius: 6,
                  background: emailFeedback.kind === 'ok' ? '#f0fdf4' : '#fef2f2',
                  border: `1px solid ${emailFeedback.kind === 'ok' ? '#86efac' : '#fecaca'}`,
                  color: emailFeedback.kind === 'ok' ? '#166534' : '#991b1b',
                  fontSize: 12,
                }}
              >
                {emailFeedback.text}
              </div>
            )}

            <button
              type="submit"
              data-testid="submit-email-proposal-btn"
              disabled={!permissions.canProposeProviderConfig || !permissions.hasMfaAssurance || emailBusy}
              style={{
                padding: '8px 14px',
                borderRadius: 6,
                border: 'none',
                background:
                  permissions.canProposeProviderConfig && permissions.hasMfaAssurance
                    ? '#2563eb'
                    : '#94a3b8',
                color: '#ffffff',
                fontWeight: 600,
                fontSize: 12,
                cursor:
                  permissions.canProposeProviderConfig && permissions.hasMfaAssurance
                    ? 'pointer'
                    : 'not-allowed',
              }}
            >
              {emailBusy
                ? 'Submitting Email Proposal…'
                : !permissions.hasMfaAssurance && permissions.canProposeProviderConfig
                  ? 'MFA Required to Propose Email Change'
                  : 'Submit Email Configuration Proposal'}
            </button>
          </form>
        </section>
      </div>

      {/* ==================== GOVERNED PROPOSALS QUEUE ==================== */}
      <section
        data-testid="provider-proposals-section"
        style={{
          background: '#ffffff',
          border: '1px solid #e2e8f0',
          borderRadius: 12,
          padding: 20,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div>
            <h3 style={{ margin: 0, fontSize: 15, color: '#0f172a' }}>
              Governed Provider Configuration Proposals (Maker-Checker & Activation)
            </h3>
            <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>
              Initiating administrator cannot approve their own change. Independent{' '}
              <code>FINANCE_CONTROLLER</code> + MFA approval is required prior to activation.
            </div>
          </div>
        </div>

        {queueBanner && (
          <div
            data-testid="provider-queue-banner"
            style={{
              marginBottom: 12,
              padding: 10,
              borderRadius: 6,
              background: queueBanner.kind === 'ok' ? '#f0fdf4' : '#fef2f2',
              border: `1px solid ${queueBanner.kind === 'ok' ? '#86efac' : '#fecaca'}`,
              color: queueBanner.kind === 'ok' ? '#166534' : '#991b1b',
              fontSize: 12,
            }}
          >
            {queueBanner.text}
          </div>
        )}

        {proposals.length === 0 ? (
          <div style={{ fontSize: 12, color: '#64748b', padding: 12 }}>
            No provider configuration proposals submitted yet.
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table
              data-testid="provider-proposals-table"
              style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}
            >
              <thead>
                <tr style={{ background: '#f8fafc', textAlign: 'left', borderBottom: '1px solid #e2e8f0' }}>
                  <th style={{ padding: 8 }}>Channel</th>
                  <th style={{ padding: 8 }}>Proposed Change</th>
                  <th style={{ padding: 8 }}>Credential</th>
                  <th style={{ padding: 8 }}>Sender / DNS</th>
                  <th style={{ padding: 8 }}>Proposer & Reason</th>
                  <th style={{ padding: 8 }}>Status</th>
                  <th style={{ padding: 8 }}>Governance Action</th>
                </tr>
              </thead>
              <tbody>
                {proposals.map((prop) => {
                  const isSelf = Boolean(
                    principalId && principalId === prop.proposerPrincipalId,
                  );
                  const canApproveThis =
                    prop.status === 'REQUESTED' &&
                    permissions.canApproveProviderConfig &&
                    permissions.hasMfaAssurance &&
                    !isSelf;
                  const canActivateThis =
                    prop.status === 'APPROVED' &&
                    permissions.canActivateProviderConfig &&
                    permissions.hasMfaAssurance;
                  const busy = queueBusyId === prop.id;

                  return (
                    <tr key={prop.id} data-testid={`provider-proposal-row-${prop.id}`} style={{ borderBottom: '1px solid #f1f5f9' }}>
                      <td style={{ padding: 8, fontWeight: 700 }}>{prop.channel}</td>
                      <td style={{ padding: 8 }}>
                        <code>{prop.proposedProvider}</code> ·{' '}
                        {prop.proposedEnabled ? 'ENABLED' : 'DISABLED'} (base v{prop.expectedVersion})
                      </td>
                      <td style={{ padding: 8 }}>
                        <div>{prop.credentialAction}</div>
                        {prop.proposedKeyFingerprint && (
                          <code>{prop.proposedKeyFingerprint}</code>
                        )}
                      </td>
                      <td style={{ padding: 8 }}>
                        {prop.channel === 'SMS'
                          ? prop.proposedSenderId || 'Workspace default'
                          : prop.proposedFromEmail
                            ? `${prop.proposedFromName ? `${prop.proposedFromName} ` : ''}<${prop.proposedFromEmail}>`
                            : '—'}
                      </td>
                      <td style={{ padding: 8 }}>
                        <div>
                          <strong>{prop.proposerPrincipalId}</strong>
                        </div>
                        <div style={{ color: '#475569' }}>{prop.reason}</div>
                      </td>
                      <td style={{ padding: 8 }}>
                        <span style={{ fontWeight: 700 }}>{prop.status}</span>
                        {prop.decidedBy && (
                          <div style={{ color: '#64748b', fontSize: 11 }}>
                            by {prop.decidedBy}
                          </div>
                        )}
                        {prop.resultingVersion && (
                          <div style={{ color: '#166534', fontSize: 11 }}>
                            activated v{prop.resultingVersion}
                          </div>
                        )}
                      </td>
                      <td style={{ padding: 8 }}>
                        {prop.status === 'REQUESTED' && isSelf && (
                          <span
                            data-testid={`self-approval-blocked-${prop.id}`}
                            style={{
                              display: 'inline-block',
                              padding: '3px 8px',
                              borderRadius: 6,
                              background: '#fef3c7',
                              color: '#92400e',
                              fontSize: 11,
                              fontWeight: 600,
                            }}
                          >
                            Self-Approval Prohibited
                          </span>
                        )}
                        {prop.status === 'REQUESTED' && !isSelf && permissions.canApproveProviderConfig && (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                            <input
                              type="text"
                              data-testid={`decision-comment-${prop.id}`}
                              placeholder="Checker note (optional)"
                              value={decisionComments[prop.id] ?? ''}
                              onChange={(e) =>
                                setDecisionComments((prev) => ({
                                  ...prev,
                                  [prop.id]: e.target.value,
                                }))
                              }
                              style={{ padding: '4px 6px', borderRadius: 4, border: '1px solid #cbd5e1', fontSize: 11 }}
                            />
                            <div style={{ display: 'flex', gap: 6 }}>
                              <button
                                type="button"
                                data-testid={`approve-provider-proposal-${prop.id}`}
                                disabled={!canApproveThis || busy}
                                onClick={() => void handleProposalAction(prop, 'approve')}
                                style={{
                                  padding: '4px 10px',
                                  borderRadius: 4,
                                  border: 'none',
                                  background: canApproveThis ? '#16a34a' : '#94a3b8',
                                  color: '#ffffff',
                                  fontWeight: 600,
                                  fontSize: 11,
                                  cursor: canApproveThis ? 'pointer' : 'not-allowed',
                                }}
                              >
                                Approve
                              </button>
                              <button
                                type="button"
                                data-testid={`reject-provider-proposal-${prop.id}`}
                                disabled={!canApproveThis || busy}
                                onClick={() => void handleProposalAction(prop, 'reject')}
                                style={{
                                  padding: '4px 10px',
                                  borderRadius: 4,
                                  border: '1px solid #dc2626',
                                  background: '#ffffff',
                                  color: '#dc2626',
                                  fontWeight: 600,
                                  fontSize: 11,
                                  cursor: canApproveThis ? 'pointer' : 'not-allowed',
                                }}
                              >
                                Reject
                              </button>
                            </div>
                          </div>
                        )}
                        {prop.status === 'APPROVED' && permissions.canActivateProviderConfig && (
                          <button
                            type="button"
                            data-testid={`activate-provider-proposal-${prop.id}`}
                            disabled={!canActivateThis || busy}
                            onClick={() => void handleProposalAction(prop, 'activate')}
                            style={{
                              padding: '5px 12px',
                              borderRadius: 4,
                              border: 'none',
                              background: canActivateThis ? '#2563eb' : '#94a3b8',
                              color: '#ffffff',
                              fontWeight: 700,
                              fontSize: 11,
                              cursor: canActivateThis ? 'pointer' : 'not-allowed',
                            }}
                          >
                            {busy ? 'Activating…' : 'Activate Configuration'}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
};
