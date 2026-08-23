export interface ModelOption {
  id: string;
  name: string;
  description: string;
  recommended?: boolean;
}

export const AVAILABLE_MODELS: ModelOption[] = [
  {
    id: 'anthropic/claude-3.5-sonnet',
    name: 'Claude 3.5 Sonnet',
    description: 'Top-tier technical reasoning, precise tool usage & document generation (Recommended)',
    recommended: true
  },
  {
    id: 'openai/gpt-4o',
    name: 'GPT-4o',
    description: 'Strong general reasoning and fast tool execution',
    recommended: false
  },
  {
    id: 'deepseek/deepseek-chat',
    name: 'DeepSeek V3',
    description: 'High capability and cost-effective physical project reasoning',
    recommended: false
  },
  {
    id: 'google/gemini-2.0-flash-001',
    name: 'Gemini 2.0 Flash',
    description: 'Extremely fast responses and large context window',
    recommended: false
  }
];
