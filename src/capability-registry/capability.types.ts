export interface CapabilityCreateInput {
  capabilityCode: string;
  domain: string;
  name: string;
  description: string;
  productScope: string;
  lifecycle: string;
  backendStatus: string;
  apiStatus: string;
  adminUiStatus: string;
  customerUiStatus: string;
  agentUiStatus: string;
  enabled: boolean;
  configurationStatus: string;
  dependencies?: string[] | null;
  implementationReferences?: string[] | null;
  migrationReferences?: string[] | null;
  testReferences?: string[] | null;
  documentationReferences?: string[] | null;
  version?: number;
  owner?: string | null;
  blockerType?: string;
  blockerDescription?: string | null;
  notes?: string | null;
}

export interface CapabilitySafeProjection {
  capabilityCode: string;
  domain: string;
  name: string;
  description: string;
  productScope: string;
  lifecycle: string;
  backendStatus: string;
  apiStatus: string;
  adminUiStatus: string;
  customerUiStatus: string;
  agentUiStatus: string;
  enabled: boolean;
  configurationStatus: string;
  dependencies: string[] | null;
  implementationReferences: string[] | null;
  migrationReferences: string[] | null;
  testReferences: string[] | null;
  documentationReferences: string[] | null;
  version: number;
  owner: string | null;
  blockerType: string;
  blockerDescription: string | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CapabilitySummary {
  total: number;
  fullyEnabled: number;
  backendOnly: number;
  apiReadyButUiMissing: number;
  configuredButDisabled: number;
  blocked: number;
  planned: number;
  v1: number;
  v2: number;
  byDomain: Record<string, number>;
  byBackendStatus: Record<string, number>;
}
