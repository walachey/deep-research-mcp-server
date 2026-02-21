/**
 * Deep Research Agent - Uses Google's official Deep Research Agent via Interactions API
 * 
 * This module wraps the Deep Research Agent (deep-research-pro-preview-12-2025)
 * which autonomously plans, executes, and synthesizes multi-step research tasks.
 * 
 * Key features:
 * - Background execution for long-running tasks (up to 60 minutes)
 * - Streaming progress updates with thought summaries
 * - Automatic state management via Interactions API
 * - Professional reports with citations
 */

import { GoogleGenAI } from '@google/genai';
import { logger } from './logger.js';

// Environment configuration
const API_KEY = process.env.GEMINI_API_KEY;
if (!API_KEY) {
  throw new Error('GEMINI_API_KEY environment variable is required');
}

// Deep Research Agent ID
const DEEP_RESEARCH_AGENT = 'deep-research-pro-preview-12-2025';

// Initialize client
const client = new GoogleGenAI({ apiKey: API_KEY });

// Types
export interface DeepResearchOptions {
  query: string;
  formatInstructions?: string;
  onProgress?: (progress: DeepResearchProgress) => void;
  stream?: boolean;
}

export interface DeepResearchProgress {
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  percentage?: number;
  message?: string;
  thoughtSummary?: string;
  interactionId?: string;
}

export interface DeepResearchResult {
  content: string;
  interactionId: string;
  status: string;
  citations?: string[];
  metadata?: Record<string, unknown>;
}

/**
 * Run Deep Research using the official Google Deep Research Agent
 * 
 * This uses the Interactions API with the deep-research-pro-preview-12-2025 agent
 * which handles all the research planning, execution, and synthesis automatically.
 */
export async function runDeepResearch(options: DeepResearchOptions): Promise<DeepResearchResult> {
  const { query, formatInstructions, onProgress, stream = true } = options;

  logger.info({ query }, 'Starting Deep Research Agent');

  // Build the input prompt with optional formatting
  let input = query;
  if (formatInstructions) {
    input = `${query}\n\nFormat the output as follows:\n${formatInstructions}`;
  }

  try {
    // Create interaction with Deep Research Agent
    const interaction = await client.interactions.create({
      agent: DEEP_RESEARCH_AGENT,
      input: input,
      background: true, // Required for agents
      store: true, // Required for background
      ...(stream ? { stream: true } : {})
    } as { agent: string; input: string; background: boolean; store: boolean; stream?: boolean });

    const interactionId = (interaction as { id?: string }).id || 'unknown';
    logger.info({ interactionId }, 'Deep Research interaction created');

    // Report initial progress
    onProgress?.({
      status: 'running',
      message: 'Research started',
      interactionId
    });

    // If streaming, process the stream
    if (stream) {
      return await handleStreamingInteraction(interaction, interactionId, onProgress);
    }

    // Otherwise, poll for completion
    return await pollForCompletion(interactionId, onProgress);

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error({ err: errorMessage }, 'Deep Research Agent error');
    throw new Error(`Deep Research Agent failed: ${errorMessage}`);
  }
}

/**
 * Handle streaming interaction with progress updates
 */
async function handleStreamingInteraction(
  stream: unknown,
  interactionId: string,
  onProgress?: (progress: DeepResearchProgress) => void
): Promise<DeepResearchResult> {
  let lastPercentage = 0;
  let fullContent = '';

  try {
    // Process stream chunks
    for await (const chunk of stream as AsyncIterable<{ 
      eventType?: string; 
      event_type?: string;
      delta?: { type?: string; text?: string; content?: { text?: string } };
      interaction?: { id?: string; status?: string };
      status?: string;
      outputs?: Array<{ text?: string; type?: string }>;
    }>) {
      const eventType = chunk.eventType || chunk.event_type;

      // Handle different event types
      if (eventType === 'interaction.start' || eventType === 'interaction_start') {
        onProgress?.({
          status: 'running',
          message: 'Research started',
          interactionId: chunk.interaction?.id || interactionId
        });
      } else if (eventType === 'content.delta' || eventType === 'content_delta') {
        // Text content
        if (chunk.delta?.type === 'text' || chunk.delta?.type === 'text_delta') {
          const text = chunk.delta.text || chunk.delta.content?.text || '';
          fullContent += text;
          
          // Estimate progress based on content length
          lastPercentage = Math.min(95, lastPercentage + 1);
          onProgress?.({
            status: 'running',
            percentage: lastPercentage,
            message: 'Generating report...'
          });
        } 
        // Thought summaries
        else if (chunk.delta?.type === 'thought_summary' || chunk.delta?.type === 'thought') {
          const thoughtText = chunk.delta.content?.text || chunk.delta.text || '';
          onProgress?.({
            status: 'running',
            percentage: lastPercentage,
            thoughtSummary: thoughtText,
            message: 'Thinking...'
          });
          lastPercentage = Math.min(90, lastPercentage + 2);
        }
      } else if (eventType === 'interaction.complete' || eventType === 'interaction_complete') {
        // Extract final content if not already captured
        if (chunk.outputs && Array.isArray(chunk.outputs)) {
          const textOutput = chunk.outputs.find(o => o.type === 'text' || !o.type);
          if (textOutput?.text) {
            fullContent = textOutput.text;
          }
        }
        
        onProgress?.({
          status: 'completed',
          percentage: 100,
          message: 'Research completed'
        });
      } else if (eventType === 'progress' || eventType === 'status') {
        // Generic progress update
        onProgress?.({
          status: 'running',
          percentage: lastPercentage,
          message: 'Processing...'
        });
      }
    }

    return {
      content: fullContent,
      interactionId,
      status: 'completed',
      metadata: {
        agent: DEEP_RESEARCH_AGENT,
        streaming: true
      }
    };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error({ err: errorMessage }, 'Streaming error');
    
    // Fall back to polling if streaming fails
    logger.info({ interactionId }, 'Falling back to polling');
    return await pollForCompletion(interactionId, onProgress);
  }
}

