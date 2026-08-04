import {
  Check,
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

import { PreferenceHistoryAction } from './customer-preference.enums';

@Entity({ name: 'preference_histories' })
@Index('idx_preference_histories_preference_created', ['preferenceId', 'createdAt'])
@Check('chk_preference_histories_action', "action IN ('CREATED', 'UPDATED')")
export class PreferenceHistory {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'preference_id', type: 'uuid' })
  preferenceId!: string;

  @Column({ type: 'varchar', length: 20 })
  action!: PreferenceHistoryAction;

  @Column({ type: 'jsonb', nullable: true })
  previousValues!: Record<string, unknown> | null;

  @Column({ type: 'jsonb', nullable: true })
  newValues!: Record<string, unknown> | null;

  @Column({ type: 'varchar', length: 160 })
  actor!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt!: Date | null;
}
