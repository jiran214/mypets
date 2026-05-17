import { getCurrentWindow } from '@tauri-apps/api/window';

export function setupDrag(element: HTMLElement): void {
  element.addEventListener('mousedown', (e: MouseEvent) => {
    if (e.button === 0) {
      getCurrentWindow().startDragging();
    }
  });
}
