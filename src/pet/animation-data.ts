import type { AnimationState, AnimationDef } from '@/types';

export const CELL_W = 192;
export const CELL_H = 208;
export const COLS = 8;
export const ROWS = 9;

export const ANIMATIONS: Record<AnimationState, AnimationDef> = {
  'idle':          { row: 0, frameCount: 6, durations: [280, 110, 110, 140, 140, 320] },
  'running-right': { row: 1, frameCount: 8, durations: [120, 120, 120, 120, 120, 120, 120, 220] },
  'running-left':  { row: 2, frameCount: 8, durations: [120, 120, 120, 120, 120, 120, 120, 220] },
  'waving':        { row: 3, frameCount: 4, durations: [140, 140, 140, 280] },
  'jumping':       { row: 4, frameCount: 5, durations: [140, 140, 140, 140, 280] },
  'failed':        { row: 5, frameCount: 8, durations: [140, 140, 140, 140, 140, 140, 140, 240] },
  'waiting':       { row: 6, frameCount: 6, durations: [150, 150, 150, 150, 150, 260] },
  'running':       { row: 7, frameCount: 6, durations: [120, 120, 120, 120, 120, 220] },
  'review':        { row: 8, frameCount: 6, durations: [150, 150, 150, 150, 150, 280] },
};
