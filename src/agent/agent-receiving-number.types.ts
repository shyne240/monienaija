export type ReceivingOwnerType = 'CUSTOMER' | 'AGENT';

export interface AgentReceivingNumberView {
  id: string;
  agentId: string;
  receivingNumber: string;
  status: string;
  assignedAt: Date;
  revokedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface RecipientResolution {
  ownerType: ReceivingOwnerType;
  ownerId: string;
  receivingNumber: string;
  display: string;
  // optional phone/normalized for traceability
  status: string;
}
