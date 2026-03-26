import type { EmbeddingProvider } from "./types.js";

const DEFAULT_MODEL = "text-embedding-3-small";
const DEFAULT_DIMENSIONS = 1536;
const MAX_BATCH_SIZE = 2048;
const TIMEOUT_MS = 30_000;
const ENDPOINT = "https://api.openai.com/v1/embeddings";

/**
 * OpenAI embedding provider using the text-embedding-3-small model.
 * Communicates via native fetch — no SDK dependency.
 */
export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  readonly name = "openai";
  readonly dimensions: number;
  readonly model: string;
  private readonly apiKey: string;

  constructor(apiKey: string, modelOverride?: string) {
    this.apiKey = apiKey;
    this.model = modelOverride || DEFAULT_MODEL;
    this.dimensions = DEFAULT_DIMENSIONS;
  }

  /** Embed one or more texts, batching internally at 2048 texts per request. */
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
      const result = await this.embed(["test"]);
      return result.length === 1 && result[0].length > 0;
    } catch {
      return false;
    }
  }

  private async requestEmbeddings(
    texts: string[],
    retry = true,
  ): Promise<number[][]> {
    try {
      const response = await fetch(ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({ model: this.model, input: texts }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });

      if (response.status === 429 && retry) {
        const retryAfter = parseInt(response.headers.get("retry-after") || "1", 10);
        const delayMs = Math.max(retryAfter, 1) * 1000;
        console.error(`[cortex] OpenAI rate limited, retrying in ${delayMs}ms`);
        await sleep(delayMs);
        return this.requestEmbeddings(texts, false);
      }

      if (!response.ok) {
        const body = await response.text().catch(() => "");
        console.error(
          `[cortex] OpenAI embedding request failed (${response.status}): ${body}`,
        );
        return texts.map(() => []);
      }

      const json = (await response.json()) as {
        data: { embedding: number[]; index: number }[];
      };

      // API may return embeddings out of order — sort by index
      const sorted = json.data.sort((a, b) => a.index - b.index);
      return sorted.map((d) => d.embedding);
    } catch (err) {
      console.error("[cortex] OpenAI embedding request error:", err);
      return texts.map(() => []);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
