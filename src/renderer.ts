import { loadSpritesheet } from './pet-loader';
import { ANIMATIONS, CELL_W, CELL_H } from './animation-data';
import type { AnimationState } from './types';

export class SpriteRenderer {
  private ctx: CanvasRenderingContext2D;
  private image: HTMLImageElement | null = null;
  private currentState: AnimationState = 'idle';
  private currentFrame = 0;
  private frameElapsed = 0;
  private lastTimestamp = 0;
  private running = false;

  constructor(canvas: HTMLCanvasElement) {
    const dpr = window.devicePixelRatio || 1;
    canvas.width = CELL_W * dpr;
    canvas.height = CELL_H * dpr;
    canvas.style.width = `${CELL_W}px`;
    canvas.style.height = `${CELL_H}px`;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Failed to get 2d context');
    this.ctx = ctx;
    this.ctx.scale(dpr, dpr);
  }

  async setImage(spritesheetPath: string): Promise<void> {
    const dataUrl = await loadSpritesheet(spritesheetPath);
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        this.image = img;
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

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastTimestamp = performance.now();
    requestAnimationFrame((t) => this.tick(t));
  }

  private tick(timestamp: number): void {
    if (!this.running) return;
    const dt = timestamp - this.lastTimestamp;
    this.lastTimestamp = timestamp;
    this.frameElapsed += dt;

    const def = ANIMATIONS[this.currentState];
    while (this.frameElapsed >= def.durations[this.currentFrame]) {
      this.frameElapsed -= def.durations[this.currentFrame];
      this.currentFrame = (this.currentFrame + 1) % def.frameCount;
    }

    this.draw();
    requestAnimationFrame((t) => this.tick(t));
  }

  private draw(): void {
    if (!this.image) return;
    const def = ANIMATIONS[this.currentState];
    const sx = this.currentFrame * CELL_W;
    const sy = def.row * CELL_H;
    this.ctx.clearRect(0, 0, CELL_W, CELL_H);
    this.ctx.drawImage(this.image, sx, sy, CELL_W, CELL_H, 0, 0, CELL_W, CELL_H);
  }
}
