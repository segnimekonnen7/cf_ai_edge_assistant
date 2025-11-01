import type { ChatRequestBody, Env, MemoryState } from './types';

export async function fetchMemory(env: Env, sessionId: string): Promise<MemoryState | null> {
  const stub = getStub(env, sessionId);
  const res = await stub.fetch(`https://memory/${sessionId}`, {
    method: 'POST',
    body: JSON.stringify({ intent: 'get' }),
  });
  if (!res.ok) return null;
  return (await res.json()) as MemoryState;
}

export async function appendMemory(
  env: Env,
  sessionId: string,
  turn: { role: 'user' | 'assistant'; content: string; ts?: number },
): Promise<void> {
  const stub = getStub(env, sessionId);
  await stub.fetch(`https://memory/${sessionId}`, {
    method: 'POST',
    body: JSON.stringify({ intent: 'append', payload: turn }),
  });
}

export async function clearMemory(env: Env, sessionId: string): Promise<void> {
  const stub = getStub(env, sessionId);
  await stub.fetch(`https://memory/${sessionId}`, { method: 'POST', body: JSON.stringify({ intent: 'clear' }) });
}

export async function exportMemory(env: Env, sessionId: string): Promise<MemoryState | null> {
  return fetchMemory(env, sessionId);
}

export async function requestSummary(env: Env, sessionId: string): Promise<void> {
  const stub = getStub(env, sessionId);
  await stub.fetch(`https://memory/${sessionId}`, {
    method: 'POST',
    body: JSON.stringify({ intent: 'summarize' }),
  });
}

function getStub(env: Env, sessionId: string): DurableObjectStub {
  const id = env.MEMORY_DO.idFromString(sessionId);
  return env.MEMORY_DO.get(id);
}

