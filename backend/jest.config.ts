import type { Config } from 'jest';

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  testMatch: ['**/*.test.ts'],
  // Integration tests need DATABASE_URL; unit tests do not
  // Run them separately: npm run test:unit / npm run test:integration
};

export default config;
