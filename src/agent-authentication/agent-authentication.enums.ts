export enum AgentAuthenticationCredentialStatus {
  PENDING = 'PENDING',
  ACTIVE = 'ACTIVE',
  SUSPENDED = 'SUSPENDED',
  REVOKED = 'REVOKED',
}

export enum AgentTransactionPinStatus {
  ACTIVE = 'ACTIVE',
  LOCKED = 'LOCKED',
  REVOKED = 'REVOKED',
}

export enum AgentAuthenticationSessionStatus {
  ACTIVE = 'ACTIVE',
  REVOKED = 'REVOKED',
  EXPIRED = 'EXPIRED',
}

export enum AgentPasswordHashAlgorithm {
  ARGON2ID = 'ARGON2ID',
  BCRYPT = 'BCRYPT',
  SCRYPT = 'SCRYPT',
  PBKDF2 = 'PBKDF2',
}
