export enum SupportTicketStatus {
  OPEN = 'OPEN',
  IN_PROGRESS = 'IN_PROGRESS',
  RESOLVED = 'RESOLVED',
  CLOSED = 'CLOSED',
}

export enum SupportTicketCategory {
  FUNDING = 'FUNDING',
  TRANSFER = 'TRANSFER',
  WALLET = 'WALLET',
  CASH_IN = 'CASH_IN',
  CASH_OUT = 'CASH_OUT',
  CASH_TO_CASH = 'CASH_TO_CASH',
  PROFILE = 'PROFILE',
  PIN = 'PIN',
  AUTHENTICATION = 'AUTHENTICATION',
  AGENT_FUNDING = 'AGENT_FUNDING',
  OUTLET = 'OUTLET',
  TERMINAL = 'TERMINAL',
  OTHER = 'OTHER',
}

export enum SupportTicketPriority {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
  CRITICAL = 'CRITICAL',
}
