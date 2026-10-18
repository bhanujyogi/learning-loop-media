import { createHash, randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { sha256Hex } from './sha256';

const node = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');

describe('sha256Hex', () => {
  it('matches the standard test vectors', () => {
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
    expect(sha256Hex('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq')).toBe(
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
    );
    expect(sha256Hex('a'.repeat(1_000_000))).toBe(
      'cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0',
    );
  });
  it('matches node crypto at every padding boundary', () => {
    for (let n = 0; n < 200; n++) expect(sha256Hex('x'.repeat(n))).toBe(node('x'.repeat(n)));
  });
  it('matches node crypto for random strings incl. Hindi, emoji and mixed scripts', () => {
    const samples = [
      'नमस्ते दुनिया',
      'सही उत्तर: जयपुर',
      'क्षत्रिय ज्ञान ॐ',
      'emoji 🎓🔥 ✓✗',
      'é ü ñ 日本語',
    ];
    for (let i = 0; i < 100; i++) {
      samples.push(randomBytes(1 + (i % 40)).toString('base64'));
      samples.push(
        Array.from({ length: 1 + (i % 30) }, () =>
          String.fromCodePoint(0x900 + Math.floor(Math.random() * 0x7f)),
        ).join(''),
      );
    }
    for (const s of samples) expect(sha256Hex(s)).toBe(node(s));
  });
  it('treats lone surrogates like node (U+FFFD)', () => {
    for (const s of ['a\ud800b', '\udc00', 'x\ud83d']) expect(sha256Hex(s)).toBe(node(s));
  });
});
