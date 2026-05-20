import { Menu, PredefinedMenuItem } from '@tauri-apps/api/menu';
import { emit } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { ANIMATIONS } from './animation-data';
import type { SpriteRenderer } from './renderer';
import type { AnimationState } from './types';

const STATE_LABELS: Record<AnimationState, string> = {
  'idle': '待机',
  'running-right': '向右跑',
  'running-left': '向左跑',
  'waving': '挥手',
  'jumping': '跳跃',
  'failed': '失败',
  'waiting': '等待',
  'running': '工作中',
  'review': '检查',
};

export function setupContextMenu(
  canvas: HTMLCanvasElement,
  renderer: SpriteRenderer,
  onOpenSettings: () => void,
  folder: string,
): void {
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
          text: '设置',
          action: () => onOpenSettings(),
        },
        separator,
        {
          id: 'quit',
          text: '退出',
          action: () => {
            void emit('pet-window-closed', { folder })
              .catch((error) => {
                console.warn('Failed to emit pet close event:', error);
              })
              .finally(() => {
                void getCurrentWindow().close();
              });
          },
        },
      ],
    });

    await menu.popup();
  });
}
