import { Menu, MenuItem, PredefinedMenuItem, Submenu } from '@tauri-apps/api/menu';
import { emit } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { ANIMATIONS } from './animation-data';
import type { SpriteRenderer } from '@/renderer';
import type { AnimationState } from '@/types';

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

async function showMainWindow(): Promise<void> {
  const mainWindow = await WebviewWindow.getByLabel('main');
  if (!mainWindow) return;

  await mainWindow.show().catch(() => {});
  await mainWindow.unminimize().catch(() => {});
  await mainWindow.setFocus().catch(() => {});
}

export function setupContextMenu(
  canvas: HTMLCanvasElement,
  renderer: SpriteRenderer,
  folder: string,
): void {
  canvas.addEventListener('contextmenu', async (e: MouseEvent) => {
    e.preventDefault();

    const separator = await PredefinedMenuItem.new({ item: 'Separator' });

    const stateItems = await Promise.all(
      (Object.keys(ANIMATIONS) as AnimationState[]).map((state) =>
        MenuItem.new({
          id: `anim-${state}`,
          text: STATE_LABELS[state],
          action: () => renderer.setState(state),
        }),
      ),
    );

    const actionsSubmenu = await Submenu.new({
      id: 'actions',
      text: '动作',
      items: stateItems,
    });

    const menu = await Menu.new({
      items: [
        actionsSubmenu,
        separator,
        {
          id: 'main-window',
          text: '主界面',
          action: () => {
            void emit('pet-window-lower').catch(() => {});
            void showMainWindow();
            setTimeout(() => {
              void emit('focus-pet-chat', { folder }).catch(() => {});
            }, 50);
          },
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
