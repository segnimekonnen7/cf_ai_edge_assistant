import { z } from 'zod';

export const chatRequestSchema = z.object({
  sessionId: z.string().min(1),
  message: z.string().min(1),
  modelId: z.string().optional(),
  meta: z
    .object({
      clientTs: z.number().int().optional(),
    })
    .optional(),
});

export type ChatRequest = z.infer<typeof chatRequestSchema>;

