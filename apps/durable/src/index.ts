const DEFAULT_MEMORY: MemoryState = {
  turns: [],
  summary: '',
  lastUpdated: Date.now(),
};

const MAX_TURNS = 20;

interface MemoryTurn {
  role: 'user' | 'assistant';
  content: string;
  ts: number;
}

interface MemoryState {
  turns: MemoryTurn[];
  summary: string;
  lastUpdated: number;
}

interface DurableEnv {
  MODEL_ID?: string;
  WORKERS_AI: {
    run: (model: string, input: Record<string, unknown>) => Promise<unknown>;
  };
  CHAT_SUMMARIES?: KVNamespace;
}

const SUMMARY_SYSTEM_PROMPT =
  'Summarise the following conversation between a user and an assistant into 2-3 bullet points highlighting goals and follow-ups.';

export class SessionMemory {
  private state: DurableObjectState;
  private env: DurableEnv;
  private storageReady: Promise<void>;

  constructor(state: DurableObjectState, env: DurableEnv) {
    this.state = state;
    this.env = env;
    this.storageReady = this.state.blockConcurrencyWhile(async () => {
      const existing = (await this.state.storage.get<MemoryState>('memory')) ?? null;
      if (!existing) {
        await this.state.storage.put('memory', DEFAULT_MEMORY);
      }
    });
  }

  async fetch(request: Request): Promise<Response> {
    await this.storageReady;

    if (request.method === 'GET') {
      const snapshot = await this.load();
      return new Response(JSON.stringify(snapshot), { headers: { 'Content-Type': 'application/json' } });
    }

    if (request.method === 'DELETE') {
      await this.reset();
      return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } });
    }

    const payload = await request.json();
    const intent = payload.intent as string;

    switch (intent) {
      case 'get':
        return new Response(JSON.stringify(await this.load()), { headers: { 'Content-Type': 'application/json' } });
      case 'append': {
        const turn = payload.payload as Partial<MemoryTurn>;
        if (!turn?.role || !turn?.content) {
          return new Response(JSON.stringify({ error: 'Invalid turn payload' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        await this.appendTurn(turn.role, turn.content, turn.ts ?? Date.now());
        return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } });
      }
      case 'clear':
        await this.reset();
        return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } });
      case 'context': {
        const maxTokens = Number(payload.payload?.maxTokens) || 4000;
        const context = await this.getContext(maxTokens);
        return new Response(JSON.stringify(context), { headers: { 'Content-Type': 'application/json' } });
      }
      case 'summarize':
        await this.summarize();
        return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } });
      default:
        return new Response(JSON.stringify({ error: 'Unknown intent' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
    }
  }

  private async load(): Promise<MemoryState> {
    const memory = (await this.state.storage.get<MemoryState>('memory')) ?? DEFAULT_MEMORY;
    return memory;
  }

  private async save(memory: MemoryState): Promise<void> {
    await this.state.storage.put('memory', memory);
  }

  private async reset(): Promise<void> {
    await this.save({ ...DEFAULT_MEMORY, turns: [], summary: '' });
  }

  private async appendTurn(role: 'user' | 'assistant', content: string, ts: number): Promise<void> {
    const memory = await this.load();
    memory.turns.push({ role, content, ts });
    if (memory.turns.length > MAX_TURNS) {
      memory.turns = memory.turns.slice(-MAX_TURNS);
    }
    memory.lastUpdated = Date.now();
    await this.save(memory);
  }

  private async getContext(maxTokens: number): Promise<{ summary: string; turns: MemoryTurn[] }> {
    const memory = await this.load();
    let tokens = memory.summary.length / 3;
    const turns: MemoryTurn[] = [];
    for (let i = memory.turns.length - 1; i >= 0; i -= 1) {
      const turn = memory.turns[i];
      tokens += turn.content.length / 3;
      if (tokens > maxTokens) break;
      turns.unshift(turn);
    }
    return { summary: memory.summary, turns };
  }

  private async summarize(): Promise<void> {
    const memory = await this.load();
    if (memory.turns.length === 0) {
      return;
    }

    const conversation = memory.turns
      .map((turn) => `${turn.role.toUpperCase()}: ${turn.content}`)
      .join('\n');

    try {
      const model = this.env.MODEL_ID || '@cf/meta/llama-3.3-8b-instruct';
      const result = await this.env.WORKERS_AI.run(model, {
        messages: [
          { role: 'system', content: SUMMARY_SYSTEM_PROMPT },
          { role: 'user', content: conversation },
        ],
      });

      let summaryText: string;
      if (typeof result === 'string') {
        summaryText = result;
      } else if (result && typeof result === 'object' && 'response' in result) {
        summaryText = String((result as { response: string }).response);
      } else {
        summaryText = JSON.stringify(result);
      }

      memory.summary = summaryText;
      memory.lastUpdated = Date.now();
      await this.save(memory);

      if (this.env.CHAT_SUMMARIES) {
        await this.env.CHAT_SUMMARIES.put(this.state.id.toString(), summaryText);
      }
    } catch (error) {
      console.error('Failed to summarise conversation', error);
    }
  }
}

