import { useEffect, useRef, useState, type ReactNode } from 'react';
import { FolderOpen } from 'lucide-react';
import type { AiSettings } from '@/ai/ai-types';
import type { ReadyPetWorkspace } from '@/workspaces';
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

const PREVIEW_DISPLAY_W = 192;
const PREVIEW_DISPLAY_H = 208;

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

function drawPreview(canvas: HTMLCanvasElement, image: HTMLImageElement, frame: number): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const def = ANIMATIONS.idle;
  canvas.width = PREVIEW_DISPLAY_W;
  canvas.height = PREVIEW_DISPLAY_H;

  ctx.clearRect(0, 0, PREVIEW_DISPLAY_W, PREVIEW_DISPLAY_H);
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
    PREVIEW_DISPLAY_W,
    PREVIEW_DISPLAY_H,
  );
}

function PetPreview({ workspace }: { workspace: ReadyPetWorkspace | null }): ReactNode {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let disposed = false;
    let animationId: number | null = null;
    let frame = 0;
    let elapsed = 0;
    let lastTimestamp = 0;

    const cancel = (): void => {
      if (animationId !== null) {
        cancelAnimationFrame(animationId);
        animationId = null;
      }
    };

    if (!workspace) {
      setError('');
      return cancel;
    }

    const tick = (image: HTMLImageElement, timestamp: number): void => {
      if (disposed || !canvasRef.current) return;
      const def = ANIMATIONS.idle;
      if (lastTimestamp === 0) {
        lastTimestamp = timestamp;
      }
      elapsed += timestamp - lastTimestamp;
      lastTimestamp = timestamp;

      while (elapsed >= def.durations[frame]) {
        elapsed -= def.durations[frame];
        frame = (frame + 1) % def.frameCount;
      }

      drawPreview(canvasRef.current, image, frame);
      animationId = requestAnimationFrame((nextTimestamp) => tick(image, nextTimestamp));
    };

    setError('');
    void loadSpritesheetImage(workspace.meta.spritesheetPath)
      .then((image) => {
        if (disposed || !canvasRef.current) return;
        drawPreview(canvasRef.current, image, 0);
        animationId = requestAnimationFrame((timestamp) => tick(image, timestamp));
      })
      .catch((loadError) => {
        setError(loadError instanceof Error ? loadError.message : String(loadError));
      });

    return () => {
      disposed = true;
      cancel();
    };
  }, [workspace]);

  if (!workspace) {
    return <div className="text-sm text-muted-foreground">请选择一个可用桌宠</div>;
  }

  if (error) {
    return <div className="text-sm text-destructive">{error}</div>;
  }

  return (
    <canvas
      ref={canvasRef}
      className="bg-transparent"
      width={PREVIEW_DISPLAY_W}
      height={PREVIEW_DISPLAY_H}
      aria-label={`${workspace.meta.displayName} 预览`}
    />
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

  return (
    <div className="flex min-h-full flex-col gap-4">
      <div className="flex min-h-[360px] items-center justify-center rounded-lg border bg-background overflow-hidden">
        <div style={{ transform: `scale(${scale})`, transformOrigin: 'center center' }}>
          <PetPreview workspace={readyWorkspace} />
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
              min={60}
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
