export interface RetentionPolicy {
  name: 'metrics' | 'audit' | 'idempotency' | 'outbox';
  retentionSeconds: number;
  cutoff: string;
}

export interface RetentionCount {
  name: RetentionPolicy['name'];
  candidates: number;
}

export interface RetentionReport {
  dryRun: boolean;
  policies: RetentionPolicy[];
  counts: RetentionCount[];
  executedAt: string;
}

export interface GovernanceMetadataView {
  id: string;
  applicationVersion: string;
  migrationHead: string;
  configurationFingerprint: string;
  buildTimestamp: string | null;
  startupTimestamp: string;
  environment: string;
  apiVersion: string;
  createdAt: string;
}

export interface OperationalHealthDashboard {
  systemStatus: 'PASS' | 'WARNING' | 'FAIL';
  database: { status: string };
  migrations: { status: string; compatible: boolean; latestName: string | null };
  ledger: { status: 'PASS' | 'WARNING' | 'ERROR' };
  reconciliation: { status: 'PASS' | 'WARNING' | 'ERROR' };
  outbox: { status: 'PASS' | 'WARNING' | 'ERROR'; pending: number };
  audit: { status: 'PASS' | 'WARNING' | 'ERROR'; eventCount: number };
  metrics: Record<string, string>;
  applicationVersion: string;
  apiVersion: string;
  governance: GovernanceMetadataView | null;
  generatedAt: string;
}

export interface AcceptanceReport {
  status: 'PASS' | 'WARNING' | 'FAIL';
  checks: Array<{ name: string; status: 'PASS' | 'WARNING' | 'FAIL'; message: string }>;
  applicationVersion: string;
  apiVersion: string;
  generatedAt: string;
}
