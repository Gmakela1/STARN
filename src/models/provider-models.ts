import { ProviderConfig } from '../config.js';
import { ChatClient } from '../openrouter/types.js';

/** Lists model ids from an OpenAI-compatible provider's GET <baseUrl>/models. Errors name the URL tried. */
export async function listProviderModels(p: ProviderConfig): Promise<string[]> {
  const url = `${p.baseUrl.replace(/\/+$/, '')}/models`;
  let res: Response;
  try {
    res = await fetch(url, { headers: p.apiKey ? { Authorization: `Bearer ${p.apiKey}` } : {} });
  } catch (err: any) {
    throw new Error(`Provider "${p.name}" unreachable at ${url}: ${err?.message ?? err}`);
  }
  if (!res.ok) {
    throw new Error(`Provider "${p.name}" returned ${res.status} from ${url}`);
  }
  const data = (await res.json()) as any;
  const list = Array.isArray(data?.data) ? data.data : Array.isArray(data?.models) ? data.models : [];
  return list.map((m: any) => String(m.id ?? m.name ?? '')).filter(Boolean);
}

/** One forced tool call against a trivial `ping` tool. ok iff the model returns a ping tool call. */
export async function probeToolCalling(client: ChatClient, model: string): Promise<{ ok: boolean; detail: string }> {
  try {
    const res = await client.chatCompletion({
      model,
      messages: [{ role: 'user', content: 'Call the ping tool.' }],
      tools: [
        {
          type: 'function',
          function: { name: 'ping', description: 'Connectivity check. Takes no arguments.', parameters: { type: 'object', properties: {} } }
        }
      ],
      tool_choice: { type: 'function', function: { name: 'ping' } },
      max_tokens: 32,
      temperature: 0
    });
    const called = res.toolCalls?.some(tc => tc.function?.name === 'ping');
    return called
      ? { ok: true, detail: 'Tool calling supported' }
      : { ok: false, detail: 'Model returned text, not a tool call' };
  } catch (err: any) {
    return { ok: false, detail: err?.message ?? String(err) };
  }
}
