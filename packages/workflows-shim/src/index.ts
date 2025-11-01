export interface WorkflowEvent<T = unknown> {
  payload: T;
}

export class WorkflowStep {
  async run<T>(name: string, fn: () => Promise<T> | T): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      throw error instanceof Error ? error : new Error(`${name} step failed`);
    }
  }

  async stream(name: string, handler: (stream: WorkflowStreamWriter) => Promise<void>): Promise<ReadableStream> {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start: async (controller) => {
        const writer: WorkflowStreamWriter = {
          write: (chunk: Uint8Array | string) => {
            const data = typeof chunk === 'string' ? encoder.encode(chunk) : chunk;
            controller.enqueue(data);
          },
        };
        await handler(writer);
        controller.close();
      },
    });
    return stream;
  }
}

export interface WorkflowStreamWriter {
  write: (chunk: Uint8Array | string) => void;
}

export abstract class WorkflowEntrypoint<Env = unknown, Context = unknown, Result = unknown> {
  protected env: Env;

  constructor(env: Env) {
    this.env = env;
  }

  abstract run(event: WorkflowEvent, step: WorkflowStep): Promise<Result>;
}

