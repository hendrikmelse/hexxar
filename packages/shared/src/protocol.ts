import { z } from 'zod';

/** Messages sent from client to server. */
export const clientMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('hello'), name: z.string().min(1).max(24) }),
]);
export type ClientMessage = z.infer<typeof clientMessageSchema>;

/** Messages sent from server to client. */
export const serverMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('welcome'), tickMs: z.number().int().positive() }),
  z.object({
    type: z.literal('tick'),
    tick: z.number().int().nonnegative(),
    /** Server timestamp (ms since epoch) at which the next tick will fire. */
    nextTickAt: z.number(),
  }),
]);
export type ServerMessage = z.infer<typeof serverMessageSchema>;
