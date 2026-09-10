import type { Member, Room, SelfState } from '../discord/voice.js';
import type { RingState } from './colors.js';
import { capacity, FRONT_ROW } from './layout.js';

/**
 * What the display should show, worked out and finished with.
 *
 * Nothing below this point knows about Discord, and nothing above it knows
 * about pixels. A frame is comparable, so an unchanged one costs no request,
 * and it is the whole input to both the device and the offline preview.
 */
export type Tile = {
  userId: string;
  name: string;
  ring: RingState;
  /** Asset path on the device, or null while the picture is still coming. */
  avatar: string | null;
  streaming: boolean;
};

export type Frame =
  | { kind: 'away' }
  | {
      kind: 'call';
      channel: string;
      tiles: Tile[];
      /** People in the call who did not fit on the strip. */
      hidden: number;
      selfMuted: boolean;
      selfDeafened: boolean;
    };

export type FrameOptions = {
  /** Most avatars to draw. Beyond this the row is a count, not a crowd. */
  maxTiles: number;
  /** Leave bots out; a music bot is not somebody you are talking to. */
  hideBots: boolean;
};

export const DEFAULT_MAX_TILES = 5;

/** The most the front strip can hold, whatever the settings say. */
export const HARD_MAX_TILES = capacity(FRONT_ROW);

/**
 * Builds the frame for a moment.
 *
 * `speaking` is passed in rather than read off the member because the ring has
 * a hold on it — whether somebody counts as talking depends on the clock, and
 * the clock belongs to the room, not to this.
 */
export function toFrame(
  room: Room | null,
  self: SelfState | null,
  speaking: (member: Member) => boolean,
  options: FrameOptions,
): Frame {
  if (!room) {
    return { kind: 'away' };
  }

  const people = options.hideBots
    ? room.members.filter((member) => !member.bot)
    : room.members;
  const limit = Math.max(1, Math.min(options.maxTiles, HARD_MAX_TILES));
  const shown = people.slice(0, limit);
  const me = self ? people.find((member) => member.id === self.userId) : undefined;

  return {
    kind: 'call',
    channel: room.channelName,
    tiles: shown.map((member) => ({
      userId: member.id,
      name: member.name,
      ring: ringOf(member, speaking(member)),
      avatar: null,
      streaming: member.streaming,
    })),
    hidden: people.length - shown.length,
    // The client is the authority on your own state; the roster agrees with it
    // a moment later, and the moment shows if you trust the roster instead.
    selfMuted: self?.muted ?? me?.muted ?? false,
    selfDeafened: self?.deafened ?? me?.deafened ?? false,
  };
}

/**
 * Speech first, because it is the only state that changes second to second.
 *
 * Someone deafened is also muted, so the order decides which the ring shows;
 * deafened is the more informative of the two — they cannot hear you either.
 */
function ringOf(member: Member, speaking: boolean): RingState {
  if (speaking) {
    return 'speaking';
  }
  if (member.deafened) {
    return 'deafened';
  }

  return member.muted ? 'muted' : 'idle';
}

/** Whether two frames would draw the same thing. */
export function sameFrame(left: Frame, right: Frame): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
