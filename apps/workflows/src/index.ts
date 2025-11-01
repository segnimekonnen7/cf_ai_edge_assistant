import { WorkflowEntrypoint, WorkflowStep } from '@cloudflare/workflows';
import type { WorkflowEvent } from '@cloudflare/workflows';
import { z } from 'zod';
import { SAFETY_GUARDRAILS, SYSTEM_PROMPT } from './prompts';

const inputSchema = z.object({
  sessionId: z.string().min(1),
  message: z.string().min(1),
  meta: z
    .object({
      clientTs: z.number().optional(),
    })
    .optional(),
});

interface MemoryTurn {
  role: 'user' | 'assistant';
  content: string;
  ts: number;
}

interface MemorySnapshot {
  summary: string;
  turns: MemoryTurn[];
}

interface WorkflowEnv {
  MODEL_ID?: string;
  WORKERS_AI: {
    run: (model: string, input: Record<string, unknown>) => Promise<unknown>;
  };
  MEMORY_DO: DurableObjectNamespace;
}

const DEFAULT_MODEL = '@cf/meta/llama-3.3-8b-instruct';

export function buildPrompt(
  memory: MemorySnapshot,
  userMessage: string,
): Array<{ role: string; content: string }> {
  const messages: Array<{ role: string; content: string }> = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'system', content: SAFETY_GUARDRAILS },
  ];

  if (memory.summary) {
    messages.push({ role: 'system', content: `Conversation summary: ${memory.summary}` });
  }

  for (const turn of memory.turns) {
    messages.push({ role: turn.role, content: turn.content });
  }

  messages.push({ role: 'user', content: userMessage });
  return messages;
}

async function loadMemory(env: WorkflowEnv, sessionId: string, step: WorkflowStep): Promise<MemorySnapshot> {
  return step.run('load_memory', async () => {
    const id = env.MEMORY_DO.idFromString(sessionId);
    const stub = env.MEMORY_DO.get(id);
    const res = await stub.fetch('https://memory/context', {
      method: 'POST',
      body: JSON.stringify({ intent: 'context', payload: { maxTokens: 4000 } }),
    });
    if (!res.ok) {
      throw new Error(`Memory fetch failed with ${res.status}`);
    }
    return (await res.json()) as MemorySnapshot;
  });
}

async function updateMemory(
  env: WorkflowEnv,
  sessionId: string,
  userMessage: string,
  assistantMessage: string,
  step: WorkflowStep,
): Promise<void> {
  await step.run('update_memory', async () => {
    const id = env.MEMORY_DO.idFromString(sessionId);
    const stub = env.MEMORY_DO.get(id);
    const ts = Date.now();
    await stub.fetch('https://memory/append-user', {
      method: 'POST',
      body: JSON.stringify({ intent: 'append', payload: { role: 'user', content: userMessage, ts } }),
    });
    await stub.fetch('https://memory/append-assistant', {
      method: 'POST',
      body: JSON.stringify({ intent: 'append', payload: { role: 'assistant', content: assistantMessage, ts: ts + 1 } }),
    });
    const summaryTrigger = await stub.fetch('https://memory/summarize', {
      method: 'POST',
      body: JSON.stringify({ intent: 'summarize' }),
    });
    if (!summaryTrigger.ok) {
      console.warn('Summary trigger failed for session', sessionId);
    }
  });
}

async function callLlm(
  env: WorkflowEnv,
  messages: Array<{ role: string; content: string }>,
  step: WorkflowStep,
  modelOverride?: string,
): Promise<string> {
  return step.run('call_llm', async () => {
    const model = modelOverride || env.MODEL_ID || DEFAULT_MODEL;
    const result = await env.WORKERS_AI.run(model, {
      messages,
    });
    if (typeof result === 'string') {
      return result;
    }
    if (result && typeof result === 'object' && 'response' in result) {
      return String((result as { response: string }).response);
    }
    return JSON.stringify(result);
  });
}

export default class ChatWorkflow extends WorkflowEntrypoint<WorkflowEnv, unknown, ReadableStream> {
  async run(event: WorkflowEvent<unknown>, step: WorkflowStep): Promise<ReadableStream> {
    const payload = await step.run('ingest_input', async () => {
      const body = typeof event.payload === 'string' ? JSON.parse(event.payload) : event.payload;
      return inputSchema.parse(body);
    });

    const memory = await loadMemory(this.env, payload.sessionId, step).catch(() => ({
      summary: '',
      turns: [],
    }));

    const promptMessages = await step.run('prepare_context', async () => buildPrompt(memory, payload.message));
    const assistantMessage = await callLlm(this.env, promptMessages, step, payload.modelId);

    await updateMemory(this.env, payload.sessionId, payload.message, assistantMessage, step).catch((error) => {
      console.warn('Memory update failed', error);
    });

    const encoder = new TextEncoder();
    const tokens = assistantMessage.split(/(\s+)/).filter(Boolean);

    return step.stream('emit_stream', async (stream) => {
      for (const chunk of tokens) {
        stream.write(encoder.encode(JSON.stringify({ delta: chunk, sessionId: payload.sessionId }) + '\n'));
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      stream.write(encoder.encode(JSON.stringify({ done: true, sessionId: payload.sessionId }) + '\n'));
    });
  }
}

