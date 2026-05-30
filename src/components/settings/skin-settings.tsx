import { useEffect, useRef, useState, useCallback, type ReactNode } from 'react';
import { FolderOpen } from 'lucide-react';
import type { AiSettings } from '@/ai/ai-types';
import type { ReadyPetWorkspace } from '@/workspaces';
import type { AnimationState } from '@/types';
import { loadSpritesheet } from '@/pet/pet-loader';
import { ANIMATIONS, CELL_W, CELL_H } from '@/pet/animation-data';
import { Button } from '@/components/ui/button';
import {
  FieldSet,
  FieldGroup,
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
} from '@/components/ui/field';
import { Switch } from '@/components/ui/switch';

const PREVIEW_W = 192;
const PREVIEW_H = 208;
const GRID_ITEM_W = 80;
const GRID_ITEM_H = 88;

const ANIMATION_LABELS: Record<AnimationState, string> = {
  'idle': '待机',
  'running-right': '向右跑',
  'running-left': '向左跑',
  'waving': '招手',
  'jumping': '跳跃',
  'failed': '失败',
  'waiting': '等待',
  'running': '奔跑',
  'review': '检视',
};

const ALL_STATES: AnimationState[] = [
  'idle', 'running-right', 'running-left', 'waving',
  'jumping', 'failed', 'waiting', 'running', 'review',
];

const spritesheetCache = new Map<string, Promise<HTMLImageElement>>();

function loadSpritesheetImage(spritesheetPath: string): Promise<HTMLImageElement> {
  const cached = spritesheetCache.get(spritesheetPath);
  if (cached) return cached;

  const promise = loadSpritesheet(spritesheetPath).then((dataUrl: string) => new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Failed to load spritesheet'));
    image.src = dataUrl;
  })).catch((error: unknown) => {
    spritesheetCache.delete(spritesheetPath);
    throw error;
  });
  spritesheetCache.set(spritesheetPath, promise);
  return promise;
}

function drawFrame(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement,
  state: AnimationState,
  frame: number,
  dw: number,
  dh: number,
): void {
  const def = ANIMATIONS[state];
  ctx.clearRect(0, 0, dw, dh);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(
    image,
    frame * CELL_W,
    def.row * CELL_H,
    CELL_W,
    CELL_H,
    0,
    0,
    dw,
    dh,
  );
}

/** Left side: large canvas playing the selected animation */
function MainPreview({
  workspace,
  image,
  state,
}: {
  workspace: ReadyPetWorkspace;
  image: HTMLImageElement;
  state: AnimationState;
}): ReactNode {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    let disposed = false;
    let animationId: number | null = null;
    let frame = 0;
    let elapsed = 0;
    let lastTimestamp = 0;

    const tick = (timestamp: number): void => {
      if (disposed || !canvasRef.current) return;
      const def = ANIMATIONS[stateRef.current];
      if (lastTimestamp === 0) lastTimestamp = timestamp;
      elapsed += timestamp - lastTimestamp;
      lastTimestamp = timestamp;

      while (elapsed >= def.durations[frame]) {
        elapsed -= def.durations[frame];
        frame = (frame + 1) % def.frameCount;
      }

      const ctx = canvasRef.current.getContext('2d');
      if (ctx) drawFrame(ctx, image, stateRef.current, frame, PREVIEW_W, PREVIEW_H);
      animationId = requestAnimationFrame(tick);
    };

    const ctx = canvasRef.current?.getContext('2d');
    if (ctx) drawFrame(ctx, image, state, 0, PREVIEW_W, PREVIEW_H);
    animationId = requestAnimationFrame(tick);

    return () => {
      disposed = true;
      if (animationId !== null) cancelAnimationFrame(animationId);
    };
  }, [workspace, image]);

  return (
    <canvas
      ref={canvasRef}
      className="bg-transparent"
      width={PREVIEW_W}
      height={PREVIEW_H}
    />
  );
}

/** Right side grid item: small canvas looping a single animation */
function AnimationGridItem({
  image,
  state,
  selected,
  onSelect,
}: {
  image: HTMLImageElement;
  state: AnimationState;
  selected: boolean;
  onSelect: () => void;
}): ReactNode {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    let disposed = false;
    let animationId: number | null = null;
    let frame = 0;
    let elapsed = 0;
    let lastTimestamp = 0;

    const tick = (timestamp: number): void => {
      if (disposed || !canvasRef.current) return;
      const def = ANIMATIONS[state];
      if (lastTimestamp === 0) lastTimestamp = timestamp;
      elapsed += timestamp - lastTimestamp;
      lastTimestamp = timestamp;

      while (elapsed >= def.durations[frame]) {
        elapsed -= def.durations[frame];
        frame = (frame + 1) % def.frameCount;
      }

      const ctx = canvasRef.current.getContext('2d');
      if (ctx) drawFrame(ctx, image, state, frame, GRID_ITEM_W, GRID_ITEM_H);
      animationId = requestAnimationFrame(tick);
    };

    const ctx = canvasRef.current?.getContext('2d');
    if (ctx) drawFrame(ctx, image, state, 0, GRID_ITEM_W, GRID_ITEM_H);
    animationId = requestAnimationFrame(tick);

    return () => {
      disposed = true;
      if (animationId !== null) cancelAnimationFrame(animationId);
    };
  }, [image, state]);

  return (
    <button
      type="button"
      className={`flex flex-col items-center gap-1 rounded-lg border p-2 transition-colors cursor-pointer hover:bg-accent ${selected ? 'border-primary bg-accent' : 'border-transparent'}`}
      onClick={onSelect}
    >
      <canvas
        ref={canvasRef}
        className="bg-transparent"
        width={GRID_ITEM_W}
        height={GRID_ITEM_H}
      />
      <span className="text-xs text-muted-foreground">{ANIMATION_LABELS[state]}</span>
    </button>
  );
}

