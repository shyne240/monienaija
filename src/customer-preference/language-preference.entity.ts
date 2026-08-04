import { Column } from 'typeorm';

import { CustomerLanguage } from './customer-preference.enums';

export class LanguagePreference {
  @Column({ name: 'language_code', type: 'varchar', length: 2, default: CustomerLanguage.EN })
  code!: CustomerLanguage;
}
