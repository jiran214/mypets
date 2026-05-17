import { Menu, PredefinedMenuItem } from '@tauri-apps/api/menu';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { ANIMATIONS } from './animation-data';
import type { SpriteRenderer } from './renderer';
import type { AnimationState } from './types';

const STATE_LABELS: Record<AnimationState, string> = {
  'idle': 'Idle',
  'running-right': 'Running Right',
  'running-left': 'Running Left',
  'waving': 'Waving',
  'jumping': 'Jumping',
  'failed': 'Failed',
  'waiting': 'Waiting',
  'running': 'Running (Working)',
  'review': 'Review',
};

export function setupContextMenu(canvas: HTMLCanvasElement, renderer: SpriteRenderer, onOpenSettings: () => void): void {
  canvas.addEventListener('contextmenu', async (e: MouseEvent) => {
    e.preventDefault();

    const separator = await PredefinedMenuItem.new({ item: 'Separator' });

    const stateItems = (Object.keys(ANIMATIONS) as AnimationState[]).map((state) => ({
      id: state,
      text: STATE_LABELS[state],
      action: () => renderer.setState(state),
    }));

    const menu = await Menu.new({
      items: [
        ...stateItems,
        separator,
        {
          id: 'settings',
          text: 'Settings',
          action: () => onOpenSettings(),
        },
        separator,
        {
          id: 'quit',
          text: 'Quit',
          action: () => getCurrentWindow().close(),
        },
      ],
    });

    await menu.popup();
  });
}
