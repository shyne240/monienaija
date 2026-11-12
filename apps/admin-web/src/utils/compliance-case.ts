/** The customer case endpoint returns persisted case entities, not free-form case summaries. */
export interface CustomerComplianceCaseRow {
  id: string;
  customerId: string;
  caseNumber: string;
  category: string;
  severity: string;
  status: string;
  openedAt?: string;
}

export function validCustomerCase(value: unknown, customerId: string): value is CustomerComplianceCaseRow {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const row = value as CustomerComplianceCaseRow;
  const text = (item: unknown) => typeof item === 'string' && !!item.trim();
  return text(row.id) && row.customerId === customerId && text(row.caseNumber) && text(row.category) && text(row.severity) && text(row.status);
}
