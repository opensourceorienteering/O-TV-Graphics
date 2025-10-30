/**
 * Keyboard Shortcuts Hook
 * Provides global keyboard shortcuts for broadcast operations
 */

import { useEffect } from 'react';

export interface KeyboardShortcut {
  key: string;
  ctrl?: boolean;
  meta?: boolean;
  shift?: boolean;
  alt?: boolean;
  description: string;
  handler: () => void;
  preventDefault?: boolean;
}

export interface UseKeyboardShortcutsOptions {
  enabled?: boolean;
  shortcuts: KeyboardShortcut[];
}

/**
 * Hook to register keyboard shortcuts
 * 
 * @example
 * ```tsx
 * useKeyboardShortcuts({
 *   shortcuts: [
 *     {
 *       key: ' ', // Space
 *       description: 'Play/Stop selected item',
 *       handler: () => handlePlayStop(),
 *       preventDefault: true
 *     },
 *     {
 *       key: 's',
 *       ctrl: true,
 *       description: 'Save rundown',
 *       handler: () => handleSave(),
 *       preventDefault: true
 *     }
 *   ]
 * });
 * ```
 */
export function useKeyboardShortcuts(options: UseKeyboardShortcutsOptions) {
  const { enabled = true, shortcuts } = options;

  useEffect(() => {
    if (!enabled) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      // Don't trigger shortcuts when typing in input fields
      const target = event.target as HTMLElement;
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable
      ) {
        return;
      }

      // Find matching shortcut
      const shortcut = shortcuts.find(s => {
        const keyMatches = s.key.toLowerCase() === event.key.toLowerCase();
        const ctrlMatches = s.ctrl ? event.ctrlKey || event.metaKey : !event.ctrlKey && !event.metaKey;
        const shiftMatches = s.shift ? event.shiftKey : !event.shiftKey;
        const altMatches = s.alt ? event.altKey : !event.altKey;

        return keyMatches && ctrlMatches && shiftMatches && altMatches;
      });

      if (shortcut) {
        if (shortcut.preventDefault !== false) {
          event.preventDefault();
        }
        shortcut.handler();
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [enabled, shortcuts]);
}

/**
 * Get keyboard shortcut display string
 * 
 * @example
 * ```tsx
 * getShortcutDisplay({ key: 's', ctrl: true }) // "Ctrl+S" or "⌘S"
 * ```
 */
export function getShortcutDisplay(shortcut: Omit<KeyboardShortcut, 'handler' | 'description'>): string {
  const parts: string[] = [];
  const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;

  if (shortcut.ctrl || shortcut.meta) {
    parts.push(isMac ? '⌘' : 'Ctrl');
  }
  if (shortcut.shift) {
    parts.push(isMac ? '⇧' : 'Shift');
  }
  if (shortcut.alt) {
    parts.push(isMac ? '⌥' : 'Alt');
  }

  // Format key name
  let keyName = shortcut.key;
  if (keyName === ' ') {
    keyName = 'Space';
  } else if (keyName === 'Escape') {
    keyName = 'Esc';
  } else if (keyName === 'Enter') {
    keyName = '↵';
  } else if (keyName === 'ArrowUp') {
    keyName = '↑';
  } else if (keyName === 'ArrowDown') {
    keyName = '↓';
  } else if (keyName === 'ArrowLeft') {
    keyName = '←';
  } else if (keyName === 'ArrowRight') {
    keyName = '→';
  } else {
    keyName = keyName.toUpperCase();
  }

  parts.push(keyName);

  return parts.join(isMac ? '' : '+');
}

