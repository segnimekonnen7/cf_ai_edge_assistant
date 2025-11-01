import { setTimeout as delay } from 'node:timers/promises';
import { randomUUID } from 'node:crypto';

const CONCURRENCY = 10;
const TOTAL = 50;
const BATCH_DELAY = 150;
const ENDPOINT = process.env.CHAT_URL ?? 'http://127.0.0.1:8787/api/chat';

async function postMessage(sessionId, message) {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, message }),
  });
  if (!res.ok) {
    throw new Error(`Request failed with ${res.status}`);
  }
  await res.text();
}

async function runBatch(startIndex) {
  const promises = [];
  for (let i = 0; i < CONCURRENCY && startIndex + i < TOTAL; i += 1) {
    const session = randomUUID();
    promises.push(postMessage(session, `Load test message #${startIndex + i}`));
  }
  await Promise.allSettled(promises);
}

async function main() {
  console.log(`Starting load test against ${ENDPOINT}`);
  for (let i = 0; i < TOTAL; i += CONCURRENCY) {
    await runBatch(i);
    await delay(BATCH_DELAY);
  }
  console.log('Load test complete');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

