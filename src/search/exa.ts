/**
 * Exa Search Provider - Neural search API for high-quality web results
 * 
 * Exa provides AI-native search with better relevance than traditional search.
 * Enable with ENABLE_EXA_PRIMARY=true and EXA_API_KEY=your_key
 * 
 * https://exa.ai
 */

import { logger } from '../logger.js';

const EXA_API_URL = 'https://api.exa.ai/search';

export interface ExaSearchResult {
  title: string;
  url: string;
  publishedDate?: string;
  author?: string;
  summary?: string;
  text?: string;
  score?: number;
}

export interface ExaSearchOptions {
  query: string;
  numResults?: number;
  useAutoprompt?: boolean;
  type?: 'auto' | 'keyword' | 'neural';
  contents?: {
    text?: { maxCharacters?: number };
    summary?: { maxCharacters?: number };
  };
  category?: 'company' | 'research paper' | 'news' | 'github' | 'movie' | 'song' | 'personal site' | 'pdf';
  startPublishedDate?: string;
  endPublishedDate?: string;
  startCrawlDate?: string;
  endCrawlDate?: string;
  excludeDomains?: string[];
  includeDomains?: string[];
}

export interface ExaSearchResponse {
  results: ExaSearchResult[];
  autopromptString?: string;
  costDollars?: {
    total: number;
    search: { perRequest: number };
    contents: { perRequest: number };
  };
}

/**
 * Check if Exa is enabled
 */
export function isExaEnabled(): boolean {
  return process.env.ENABLE_EXA_PRIMARY?.toLowerCase() === 'true' && 
         !!process.env.EXA_API_KEY;
}

/**
 * Search using Exa neural search API
 */
export async function exaSearch(options: ExaSearchOptions): Promise<ExaSearchResult[]> {
  const apiKey = process.env.EXA_API_KEY;
  
  if (!apiKey) {
    logger.warn('EXA_API_KEY not set, falling back to Google Search Grounding');
    return [];
  }

  const {
    query,
    numResults = 10,
    useAutoprompt = true,
    type = 'neural',
    contents,
    category,
    startPublishedDate,
    endPublishedDate,
    excludeDomains,
    includeDomains,
  } = options;

  try {
    logger.info({ query, numResults }, 'Exa search starting');

    const requestBody: Record<string, unknown> = {
      query,
      numResults,
      useAutoprompt,
      type,
    };

    // Add optional parameters
    if (contents) {
      requestBody.contents = contents;
    }
    if (category) {
      requestBody.category = category;
    }
    if (startPublishedDate) {
      requestBody.startPublishedDate = startPublishedDate;
    }
    if (endPublishedDate) {
      requestBody.endPublishedDate = endPublishedDate;
    }
    if (excludeDomains?.length) {
      requestBody.excludeDomains = excludeDomains;
    }
    if (includeDomains?.length) {
      requestBody.includeDomains = includeDomains;
    }

    const response = await fetch(EXA_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const error = await response.text();
      logger.error({ status: response.status, error }, 'Exa API error');
      throw new Error(`Exa API error: ${response.status} - ${error}`);
    }

    const data = await response.json() as ExaSearchResponse;
    
    logger.info({ 
      resultsCount: data.results?.length || 0,
      autoprompt: data.autopromptString,
      cost: data.costDollars?.total 
    }, 'Exa search completed');

    return data.results || [];

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error({ err: errorMessage }, 'Exa search failed');
    return [];
  }
}

/**
 * Search and get full text content
 */
export async function exaSearchWithContent(
  query: string,
  options?: Omit<ExaSearchOptions, 'query' | 'contents'>
): Promise<ExaSearchResult[]> {
  return exaSearch({
    ...options,
    query,
    contents: {
      text: { maxCharacters: 4000 },
      summary: { maxCharacters: 500 },
    },
  });
}

/**
 * Search for recent news
 */
export async function exaSearchNews(
  query: string,
  daysBack: number = 7
): Promise<ExaSearchResult[]> {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - daysBack);
  
  return exaSearch({
    query,
    numResults: 10,
    category: 'news',
    startPublishedDate: startDate.toISOString().split('T')[0],
    useAutoprompt: true,
  });
}

/**
 * Search for research papers
 */
export async function exaSearchResearch(
  query: string,
  options?: Omit<ExaSearchOptions, 'query' | 'category'>
): Promise<ExaSearchResult[]> {
  return exaSearch({
    ...options,
    query,
    category: 'research paper',
    useAutoprompt: true,
  });
}

/**
 * Convert Exa results to a format compatible with the deep research pipeline
 */
export function exaResultsToMarkdown(results: ExaSearchResult[]): string {
  return results
    .map((r, i) => {
      const parts = [`## [${i + 1}] ${r.title}`];
      
      if (r.url) {
        parts.push(`URL: ${r.url}`);
      }
      if (r.publishedDate) {
        parts.push(`Published: ${r.publishedDate}`);
      }
      if (r.author) {
        parts.push(`Author: ${r.author}`);
      }
      if (r.summary) {
        parts.push(`\n### Summary\n${r.summary}`);
      }
      if (r.text) {
        parts.push(`\n### Content\n${r.text.slice(0, 2000)}${r.text.length > 2000 ? '...' : ''}`);
      }
      
      return parts.join('\n');
    })
    .join('\n\n---\n\n');
}

export default {
  isExaEnabled,
  exaSearch,
  exaSearchWithContent,
  exaSearchNews,
  exaSearchResearch,
  exaResultsToMarkdown,
};