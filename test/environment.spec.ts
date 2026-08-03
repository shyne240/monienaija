import { validateEnvironment } from '../src/config/environment';

const validEnvironment = {
  DB_HOST: 'localhost',
  DB_NAME: 'monienaija',
  DB_USER: 'monienaija',
  DB_PASSWORD: 'local-password',
};

describe('validateEnvironment', () => {
  it('applies safe defaults to a valid environment', () => {
    expect(validateEnvironment(validEnvironment)).toMatchObject({
      NODE_ENV: 'development',
      PORT: 3000,
      DB_PORT: 5432,
      DB_SSL: false,
    });
  });

  it('fails fast when required database configuration is absent', () => {
    expect(() => validateEnvironment({ ...validEnvironment, DB_PASSWORD: '' })).toThrow(
      'Invalid environment configuration',
    );
  });
});
