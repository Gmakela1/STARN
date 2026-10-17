import { ToolHandler, ToolExecutionContext, ToolExecutionResponse } from '../types.js';
import { createSearchClient } from '../search/search-client.js';
import { loadConfig } from '../../config.js';

export const webSearchHandler: ToolHandler = {
  name: 'web_search',
  definition: {
    type: 'function',
    function: {
      name: 'web_search',
      description: 'Searches the web for engineering components, datasheets, part numbers, pricing, and suppliers. Scoped to hardware procurement and sourcing.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'The search query (e.g. "Motenergy ME1115 BLDC motor 72V datasheet pricing").'
          },
          maxResults: {
            type: 'number',
            description: 'Maximum number of results to return (1 to 10, default 5).'
          }
        },
        required: ['query']
      }
    }
  },
  execute: async (args: any, context: ToolExecutionContext): Promise<ToolExecutionResponse> => {
    const query = String(args?.query ?? '').trim();
    if (!query) {
      return { success: false, error: 'Search query is required.' };
    }

    const maxResults = typeof args?.maxResults === 'number'
      ? Math.max(1, Math.min(10, Math.floor(args.maxResults)))
      : 5;

    let client = context.searchClient;
    if (!client) {
      try {
        const config = loadConfig();
        client = createSearchClient(config);
      } catch (err: any) {
        return { success: false, error: `Search client initialization failed: ${err.message || String(err)}` };
      }
    }

    try {
      const searchRes = await client.search(query, maxResults);
      const lines: string[] = [];

      lines.push(`## Web Search Results: "${query}" (via ${searchRes.provider})\n`);

      if (searchRes.rawAnswer) {
        lines.push(`**Synthesis / Answer:**\n${searchRes.rawAnswer}\n`);
      }

      if (searchRes.results.length === 0) {
        lines.push('No direct web results found. Try refining keywords or specific part numbers.');
      } else {
        searchRes.results.forEach((item, idx) => {
          lines.push(`### ${idx + 1}. ${item.title}`);
          if (item.url) lines.push(`- **URL:** [${item.title}](${item.url})`);
          if (item.snippet) lines.push(`- **Overview:** ${item.snippet}`);
          if (item.content) lines.push(`- **Specs/Details:** ${item.content}`);
          lines.push('');
        });
      }

      return {
        success: true,
        result: lines.join('\n').trim()
      };
    } catch (err: any) {
      return {
        success: false,
        error: `Web search execution failed: ${err.message || String(err)}`
      };
    }
  }
};
