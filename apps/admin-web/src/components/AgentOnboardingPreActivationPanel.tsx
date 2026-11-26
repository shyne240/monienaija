import React, { useCallback, useEffect, useRef, useState } from 'react';

import { ApiClient } from '../services/api-client';
import type { AgentClassMissingConfiguration } from '../services/agent-class-lifecycle-api';

/**
 * Pre-activation configuration review.
 *
 * The one irreversible moment in Agent onboarding is activation: from that instant the Agent's class
 * decides which services it may perform and which fees, commissions and limits apply, and the
 * operator cannot see any of that from an application row that only shows a class NAME.
 *
 * So before an APPROVED application is activated, this panel resolves — against the real read
 * surfaces, not a client-side guess:
 *
 *   class + permitted services   the persisted class row itself
 *   effective limits             `GET /internal/limit-assignments/agent-class/:id`
 *   effective fee / commission   `GET /internal/commercial-configuration/effective-preview`
 *                                with `agentClassId` set, one call per product/currency/direction
 *
 * Two rules it will not break:
 *
 *  1. **Absent is not zero.** A class with no limit assignment is reported as "no limit profile
 *     assigned — not the same as unlimited". A product with no fee rule is reported as "fee
 *     undefined", never as ₦0. The preview endpoint already returns MISSING/NOT_APPLICABLE for
 *     exactly this reason and those statuses are surfaced verbatim.
 *  2. **Missing configuration never blocks activation.** A class mid-configuration is a legitimate
 *     state; the panel informs and the operator decides. What it will not do is imply readiness it
 *     has not verified.
 *
 * Product codes come from the class's permitted services using the same mapping the backend uses
 * (`PRODUCT_CODES_BY_SERVICE`): fees and commissions are keyed on `CASH_TO_WALLET`-style product
 * codes, not on `CASH_IN`-style service names.
 */

/** Mirrors `src/agent/agent-service.enum.ts` — the two vocabularies name the same movement. */
const PRODUCT_CODES_BY_SERVICE: Record<string, readonly string[]> = {
  WALLET_TRANSFER: ['WALLET_TRANSFER'],
  CASH_IN: ['CASH_TO_WALLET'],
  CASH_OUT: ['WALLET_TO_CASH'],
  CASH_TO_CASH: ['CASH_TO_CASH'],
  AGENT_FUNDING: [],
  AGENT_DEFUNDING: [],
  EXTERNAL_BANK_TRANSFER: [],
};

const CURRENCY = 'NGN';

/** Product → the direction the preview expects. The engine is direction-aware. */
const DIRECTION_BY_PRODUCT: Record<string, 'INCOMING' | 'OUTGOING' | 'BOTH'> = {
  CASH_TO_WALLET: 'OUTGOING',
  WALLET_TO_CASH: 'INCOMING',
  CASH_TO_CASH: 'BOTH',
  WALLET_TRANSFER: 'BOTH',
};

interface ProductPreview {
  fee?: PreviewSection;
  commission?: PreviewSection;
}

interface PreviewSection {
  status?: string;
  note?: string | null;
  computed?: {
    status?: string;
    feeMinor?: string | null;
    vatMinor?: string | null;
    totalMinor?: string | null;
    calculationModel?: string | null;
  } | null;
  rule?: { percentageBps?: number | null; flatFeeMinor?: string | null } | null;
}

interface AgentClassOption {
  id: string;
  code: string;
  name: string;
  isActive?: boolean;
  /** JSONB from the backend, so the shape is only known after normalization. */
  applicableServices?: unknown;
}

/** Normalizes the JSONB service list; an unexpected shape reads as "nothing declared". */
function normalizeServices(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0);
}

interface LimitAssignment {
  limitProfileCode: string;
  isActive?: boolean;
  effectiveTo?: string | null;
}

