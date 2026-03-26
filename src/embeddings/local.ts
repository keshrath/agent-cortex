import type { EmbeddingProvider } from "./types.js";

const DEFAULT_MODEL = "Xenova/all-MiniLM-L6-v2";
const DEFAULT_DIMENSIONS = 384;
const DEFAULT_BATCH_SIZE = 32;

/** Cached pipeline instance — only loaded once. */
let _pipeline: ReturnType<typeof createPipeline> | null = null;

type PipelineFn = (
  texts: string[],
  options: { pooling: string; normalize: boolean },
) => Promise<{ tolist(): number[][] }>;

async function createPipeline(model: string): Promise<PipelineFn | null> {
  try {
    const { pipeline } = await import("@huggingface/transformers");
    const pipe = await pipeline("feature-extraction", model, {
      dtype: "fp32",
    });
    return pipe as unknown as PipelineFn;
  } catch (err) {
    console.error(`[cortex] Failed to load embedding model ${model}:`, err);
    return null;
  }
}

/**
 * Local embedding provider using @huggingface/transformers.
 * Downloads the model silently on first use and caches the pipeline as a singleton.
 */
export class LocalEmbeddingProvider implements EmbeddingProvider {
  readonly name = "local";
  readonly dimensions: number;
  readonly model: string;
  private readonly batchSize: number;

  constructor(modelOverride?: string, batchSize?: number) {
    this.model = modelOverride || DEFAULT_MODEL;
    this.dimensions = DEFAULT_DIMENSIONS;
    this.batchSize = batchSize ?? DEFAULT_BATCH_SIZE;
  }

  /** Embed one or more texts, batching internally if needed. */
  async embed(texts: string[]): Promise<number[][]> {
    const pipe = await this.getPipeline();
    if (!pipe) return texts.map(() => []);

    const results: number[][] = [];
    for (let i = 0; i < texts.length; i += this.batchSize) {
      const batch = texts.slice(i, i + this.batchSize);
      try {
        const output = await pipe(batch, {
          pooling: "mean",
          normalize: true,
        });
        const vectors = output.tolist();
        results.push(...vectors);
      } catch (err) {
        console.error("[cortex] Embedding batch failed:", err);
        results.push(...batch.map(() => []));
      }
    }
    return results;
  }

  /** Embed a single text. */
  async embedOne(text: string): Promise<number[]> {
    const results = await this.embed([text]);
    return results[0] ?? [];
  }

  /** Check if the provider is available. Attempts to load the model if not yet loaded. */
  async isAvailable(): Promise<boolean> {
    const pipe = await this.getPipeline();
    return pipe !== null;
  }

  private async getPipeline(): Promise<PipelineFn | null> {
    if (!_pipeline) {
      _pipeline = createPipeline(this.model);
    }
    return _pipeline;
  }
}
