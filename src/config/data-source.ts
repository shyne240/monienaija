import 'dotenv/config';
import { DataSource } from 'typeorm';

import { createDatabaseOptions } from './database.config';
import { validateEnvironment } from './environment';

export default new DataSource(createDatabaseOptions(validateEnvironment(process.env)));
