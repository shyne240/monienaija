export interface LimitProfileCreateInput {
  code: string;
  name: string;
  description?: string | null;
  kind: string;
  status?: string;
  enabled?: boolean;
  configurationStatus?: string;
  createdBy: string;
}

export interface LimitProfileUpdateInput {
  name?: string;
  description?: string | null;
  kind?: string;
  status?: string;
  enabled?: boolean;
  configurationStatus?: string;
  updatedBy: string;
  version: number;
}

export interface LimitRuleCreateInput {
  limitProfileCode: string;
  product: string;
  direction?: string | null;
  channel?: string | null;
  currency: string;
  dimension: string;
  limitValueMinor?: string | null;
  limitValueCount?: number | null;
  effectiveFrom?: Date | string | null;
  effectiveTo?: Date | string | null;
  isActive?: boolean;
  priority?: number;
  createdBy: string;
}

export interface LimitRuleUpdateInput {
  product?: string;
  direction?: string | null;
  channel?: string | null;
  currency?: string;
  dimension?: string;
  limitValueMinor?: string | null;
  limitValueCount?: number | null;
  effectiveFrom?: Date | string | null;
  effectiveTo?: Date | string | null;
  isActive?: boolean;
  priority?: number;
  updatedBy: string;
  version: number;
}

export interface LimitProfileSafeProjection {
  code: string;
  name: string;
  description: string | null;
  kind: string;
  status: string;
  enabled: boolean;
  configurationStatus: string;
  createdBy: string;
  updatedBy: string | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface LimitRuleSafeProjection {
  id: string;
  limitProfileCode: string;
  product: string;
  direction: string | null;
  channel: string | null;
  currency: string;
  dimension: string;
  limitValueMinor: string | null;
  limitValueCount: number | null;
  version: number;
  effectiveFrom: Date;
  effectiveTo: Date | null;
  isActive: boolean;
  priority: number;
  createdBy: string;
  updatedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface LimitAssignmentCreateInput {
  limitProfileCode: string;
  subjectType: string;
  subjectId?: string | null;
  segmentCode?: string | null;
  precedence?: number;
  effectiveFrom?: Date | string | null;
  effectiveTo?: Date | string | null;
  isActive?: boolean;
  createdBy: string;
}

export interface LimitAssignmentUpdateInput {
  limitProfileCode?: string;
  subjectType?: string;
  subjectId?: string | null;
  segmentCode?: string | null;
  precedence?: number;
  effectiveFrom?: Date | string | null;
  effectiveTo?: Date | string | null;
  isActive?: boolean;
  updatedBy: string;
  version: number;
}

export interface LimitAssignmentSafeProjection {
  id: string;
  limitProfileCode: string;
  subjectType: string;
  subjectId: string | null;
  segmentCode: string | null;
  precedence: number;
  version: number;
  effectiveFrom: Date;
  effectiveTo: Date | null;
  isActive: boolean;
  createdBy: string;
  updatedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}
