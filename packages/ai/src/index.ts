/**
 * AI architecture (docs/AI_ARCHITECTURE.md). Runtime AI is LOCAL/ON-DEVICE ONLY: no paid cloud API is on any
 * runtime path, and private content is never silently sent to a remote provider.
 *
 *   AIService → AIProvider → LocalInferenceProvider (native runtime, e.g. llama.rn — evaluated in docs, not yet bundled)
 *
 * What exists today: the provider contract, device-capability gating, model catalogue/selection, grounding with
 * content-trust labels, cancellation and truthful "unavailable" states. What does NOT exist yet: a bundled native
 * inference runtime and downloaded models. Until one is installed the service reports `unavailable` — the UI must
 * show that honestly (no canned responses).
 */

export type TrustLabel = 'verified' | 'student_generated' | 'ai_generated' | 'unverified';

export interface GroundingSource {
  id: string;
  title: string;
  text: string;
  trust: TrustLabel;
}

export interface DeviceCapability {
  totalMemoryMB: number;
  freeStorageMB: number;
  cpuCores: number;
  isLowPowerMode: boolean;
  batteryLevel?: number;
  platform: 'ios' | 'android' | 'other';
}

export interface ModelSpec {
  id: string;
  family: string;
  quantization: string;
  format: 'gguf' | 'onnx';
  sizeMB: number;
  minMemoryMB: number;
  contextTokens: number;
  license: string;
}

/** Curated catalogue. Entries are CANDIDATES to be verified/benchmarked before shipping (see docs/AI_ARCHITECTURE.md). */
export const MODEL_CATALOGUE: ModelSpec[] = [];

export type AvailabilityReason =
  | 'no_runtime'
  | 'no_model_installed'
  | 'insufficient_memory'
  | 'insufficient_storage'
  | 'low_power'
  | 'disabled_by_flag';
export type Availability =
  | { available: true; model: ModelSpec }
  | { available: false; reason: AvailabilityReason; detail: string };

export function selectModel(
  device: DeviceCapability,
  catalogue: ModelSpec[],
  installedIds: string[],
): Availability {
  if (device.isLowPowerMode || (device.batteryLevel !== undefined && device.batteryLevel < 0.15))
    return { available: false, reason: 'low_power', detail: 'Local AI is paused to save battery.' };
  const fits = catalogue.filter((m) => m.minMemoryMB <= device.totalMemoryMB * 0.6);
  if (!fits.length)
    return {
      available: false,
      reason: 'insufficient_memory',
      detail: 'This device does not have enough memory for any supported model.',
    };
  const installed = fits
    .filter((m) => installedIds.includes(m.id))
    .sort((a, b) => b.sizeMB - a.sizeMB);
  if (installed[0]) return { available: true, model: installed[0] };
  const smallest = [...fits].sort((a, b) => a.sizeMB - b.sizeMB)[0]!;
  if (device.freeStorageMB < smallest.sizeMB * 1.5)
    return {
      available: false,
      reason: 'insufficient_storage',
      detail: `Needs about ${smallest.sizeMB} MB free to download a model.`,
    };
  return {
    available: false,
    reason: 'no_model_installed',
    detail: 'Download a model to use the on-device assistant.',
  };
}

export interface GenerateRequest {
  system?: string;
  prompt: string;
  sources?: GroundingSource[];
  maxTokens?: number;
  temperature?: number;
}
export interface GenerateChunk {
  text: string;
  done: boolean;
}

export interface AIProvider {
  readonly id: string;
  isRuntimeAvailable(): Promise<boolean>;
  generate(req: GenerateRequest, signal: AbortSignal): AsyncIterable<GenerateChunk>;
  unload(): Promise<void>;
}

export class AIUnavailableError extends Error {
  constructor(
    readonly reason: AvailabilityReason,
    message: string,
  ) {
    super(message);
    this.name = 'AIUnavailableError';
  }
}

/** Compose a grounded prompt. Trust labels are explicit so the model (and UI) can distinguish verified from unverified material. */
export function buildGroundedPrompt(req: GenerateRequest): string {
  const src = (req.sources ?? [])
    .map((s, i) => `[S${i + 1}] (${s.trust}) ${s.title}\n${s.text}`)
    .join('\n\n');
  const rules =
    'Answer using the numbered sources when possible and cite them like [S1]. If sources are not enough, say so; never present unverified or AI-generated material as guaranteed fact.';
  return [
    req.system ?? 'You are a concise study assistant for exam preparation.',
    rules,
    src && `Sources:\n${src}`,
    `Question: ${req.prompt}`,
  ]
    .filter(Boolean)
    .join('\n\n');
}

export interface AIServiceOptions {
  provider: AIProvider | null;
  device: () => Promise<DeviceCapability>;
  catalogue?: ModelSpec[];
  installedModelIds: () => Promise<string[]>;
  enabled: boolean;
}

export class AIService {
  private controller: AbortController | null = null;
  constructor(private readonly o: AIServiceOptions) {}

  async availability(): Promise<Availability> {
    if (!this.o.enabled)
      return {
        available: false,
        reason: 'disabled_by_flag',
        detail: 'On-device AI is not enabled.',
      };
    if (!this.o.provider || !(await this.o.provider.isRuntimeAvailable()))
      return {
        available: false,
        reason: 'no_runtime',
        detail: 'No on-device inference runtime is installed in this build.',
      };
    return selectModel(
      await this.o.device(),
      this.o.catalogue ?? MODEL_CATALOGUE,
      await this.o.installedModelIds(),
    );
  }

  /** Streams a grounded answer. Throws AIUnavailableError (never fabricates output) when local inference cannot run. */
  async *ask(req: GenerateRequest): AsyncGenerator<GenerateChunk> {
    const a = await this.availability();
    if (!a.available) throw new AIUnavailableError(a.reason, a.detail);
    this.cancel();
    const c = (this.controller = new AbortController());
    try {
      for await (const chunk of this.o.provider!.generate(
        { ...req, prompt: buildGroundedPrompt(req) },
        c.signal,
      )) {
        if (c.signal.aborted) return;
        yield chunk;
      }
    } finally {
      if (this.controller === c) this.controller = null;
    }
  }
  cancel(): void {
    this.controller?.abort();
    this.controller = null;
  }
}
