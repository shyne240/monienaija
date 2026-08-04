export enum CustomerRiskLevel {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
  CRITICAL = 'CRITICAL',
}

export enum CustomerRiskProfileStatus {
  ACTIVE = 'ACTIVE',
  CLOSED = 'CLOSED',
}

export enum RiskProfileHistoryAction {
  CREATED = 'CREATED',
  REASSESSED = 'REASSESSED',
  CLOSED = 'CLOSED',
}

export enum RiskFactorHistoryAction {
  ASSESSMENT_RECORDED = 'ASSESSMENT_RECORDED',
}