/**
 * Poll for interaction completion (non-streaming fallback)
 */
async function pollForCompletion(
  interactionId: string,
  onProgress?: (progress: DeepResearchProgress) => void,
  maxWaitMs: number = 60 * 60 * 1000 // 60 minutes max
): Promise<DeepResearchResult> {
  const startTime = Date.now();
  const pollIntervalMs = 10000; // 10 seconds

  while (Date.now() - startTime < maxWaitMs) {
    try {
      const status = await client.interactions.get(interactionId);
      
      const statusValue = (status as { status?: string }).status || 'unknown';
      
      onProgress?.({
        status: statusValue as DeepResearchProgress['status'],
        percentage: Math.min(95, Math.floor((Date.now() - startTime) / maxWaitMs * 100)),
        message: `Status: ${statusValue}`,
        interactionId
      });

      if (statusValue === 'completed') {
        const outputs = (status as { outputs?: Array<{ text?: string; type?: string }> }).outputs || [];
        const textOutput = outputs.find(o => o.type === 'text' || !o.type);
        const content = textOutput?.text || '';

        onProgress?.({
          status: 'completed',
          percentage: 100,
          message: 'Research completed'
        });

        return {
          content,
          interactionId,
          status: 'completed',
          metadata: {
            agent: DEEP_RESEARCH_AGENT,
            streaming: false
          }
        };
      } else if (statusValue === 'failed') {
        const error = (status as { error?: string }).error || 'Unknown error';
        throw new Error(`Research failed: ${error}`);
      } else if (statusValue === 'cancelled') {
        throw new Error('Research was cancelled');
      }

      // Wait before next poll
      await new Promise(resolve => setTimeout(resolve, pollIntervalMs));

    } catch (error) {
      // If it's our own error, rethrow
      if (error instanceof Error && error.message.includes('Research')) {
        throw error;
      }
      // Otherwise log and continue polling
      logger.warn({ err: error instanceof Error ? error.message : String(error) }, 'Poll error, retrying');
      await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
    }
  }

  throw new Error('Research timed out after 60 minutes');
}

/**
 * Continue a conversation after Deep Research completes
 * Uses the same interaction context for follow-up questions
 */
export async function continueResearch(
  interactionId: string,
  followUp: string
): Promise<string> {
  try {
    const interaction = await client.interactions.create({
      model: 'gemini-2.5-flash', // Use a regular model for follow-ups
      input: followUp,
      previousInteractionId: interactionId
    } as Parameters<typeof client.interactions.create>[0]);

    const outputs = (interaction as { outputs?: Array<{ text?: string; type?: string }> }).outputs || [];
    const textOutput = outputs.find(o => o.type === 'text' || !o.type);
    return textOutput?.text || '';
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error({ err: errorMessage }, 'Follow-up error');
    throw new Error(`Follow-up failed: ${errorMessage}`);
  }
}

/**
 * Get a previous interaction by ID
 */
export async function getInteraction(interactionId: string): Promise<{
  content: string;
  status: string;
}> {
  const interaction = await client.interactions.get(interactionId);
  const outputs = (interaction as { outputs?: Array<{ text?: string; type?: string }> }).outputs || [];
  const textOutput = outputs.find(o => o.type === 'text' || !o.type);
  
  return {
    content: textOutput?.text || '',
    status: (interaction as { status?: string }).status || 'unknown'
  };
}