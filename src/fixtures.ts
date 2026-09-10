import { Bitmap } from 'busybar-kit/preview';
import type { RgbaImage } from 'busybar-kit/image';
import type { Member, Room } from './discord/voice.js';

/**
 * A call that is not a call, for the preview and the tests.
 *
 * Everything here is made up on purpose: the point of the preview is to settle
 * the layout without Discord running, and a fixture that needed the network to
 * draw would defeat it.
 */
const NAMES = ['kolya', 'sasha', 'viirtual', 'mike', 'lena', 'artem', 'dima'];

const HUES = [210, 340, 130, 40, 280, 10, 180];

export function fixtureRoom(count: number, speakingIndex = 0): Room {
  const members: Member[] = Array.from({ length: count }, (_, index) => ({
    id: String(index + 1),
    name: NAMES[index % NAMES.length] ?? `user${index}`,
    avatar: null,
    bot: false,
    muted: index === 2,
    deafened: false,
    streaming: false,
    video: false,
    joinedAt: index,
    speakingSince: index === speakingIndex ? 1 : 0,
    silentSince: 0,
    spokenMs: 0,
  }));

  return { channelId: 'c1', channelName: 'general', guildId: 'g1', members };
}

/**
 * A stand-in for somebody's avatar: a two-tone disc, distinct per person.
 *
 * Real avatars are photographs, and a photograph at twelve pixels is mostly
 * one colour with a lighter blob near the top. That is what this imitates —
 * close enough that a layout which reads here reads on the device.
 */
export function fixtureAvatar(index: number, size = 128): RgbaImage {
  const hue = HUES[index % HUES.length] ?? 0;
  const bitmap = new Bitmap(size, size);
  const centre = (size - 1) / 2;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      // A face-shaped lighter patch above the middle, on a flat ground.
      const head = Math.hypot(x - centre, y - centre * 0.7) < size * 0.22;
      const body = Math.hypot(x - centre, y - size * 1.05) < size * 0.5;
      const light = head ? 0.85 : body ? 0.6 : 0.32;
      bitmap.set(x, y, { ...hsl(hue, 0.5, light), a: 255 });
    }
  }

  return { width: size, height: size, data: bitmap.data };
}

function hsl(hue: number, saturation: number, lightness: number) {
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const sector = (hue % 360) / 60;
  const second = chroma * (1 - Math.abs((sector % 2) - 1));
  const [r, g, b] = wheel(sector, chroma, second);
  const base = lightness - chroma / 2;

  return {
    r: Math.round((r + base) * 255),
    g: Math.round((g + base) * 255),
    b: Math.round((b + base) * 255),
  };
}

function wheel(sector: number, chroma: number, second: number): [number, number, number] {
  if (sector < 1) {
    return [chroma, second, 0];
  }
  if (sector < 2) {
    return [second, chroma, 0];
  }
  if (sector < 3) {
    return [0, chroma, second];
  }
  if (sector < 4) {
    return [0, second, chroma];
  }
  if (sector < 5) {
    return [second, 0, chroma];
  }

  return [chroma, 0, second];
}
