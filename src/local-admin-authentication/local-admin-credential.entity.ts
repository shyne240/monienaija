import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * V1-ADMIN-LOCAL-LOGIN-01 — LOCAL DEVELOPMENT ONLY credential store backing a real
 * username/password front door for the Admin Web login screen.
 *
 * This table exists purely to let a local developer authenticate with an ordinary
 * email + password instead of hand-crafting an OIDC assertion or a bootstrap JWS
 * statement. It does NOT introduce a parallel session/authorization architecture:
 * a successful password check here only ever leads into the existing, already
 * shipped A2 workforce sandbox/mock-token bypass
 * (`A2WorkforceOidcService.validate` + `A2WorkforceSessionService.establish`),
 * which is independently and unconditionally gated to
 * `NODE_ENV=development`/`NODE_ENV=test` and can never activate when
 * `NODE_ENV=production` or `NODE_ENV=staging` — see
 * `LocalAdminAuthenticationService` for the full chain of guards.
 *
 * Rows in this table are schema-only outside local development: nothing in this
 * codebase ever creates a row here except `LocalAdminAuthenticationService
 * .seedDefaultAdmin`, which itself refuses to run outside
 * `NODE_ENV=development`/`NODE_ENV=test`. A production database migrated with
 * this table applied will simply have it permanently empty.
 */
@Entity({ name: 'local_admin_credentials' })
@Check('chk_local_admin_credentials_algorithm', "hash_algorithm IN ('PBKDF2')")
export class LocalAdminCredential {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 255, unique: true })
  email!: string;

  @Column({ name: 'password_hash', type: 'varchar', length: 512 })
  passwordHash!: string;

  @Column({ name: 'hash_algorithm', type: 'varchar', length: 20 })
  hashAlgorithm!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
