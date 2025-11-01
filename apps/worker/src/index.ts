import { chatRequestSchema } from './schema';
import { streamWorkflow } from './workflowClient';
import { runStatelessChat } from './llm';
import { clearMemory, exportMemory, fetchMemory } from './memoryClient';
import type { ChatRequestBody, Env } from './types';

const jsonHeaders = { 'Content-Type': 'application/json' } as const;

async function handleChat(request: Request, env: Env): Promise<Response> {
  const body = await request.json();
  const parsed = chatRequestSchema.safeParse(body);
  if (!parsed.success) {
    return new Response(JSON.stringify({ error: parsed.error.flatten() }), {
      status: 400,
      headers: jsonHeaders,
    });
  }

  const chatBody: ChatRequestBody = parsed.data;
  if (!chatBody.modelId) {
    const headerModel = request.headers.get('x-model-id');
    if (headerModel) {
      chatBody.modelId = headerModel;
    }
  }

  try {
    return await streamWorkflow(env, chatBody);
  } catch (error) {
    const memory = await fetchMemory(env, chatBody.sessionId);
    return runStatelessChat(env, chatBody, memory || undefined);
  }
}

async function handleMemoryGet(url: URL, env: Env): Promise<Response> {
  const sessionId = url.searchParams.get('sessionId');
  if (!sessionId) {
    return new Response(JSON.stringify({ error: 'sessionId is required' }), { status: 400, headers: jsonHeaders });
  }
  const memory = await exportMemory(env, sessionId);
  return new Response(JSON.stringify({ sessionId, memory }), { headers: jsonHeaders });
}

async function handleMemoryDelete(url: URL, env: Env): Promise<Response> {
  const sessionId = url.searchParams.get('sessionId');
  if (!sessionId) {
    return new Response(JSON.stringify({ error: 'sessionId is required' }), { status: 400, headers: jsonHeaders });
  }
  await clearMemory(env, sessionId);
  return new Response(JSON.stringify({ ok: true, sessionId }), { headers: jsonHeaders });
}

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const { pathname } = url;

    if (pathname === '/api/health') {
      return new Response(JSON.stringify({ status: 'ok', ts: Date.now() }), { headers: jsonHeaders });
    }

    if (pathname === '/api/chat' && request.method === 'POST') {
      return handleChat(request, env);
    }

    if (pathname === '/api/memory') {
      if (request.method === 'GET') {
        return handleMemoryGet(url, env);
      }
      if (request.method === 'DELETE') {
        return handleMemoryDelete(url, env);
      }
    }

    return new Response(JSON.stringify({ error: 'Not found' }), { status: 404, headers: jsonHeaders });
  },
};

