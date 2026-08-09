/**
 * B2T10 — B2 public API authentication persistence entity.
 *
 * The entity is the durable TypeORM record for each public API
 * authentication decision. It persists the decision as a JSONB payload
 * alongside the auth reference, method, path, outcome, hashes,
 * idempotency scope/key, and cohort identity. The table is the only
 * B2 public API authentication persistence surface and never stores a
 * raw secret.
 */

import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

import type { B2PublicApiAuthOutcome } from './b2-public-api-authentication.types';

@Index('uq_b2_public_api_auth_reference', ['authReference', 'authVersion'], { unique: true })
@Index('idx_b2_public_api_auth_path', ['pathTemplate'])
@Index('idx_b2_public_api_auth_outcome', ['outcome'])
@Index('idx_b2_public_api_auth_cohort', ['cohortKey', 'cohortVersion'])
@Index('idx_b2_public_api_auth_request_hash', ['requestHash'])
@Index('idx_b2_public_api_auth_idempotency', ['idempotencyScope', 'idempotencyKey'])
@Index('idx_b2_public_api_auth_correlation', ['correlationId'])
@Entity('b2_public_api_authentication')
export class B2PublicApiAuthentication {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'auth_reference', type: 'varchar', length: 200 })
  authReference!: string;

  @Column({ name: 'auth_version', type: 'integer' })
  authVersion!: number;

  @Column({ name: 'method', type: 'varchar', length: 10 })
  method!: string;

  @Column({ name: 'path_template', type: 'varchar', length: 200 })
  pathTemplate!: string;

  @Column({ name: 'outcome', type: 'varchar', length: 24 })
  outcome!: B2PublicApiAuthOutcome;

  @Column({ name: 'http_status', type: 'integer' })
  httpStatus!: number;

  @Column({ name: 'cohort_key', type: 'varchar', length: 200 })
  cohortKey!: string;

  @Column({ name: 'cohort_version', type: 'integer' })
  cohortVersion!: number;

  @Column({ name: 'request_hash', type: 'varchar', length: 64 })
  requestHash!: string;

  @Column({ name: 'decision_hash', type: 'varchar', length: 64 })
  decisionHash!: string;

  @Column({ name: 'decision_replay_hash', type: 'varchar', length: 64 })
  decisionReplayHash!: string;

  @Column({ name: 'idempotency_scope', type: 'varchar', length: 80 })
  idempotencyScope!: string;

  @Column({ name: 'idempotency_key', type: 'varchar', length: 255 })
  idempotencyKey!: string;

  @Column({ name: 'correlation_id', type: 'varchar', length: 255 })
  correlationId!: string;

  @Column({ name: 'record', type: 'jsonb' })
  record!: Record<string, unknown>;

  @Column({ name: 'created_at', type: 'timestamptz', default: () => 'now()' })
  createdAt!: Date;

  @Column({ name: 'updated_at', type: 'timestamptz', default: () => 'now()' })
  updatedAt!: Date;
}
