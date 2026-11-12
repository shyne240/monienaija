import React from 'react';
import { ApiClient } from '../../services/api-client';
import { useWidgetData } from './useWidgetData';
import { isStatusCountData, type StatusCountData } from './widget-validation';

interface Props { canKyc: boolean; canSupport: boolean; canApprovals: boolean; onNavigate: (view: 'kycQueue' | 'support' | 'approvalsInbox') => void; onAgents?: (options?: { openApplications?: boolean }) => void; canAgentNetwork?: boolean; canAgentOnboarding?: boolean }

function KycItems({ onNavigate }: { onNavigate: Props['onNavigate'] }) {
  const { data, loading, error } = useWidgetData<StatusCountData>(async () => {
    const response: unknown = await ApiClient.get('/internal/a2/workforce/dashboard/widgets/kyc-queue-summary');
    if (!isStatusCountData(response, 'kyc-queue-summary')) throw new Error('Invalid KYC counts');
    return response as StatusCountData;
  }, []);
  return <div className="one-action-item"><span aria-hidden="true">◇</span><button type="button" onClick={() => onNavigate('kycQueue')}>KYC assessments</button><span>{loading ? 'Loading…' : error ? 'Unavailable' : data?.byStatus?.length ? data.byStatus.map(row => `${row.status}: ${row.count}`).join(', ') : 'No assessments'}</span></div>;
}
function SupportItems({ onNavigate }: { onNavigate: Props['onNavigate'] }) {
  const { data, loading, error } = useWidgetData<number>(async () => {
    const response: any = await ApiClient.get('/internal/support/tickets?page=1&limit=1&status=OPEN');
    if (!response || !Array.isArray(response.items) || !response.pagination || response.pagination.page !== 1 || response.pagination.limit !== 1 || !Number.isSafeInteger(response.pagination.total) || response.pagination.total < 0 || response.items.length > Math.min(1, response.pagination.total) || response.items.some((ticket: any) => ticket.status !== 'OPEN')) throw new Error('Invalid support queue');
    return response.pagination.total;
  }, []);
  return <div className="one-action-item"><span aria-hidden="true">♧</span><button type="button" onClick={() => onNavigate('support')}>Open support tickets</button><span>{loading ? 'Loading…' : error ? 'Unavailable' : data}</span></div>;
}
export const ActionItems: React.FC<Props> = ({ canKyc, canSupport, canApprovals, onNavigate, onAgents, canAgentNetwork, canAgentOnboarding }) => <section className="one-action-queue" aria-label="Action items">
  <h2>Action Items</h2>
  {canKyc && <KycItems onNavigate={onNavigate} />}
  {canSupport && <SupportItems onNavigate={onNavigate} />}
  {canApprovals && <div className="one-action-item"><span aria-hidden="true">⇄</span><button type="button" onClick={() => onNavigate('approvalsInbox')}>Approvals awaiting review</button><span>Count unavailable</span></div>}
  {onAgents && canAgentNetwork && <div className="one-action-item"><span aria-hidden="true">♙</span><button type="button" onClick={() => onAgents()}>Agent network</button><span>Open →</span></div>}
  {onAgents && canAgentOnboarding && <div className="one-action-item"><span aria-hidden="true">♙</span><button type="button" onClick={() => onAgents({ openApplications: true })}>Agent onboarding</button><span>Review →</span></div>}
  {!canKyc && !canSupport && !canApprovals && !(onAgents && (canAgentNetwork || canAgentOnboarding)) && <p>No action sources are available to this session.</p>}

</section>;
