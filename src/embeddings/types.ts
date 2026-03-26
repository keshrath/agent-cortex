/**
 * Embedding provider interface — all providers (local, OpenAI, Claude, Gemini) implement this.
 */
export interface EmbeddingProvider {
  /** Provider identifier */
  readonly name: string;
  /** Vector dimensions produced by this provider */
  readonly dimensions: number;
  /** Model identifier */
  readonly model: string;
  /**
   * Embed one or more texts. Returns array of float arrays.
   * Implementations MUST handle batching internally if needed.
   */
  embed(texts: string[]): Promise<number[][]>;
  /**
   * Embed a single text. Convenience wrapper.
   */
  embedOne(text: string): Promise<number[]>;
  /**
   * Check if the provider is available (model downloaded, API key valid, etc.)
   */
  isAvailable(): Promise<boolean>;
}

export type ProviderName = "local" | "openai" | "claude" | "gemini";

export interface EmbeddingConfig {
  provider: ProviderName;
  /** TF-IDF vs semantic weight. 0 = pure semantic, 1 = pure TF-IDF. Default 0.3 */
  alpha: number;
  /** API keys for external providers */
  openaiApiKey?: string;
  claudeApiKey?: string;
  geminiApiKey?: string;
  /** Custom model override per provider */
  modelOverride?: string;
}

/** Read embedding configuration from environment variables. */
export function getEmbeddingConfig(): EmbeddingConfig {
  return {
    provider:
      (process.env.CORTEX_EMBEDDING_PROVIDER as ProviderName) || "local",
    alpha: parseFloat(process.env.CORTEX_EMBEDDING_ALPHA || "0.3"),
    openaiApiKey:
      process.env.CORTEX_OPENAI_API_KEY || process.env.OPENAI_API_KEY,
    claudeApiKey:
      process.env.CORTEX_CLAUDE_API_KEY || process.env.ANTHROPIC_API_KEY,
    geminiApiKey:
      process.env.CORTEX_GEMINI_API_KEY || process.env.GEMINI_API_KEY,
    modelOverride: process.env.CORTEX_EMBEDDING_MODEL,
  };
}
