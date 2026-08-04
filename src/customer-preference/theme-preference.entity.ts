import { Column } from 'typeorm';

import { CustomerTheme } from './customer-preference.enums';

export class ThemePreference {
  @Column({ name: 'theme_code', type: 'varchar', length: 10, default: CustomerTheme.SYSTEM })
  code!: CustomerTheme;
}
