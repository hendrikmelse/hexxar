import { z } from 'zod';

/** What a feedback page submission is about. */
export const FEEDBACK_KINDS = ['feedback', 'bug'] as const;
export type FeedbackKind = (typeof FEEDBACK_KINDS)[number];

/** The longest message accepted. */
export const FEEDBACK_MAX_LENGTH = 4000;

/**
 * What the feedback page sends to the server (POST /api/feedback), and what the server accepts. The
 * email, if given, is where a reply goes; `details` is technical information the sender agreed
 * to include (browser, screen size, where in the game they were). `website` is a trap for bots:
 * the page never shows it, so anything in it means the form was filled in by a script.
 */
export const feedbackSchema = z.object({
  kind: z.enum(FEEDBACK_KINDS),
  message: z.string().trim().min(3).max(FEEDBACK_MAX_LENGTH),
  email: z.string().trim().email().max(200).optional(),
  name: z.string().trim().max(24).optional(),
  details: z.string().max(2000).optional(),
  website: z.string().max(200).optional(),
});
export type Feedback = z.infer<typeof feedbackSchema>;

/** A submission as the server keeps it, and as the admin panel lists it. */
export interface StoredFeedback {
  readonly id: string;
  /** When it arrived, as an ISO timestamp. */
  readonly receivedAt: string;
  readonly kind: FeedbackKind;
  readonly message: string;
  readonly email?: string;
  readonly name?: string;
  readonly details?: string;
  /** When it was marked as dealt with, or null while it is still open. */
  readonly resolvedAt: string | null;
}
