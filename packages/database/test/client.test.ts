import { describe, expect, it } from 'vitest';
import { createPublicClient } from '../src/client';

const jwt = (role: string) => {
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ role, iss: 'supabase' })}.signature`;
};

describe('createPublicClient', () => {
  it('accepts an anon key', () => {
    expect(() =>
      createPublicClient({ url: 'http://127.0.0.1:54321', anonKey: jwt('anon') }),
    ).not.toThrow();
  });
  it('refuses a service-role JWT and secret-style keys', () => {
    expect(() =>
      createPublicClient({ url: 'http://127.0.0.1:54321', anonKey: jwt('service_role') }),
    ).toThrow(/privileged/);
    expect(() =>
      createPublicClient({ url: 'http://127.0.0.1:54321', anonKey: 'sb_secret_abc' }),
    ).toThrow(/privileged/);
    expect(() => createPublicClient({ url: 'http://x', anonKey: '' })).toThrow();
  });
});
