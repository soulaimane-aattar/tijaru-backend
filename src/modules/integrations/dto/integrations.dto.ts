import { z } from 'zod';

import { WEBHOOK_EVENTS } from '../application/webhook-dispatcher.service';

const EventSchema = z.enum(WEBHOOK_EVENTS);

export const CreateWebhookSchema = z.object({
  url: z.string().url().max(500),
  events: z.array(EventSchema).min(1),
  /** Optional: bring your own signing secret. One is generated otherwise. */
  secret: z.string().min(16).max(128).optional(),
});
export type CreateWebhookInput = z.infer<typeof CreateWebhookSchema>;

export const UpdateWebhookSchema = z.object({
  url: z.string().url().max(500).optional(),
  events: z.array(EventSchema).min(1).optional(),
  active: z.boolean().optional(),
});
export type UpdateWebhookInput = z.infer<typeof UpdateWebhookSchema>;

export const CreateApiKeySchema = z.object({ name: z.string().min(1).max(60) });
export type CreateApiKeyInput = z.infer<typeof CreateApiKeySchema>;
