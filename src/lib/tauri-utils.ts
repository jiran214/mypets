import { useEffect } from 'react';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';

export function hasTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

export function safeCurrentWindow(): ReturnType<typeof getCurrentWindow> | null {
  try {
    return getCurrentWindow();
  } catch (error) {
    console.warn('Tauri window controls are unavailable outside Tauri:', error);
    return null;
  }
}

/**
 * Subscribe to a Tauri event with automatic cleanup on unmount.
 * Safe to call outside Tauri (no-op).
 */
export function useTauriListen<T>(
  event: string,
  handler: (payload: T) => void,
  deps: React.DependencyList = [],
): void {
  useEffect(() => {
    if (!hasTauriRuntime()) return;

    let disposed = false;
    let cleanup: (() => void) | undefined;

    void listen<T>(event, (e) => handler(e.payload))
      .then((unlisten) => {
        if (disposed) {
          unlisten();
          return;
        }
        cleanup = unlisten;
      })
      .catch((error) => {
        console.warn(`Failed to listen to ${event}:`, error);
      });

    return () => {
      disposed = true;
      cleanup?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
