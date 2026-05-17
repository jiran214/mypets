export interface PetMeta {
  id: string;
  displayName: string;
  description: string;
  spritesheetPath: string;
  kind?: string;
}

export type AnimationState =
  | 'idle'
  | 'running-right'
  | 'running-left'
  | 'waving'
  | 'jumping'
  | 'failed'
  | 'waiting'
  | 'running'
  | 'review';

export interface AnimationDef {
  row: number;
  frameCount: number;
  durations: number[];
}
