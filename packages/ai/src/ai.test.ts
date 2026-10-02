import { describe, expect, it } from 'vitest';
import {
  AIService,
  AIUnavailableError,
  buildGroundedPrompt,
  selectModel,
  type AIProvider,
  type DeviceCapability,
  type ModelSpec,
} from './index.ts';

const dev = (o: Partial<DeviceCapability> = {}): DeviceCapability => ({
  totalMemoryMB: 6000,
  freeStorageMB: 10_000,
  cpuCores: 8,
  isLowPowerMode: false,
  platform: 'android',
  ...o,
});
const small: ModelSpec = {
  id: 'tiny',
  family: 'x',
  quantization: 'q4',
  format: 'gguf',
  sizeMB: 800,
  minMemoryMB: 2000,
  contextTokens: 2048,
  license: 'apache-2.0',
};
const big: ModelSpec = { ...small, id: 'big', sizeMB: 4000, minMemoryMB: 8000 };

describe('model selection / device gating', () => {
  it('refuses models the device cannot run', () => {
    expect(selectModel(dev({ totalMemoryMB: 2000 }), [small, big], [])).toMatchObject({
      available: false,
      reason: 'insufficient_memory',
    });
  });
  it('pauses on low power', () =>
    expect(selectModel(dev({ isLowPowerMode: true }), [small], ['tiny'])).toMatchObject({
      reason: 'low_power',
    }));
  it('needs storage before suggesting a download; picks the largest installed fitting model', () => {
    expect(selectModel(dev({ freeStorageMB: 500 }), [small], [])).toMatchObject({
      reason: 'insufficient_storage',
    });
    expect(selectModel(dev(), [small], [])).toMatchObject({ reason: 'no_model_installed' });
    expect(selectModel(dev({ totalMemoryMB: 16000 }), [small, big], ['tiny', 'big'])).toMatchObject(
      { available: true, model: { id: 'big' } },
    );
  });
});

describe('AIService truthfulness', () => {
  const provider = (text: string[]): AIProvider => ({
    id: 'fake',
    isRuntimeAvailable: async () => true,
    unload: async () => {},
    async *generate(_r, signal) {
      for (const t of text) {
        if (signal.aborted) return;
        yield { text: t, done: false };
      }
      yield { text: '', done: true };
    },
  });
  const svc = (p: AIProvider | null, enabled = true, installed = ['tiny']) =>
    new AIService({
      provider: p,
      device: async () => dev(),
      catalogue: [small],
      installedModelIds: async () => installed,
      enabled,
    });

  it('reports unavailable (never canned text) with no runtime, no model, or flag off', async () => {
    await expect(svc(null).ask({ prompt: 'hi' }).next()).rejects.toBeInstanceOf(AIUnavailableError);
    await expect(
      svc(provider(['x']), true, [])
        .ask({ prompt: 'hi' })
        .next(),
    ).rejects.toMatchObject({ reason: 'no_model_installed' });
    await expect(
      svc(provider(['x']), false)
        .ask({ prompt: 'hi' })
        .next(),
    ).rejects.toMatchObject({ reason: 'disabled_by_flag' });
  });
  it('streams provider output when available', async () => {
    const out: string[] = [];
    for await (const c of svc(provider(['a', 'b'])).ask({ prompt: 'q' })) out.push(c.text);
    expect(out.join('')).toBe('ab');
  });
  it('can be cancelled', async () => {
    const s = svc(provider(['a', 'b', 'c']));
    const out: string[] = [];
    for await (const c of s.ask({ prompt: 'q' })) {
      out.push(c.text);
      s.cancel();
    }
    expect(out.length).toBeLessThan(4);
  });
  it('grounded prompt labels trust levels', () => {
    const p = buildGroundedPrompt({
      prompt: 'Why?',
      sources: [
        { id: '1', title: 'Ohm', text: 'V=IR', trust: 'verified' },
        { id: '2', title: 'Note', text: 'x', trust: 'ai_generated' },
      ],
    });
    expect(p).toContain('[S1] (verified)');
    expect(p).toContain('[S2] (ai_generated)');
    expect(p).toMatch(/never present unverified/);
  });
});
