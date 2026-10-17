import { StarnConfig } from '../../config.js';
import { SearchClient, WebSearchResponse, WebSearchResultItem } from './types.js';

export function createSearchClient(config: StarnConfig): SearchClient {
  return {
    async search(query: string, maxResults: number = 5): Promise<WebSearchResponse> {
      const preferredProvider = config.search?.provider || 'openrouter';

      // 1. Tavily Search
      if (preferredProvider === 'tavily' && config.search?.tavilyApiKey) {
        return searchTavily(query, config.search.tavilyApiKey, maxResults);
      }

      // 2. Brave Search
      if (preferredProvider === 'brave' && config.search?.braveApiKey) {
        return searchBrave(query, config.search.braveApiKey, maxResults);
      }

      // 3. OpenRouter Built-in Server Tool (Default / Fallback)
      return searchOpenRouter(query, config, maxResults);
    }
  };
}

async function searchTavily(query: string, apiKey: string, maxResults: number): Promise<WebSearchResponse> {
  const res = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      api_key: apiKey,
      query,
      search_depth: 'basic',
      max_results: maxResults,
      include_answer: true
    })
  });

  if (!res.ok) {
    const errorText = await res.text().catch(() => '');
    throw new Error(`Tavily search failed (${res.status}): ${errorText}`);
  }

  const data = await res.json() as any;
  const results: WebSearchResultItem[] = (data.results || []).map((r: any) => ({
    title: String(r.title || 'Untitled'),
    url: String(r.url || ''),
    snippet: String(r.content || ''),
    content: r.content ? String(r.content) : undefined
  }));

  return {
    provider: 'tavily',
    query,
    results,
    rawAnswer: data.answer ? String(data.answer) : undefined
  };
}

async function searchBrave(query: string, apiKey: string, maxResults: number): Promise<WebSearchResponse> {
  const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${Math.min(maxResults, 20)}`;
  const res = await fetch(url, {
    method: 'GET',
    headers: {
      'Accept': 'application/json',
      'X-Subscription-Token': apiKey
    }
  });

  if (!res.ok) {
    const errorText = await res.text().catch(() => '');
    throw new Error(`Brave search failed (${res.status}): ${errorText}`);
  }

  const data = await res.json() as any;
  const webResults = data.web?.results || [];
  const results: WebSearchResultItem[] = webResults.map((r: any) => ({
    title: String(r.title || 'Untitled'),
    url: String(r.url || ''),
    snippet: String(r.description || '')
  }));

  return {
    provider: 'brave',
    query,
    results
  };
}

async function searchOpenRouter(query: string, config: StarnConfig, maxResults: number): Promise<WebSearchResponse> {
  const model = config.assignments?.drafting?.model || config.defaultModel || 'anthropic/claude-3.5-sonnet';
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${config.apiKey}`,
      'HTTP-Referer': config.siteUrl,
      'X-Title': config.appName,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: 'system',
          content: 'You are a hardware search agent. When searching, format web results clearly with title, markdown link [Title](url), and technical specifications or pricing summary.'
        },
        {
          role: 'user',
          content: `Search the web for components, datasheets, or suppliers matching: ${query}`
        }
      ],
      tools: [
        {
          type: 'openrouter:web_search',
          parameters: {
            max_results: maxResults
          }
        }
      ]
    })
  });

  if (!res.ok) {
    const errorText = await res.text().catch(() => '');
    throw new Error(`OpenRouter web search failed (${res.status}): ${errorText}`);
  }

  const data = await res.json() as any;
  const content = String(data.choices?.[0]?.message?.content || '');

  // Extract results from content using markdown links [Title](url): snippet
  const linkRegex = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)(?::|\s*[-–—]\s*)?([^\n\r]*)/g;
  const results: WebSearchResultItem[] = [];
  let match: RegExpExecArray | null;

  while ((match = linkRegex.exec(content)) !== null) {
    const title = match[1].trim();
    const url = match[2].trim();
    const snippet = match[3] ? match[3].trim() : title;
    results.push({ title, url, snippet });
  }

  if (results.length === 0 && content.length > 0) {
    results.push({
      title: 'Web Search Findings',
      url: '',
      snippet: content.slice(0, 1000)
    });
  }

  return {
    provider: 'openrouter',
    query,
    results,
    rawAnswer: content
  };
}
