export interface ModelOption {
  id: string;
  name: string;
  description: string;
  recommended?: boolean;
  contextLength?: number;
  contextLengthFormatted?: string;
  pricingFormatted?: string;
}

export const AVAILABLE_MODELS: ModelOption[] = [
  {
    id: 'anthropic/claude-3.5-sonnet',
    name: 'Claude 3.5 Sonnet',
    description: 'Top-tier technical reasoning, precise tool usage & document generation (Recommended)',
    recommended: true,
    contextLength: 200000,
    contextLengthFormatted: '200k ctx',
    pricingFormatted: '$3.00/$15.00'
  },
  {
    id: 'openai/gpt-4o',
    name: 'GPT-4o',
    description: 'Strong general reasoning and fast tool execution',
    recommended: false,
    contextLength: 128000,
    contextLengthFormatted: '128k ctx',
    pricingFormatted: '$2.50/$10.00'
  },
  {
    id: 'deepseek/deepseek-chat',
    name: 'DeepSeek V3',
    description: 'High capability and cost-effective physical project reasoning',
    recommended: false,
    contextLength: 64000,
    contextLengthFormatted: '64k ctx',
    pricingFormatted: '$0.14/$0.28'
  },
  {
    id: 'google/gemini-2.0-flash-001',
    name: 'Gemini 2.0 Flash',
    description: 'Extremely fast responses and large context window',
    recommended: false,
    contextLength: 1000000,
    contextLengthFormatted: '1M ctx',
    pricingFormatted: '$0.10/$0.40'
  }
];

const RECOMMENDED_IDS = [
  'anthropic/claude-3.5-sonnet',
  'openai/gpt-4o',
  'deepseek/deepseek-chat',
  'google/gemini-2.0-flash-001',
  'meta-llama/llama-3.3-70b-instruct',
  'qwen/qwen-2.5-72b-instruct'
];

function formatContext(ctx?: number): string {
  if (!ctx) return '';
  if (ctx >= 1000000) return `${(ctx / 1000000).toFixed(0)}M ctx`;
  if (ctx >= 1000) return `${Math.round(ctx / 1000)}k ctx`;
  return `${ctx} ctx`;
}

function formatPricing(pricing?: { prompt?: string | number; completion?: string | number }): string {
  if (!pricing) return '';
  const promptMtok = Number(pricing.prompt || 0) * 1000000;
  const compMtok = Number(pricing.completion || 0) * 1000000;
  if (promptMtok === 0 && compMtok === 0) return 'Free';
  return `$${promptMtok.toFixed(2)}/$${compMtok.toFixed(2)}`;
}

export async function fetchLiveOpenRouterModels(apiKey?: string): Promise<ModelOption[]> {
  const url = 'https://openrouter.ai/api/v1/models';
  const headers: Record<string, string> = {};
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  try {
    const res = await fetch(url, { headers });
    if (!res.ok) {
      return AVAILABLE_MODELS;
    }
    const json = (await res.json()) as any;
    const rawList: any[] = json.data || [];

    if (!Array.isArray(rawList) || rawList.length === 0) {
      return AVAILABLE_MODELS;
    }

    const parsed: ModelOption[] = rawList.map(item => {
      const isRec = RECOMMENDED_IDS.includes(item.id);
      return {
        id: item.id,
        name: item.name || item.id,
        description: item.description || '',
        recommended: isRec,
        contextLength: item.context_length,
        contextLengthFormatted: formatContext(item.context_length),
        pricingFormatted: formatPricing(item.pricing)
      };
    });

    // Sort: recommended first, then alphabetical
    parsed.sort((a, b) => {
      if (a.recommended && !b.recommended) return -1;
      if (!a.recommended && b.recommended) return 1;
      return a.id.localeCompare(b.id);
    });

    return parsed;
  } catch (_err) {
    return AVAILABLE_MODELS;
  }
}
