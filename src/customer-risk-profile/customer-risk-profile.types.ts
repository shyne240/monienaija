import type {
  CustomerRiskLevel,
  CustomerRiskProfileStatus,
  RiskFactorHistoryAction,
  RiskProfileHistoryAction,
} from './customer-risk-profile.enums';

export interface RiskFactorCommand {
  category: string;
  score: number;
  weight: number;
  remarks?: string;
}

export interface CreateCustomerRiskProfileCommand {
  assessmentDate: string;
  assessedBy: string;
  assessmentMethod: string;
  overallRiskLevel: CustomerRiskLevel;
  reviewDueDate: string;
  notes?: string;
  factors: RiskFactorCommand[];
  actor: string;
}

export interface UpdateCustomerRiskProfileCommand {
  status?: CustomerRiskProfileStatus;
  assessmentDate?: string;
  assessedBy?: string;
  assessmentMethod?: string;
  overallRiskLevel?: CustomerRiskLevel;
  reviewDueDate?: string;
  notes?: string;
  factors?: RiskFactorCommand[];
  actor: string;
  version?: number;
}

export interface CustomerRiskFactorView {
  id: string;
  category: string;
  score: number;
  weight: number;
  remarks: string | null;
}

export interface CustomerRiskProfileView {
  id: string;
  customerId: string;
  status: CustomerRiskProfileStatus;
  assessmentDate: Date;
  assessedBy: string;
  assessmentMethod: string;
  overallRiskLevel: CustomerRiskLevel;
  reviewDueDate: Date;
  notes: string | null;
  version: number;
  factors: CustomerRiskFactorView[];
  createdAt: Date;
  updatedAt: Date;
}

export interface RiskProfileHistoryView {
  id: string;
  profileId: string;
  action: RiskProfileHistoryAction;
  version: number;
  assessmentDate: Date;
  assessedBy: string;
  assessmentMethod: string;
  overallRiskLevel: CustomerRiskLevel;
  reviewDueDate: Date;
  notes: string | null;
  actor: string;
  createdAt: Date;
}

export interface RiskFactorHistoryView {
  id: string;
  profileId: string;
  profileVersion: number;
  action: RiskFactorHistoryAction;
  category: string;
  score: number;
  weight: number;
  remarks: string | null;
  actor: string;
  createdAt: Date;
}
