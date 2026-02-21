import { config } from 'dotenv';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { runDeepResearch, continueResearch, getInteraction, type DeepResearchProgress } from './deep-research-agent.js';
import { LRUCache } from 'lru-cache';
import { logger } from './logger.js';

// Get the directory name of the current module
const __dirname = fileURLToPath(new URL('.', import.meta.url));

// Load environment variables from .env.local
config({ path: resolve(__dirname, '../.env.local') });

// Log environment variables for debugging
logger.info({ env: { hasGeminiKey: !!process.env.GEMINI_API_KEY } }, 'Environment check');

// Cache for completed research
const CACHE_TTL_MS = Math.max(1000, Math.min(86_400_000, parseInt(process.env.PROVIDER_CACHE_TTL_MS || '600000', 10)));
const researchCache = new LRUCache<string, { content: { type: "text"; text: string }[]; metadata: Record<string, unknown> }>({
  max: 50,
  ttl: CACHE_TTL_MS,
});

function hashKey(obj: unknown): string {
  try {
    return createHash('sha256').update(JSON.stringify(obj)).digest('hex');
  } catch {
    return String(obj);
  }
}

// Create MCP server
const server = new McpServer({
  name: "deep-research-agent",
  version: "2.0.0"
});

// Define the deep research tool using official Deep Research Agent
server.registerTool(
  "deep_research",
  {
    title: "Deep Research Agent",
    description: "Run Google's official Deep Research Agent (deep-research-pro-preview-12-2025) for comprehensive, multi-step research. Best for in-depth analysis, market research, literature reviews, and detailed reports. Takes 5-20 minutes.",
    inputSchema: {
      query: z.string().min(10).describe("The research question or topic to investigate (minimum 10 characters)"),
      format: z.string().optional().describe("Optional formatting instructions for the output (e.g., 'Executive Summary, Key Findings, Recommendations')"),
    }
  },
  async ({ query, format }): Promise<{ content: { type: "text"; text: string }[]; metadata: Record<string, unknown> }> => {
    const cacheKey = hashKey({ query, format });

    // Check cache
    const cached = researchCache.get(cacheKey);
    if (cached) {
      logger.info({ key: cacheKey.slice(0, 8) }, '[cache] HIT');
      return cached;
    }
    logger.info({ key: cacheKey.slice(0, 8) }, '[cache] MISS');

    try {
      logger.info({ query: query.slice(0, 100) }, 'Starting Deep Research Agent');

      const result = await runDeepResearch({
        query,
        formatInstructions: format,
        stream: true,
        onProgress: (progress: DeepResearchProgress) => {
          logger.info({
            status: progress.status,
            pct: progress.percentage,
            thought: progress.thoughtSummary?.slice(0, 50)
          }, 'Research progress');
        }
      });

      const mcpResult: { content: { type: "text"; text: string }[]; metadata: Record<string, unknown> } = {
        content: [{ type: "text" as const, text: result.content }],
        metadata: {
          interactionId: result.interactionId,
          status: result.status,
          agent: result.metadata?.agent || 'deep-research-pro-preview-12-2025'
        }
      };

      researchCache.set(cacheKey, mcpResult);
      logger.info({ interactionId: result.interactionId }, 'Deep Research completed');

      return mcpResult;

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error({ err: errorMessage }, 'Deep Research error');
      return {
        content: [{ type: "text" as const, text: `Deep Research failed: ${errorMessage}` }],
        metadata: { status: 'failed', error: errorMessage }
      };
    }
  }
);

// Tool for follow-up questions on previous research
server.registerTool(
  "continue_research",
  {
    title: "Continue Research",
    description: "Ask a follow-up question on a previous Deep Research interaction. Uses the same context for continuity.",
    inputSchema: {
      interactionId: z.string().describe("The interaction ID from a previous deep_research call"),
      question: z.string().min(5).describe("The follow-up question to ask"),
    }
  },
  async ({ interactionId, question }): Promise<{ content: { type: "text"; text: string }[]; metadata: Record<string, unknown> }> => {
    try {
      logger.info({ interactionId, question: question.slice(0, 50) }, 'Continuing research');

      const content = await continueResearch(interactionId, question);

      return {
        content: [{ type: "text" as const, text: content }],
        metadata: { interactionId, status: 'completed' }
      };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error({ err: errorMessage }, 'Continue research error');
      return {
        content: [{ type: "text" as const, text: `Continue research failed: ${errorMessage}` }],
        metadata: { status: 'failed', error: errorMessage }
      };
    }
  }
);

// Tool to retrieve a previous research result
server.registerTool(
  "get_research",
  {
    title: "Get Research",
    description: "Retrieve a previous Deep Research interaction by ID",
    inputSchema: {
      interactionId: z.string().describe("The interaction ID to retrieve"),
    }
  },
  async ({ interactionId }): Promise<{ content: { type: "text"; text: string }[]; metadata: Record<string, unknown> }> => {
    try {
      const result = await getInteraction(interactionId);

      return {
        content: [{ type: "text" as const, text: result.content }],
        metadata: { interactionId, status: result.status }
      };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error({ err: errorMessage }, 'Get research error');
      return {
        content: [{ type: "text" as const, text: `Failed to retrieve research: ${errorMessage}` }],
        metadata: { status: 'failed', error: errorMessage }
      };
    }
  }
);

// Expose capabilities as a resource
server.registerResource(
  "capabilities",
  "mcp://capabilities",
  {
    title: "Deep Research Agent Capabilities",
    description: "Information about the Deep Research Agent and its features",
    mimeType: "application/json"
  },
  async (uri) => ({
    contents: [{
      uri: uri.href,
      text: JSON.stringify({
        name: "deep-research-agent",
        version: "2.0.0",
        description: "Google Deep Research Agent via Interactions API",
        agent: "deep-research-pro-preview-12-2025",
        features: [
          "Autonomous multi-step research",
          "Background execution (up to 60 minutes)",
          "Streaming progress updates",
          "Automatic citation and sourcing",
          "Follow-up question support",
          "Server-side state management"
        ],
        tools: {
          deep_research: {
            description: "Run comprehensive research on a topic",
            estimatedTime: "5-20 minutes",
            bestFor: ["Market analysis", "Literature reviews", "Due diligence", "Technical research"]
          },
          continue_research: {
            description: "Ask follow-up questions on previous research",
            estimatedTime: "30 seconds - 2 minutes"
          },
          get_research: {
            description: "Retrieve a previous research interaction",
            estimatedTime: "1-5 seconds"
          }
        },
        retention: {
          paid: "55 days",
          free: "1 day"
        }
      }, null, 2)
    }]
  })
);

// Start the MCP server
const transport = new StdioServerTransport();
server.connect(transport)
  .then(() => { logger.info('Deep Research Agent MCP server running'); })
  .catch((err: Error) => { logger.error({ err }, 'MCP server error'); });