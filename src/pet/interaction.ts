import { LogicalSize, PhysicalPosition } from '@tauri-apps/api/window';
import { safeCurrentWindow } from '@/lib/tauri-utils';
import type { SpriteRenderer } from '@/renderer';
import type { AnimationState } from '@/types';

const DRAG_THRESHOLD = 10;
const MIN_SCALE = 0.5;
const MAX_SCALE = 2;
const SCALE_SENSITIVITY = 0.008;

const enum Priority {
  Idle = 0,
  Hover = 1,
  OneShot = 2,
  Continuous = 3,
  Drag = 4,
}

type InteractionSource = 'hover' | 'drag' | 'oneshot' | 'chat';
type Size = { width: number; height: number };

interface InteractionSlot {
  priority: Priority;
  state: AnimationState;
}

export class InteractionManager {
  private readonly slots = new Map<InteractionSource, InteractionSlot>();
  private currentState: AnimationState = 'idle';
  private oneShotCleanup: (() => void) | null = null;

  constructor(private renderer: SpriteRenderer) {}

  activate(source: InteractionSource, priority: Priority, state: AnimationState): void {
    this.slots.set(source, { priority, state });
    this.sync();
  }

  deactivate(source: InteractionSource): void {
    if (!this.slots.delete(source)) {
      return;
    }

    this.sync();
  }

  playOnce(state: AnimationState): void {
    this.cancelOneShot();
    this.activate('oneshot', Priority.OneShot, state);
    this.oneShotCleanup = this.renderer.onCycle(() => {
      this.cancelOneShot();
      this.deactivate('oneshot');
    });
  }

  private cancelOneShot(): void {
    if (this.oneShotCleanup) {
      this.oneShotCleanup();
      this.oneShotCleanup = null;
    }
  }

  private sync(): void {
    let nextState: AnimationState = 'idle';
    let nextPriority = Priority.Idle;

    for (const slot of this.slots.values()) {
      if (slot.priority >= nextPriority) {
        nextPriority = slot.priority;
        nextState = slot.state;
      }
    }

    if (nextState === this.currentState) {
      return;
    }

    this.currentState = nextState;
    this.renderer.setState(nextState);
  }
}

function setupDragDirection(canvas: HTMLCanvasElement, manager: InteractionManager): void {
  const appWindow = safeCurrentWindow();
  if (!appWindow) return;
  let pointerId: number | null = null;
  let startScreenX = 0;
  let startScreenY = 0;
  let lastScreenX = 0;
  let lastDirectionX = 0;
  let startWindowX = 0;
  let startWindowY = 0;
  let scaleFactor = 1;
  let dragActive = false;
  let ready = false;

  const stopDrag = () => {
    pointerId = null;
    dragActive = false;
    ready = false;
    manager.deactivate('drag');
  };

  canvas.addEventListener('pointerdown', (e: PointerEvent) => {
    if (e.button !== 0) {
      return;
    }

    e.preventDefault();
    canvas.setPointerCapture(e.pointerId);
    pointerId = e.pointerId;
    startScreenX = e.screenX;
    startScreenY = e.screenY;
    lastScreenX = e.screenX;
    lastDirectionX = 0;
    dragActive = false;
    ready = false;

    void Promise.all([appWindow.outerPosition(), appWindow.scaleFactor()]).then(([position, factor]) => {
      if (pointerId !== e.pointerId) {
        return;
      }

      startWindowX = position.x;
      startWindowY = position.y;
      scaleFactor = factor;
      ready = true;
    });
  });

  canvas.addEventListener('pointermove', (e: PointerEvent) => {
    if (pointerId !== e.pointerId || !ready) {
      return;
    }

    const dx = e.screenX - startScreenX;
    const dy = e.screenY - startScreenY;
    const moveX = e.screenX - lastScreenX;
    if (moveX !== 0) {
      lastDirectionX = moveX;
    }
    lastScreenX = e.screenX;

    void appWindow.setPosition(
      new PhysicalPosition(
        Math.round(startWindowX + dx * scaleFactor),
        Math.round(startWindowY + dy * scaleFactor),
      ),
    );

    if (Math.abs(dx) < DRAG_THRESHOLD) {
      if (dragActive) {
        dragActive = false;
        manager.deactivate('drag');
      }
      return;
    }

    dragActive = true;
    if (lastDirectionX !== 0) {
      manager.activate('drag', Priority.Drag, lastDirectionX > 0 ? 'running-right' : 'running-left');
    }
  });

  canvas.addEventListener('pointerup', (e: PointerEvent) => {
    if (pointerId !== e.pointerId) {
      return;
    }

    if (canvas.hasPointerCapture(e.pointerId)) {
      canvas.releasePointerCapture(e.pointerId);
    }
    stopDrag();
  });

  canvas.addEventListener('pointercancel', stopDrag);
}

