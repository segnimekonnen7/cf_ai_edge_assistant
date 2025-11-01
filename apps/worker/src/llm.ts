import { getModelId } from './config';
import { SYSTEM_PROMPT } from './prompt/system';
import type { ChatRequestBody, Env, MemoryState } from './types';

interface StatelessResult {
  sessionId: string;
  delta: string;
  done?: boolean;
}

export async function runStatelessChat(
  env: Env,
  body: ChatRequestBody,
  memory?: MemoryState,
): Promise<Response> {
  const { sessionId, message } = body;
  const history = memory?.turns ?? [];
  const prompt = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...(memory?.summary
      ? [{ role: 'system', content: `Conversation summary: ${memory.summary}` }]
      : []),
    ...history.map((turn) => ({ role: turn.role, content: turn.content })),
    { role: 'user', content: message },
  ];

  const model = body.modelId || getModelId(env);
  const aiInput = {
    messages: prompt,
    stream: true,
  };

  if (!env.WORKERS_AI?.stream) {
    throw new Error('Workers AI streaming API is not available in this environment');
  }

  const response = await env.WORKERS_AI.stream(model, aiInput);
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const decoder = new TextDecoder();

  void (async () => {
    const reader = response.body?.getReader();
    if (!reader) {
      writer.close();
      return;
    }
    let buffer = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (!line.trim()) continue;
        const chunk = JSON.parse(line) as StatelessResult;
        const payload = `event: delta\ndata: ${JSON.stringify({ ...chunk, sessionId })}\n\n`;
        await writer.write(new TextEncoder().encode(payload));
      }
    }
    await writer.write(new TextEncoder().encode('event: done\n\n'));
    writer.close();
  })();

  return new Response(readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
    },
  });
}

