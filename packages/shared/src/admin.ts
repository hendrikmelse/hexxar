import type { RoomMode, RoomState } from './protocol.js';

/** One open game, as the admin panel shows it. */
export interface AdminRoom {
  readonly code: string;
  readonly visibility: 'public' | 'private';
  readonly mode: RoomMode;
  readonly state: RoomState;
  /** Connected people taking part. */
  readonly players: number;
  readonly spectators: number;
  /** Names of the people in it. */
  readonly names: readonly string[];
  /** When the room was opened (milliseconds since the epoch). */
  readonly createdAt: number;
}

/** What GET /api/admin/stats answers. */
export interface AdminStats {
  readonly serverTime: number;
  readonly startedAt: number;
  /** People with a live connection right now. */
  readonly connected: number;
  /** People connected and not in any game. */
  readonly inMenu: number;
  /** People in public games, by mode (what the title screen shows). */
  readonly publicPlayers: { readonly duel: number; readonly ffa: number };
  readonly rooms: readonly AdminRoom[];
  readonly feedback: { readonly open: number; readonly total: number };
}

/** One day of traffic, for the trend. */
export interface AnalyticsDay {
  /** YYYY-MM-DD (UTC). */
  readonly day: string;
  readonly visitors: number;
  readonly matches: number;
}

/** How many came to each step of the way from arriving to playing. Each is a count of visitors. */
export interface AnalyticsFunnel {
  readonly visitors: number;
  readonly tutorialStarted: number;
  readonly tutorialCompleted: number;
  /** Visitors who pressed a quickplay button. */
  readonly quickplayed: number;
  /** Visitors who finished the tutorial and later pressed a quickplay button. */
  readonly completedThenQuickplayed: number;
  readonly joinedLobby: number;
  readonly playedMatch: number;
}

/** How many reached each page of the tutorial, and how many left or retried there. */
export interface AnalyticsTutorialStep {
  readonly lesson: number;
  readonly step: number;
  /** Page loads that got to this page. */
  readonly reached: number;
  readonly exits: number;
  readonly retries: number;
}

/** What became of the people who joined a lobby, by kind of game. */
export interface AnalyticsLobby {
  readonly visibility: string;
  readonly mode: string;
  /** People who joined a lobby of this kind (at least ten minutes ago, so it has had its outcome). */
  readonly joins: number;
  /** ...of whom this many went on to play a match from it. */
  readonly played: number;
  /** People who left a lobby of this kind (any time), and the average time they had waited. */
  readonly leaves: number;
  readonly avgWaitBeforeLeavingMs: number | null;
}

/** How matches began, by kind of game. */
export interface AnalyticsStarts {
  readonly visibility: string;
  readonly mode: string;
  readonly matches: number;
  readonly avgPlayers: number | null;
  /** From the room opening to the match starting. */
  readonly avgLobbyMs: number | null;
  /** The part of that with too few players to start. */
  readonly avgBelowMinMs: number | null;
  /** Matches by why they began: full, timer, vote or host. */
  readonly reasons: Readonly<Record<string, number>>;
}

/** How matches went, by kind of game. */
export interface AnalyticsMatches {
  readonly visibility: string;
  readonly mode: string;
  readonly matches: number;
  readonly avgDurationMs: number | null;
  /** Matches by how the last player went out: eliminated, surrendered, left or afk. */
  readonly endedBy: Readonly<Record<string, number>>;
  /** Players' results: won, eliminated, surrendered, left, afk. */
  readonly outcomes: Readonly<Record<string, number>>;
}

/** Where visitors came from, and how far those from one source got. */
export interface AnalyticsSource {
  /** `link`: a ?ref= tag on the link; `site`: another website that linked here; `direct`: neither. */
  readonly kind: 'link' | 'site' | 'direct';
  readonly source: string;
  readonly visitors: number;
  readonly tutorialCompleted: number;
  readonly quickplayed: number;
  readonly playedMatch: number;
}

/** What GET /api/admin/analytics answers. Everything leaves out the owner's own activity. */
export interface AnalyticsReport {
  readonly days: number;
  readonly generatedAt: number;
  readonly daily: readonly AnalyticsDay[];
  readonly traffic: {
    readonly visitors: number;
    readonly sessions: number;
    /** Visitors who had been here before. */
    readonly returningVisitors: number;
    /** Page loads that came from an invite link. */
    readonly invitedSessions: number;
    /** Visitors on a phone, who were shown the notice that phones are not supported. They are counted in `visitors` too. */
    readonly phoneVisitors: number;
  };
  readonly funnel: AnalyticsFunnel;
  /** Where visitors came from, most visitors first. A visitor counts under each source they came by. */
  readonly sources: readonly AnalyticsSource[];
  readonly tutorial: readonly AnalyticsTutorialStep[];
  readonly lobbies: readonly AnalyticsLobby[];
  readonly starts: readonly AnalyticsStarts[];
  readonly matches: readonly AnalyticsMatches[];
  readonly sessions: {
    /** Page loads seen at all. */
    readonly total: number;
    /** ...in which at least one match was played. */
    readonly withMatch: number;
    /** Matches per page load, among those that played any. */
    readonly avgMatches: number | null;
  };
  readonly chat: {
    /** Visitors who were in a lobby or watching, so could have chatted. */
    readonly eligible: number;
    readonly chatted: number;
    readonly messages: number;
    readonly byChannel: Readonly<Record<string, number>>;
  };
  readonly spectating: {
    /** What people chose after being knocked out or after the match, by card. */
    readonly choices: readonly { card: string; choice: string; count: number }[];
    readonly watching: readonly {
      role: string;
      count: number;
      avgMs: number | null;
      /** How many watched until the match was over. */
      untilEnd: number;
    }[];
    readonly joins: Readonly<Record<string, number>>;
  };
  /** How often each smaller thing was done, by event name (and what, for the support card). */
  readonly usage: Readonly<Record<string, number>>;
}
