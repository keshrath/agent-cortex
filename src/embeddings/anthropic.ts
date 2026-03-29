import type { EmbeddingProvider } from './types.js';

const DEFAULT_MODEL = 'voyage-3-lite';
const DEFAULT_DIMENSIONS = 512;
const MAX_BATCH_SIZE = 128;
const TIMEOUT_MS = 30_000;
const ENDPOINT = 'https://api.voyageai.com/v1/embeddings';

/**
 * Anthropic/Voyage AI embedding provider.
 * Uses the Voyage AI API (Anthropic's embedding partner).
 * Accepts an Anthropic API key but prefers VOYAGE_API_KEY if set.
 */
export class AnthropicEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'claude';
  readonly dimensions: number;
  readonly model: string;
  private readonly apiKey: string;

  constructor(apiKey: string, modelOverride?: string) {
    this.apiKey = process.env.VOYAGE_API_KEY || apiKey;
    this.model = modelOverride || DEFAULT_MODEL;
    this.dimensions = DEFAULT_DIMENSIONS;
  }

  /** Embed one or more texts, batching internally at 128 texts per request. */
  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];

    const results: number[][] = [];
    for (let i = 0; i < texts.length; i += MAX_BATCH_SIZE) {
      const batch = texts.slice(i, i + MAX_BATCH_SIZE);
      const vectors = await this.requestEmbeddings(batch);
      results.push(...vectors);
    }
    return results;
  }

  /** Embed a single text. */
  async embedOne(text: string): Promise<number[]> {
    const results = await this.embed([text]);
    return results[0] ?? [];
  }

  /** Check availability by making a test embedding request. */
  async isAvailable(): Promise<boolean> {
    try {
      const result = await this.embed(['test']);
      return result.length === 1 && result[0].length > 0;
    } catch (err) {
      console.error(
        '[knowledge] anthropic availability:',
        err instanceof Error ? err.message : err,
      );
      return false;
    }
  }

  private async requestEmbeddings(texts: string[], retry = true): Promise<number[][]> {
    try {
      const response = await fetch(ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({ model: this.model, input: texts }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });

      if (response.status === 429 && retry) {
        const retryAfter = parseInt(response.headers.get('retry-after') || '1', 10);
        const delayMs = Math.max(retryAfter, 1) * 1000;
        console.error(`[knowledge] Voyage rate limited, retrying in ${delayMs}ms`);
        await sleep(delayMs);
        return this.requestEmbeddings(texts, false);
      }

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        console.error(`[knowledge] Voyage embedding request failed (${response.status}): ${body}`);
        return texts.map(() => []);
      }

      const json = (await response.json()) as {
        data: { embedding: number[]; index: number }[];
      };

      const sorted = json.data.sort((a, b) => a.index - b.index);
      return sorted.map((d) => d.embedding);
    } catch (err) {
      console.error('[knowledge] Voyage embedding request error:', err);
      return texts.map(() => []);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
