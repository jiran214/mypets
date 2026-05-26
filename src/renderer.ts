import { loadSpritesheet } from '@/pet/pet-loader';
import { ANIMATIONS, CELL_W, CELL_H } from '@/pet/animation-data';
import type { AnimationState } from './types';

export class SpriteRenderer {
  private ctx: CanvasRenderingContext2D;
  private image: HTMLImageElement | null = null;
  private trim = { x: 0, y: 0, width: CELL_W, height: CELL_H };
  private currentState: AnimationState = 'idle';
  private currentFrame = 0;
  private frameElapsed = 0;
  private lastTimestamp = 0;
  private running = false;
  private cycleCallbacks = new Set<() => void>();

  constructor(canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Failed to get 2d context');
    this.ctx = ctx;
    this.resizeCanvas(CELL_W, CELL_H);
  }

  async setImage(spritesheetPath: string): Promise<void> {
    const dataUrl = await loadSpritesheet(spritesheetPath);
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        this.image = img;
        this.trim = this.computeTrim(img);
        this.resizeCanvas(this.trim.width, this.trim.height);
        this.draw();
        resolve();
      };
      img.onerror = () => reject(new Error('Failed to load spritesheet'));
      img.src = dataUrl;
    });
  }

  setState(state: AnimationState): void {
    this.currentState = state;
    this.currentFrame = 0;
    this.frameElapsed = 0;
  }

  getState(): AnimationState {
    return this.currentState;
  }

  onCycle(callback: () => void): () => void {
    this.cycleCallbacks.add(callback);
    return () => { this.cycleCallbacks.delete(callback); };
  }

  getDisplaySize(): { width: number; height: number } {
    return {
      width: this.trim.width,
      height: this.trim.height,
    };
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastTimestamp = performance.now();
    requestAnimationFrame((t) => this.tick(t));
  }

  stop(): void {
    this.running = false;
  }

  dispose(): void {
    this.stop();
    this.image = null;
    this.cycleCallbacks.clear();
  }

  private tick(timestamp: number): void {
    if (!this.running) return;
    const dt = timestamp - this.lastTimestamp;
    this.lastTimestamp = timestamp;
    this.frameElapsed += dt;

    const def = ANIMATIONS[this.currentState];
    let cycled = false;
    while (this.frameElapsed >= def.durations[this.currentFrame]) {
      this.frameElapsed -= def.durations[this.currentFrame];
      if (this.currentFrame === def.frameCount - 1) {
        cycled = true;
      }
      this.currentFrame = (this.currentFrame + 1) % def.frameCount;
    }

    if (cycled) {
      for (const cb of this.cycleCallbacks) cb();
    }

    this.draw();
    requestAnimationFrame((t) => this.tick(t));
  }

  private draw(): void {
    if (!this.image) return;
    const def = ANIMATIONS[this.currentState];
    const sx = this.currentFrame * CELL_W + this.trim.x;
    const sy = def.row * CELL_H + this.trim.y;
    this.ctx.clearRect(0, 0, this.trim.width, this.trim.height);
    this.ctx.drawImage(
      this.image,
      sx,
      sy,
      this.trim.width,
      this.trim.height,
      0,
      0,
      this.trim.width,
      this.trim.height,
    );
  }

  private resizeCanvas(width: number, height: number): void {
    const dpr = window.devicePixelRatio || 1;
    const canvas = this.ctx.canvas;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    canvas.dispatchEvent(new CustomEvent('pet-canvas-resize'));
  }

  private computeTrim(img: HTMLImageElement): { x: number; y: number; width: number; height: number } {
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;

    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) {
      return { x: 0, y: 0, width: CELL_W, height: CELL_H };
    }

    ctx.drawImage(img, 0, 0);
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let minX = CELL_W;
    let minY = CELL_H;
    let maxX = -1;
    let maxY = -1;

    for (const def of Object.values(ANIMATIONS)) {
      for (let frame = 0; frame < def.frameCount; frame++) {
        const frameX = frame * CELL_W;
        const frameY = def.row * CELL_H;

        for (let y = 0; y < CELL_H; y++) {
          for (let x = 0; x < CELL_W; x++) {
            const index = ((frameY + y) * canvas.width + frameX + x) * 4 + 3;
            if (pixels[index] === 0) {
              continue;
            }

            minX = Math.min(minX, x);
            minY = Math.min(minY, y);
            maxX = Math.max(maxX, x);
            maxY = Math.max(maxY, y);
          }
        }
      }
    }

    if (maxX < minX || maxY < minY) {
      return { x: 0, y: 0, width: CELL_W, height: CELL_H };
    }

    const padding = 1;
    minX = Math.max(0, minX - padding);
    minY = Math.max(0, minY - padding);
    maxX = Math.min(CELL_W - 1, maxX + padding);
    maxY = Math.min(CELL_H - 1, maxY + padding);

    return {
      x: minX,
      y: minY,
      width: maxX - minX + 1,
      height: maxY - minY + 1,
    };
  }
}
