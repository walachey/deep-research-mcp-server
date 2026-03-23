import { config } from 'dotenv';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { createServer as createHttpServer } from 'node:http';
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
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

const TRANSPORT = (process.env.MCP_TRANSPORT || 'stdio').toLowerCase();

function parseListEnv(value: string | undefined): string[] | undefined {
  if (!value) {
    return undefined;
  }
  const items = value
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);
  return items.length > 0 ? items : undefined;
}

type StreamableHttpServerConfig = {
  port: number;
  host: string;
  enableJsonResponse: boolean;
  enableDnsRebindingProtection: boolean;
  allowedHosts?: string[];
  allowedOrigins?: string[];
};

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function startStreamableHttpServer(): Promise<void> {
  const port = Number.parseInt(process.env.MCP_HTTP_PORT || '3333', 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid MCP_HTTP_PORT value: ${process.env.MCP_HTTP_PORT}`);
  }
  const host = process.env.MCP_HTTP_HOST || '127.0.0.1';
  const enableJsonResponse = process.env.MCP_HTTP_ENABLE_JSON_RESPONSE === 'true';
  const enableDnsRebindingProtection = process.env.MCP_HTTP_ENABLE_DNS_REBINDING_PROTECTION === 'true';
  const allowedHosts = parseListEnv(process.env.MCP_HTTP_ALLOWED_HOSTS);
  const allowedOrigins = parseListEnv(process.env.MCP_HTTP_ALLOWED_ORIGINS);

  const config: StreamableHttpServerConfig = {
    port,
    host,
    enableJsonResponse,
    enableDnsRebindingProtection,
    allowedHosts,
    allowedOrigins,
  };

  let restartCount = 0;

  while (true) {
    let exitReason: 'shutdown' | 'restart' = 'restart';
    try {
      exitReason = await runStreamableHttpServerOnce(config);
    } catch (error) {
      logger.error({ err: error }, 'Streamable HTTP server crashed');
    }

    if (exitReason === 'shutdown') {
      break;
    }

    restartCount += 1;
    const delayMs = Math.min(30_000, 100 * 2 ** Math.min(restartCount, 8));
    logger.warn({ attempt: restartCount, delayMs }, 'Streamable HTTP server stopped unexpectedly, attempting restart');
    await delay(delayMs);
  }
}

async function startStdioServer(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger.info('Stdio transport closed');
}

async function start(): Promise<void> {
  if (TRANSPORT === 'streamable-http') {
    await startStreamableHttpServer();
  } else {
    await startStdioServer();
  }
}

async function runStreamableHttpServerOnce(config: StreamableHttpServerConfig): Promise<'shutdown' | 'restart'> {
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    enableJsonResponse: config.enableJsonResponse,
    enableDnsRebindingProtection: config.enableDnsRebindingProtection,
    allowedHosts: config.allowedHosts,
    allowedOrigins: config.allowedOrigins,
  });

  transport.onerror = (error: Error) => {
    logger.error({ err: error }, 'Streamable HTTP transport error');
  };

  const httpServer = createHttpServer(async (req, res) => {
    try {
      await transport.handleRequest(req, res);
    } catch (error) {
      logger.error({ err: error }, 'Failed to handle HTTP request');
      if (!res.headersSent) {
        res.writeHead(500, { 'content-type': 'application/json' });
      }
      res.end(JSON.stringify({
        jsonrpc: "2.0",
        error: {
          code: -32000,
          message: "Internal Server Error"
        },
        id: null
      }));
    }
  });

  let shuttingDown = false;
  const cleanupSignalHandlers: Array<() => void> = [];

  const shutdown = async (signal?: NodeJS.Signals) => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    logger.info({ signal }, 'Received shutdown signal, closing HTTP transport');
    cleanupSignalHandlers.forEach(remove => remove());
    try {
      await transport.close();
    } catch (error) {
      logger.error({ err: error }, 'Error while closing Streamable HTTP transport');
    }
    if (httpServer.listening) {
      httpServer.close(err => {
        if (err) {
          logger.error({ err }, 'Error while closing HTTP server');
        }
      });
    }
  };

  const sigtermHandler = (signal: NodeJS.Signals) => { void shutdown(signal); };
  const sigintHandler = (signal: NodeJS.Signals) => { void shutdown(signal); };
  process.on('SIGTERM', sigtermHandler);
  process.on('SIGINT', sigintHandler);
  cleanupSignalHandlers.push(() => process.off('SIGTERM', sigtermHandler));
  cleanupSignalHandlers.push(() => process.off('SIGINT', sigintHandler));

  try {
    await new Promise<void>((resolve, reject) => {
      httpServer.once('error', reject);
      httpServer.listen(config.port, config.host, () => resolve());
    });

    logger.info({ host: config.host, port: config.port }, 'Deep Research Agent MCP server listening (streamable-http)');

    await server.connect(transport);
    logger.info('Streamable HTTP transport ready');

    await new Promise<void>((resolve) => {
      httpServer.on('close', () => {
        logger.info('Streamable HTTP transport closed');
        resolve();
      });
    });
  } finally {
    cleanupSignalHandlers.forEach(remove => remove());
    if (!shuttingDown) {
      try {
        await transport.close();
      } catch (error) {
        logger.error({ err: error }, 'Error while closing Streamable HTTP transport');
      }
    }
  }

  return shuttingDown ? 'shutdown' : 'restart';
}

start()
  .catch((err: Error) => {
    logger.error({ err }, 'MCP server error');
    process.exitCode = 1;
  });
