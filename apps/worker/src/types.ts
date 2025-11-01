export interface ChatRequestBody {
  sessionId: string;
  message: string;
  modelId?: string;
  meta?: {
    clientTs?: number;
  };
}

export interface MemoryTurn {
  role: 'user' | 'assistant';
  content: string;
  ts: number;
}

export interface MemoryState {
  turns: MemoryTurn[];
  summary: string;
  lastUpdated: number;
}

export interface WorkflowResponseChunk {
  delta: string;
  done?: boolean;
  sessionId: string;
}

export interface Env {
  CF_ACCOUNT_ID: string;
  MODEL_ID?: string;
  MEMORY_DO: DurableObjectNamespace;
  CHAT_SUMMARIES?: KVNamespace;
  CHAT_WORKFLOW: Fetcher;
  WORKERS_AI: Ai;
}

export type Ai = {
  run: (model: string, input: Record<string, unknown>) => Promise<unknown>;
  stream?: (model: string, input: Record<string, unknown>) => Promise<Response>;
};

export interface DurableObjectRequest {
  intent: 'get' | 'append' | 'clear' | 'context' | 'summarize';
  payload?: unknown;
}