function formatMinor(value: string | null | undefined): string {
  if (value === null || value === undefined) return '—';
  const n = Number(value);
  if (!Number.isFinite(n)) return value;
  return `₦${(n / 100).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const box: React.CSSProperties = {
  border: '1px solid #d7dce5',
  borderRadius: 10,
  padding: 14,
  background: '#fbfcfe',
  margin: '8px 0 12px',
  fontSize: 13,
};
const heading: React.CSSProperties = { fontSize: 13, fontWeight: 700, margin: '0 0 8px' };
const muted: React.CSSProperties = { color: '#5b6577', fontSize: 12 };
const warn: React.CSSProperties = { color: '#8a5a00', fontSize: 12, fontWeight: 600 };
const table: React.CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: 12 };
const th: React.CSSProperties = {
  textAlign: 'left',
  padding: '4px 8px 4px 0',
  color: '#5b6577',
  fontWeight: 600,
};
const td: React.CSSProperties = { padding: '4px 8px 4px 0', verticalAlign: 'top' };

export interface AgentOnboardingPreActivationPanelProps {
  /** Class the application will activate the Agent under. */
  agentClassId: string;
  /** Resolved catalogue row, when the catalogue has been read. */
  agentClass?: AgentClassOption | null;
}

export const AgentOnboardingPreActivationPanel: React.FC<
  AgentOnboardingPreActivationPanelProps
> = ({ agentClassId, agentClass }) => {
  const [limits, setLimits] = useState<LimitAssignment[] | null>(null);
  const [limitsError, setLimitsError] = useState('');
  const [previews, setPreviews] = useState<Record<string, ProductPreview | { error: string }>>({});
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const generation = useRef(0);

  const load = useCallback(async (classId: string) => {
    const gen = ++generation.current;
    const valid = () => generation.current === gen;
    setLoading(true);
    setLimitsError('');
    setLimits(null);
    setPreviews({});

    try {
      const res: any = await ApiClient.get(
        `/internal/limit-assignments/agent-class/${encodeURIComponent(classId)}`,
      );
      if (!valid()) return;
      const rows = Array.isArray(res) ? res : (res?.data ?? []);
      setLimits(
        (Array.isArray(rows) ? rows : []).filter(
          (row: LimitAssignment) => row.isActive !== false,
        ) as LimitAssignment[],
      );
    } catch (e: any) {
      if (!valid()) return;
      setLimits(null);
      setLimitsError(e?.message || 'Effective limits could not be read.');
    }

    /*
     * One preview per product code the class actually permits. Sequential-on-purpose is avoided:
     * these are independent reads and the operator is waiting, but each result is written through
     * the generation guard so a late response for a previous class cannot land.
     */
    const services = normalizeServices(agentClass?.applicableServices);
    const productCodes = Array.from(
      new Set(services.flatMap((service) => PRODUCT_CODES_BY_SERVICE[service] ?? [])),
    );
    await Promise.all(
      productCodes.map(async (productCode) => {
        const params = new URLSearchParams({
          productCode,
          currency: CURRENCY,
          principalType: 'AGENT',
          agentClassId: classId,
          direction: DIRECTION_BY_PRODUCT[productCode] ?? 'BOTH',
          amountMinor: '50000',
        });
        try {
          const body: any = await ApiClient.get(
            `/internal/commercial-configuration/effective-preview?${params.toString()}`,
          );
          if (!valid()) return;
          setPreviews((cur) => ({
            ...cur,
            [productCode]: { fee: body?.fee, commission: body?.commission } as ProductPreview,
          }));
        } catch (e: any) {
          if (!valid()) return;
          setPreviews((cur) => ({
            ...cur,
            [productCode]: { error: e?.message || 'Preview unavailable.' },
          }));
        }
      }),
    );
    if (valid()) setLoading(false);
  }, [agentClass?.applicableServices]);

  useEffect(() => {
    if (!expanded || !agentClassId) return;
    void load(agentClassId);
    return () => {
      generation.current += 1;
    };
  }, [expanded, agentClassId, load]);

  const services = normalizeServices(agentClass?.applicableServices);
  const productCodes = Array.from(
    new Set(services.flatMap((service) => PRODUCT_CODES_BY_SERVICE[service] ?? [])),
  );

  /** Gaps derivable from what has already been read, in the same vocabulary as the backend. */
  const gaps: AgentClassMissingConfiguration[] = [];
  if (agentClass && agentClass.isActive === false) {
    gaps.push({
      code: 'CLASS_INACTIVE',
      surface: 'AGENT_CLASSES',
      detail: 'This class is inactive; activation will be refused or produce an unusable Agent.',
    });
  }
  if (agentClass && services.length === 0) {
    gaps.push({
      code: 'NO_APPLICABLE_SERVICES',
      surface: 'AGENT_CLASSES',
      detail: 'This class permits no services, so the Agent could not transact at all.',
    });
  }
  if (limits !== null && limits.length === 0) {
    gaps.push({
      code: 'NO_EFFECTIVE_LIMITS',
      surface: 'LIMITS',
      detail:
        'No active limit profile is assigned to this class. Limit-governed operations cannot resolve a profile — this is NOT the same as unlimited.',
    });
  }

  if (!agentClassId) return null;

  return (
    <div style={box} data-testid="onboarding-pre-activation">
      <p style={heading}>Configuration this Agent will inherit</p>
      <p style={muted}>
        Activation is when the class stops being a label and starts governing money. Review what
        this Agent will be permitted to do, and what it will be charged, before you activate.
      </p>
      <button
        type="button"
        style={{ ...muted, background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
        onClick={() => setExpanded((v) => !v)}
        data-testid="onboarding-pre-activation-toggle"
      >
        {expanded ? 'Hide configuration detail' : 'Show configuration detail'}
      </button>

      {expanded ? (
        <div style={{ marginTop: 10 }}>
          <p style={heading}>Selected class</p>
          <p style={muted} data-testid="pre-activation-class">
            {agentClass ? (
              <>
                <strong>
                  {agentClass.name} ({agentClass.code})
                </strong>
                {agentClass.isActive === false ? ' — INACTIVE' : ' — active'}
              </>
            ) : (
              <>
                Class <code>{agentClassId}</code> is not in the loaded catalogue, so its services
                cannot be shown. Do not activate until it resolves.
              </>
            )}
          </p>

          <p style={heading}>Eligible services</p>
          {services.length === 0 ? (
            <p style={warn} data-testid="pre-activation-services">
              None. This class permits no services.
            </p>
          ) : (
            <p style={muted} data-testid="pre-activation-services">
              {services.join(', ')}
            </p>
          )}

          <p style={heading}>Effective limits</p>
          {loading && limits === null ? (
            <p style={muted}>Reading limit assignments…</p>
          ) : limitsError ? (
            <p style={warn} data-testid="pre-activation-limits">
              Limits could not be read: {limitsError} Treat them as unknown, not as unlimited.
            </p>
          ) : limits && limits.length > 0 ? (
            <table style={table} data-testid="pre-activation-limits">
              <tbody>
                {limits.map((row) => {
                  const expired = row.effectiveTo && new Date(row.effectiveTo) <= new Date();
                  return (
                    <tr key={row.limitProfileCode}>
                      <td style={td}>
                        <code>{row.limitProfileCode}</code>
                      </td>
                      <td style={{ ...td, ...(expired ? warn : muted) }}>
                        {expired ? 'expired assignment' : 'active assignment'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <p style={warn} data-testid="pre-activation-limits">
              No active limit profile is assigned to this class. Limit-governed operations cannot
              resolve a profile — this is NOT the same as unlimited.
            </p>
          )}

          <p style={heading}>Effective fees and commissions (per {CURRENCY})</p>
          {productCodes.length === 0 ? (
            <p style={muted} data-testid="pre-activation-pricing">
              This class permits no customer-facing product, so there is no fee or commission to
              resolve.
            </p>
          ) : (
            <table style={table} data-testid="pre-activation-pricing">
              <thead>
                <tr>
                  <th style={th}>Product</th>
                  <th style={th}>Fee</th>
                  <th style={th}>Commission</th>
                </tr>
              </thead>
              <tbody>
                {productCodes.map((productCode) => {
                  const entry: any = previews[productCode];
                  const fee: PreviewSection | undefined = entry?.fee;
                  const commission: PreviewSection | undefined = entry?.commission;
                  return (
                    <tr key={productCode}>
                      <td style={td}>
                        <code>{productCode}</code>
                      </td>
                      <td style={td} data-testid={`pre-activation-fee-${productCode}`}>
                        {entry?.error ? (
                          <span style={warn}>unavailable: {entry.error}</span>
                        ) : !fee ? (
                          <span style={muted}>reading…</span>
                        ) : fee.status === 'RESOLVED' || fee.computed?.status === 'APPLIED' ? (
                          <>
                            {formatMinor(fee.computed?.feeMinor)}
                            {fee.computed?.totalMinor &&
                            fee.computed?.totalMinor !== fee.computed?.feeMinor ? (
                              <div style={muted}>
                                total {formatMinor(fee.computed?.totalMinor)}
                              </div>
                            ) : null}
                            <div style={muted}>
                              {fee.rule?.percentageBps
                                ? `${fee.rule.percentageBps / 100}%`
                                : formatMinor(fee.rule?.flatFeeMinor)}
                              {fee.computed?.calculationModel
                                ? ` · ${fee.computed.calculationModel}`
                                : ''}
                            </div>
                          </>
                        ) : (
                          <span style={warn}>
                            {fee.status === 'MISSING'
                              ? 'no fee rule — charge undefined, not zero'
                              : `${fee.status ?? 'unresolved'}${fee.note ? `: ${fee.note}` : ''}`}
                          </span>
                        )}
                      </td>
                      <td style={td} data-testid={`pre-activation-commission-${productCode}`}>
                        {entry?.error ? (
                          <span style={warn}>unavailable: {entry.error}</span>
                        ) : !commission ? (
                          <span style={muted}>reading…</span>
                        ) : commission.status === 'RESOLVED' ? (
                          <>
                            {formatMinor(commission.computed?.feeMinor)}
                            <div style={muted}>
                              {commission.computed?.calculationModel ?? 'resolved'}
                            </div>
                          </>
                        ) : (
                          <span style={warn}>
                            {commission.status === 'MISSING'
                              ? 'no commission rule — nothing would accrue'
                              : `${commission.status ?? 'unresolved'}${commission.note ? `: ${commission.note}` : ''}`}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}

          {gaps.length > 0 ? (
            <div style={{ marginTop: 10 }} data-testid="pre-activation-gaps">
              <p style={heading}>Required configuration still missing</p>
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {gaps.map((gap) => (
                  <li key={gap.code} style={warn}>
                    <strong>{gap.code}</strong> ({gap.surface}): {gap.detail}
                  </li>
                ))}
              </ul>
              <p style={muted}>
                Missing configuration does not block activation. It does mean this Agent may reach
                operations whose limits or charges are undefined, so fix these first if you intend
                the Agent to transact immediately.
              </p>
            </div>
          ) : null}

          <p style={muted}>
            Read-only. Nothing here reserves, charges, accrues or posts anything; these are the same
            resolvers the live command path uses.
          </p>
        </div>
      ) : null}
    </div>
  );
};
