import type { EmbeddingProvider } from './types.js';

const DEFAULT_MODEL = 'text-embedding-004';
const DEFAULT_DIMENSIONS = 768;
const MAX_BATCH_SIZE = 100;
const TIMEOUT_MS = 30_000;

/**
 * Google Gemini embedding provider using the Generative Language API.
 * Uses the batchEmbedContents endpoint for efficient bulk embedding.
 */
export class GeminiEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'gemini';
  readonly dimensions: number;
  readonly model: string;
  private readonly apiKey: string;

  constructor(apiKey: string, modelOverride?: string) {
    this.apiKey = apiKey;
    this.model = modelOverride || DEFAULT_MODEL;
    this.dimensions = DEFAULT_DIMENSIONS;
  }

  /** Embed one or more texts, batching internally at 100 texts per request. */
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
    } catch {
      return false;
    }
  }

  private get endpoint(): string {
    return `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:batchEmbedContents?key=${this.apiKey}`;
  }

  private async requestEmbeddings(texts: string[], retry = true): Promise<number[][]> {
    const modelPath = `models/${this.model}`;
    const requests = texts.map((text) => ({
      model: modelPath,
      content: { parts: [{ text }] },
    }));

    try {
      const response = await fetch(this.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requests }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });

      if (response.status === 429 && retry) {
        const retryAfter = parseInt(response.headers.get('retry-after') || '1', 10);
        const delayMs = Math.max(retryAfter, 1) * 1000;
        console.error(`[knowledge] Gemini rate limited, retrying in ${delayMs}ms`);
        await sleep(delayMs);
        return this.requestEmbeddings(texts, false);
      }

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        console.error(`[knowledge] Gemini embedding request failed (${response.status}): ${body}`);
        return texts.map(() => []);
      }

      const json = (await response.json()) as {
        embeddings: { values: number[] }[];
      };

      return json.embeddings.map((e) => e.values);
    } catch (err) {
      console.error('[knowledge] Gemini embedding request error:', err);
      return texts.map(() => []);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
