import {
  Check,
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
  VersionColumn,
} from 'typeorm';

import { CustomerLanguage, CustomerTheme } from './customer-preference.enums';
import { LanguagePreference } from './language-preference.entity';
import { NotificationPreference } from './notification-preference.entity';
import { SecurityPreference } from './security-preference.entity';
import { ThemePreference } from './theme-preference.entity';

@Entity({ name: 'customer_preferences' })
@Index('uq_customer_preferences_active_customer', ['customerId'], {
  unique: true,
  where: 'deleted_at IS NULL',
})
@Index('idx_customer_preferences_customer_updated', ['customerId', 'updatedAt'])
@Check('chk_customer_preferences_language', "language_code IN ('EN', 'FR', 'HA', 'IG', 'YO')")
@Check('chk_customer_preferences_theme', "theme_code IN ('SYSTEM', 'LIGHT', 'DARK')")
@Check('chk_customer_preferences_version', 'version > 0')
export class CustomerPreference {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'customer_id', type: 'uuid' })
  customerId!: string;

  @Column(() => LanguagePreference, { prefix: false })
  language!: LanguagePreference;

  @Column(() => ThemePreference, { prefix: false })
  theme!: ThemePreference;

  @Column(() => NotificationPreference, { prefix: false })
  notifications!: NotificationPreference;

  @Column(() => SecurityPreference, { prefix: false })
  security!: SecurityPreference;

  @VersionColumn({ type: 'integer', default: 1 })
  version!: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt!: Date | null;
}

export type CustomerPreferenceLanguage = LanguagePreference & { code: CustomerLanguage };
export type CustomerPreferenceTheme = ThemePreference & { code: CustomerTheme };
