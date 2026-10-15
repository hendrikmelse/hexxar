import { z } from 'zod';

/**
 * Analytics: what is measured, and how the browser reports the part of it only the browser sees.
 * An event is a name and a few facts (props). Nothing in one can identify a person: there is no IP
 * address and no text anyone typed. A visitor is a browser (an id the page makes up and keeps), a
 * session is one page load.
 */

/** What the page makes up for itself: letters, digits, dashes and underscores. */
export const analyticsIdSchema = z.string().regex(/^[A-Za-z0-9_-]{8,64}$/);

/** The admin marking a browser as the owner's (left out of the numbers) or not. */
export const internalVisitorSchema = z.object({
  visitorId: analyticsIdSchema,
  internal: z.boolean(),
});

/**
 * Events the browser reports (POST /api/event), because the server never sees them: the tutorial
 * runs in the page, and so does everything in the menus and on the result cards.
 */
export const CLIENT_EVENTS = [
  /** The page was opened. */
  'visit',
  /** A menu button: quickplay, tutorial, create or join. */
  'menu_action',
  /** The page was opened from an invite link. */
  'invite_link_open',
  'tutorial_start',
  'tutorial_step',
  'tutorial_retry',
  'tutorial_exit',
  'tutorial_complete',
  /** What a knocked-out player chose on the defeat card. */
  'out_choice',
  'feedback_open',
  'feedback_submit',
  'support_click',
  'sound_toggle',
  'fullscreen_toggle',
  'chat_toggle',
] as const;
export type ClientEventName = (typeof CLIENT_EVENTS)[number];

/** Events the server records itself, from what it sees happen. */
export const SERVER_EVENTS = [
  /** Someone entered a room: as a player, or as a spectator. */
  'lobby_join',
  /** Someone left a room (or lost their connection) before its match began. */
  'lobby_leave',
  /** Someone voted to start early, or took the vote back. */
  'vote_start',
  /** A match began; one event for each player in it. */
  'match_start',
  /** A match ended; one event for each player who was in it, with how it went for them. */
  'match_end',
  /** Someone started watching a match, without playing in it. */
  'spectator_join',
  /** Someone who was watching a match stopped (left, disconnected, or the room closed). */
  'spectate_end',
  'chat_message',
  'disconnect',
  'reconnect',
] as const;
export type ServerEventName = (typeof SERVER_EVENTS)[number];

export type EventName = ClientEventName | ServerEventName;

/** The facts of an event: a few short strings, numbers and flags. */
export const eventPropsSchema = z
  .record(z.string().max(40), z.union([z.string().max(100), z.number(), z.boolean()]))
  .refine((props) => Object.keys(props).length <= 12, 'too many props');
export type EventProps = z.infer<typeof eventPropsSchema>;

/** What the browser sends: some events at once, which visitor and page load they are from. */
export const eventBatchSchema = z.object({
  visitorId: analyticsIdSchema,
  sessionId: analyticsIdSchema,
  events: z
    .array(
      z.object({
        name: z.enum(CLIENT_EVENTS),
        props: eventPropsSchema.optional(),
        /** How long before the batch was sent this happened, in milliseconds (events are held back briefly). */
        ago: z.number().int().min(0).max(120_000).optional(),
      }),
    )
    .min(1)
    .max(20),
});
export type EventBatch = z.infer<typeof eventBatchSchema>;
