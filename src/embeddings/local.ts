import type { EmbeddingProvider } from './types.js';

const DEFAULT_MODEL = 'Xenova/all-MiniLM-L6-v2';
const DEFAULT_DIMENSIONS = 384;
const DEFAULT_BATCH_SIZE = 32;

let _pipeline: ReturnType<typeof createPipeline> | null = null;

type PipelineFn = (
  texts: string[],
  options: { pooling: string; normalize: boolean },
) => Promise<{ tolist(): number[][] }>;

async function createPipeline(model: string): Promise<PipelineFn | null> {
  try {
    const { pipeline } = await import('@huggingface/transformers');
    const pipe = await pipeline('feature-extraction', model, {
      dtype: 'fp32',
    });
    return pipe as unknown as PipelineFn;
  } catch (err) {
    console.error(`[knowledge] Failed to load embedding model ${model}:`, err);
    return null;
  }
}

export class LocalEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'local';
  readonly dimensions: number;
  readonly model: string;
  private readonly batchSize: number;

  constructor(modelOverride?: string, batchSize?: number) {
    this.model = modelOverride || DEFAULT_MODEL;
    this.dimensions = DEFAULT_DIMENSIONS;
    this.batchSize = batchSize ?? DEFAULT_BATCH_SIZE;
  }

  async embed(texts: string[]): Promise<number[][]> {
    const pipe = await this.getPipeline();
    if (!pipe) return texts.map(() => []);

    const results: number[][] = [];
    for (let i = 0; i < texts.length; i += this.batchSize) {
      const batch = texts.slice(i, i + this.batchSize);
      try {
        const output = await pipe(batch, {
          pooling: 'mean',
          normalize: true,
        });
        const vectors = output.tolist();
        results.push(...vectors);
      } catch (err) {
        console.error('[knowledge] Embedding batch failed:', err);
        results.push(...batch.map(() => []));
      }
    }
    return results;
  }

  async embedOne(text: string): Promise<number[]> {
    const results = await this.embed([text]);
    return results[0] ?? [];
  }

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