function setupHover(canvas: HTMLCanvasElement, manager: InteractionManager): void {
  canvas.addEventListener('mouseenter', () => {
    manager.activate('hover', Priority.Hover, 'jumping');
  });

  canvas.addEventListener('mouseleave', () => {
    manager.deactivate('hover');
  });
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function syncStageScale(
  stage: HTMLElement,
  canvas: HTMLCanvasElement,
  renderer: SpriteRenderer,
  scale: number,
): void {
  const size = renderer.getDisplaySize();
  const width = Math.round(size.width * scale);
  const height = Math.round(size.height * scale);
  stage.style.width = `${width}px`;
  stage.style.height = `${height}px`;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  stage.style.setProperty('--pet-scale', scale.toFixed(3));
}

export interface ResizeHandleControl {
  setScale(scale: number): void;
  setEnabled(enabled: boolean): void;
  getScale(): number;
}

function setupResizeHandle(
  stage: HTMLDivElement,
  canvas: HTMLCanvasElement,
  handle: HTMLButtonElement,
  renderer: SpriteRenderer,
  resolveWindowSize?: (base: Size) => Size,
  onScaleChange?: (scale: number) => void,
): ResizeHandleControl {
  const appWindow = safeCurrentWindow();
  let scale = 0.8;
  let enabled = true;
  let pointerId: number | null = null;
  let startScale = 1;
  let startX = 0;
  let startY = 0;

  const syncWindowSize = () => {
    syncStageScale(stage, canvas, renderer, scale);
    if (stage.style.display === 'none') {
      return;
    }
    const base = { width: canvas.offsetWidth, height: canvas.offsetHeight };
    const size = resolveWindowSize ? resolveWindowSize(base) : base;
    if (appWindow) {
      void appWindow.setSize(new LogicalSize(size.width, size.height));
    }
  };

  syncStageScale(stage, canvas, renderer, scale);
  canvas.addEventListener('pet-canvas-resize', syncWindowSize);

  handle.addEventListener('pointerdown', (e: PointerEvent) => {
    if (!enabled || e.button !== 0) {
      return;
    }

    e.preventDefault();
    e.stopPropagation();
    handle.setPointerCapture(e.pointerId);
    pointerId = e.pointerId;
    startScale = scale;
    startX = e.screenX;
    startY = e.screenY;
    handle.dataset.active = 'true';
  });

  handle.addEventListener('pointermove', (e: PointerEvent) => {
    if (pointerId !== e.pointerId) {
      return;
    }

    e.preventDefault();
    const nextScale = clamp(
      startScale + (e.screenX - startX + (e.screenY - startY)) * SCALE_SENSITIVITY,
      MIN_SCALE,
      MAX_SCALE,
    );

    if (Math.abs(nextScale - scale) < 0.001) {
      return;
    }

    scale = nextScale;
    syncStageScale(stage, canvas, renderer, scale);
    const base = { width: canvas.offsetWidth, height: canvas.offsetHeight };
    const size = resolveWindowSize ? resolveWindowSize(base) : base;
    if (appWindow) {
      void appWindow.setSize(new LogicalSize(size.width, size.height));
    }
  });

  const stopResize = (e?: PointerEvent) => {
    if (e && pointerId === e.pointerId && handle.hasPointerCapture(e.pointerId)) {
      handle.releasePointerCapture(e.pointerId);
    }
    if (pointerId !== null) {
      onScaleChange?.(scale);
    }
    pointerId = null;
    delete handle.dataset.active;
  };

  handle.addEventListener('pointerup', stopResize);
  handle.addEventListener('pointercancel', stopResize);

  return {
    setScale(newScale: number) {
      scale = clamp(newScale, MIN_SCALE, MAX_SCALE);
      syncWindowSize();
      onScaleChange?.(scale);
    },
    setEnabled(next: boolean) {
      enabled = next;
      handle.style.display = next ? '' : 'none';
    },
    getScale() {
      return scale;
    },
  };
}

export function setupInteractions(
  stage: HTMLDivElement,
  canvas: HTMLCanvasElement,
  handle: HTMLButtonElement,
  renderer: SpriteRenderer,
  resolveWindowSize?: (base: Size) => Size,
  onScaleChange?: (scale: number) => void,
): InteractionManager & { resizeControl: ResizeHandleControl } {
  const manager = new InteractionManager(renderer);
  const resizeControl = setupResizeHandle(stage, canvas, handle, renderer, resolveWindowSize, onScaleChange);
  setupDragDirection(canvas, manager);
  setupHover(canvas, manager);
  return Object.assign(manager, { resizeControl });
}
