import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { ExternalSecretCategory } from './external-data-minimization.enums';

@Entity({ name: 'external_secret_classifications' })
@Index('idx_external_secret_classifications_category', ['category'])
@Check(
  'chk_external_secret_classifications_category',
  "category IN ('PARTNER_CLIENT_AUTHENTICATION', 'PARTNER_REQUEST_SIGNING_KEY', 'CALLBACK_SECRET', 'CALLBACK_SIGNATURE', 'PRIVATE_KEY', 'CUSTOMER_PIN', 'CUSTOMER_OTP', 'DEVICE_FINGERPRINT_RAW', 'RISK_NARRATIVE_RAW', 'COMPLIANCE_CASE_RAW')",
)
@Check('chk_external_secret_classifications_owner', "owner ~ '^[\\x20-\\x7E]{1,160}$'")
@Check('chk_external_secret_classifications_reference', "reference ~ '^[\\x20-\\x7E]{1,160}$'")
@Check(
  'chk_external_secret_classifications_notes',
  "notes IS NULL OR notes ~ '^[\\x20-\\x7E]{1,255}$'",
)
export class ExternalSecretClassificationEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'category', type: 'varchar', length: 40 })
  category!: ExternalSecretCategory;

  @Column({ name: 'owner', type: 'varchar', length: 160 })
  owner!: string;

  @Column({ name: 'reference', type: 'varchar', length: 160 })
  reference!: string;

  @Column({ name: 'notes', type: 'varchar', length: 255, nullable: true })
  notes!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