export function SkinSettings({
  readyWorkspace,
  settingsDraft,
  onSettingsChange,
  onImportWorkspace,
}: {
  readyWorkspace: ReadyPetWorkspace | null;
  settingsDraft: AiSettings;
  onSettingsChange: (settings: AiSettings) => void;
  onImportWorkspace: () => void;
}): ReactNode {
  const disabled = !readyWorkspace;
  const scale = settingsDraft.petScale;
  const [selectedState, setSelectedState] = useState<AnimationState>('idle');
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    if (!readyWorkspace) {
      setImage(null);
      setLoadError('');
      return;
    }
    let disposed = false;
    loadSpritesheetImage(readyWorkspace.meta.spritesheetPath)
      .then((img) => {
        if (!disposed) setImage(img);
      })
      .catch((err) => {
        if (!disposed) setLoadError(err instanceof Error ? err.message : String(err));
      });
    return () => { disposed = true; };
  }, [readyWorkspace]);

  const handleSelect = useCallback((state: AnimationState) => {
    setSelectedState(state);
  }, []);

  return (
    <div className="flex min-h-full flex-col gap-4">
      {/* Preview area: left-right layout */}
      <div className="flex min-h-90 gap-4">
        {/* Left: main preview */}
        <div className="flex flex-1 items-center justify-center rounded-lg border bg-background overflow-hidden">
          {!readyWorkspace ? (
            <span className="text-sm text-muted-foreground">请选择一个可用桌宠</span>
          ) : loadError ? (
            <span className="text-sm text-destructive">{loadError}</span>
          ) : !image ? (
            <span className="text-sm text-muted-foreground">加载中...</span>
          ) : (
            <div style={{ transform: `scale(${scale})`, transformOrigin: 'center center' }}>
              <MainPreview workspace={readyWorkspace} image={image} state={selectedState} />
            </div>
          )}
        </div>

        {/* Right: animation grid */}
        <div className="w-75 shrink-0 rounded-lg border bg-background overflow-auto p-3">
          {!image ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              加载中...
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-2">
              {ALL_STATES.map((s) => (
                <AnimationGridItem
                  key={s}
                  image={image}
                  state={s}
                  selected={s === selectedState}
                  onSelect={() => handleSelect(s)}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      <FieldSet disabled={disabled}>
        <FieldGroup>
          <Field data-disabled={disabled}>
            <div className="flex items-center justify-between">
              <FieldLabel htmlFor="pet-scale">桌宠大小</FieldLabel>
              <span className="text-sm text-muted-foreground">{Math.round(scale * 100)}%</span>
            </div>
            <input
              id="pet-scale"
              type="range"
              min={50}
              max={200}
              step={1}
              value={Math.round(scale * 100)}
              disabled={disabled}
              className="w-full accent-primary"
              onChange={(e) => {
                const next = Number(e.currentTarget.value) / 100;
                onSettingsChange({ ...settingsDraft, petScale: next });
              }}
            />
          </Field>

          <Field orientation="horizontal" data-disabled={disabled} className="rounded-lg border bg-background p-3">
            <Switch
              id="pet-resize-enabled"
              disabled={disabled}
              checked={settingsDraft.petResizeEnabled}
              onCheckedChange={(checked) => onSettingsChange({ ...settingsDraft, petResizeEnabled: checked })}
              aria-label="自由调节"
            />
            <FieldContent>
              <FieldLabel htmlFor="pet-resize-enabled">自由调节</FieldLabel>
              <FieldDescription>开启后可通过拖拽桌宠右下角角标自由调节大小。</FieldDescription>
            </FieldContent>
          </Field>
        </FieldGroup>
      </FieldSet>

      <div className="mt-auto flex flex-wrap items-center justify-between gap-3 border-t pt-4">
        <div className="min-w-0 text-sm text-muted-foreground">
          {readyWorkspace?.meta.spritesheetPath ?? '导入包含 pet.json 和贴图资源的文件夹'}
        </div>
        <div className="flex gap-2">
          <Button type="button" variant="outline" disabled={disabled} onClick={onImportWorkspace}>
            <FolderOpen data-icon="inline-start" />
            导入皮肤资源
          </Button>
        </div>
      </div>
    </div>
  );
}
