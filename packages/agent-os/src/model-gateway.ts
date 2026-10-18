export type ModelRequest = {
  systemPrompt: string;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  maxTokens?: number;
};

export type ModelResponse = {
  content:   string;
  inputTokens:  number;
  outputTokens: number;
  model:     string;
  fallback:  boolean;
};

export type DeterministicFallback = (request: ModelRequest) => ModelResponse;

export class ModelGateway {
  private mode: 'live' | 'degraded' = 'degraded';

  constructor(
    private apiKey:   string | undefined,
    private fallback: DeterministicFallback,
    private modelId = 'claude-sonnet-5',
  ) {
    this.mode = apiKey ? 'live' : 'degraded';
  }

  get isDegraded() { return this.mode === 'degraded'; }

  async invoke(request: ModelRequest): Promise<ModelResponse> {
    if (this.mode === 'degraded' || !this.apiKey) {
      return this.fallback(request);
    }

    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method:  'POST',
        headers: {
          'x-api-key':         this.apiKey,
          'anthropic-version': '2023-06-01',
          'content-type':      'application/json',
        },
        body: JSON.stringify({
          model:      this.modelId,
          max_tokens: request.maxTokens ?? 1024,
          system:     request.systemPrompt,
          messages:   request.messages,
        }),
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Model API error ${res.status}: ${text}`);
      }

      const data = await res.json() as {
        content: Array<{ type: string; text: string }>;
        usage:   { input_tokens: number; output_tokens: number };
        model:   string;
      };
      const text = data.content.find((c) => c.type === 'text')?.text ?? '';
      return {
        content:      text,
        inputTokens:  data.usage.input_tokens,
        outputTokens: data.usage.output_tokens,
        model:        data.model,
        fallback:     false,
      };
    } catch {
      // Degrade gracefully
      return this.fallback(request);
    }
  }
}
