import { t as tr } from "../i18n";
import { useRef, useState, type DragEvent, type KeyboardEvent } from "react";

/**
 * Drag-and-drop reordering for a list of keys, with keyboard moves on the handle (↑ / ↓).
 * Dragging starts only from the handle, so fields inside an item stay editable.
 */
export function useSortable({
  order,
  onChange,
  labelOf,
  onMoved,
}: {
  order: string[];
  onChange: (next: string[]) => void;
  labelOf: (key: string) => string;
  /** Announces keyboard moves (e.g. in a status line) */
  onMoved?: (message: string) => void;
}) {
  const [armed, setArmed] = useState("");
  const [dragging, setDragging] = useState("");
  const [dropAt, setDropAt] = useState<{ key: string; after: boolean } | null>(null);
  const handles = useRef(new Map<string, HTMLButtonElement>());

  const moveTo = (key: string, target: string, after: boolean) => {
    if (key === target) return;
    const rest = order.filter((k) => k !== key);
    const i = rest.indexOf(target);
    if (i < 0) return;
    rest.splice(after ? i + 1 : i, 0, key);
    onChange(rest);
  };
  const moveBy = (key: string, delta: -1 | 1) => {
    const i = order.indexOf(key);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= order.length) return;
    const next = [...order];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
    onMoved?.(`${labelOf(key)}: ${tr("position")} ${j + 1} / ${order.length}`);
    // Keep keyboard focus on the moved item's handle
    requestAnimationFrame(() => handles.current.get(key)?.focus());
  };

  return {
    /** Spread on the <ul> */
    listProps: {
      onDragLeave: (e: DragEvent<HTMLElement>) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropAt(null);
      },
    },
    /** Extra classes for an item: is-dragging, drop-before / drop-after */
    itemClass: (key: string) =>
      `${dragging === key ? " is-dragging" : ""}${dropAt?.key === key ? (dropAt.after ? " drop-after" : " drop-before") : ""}`,
    /** Spread on the <li> */
    itemProps: (key: string) => ({
      draggable: armed === key,
      onDragStart: (e: DragEvent<HTMLElement>) => {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", key);
        setDragging(key);
      },
      onDragEnd: () => {
        setDragging("");
        setArmed("");
        setDropAt(null);
      },
      onDragOver: (e: DragEvent<HTMLElement>) => {
        if (!dragging) return;
        e.preventDefault();
        const box = e.currentTarget.getBoundingClientRect();
        const after = e.clientY > box.top + box.height / 2;
        if (dropAt?.key !== key || dropAt.after !== after) setDropAt({ key, after });
      },
      onDrop: (e: DragEvent<HTMLElement>) => {
        e.preventDefault();
        if (dragging && dropAt) moveTo(dragging, dropAt.key, dropAt.after);
        setDropAt(null);
      },
    }),
    /** Props for <DragHandle> */
    handleProps: (key: string, index: number) => ({
      label: `${tr("Move")} ${labelOf(key)} (${index + 1} / ${order.length}). ${tr("Drag, or use the arrow keys.")}`,
      buttonRef: (el: HTMLButtonElement | null) => {
        if (el) handles.current.set(key, el);
        else handles.current.delete(key);
      },
      onPointerDown: () => setArmed(key),
      onPointerUp: () => setArmed(""),
      onKeyDown: (e: KeyboardEvent<HTMLButtonElement>) => {
        if (e.key === "ArrowUp" || e.key === "ArrowDown") {
          e.preventDefault();
          moveBy(key, e.key === "ArrowUp" ? -1 : 1);
        }
      },
    }),
  };
}

export function DragHandle({
  label,
  buttonRef,
  onPointerDown,
  onPointerUp,
  onKeyDown,
}: {
  label: string;
  buttonRef: (el: HTMLButtonElement | null) => void;
  onPointerDown: () => void;
  onPointerUp: () => void;
  onKeyDown: (e: KeyboardEvent<HTMLButtonElement>) => void;
}) {
  return (
    <button
      type="button"
      className="template-handle"
      ref={buttonRef}
      aria-label={label}
      title={tr("Drag to reorder")}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onKeyDown={onKeyDown}
    >
      <svg viewBox="0 0 12 18" width="12" height="18" aria-hidden="true">
        {[3, 9, 15].flatMap((y) => [3, 9].map((x) => <circle key={`${x}-${y}`} cx={x} cy={y} r="1.5" />))}
      </svg>
    </button>
  );
}
