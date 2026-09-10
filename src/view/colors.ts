import { BASE_COLORS } from 'busybar-kit/colors';

/**
 * What a ring means.
 *
 * Four states, and the display has to say which is which from across a room,
 * so they are as far apart as the palette allows rather than four shades of
 * one idea. Idle is deliberately dim and deliberately present: a circle that
 * vanishes when its owner stops talking makes the row jump about.
 */
export const RING = {
  speaking: '#3BD16FFF',
  muted: '#E0333BFF',
  deafened: '#8B1E24FF',
  idle: '#3A3F47FF',
} as const;

export type RingState = keyof typeof RING;

export const TEXT = {
  name: '#C9CDD4FF',
  speakingName: '#FFFFFFFF',
  channel: '#7A828EFF',
  waiting: '#6E7581FF',
} as const;

export const TRANSPARENT = BASE_COLORS.transparent;
