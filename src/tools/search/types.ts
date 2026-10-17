export type SearchProviderType = 'openrouter' | 'tavily' | 'brave';

export interface WebSearchResultItem {
  title: string;
  url: string;
  snippet: string;
  content?: string;
}

export interface WebSearchResponse {
  provider: SearchProviderType;
  query: string;
  results: WebSearchResultItem[];
  rawAnswer?: string;
}

export interface SearchClient {
  search(query: string, maxResults?: number): Promise<WebSearchResponse>;
}
