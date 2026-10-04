import { describe, expect, it } from 'vitest';
import { authErrorKey, normalizeEmail, validateEmail, validatePassword } from './auth-validation';

describe('signup / sign-in validation', () => {
  it('validates emails', () => {
    expect(validateEmail('')).toBe('auth.err.emailRequired');
    expect(validateEmail('   ')).toBe('auth.err.emailRequired');
    expect(validateEmail('nope')).toBe('auth.err.emailInvalid');
    expect(validateEmail('a@b')).toBe('auth.err.emailInvalid');
    expect(validateEmail(' a@b.co ')).toBeNull();
    expect(normalizeEmail('  A@B.Co ')).toBe('a@b.co');
  });
  it('enforces the password length on sign-up only (never locks out an older short password)', () => {
    expect(validatePassword('', 'in')).toBe('auth.err.passwordRequired');
    expect(validatePassword('short', 'up')).toBe('auth.err.passwordShort');
    expect(validatePassword('12345678', 'up')).toBeNull();
    expect(validatePassword('short', 'in')).toBeNull();
  });
});

describe('auth error mapping', () => {
  it('maps network failures to the offline message', () => {
    expect(authErrorKey({ name: 'AuthRetryableFetchError', status: 0 }, 'in')).toBe(
      'auth.err.offline',
    );
    expect(authErrorKey(new TypeError('Network request failed'), 'up')).toBe('auth.err.offline');
  });
  it('maps invalid credentials, unconfirmed email, rate limits and weak passwords', () => {
    expect(authErrorKey({ code: 'invalid_credentials', status: 400 }, 'in')).toBe(
      'auth.err.invalidCredentials',
    );
    expect(authErrorKey({ code: 'email_not_confirmed' }, 'in')).toBe('auth.err.emailNotConfirmed');
    expect(authErrorKey({ status: 429 }, 'in')).toBe('auth.err.rateLimited');
    expect(authErrorKey({ code: 'weak_password' }, 'up')).toBe('auth.err.weakPassword');
  });
  it('never discloses whether an account exists on sign-up', () => {
    expect(authErrorKey({ code: 'user_already_exists', status: 422 }, 'up')).toBe(
      'auth.err.signUpFailed',
    );
    expect(authErrorKey({ code: 'email_exists' }, 'up')).toBe('auth.err.signUpFailed');
    // unknown sign-in failures stay generic
    expect(authErrorKey({ code: 'something_else' }, 'in')).toBe('auth.err.signInFailed');
    // an unconfirmed-email message is never produced for sign-up
    expect(authErrorKey({ code: 'email_not_confirmed' }, 'up')).toBe('auth.err.signUpFailed');
  });
});
