import { createSseStream } from './utils/sse';
import type { ChatRequestBody, Env, WorkflowResponseChunk } from './types';

interface WorkflowPayload {
  sessionId: string;
  message: string;
  modelId?: string;
  meta?: ChatRequestBody['meta'];
}

export async function streamWorkflow(
  env: Env,
  payload: WorkflowPayload,
): Promise<Response> {
  try {
    const res = await env.CHAT_WORKFLOW.fetch('https://workflow/chat', {
      method: 'POST',
      body: JSON.stringify(payload),
      headers: { 'Content-Type': 'application/json' },
    });

    if (!res.ok) {
      throw new Error(`Workflow responded with ${res.status}`);
    }

    const { stream, controller } = createSseStream();

    void (async () => {
      try {
        const reader = res.body?.getReader();
        if (!reader) {
          throw new Error('Workflow response had no body stream');
        }

        let buffer = '';
        for (;;) {
          const { done, value } = await reader.read();
          if (done) {
            break;
          }
          buffer += new TextDecoder().decode(value);
          const chunks = buffer.split('\n');
          buffer = chunks.pop() || '';
          for (const chunk of chunks) {
            if (!chunk.trim()) {
              continue;
            }
            const data = JSON.parse(chunk) as WorkflowResponseChunk;
            controller.send('delta', data);
          }
        }
      } catch (err) {
        controller.send('error', { message: (err as Error).message });
      } finally {
        controller.close();
      }
    })();

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-store',
        Connection: 'keep-alive',
      },
    });
  } catch (error) {
    throw error instanceof Error ? error : new Error('Unknown workflow error');
  }
}

