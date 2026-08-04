import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { ContactMethodType } from './customer.enums';

@Entity({ name: 'customer_contact_methods' })
@Index('uq_customer_contacts_type_value', ['type', 'normalizedValue'], {
  unique: true,
  where: 'deleted_at IS NULL',
})
@Index('idx_customer_contacts_customer', ['customerId', 'deletedAt'])
export class CustomerContactMethod {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'customer_id', type: 'uuid' })
  customerId!: string;

  @Column({ type: 'varchar', length: 20 })
  type!: ContactMethodType;

  @Column({ type: 'varchar', length: 255 })
  value!: string;

  @Column({ name: 'normalized_value', type: 'varchar', length: 255 })
  normalizedValue!: string;

  @Column({ name: 'is_primary', type: 'boolean', default: false })
  isPrimary!: boolean;

  @Column({ name: 'verified_at', type: 'timestamptz', nullable: true })
  verifiedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @Column({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt!: Date | null;
}
