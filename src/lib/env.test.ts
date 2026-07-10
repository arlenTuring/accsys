import { afterEach, describe, expect, it } from 'vitest';
import { getRequiredEnv } from './env';

describe('getRequiredEnv', () => {
  afterEach(() => {
    delete process.env.TEST_VAR;
  });

  it('returns the value when the env var is set', () => {
    process.env.TEST_VAR = 'hello';
    expect(getRequiredEnv('TEST_VAR')).toBe('hello');
  });

  it('throws when the env var is missing', () => {
    expect(() => getRequiredEnv('TEST_VAR')).toThrow(
      'Missing required environment variable: TEST_VAR'
    );
  });

  it('throws when the env var is an empty string', () => {
    process.env.TEST_VAR = '   ';
    expect(() => getRequiredEnv('TEST_VAR')).toThrow(
      'Missing required environment variable: TEST_VAR'
    );
  });
});
