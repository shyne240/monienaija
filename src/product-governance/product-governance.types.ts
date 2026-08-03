import type { ProductGovernanceKind, ProductGovernanceStatus } from './product-governance.enums';

export interface CreateProductGovernanceCommand {
  kind: ProductGovernanceKind;
  recordKey: string;
  name: string;
  status: ProductGovernanceStatus;
  version: number;
  parentId?: string;
  payload: Record<string, unknown>;
  immutableRecord: boolean;
  actor: string;
}

export interface UpdateProductGovernanceCommand {
  name?: string;
  status?: ProductGovernanceStatus;
  payload?: Record<string, unknown>;
  actor: string;
}

export interface ProductGovernanceView {
  id: string;
  kind: ProductGovernanceKind;
  recordKey: string;
  name: string;
  status: ProductGovernanceStatus;
  version: number;
  parentId: string | null;
  payload: Record<string, unknown>;
  immutableRecord: boolean;
  createdBy: string;
  updatedBy: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProductGovernanceReport {
  generatedAt: string;
  recordCounts: Record<string, number>;
  blockedRecords: number;
  immutableRecords: number;
  totalRecords: number;
}

export interface LaunchReadinessCheck {
  name: string;
  status: 'PASS' | 'WARNING' | 'FAIL';
  message: string;
  recordCount: number;
}

export interface LaunchReadinessReport {
  status: 'PASS' | 'WARNING' | 'FAIL';
  generatedAt: string;
  checks: LaunchReadinessCheck[];
}
