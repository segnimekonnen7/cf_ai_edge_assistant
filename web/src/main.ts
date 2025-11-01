import { nanoid } from 'nanoid';

type Role = 'user' | 'assistant';

interface Message {
  id: string;
  role: Role;
  content: string;
  ts: number;
}

interface UiState {
  sessionId: string;
  messages: Message[];
  isStreaming: boolean;
  modelId: string;
  status: string;
}

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) {
  throw new Error('App container missing');
}

const state: UiState = {
  sessionId: `sess_${nanoid(10)}`,
  messages: [],
  isStreaming: false,
  modelId: '@cf/meta/llama-3.3-8b-instruct',
  status: 'Idle',
};

let recognition: SpeechRecognition | null = null;
let voiceEnabled = false;

function setupSpeech(): void {
  const SpeechRecognitionImpl: SpeechRecognitionConstructor | undefined =
    (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
  if (!SpeechRecognitionImpl) {
    state.status = 'Voice input not supported in this browser';
    return;
  }

  recognition = new SpeechRecognitionImpl();
  recognition.interimResults = true;
  recognition.continuous = false;

  recognition.onresult = (event) => {
    const transcript = Array.from(event.results)
      .map((result) => result[0]?.transcript ?? '')
      .join('');
    const textarea = document.querySelector<HTMLTextAreaElement>('#composer-input');
    if (textarea) {
      textarea.value = transcript;
    }
  };

  recognition.onerror = () => {
    state.status = 'Voice capture error';
    voiceEnabled = false;
    render();
  };
}

function render(): void {
  app.innerHTML = `
    <div class="chat-shell">
      <header class="chat-header">
        <div>
          <h1>Cloudflare Edge Assistant</h1>
          <div class="status">${state.status}</div>
        </div>
        <div class="chat-config">
          <label>
            Session
            <input id="session-id" value="${state.sessionId}" />
          </label>
          <label>
            Model
            <input id="model-id" value="${state.modelId}" />
          </label>
          <div class="voice-toggle">
            <label>
              <input type="checkbox" id="voice-toggle" ${voiceEnabled ? 'checked' : ''} /> Voice
            </label>
          </div>
        </div>
      </header>

      <section class="chat-log">
        ${state.messages
          .map(
            (msg) => `
              <div class="bubble ${msg.role}">
                <strong>${msg.role === 'user' ? 'You' : 'Assistant'}:</strong>
                <div>${msg.content}</div>
              </div>
            `,
          )
          .join('')}
      </section>

      <section class="composer">
        <textarea id="composer-input" placeholder="Ask about Cloudflare Workers, Durable Objects, or networking best practices"></textarea>
        <div class="composer-controls">
          <div class="actions">
            <button id="send-btn" ${state.isStreaming ? 'disabled' : ''}>Send</button>
            <button id="reset-btn" ${state.isStreaming ? 'disabled' : ''}>Reset Session</button>
          </div>
        </div>
      </section>
    </div>
  `;

  attachListeners();
  const log = document.querySelector('.chat-log');
  if (log) {
    log.scrollTop = log.scrollHeight;
  }
}

function attachListeners(): void {
  const sendBtn = document.querySelector<HTMLButtonElement>('#send-btn');
  const resetBtn = document.querySelector<HTMLButtonElement>('#reset-btn');
  const sessionInput = document.querySelector<HTMLInputElement>('#session-id');
  const modelInput = document.querySelector<HTMLInputElement>('#model-id');
  const textarea = document.querySelector<HTMLTextAreaElement>('#composer-input');
  const voiceToggle = document.querySelector<HTMLInputElement>('#voice-toggle');

  sendBtn?.addEventListener('click', () => {
    const message = textarea?.value.trim();
    if (!message) return;
    sendMessage(message);
  });

  textarea?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      sendBtn?.click();
    }
  });

  resetBtn?.addEventListener('click', async () => {
    if (state.isStreaming) return;
    await fetch(`/api/memory?sessionId=${encodeURIComponent(state.sessionId)}`, {
      method: 'DELETE',
    });
    state.messages = [];
    state.status = 'Session cleared';
    render();
  });

  sessionInput?.addEventListener('change', (event) => {
    const target = event.target as HTMLInputElement;
    state.sessionId = target.value.trim() || state.sessionId;
  });

  modelInput?.addEventListener('change', (event) => {
    const target = event.target as HTMLInputElement;
    state.modelId = target.value.trim() || state.modelId;
  });

  voiceToggle?.addEventListener('change', async (event) => {
    const target = event.target as HTMLInputElement;
    voiceEnabled = target.checked;
    if (voiceEnabled) {
      if (!recognition) {
        setupSpeech();
      }
      recognition?.start();
      state.status = 'Listening…';
    } else {
      recognition?.stop();
      state.status = 'Idle';
    }
    render();
  });
}

async function sendMessage(content: string): Promise<void> {
  const textarea = document.querySelector<HTMLTextAreaElement>('#composer-input');
  if (textarea) {
    textarea.value = '';
  }

  const userMessage: Message = {
    id: nanoid(),
    role: 'user',
    content,
    ts: Date.now(),
  };
  state.messages.push(userMessage);
  const assistantMessage: Message = {
    id: nanoid(),
    role: 'assistant',
    content: '',
    ts: Date.now(),
  };
  state.messages.push(assistantMessage);

  state.isStreaming = true;
  state.status = 'Waiting for response…';
  render();

  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-model-id': state.modelId },
      body: JSON.stringify({ sessionId: state.sessionId, message: content }),
    });

    if (!response.ok || !response.body) {
      throw new Error(`Chat API failed with status ${response.status}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let boundary = buffer.indexOf('\n\n');
      while (boundary !== -1) {
        const rawEvent = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        processEvent(rawEvent, assistantMessage);
        boundary = buffer.indexOf('\n\n');
      }
    }
  } catch (error) {
    state.status = `Error: ${(error as Error).message}`;
  } finally {
    state.isStreaming = false;
    state.status = 'Idle';
    render();
  }
}

function processEvent(payload: string, assistantMessage: Message): void {
  const lines = payload.split('\n');
  let eventType = 'message';
  let dataLine = '';
  for (const line of lines) {
    if (line.startsWith('event:')) {
      eventType = line.replace('event:', '').trim();
    }
    if (line.startsWith('data:')) {
      dataLine = line.replace('data:', '').trim();
    }
  }

  if (!dataLine) return;

  if (eventType === 'delta') {
    const data = JSON.parse(dataLine) as { delta: string };
    assistantMessage.content += data.delta;
    render();
  } else if (eventType === 'error') {
    state.status = `Workflow error: ${dataLine}`;
  }
}

setupSpeech();
render();

