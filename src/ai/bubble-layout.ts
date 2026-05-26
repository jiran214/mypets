export const BUBBLE_WIDTH = 320;
export const BUBBLE_HEIGHT = 480;
export const BUBBLE_GAP = 5;

export interface Size {
  width: number;
  height: number;
}

export interface BubbleLayout extends Size {
  petOffsetX: number;
  petOffsetY: number;
  bubbleTop: number;
}

export function calculateBubbleLayout(base: Size, withBubble: boolean): BubbleLayout {
  if (!withBubble) {
    return { ...base, petOffsetX: 0, petOffsetY: 0, bubbleTop: 0 };
  }

  const petOffsetX = Math.max(0, Math.round((BUBBLE_WIDTH - base.width) / 2));
  const petOffsetY = BUBBLE_HEIGHT + BUBBLE_GAP;
  return {
    width: Math.max(base.width, BUBBLE_WIDTH),
    height: base.height + petOffsetY,
    petOffsetX,
    petOffsetY,
    bubbleTop: 0,
  };
}
