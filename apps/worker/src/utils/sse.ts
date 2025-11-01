const encoder = new TextEncoder();

export interface SseController {
  send: (event: string, data: unknown) => void;
  close: () => void;
}

export function createSseStream(): { stream: ReadableStream; controller: SseController } {
  let controllerRef: ReadableStreamDefaultController;

  const stream = new ReadableStream({
    start(controller) {
      controllerRef = controller;
      controller.enqueue(encoder.encode('event: ready\n\n'));
    },
    cancel() {
      controllerRef?.close();
    },
  });

  return {
    stream,
    controller: {
      send(event, data) {
        const payload = typeof data === 'string' ? data : JSON.stringify(data);
        controllerRef.enqueue(
          encoder.encode(`event: ${event}\n` + `data: ${payload}\n\n`),
        );
      },
      close() {
        controllerRef.enqueue(encoder.encode('event: done\n\n'));
        controllerRef.close();
      },
    },
  };
}

