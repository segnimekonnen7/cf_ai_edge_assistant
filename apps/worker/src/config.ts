import type { Env } from './types';

export const DEFAULT_MODEL_ID = '@cf/meta/llama-3.3-8b-instruct';

export function getModelId(env: Env): string {
  return env.MODEL_ID || DEFAULT_MODEL_ID;
}

export function getAccountId(env: Env): string {
  if (!env.CF_ACCOUNT_ID) {
    throw new Error('CF_ACCOUNT_ID is not set. Add it to your wrangler configuration or .dev.vars file.');
  }
  return env.CF_ACCOUNT_ID;
}

