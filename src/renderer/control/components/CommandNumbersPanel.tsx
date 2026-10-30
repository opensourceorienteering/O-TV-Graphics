import { t as tr } from "../i18n";
import { useEffect, useMemo, useState } from "react";
import { DESK_TEMPLATES, DEFAULT_DESK_COMMANDS, type DeskCommandMap } from "../../../shared/desk";
import { call } from "../events/api";
import { DragHandle, useSortable } from "./useSortable";

const byKey = new Map(DESK_TEMPLATES.map((t) => [t.key, t]));
const defaultOrder = DESK_TEMPLATES.map((t) => t.key);

/** Saved map -> list order: numbered graphics by number, then the rest in default order */
function orderOf(map: DeskCommandMap): string[] {
  const numbered = Object.entries(map)
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([, key]) => key)
    .filter((key) => byKey.has(key));
  return [...numbered, ...defaultOrder.filter((k) => !numbered.includes(k))];
}

/**
 * Settings → Controls: the app-wide command numbers. The list order is the numbering: the
 * first graphic is 0, the next 1, and so on. Events order their own Live list in Plan.
 */
export function CommandNumbersPanel() {
  const [saved, setSaved] = useState<DeskCommandMap>({});
  const [order, setOrder] = useState<string[]>(defaultOrder);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    call<DeskCommandMap>("desk:commands")
      .then((map) => {
        setSaved(map);
        setOrder(orderOf(map));
      })
      .catch((e) => setError(e.message));
  }, []);

  const next: DeskCommandMap = useMemo(() => Object.fromEntries(order.map((key, i) => [String(i), key])), [order]);
  const dirty = JSON.stringify(Object.entries(next).sort()) !== JSON.stringify(Object.entries(saved).sort());
  const sortable = useSortable({
    order,
    onChange: (o) => {
      setOrder(o);
      setNotice("");
    },
    labelOf: (key) => tr(byKey.get(key)?.label ?? key),
    onMoved: setNotice,
  });

  const save = async (map: DeskCommandMap) => {
    setBusy(true);
    setError("");
    try {
      const result = await call<DeskCommandMap>("desk:saveCommands", map);
      setSaved(result);
      setOrder(orderOf(result));
      setNotice("Command numbers saved");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="command-numbers">
      {error && <p role="alert" className="studio-error">{error}</p>}
      <p role="status" className="muted">{notice ? tr(notice) : ""}</p>
      <ul className="template-list" {...sortable.listProps}>
        {order.map((key, index) => {
          const t = byKey.get(key)!;
          const before = Object.entries(saved).find(([, k]) => k === key)?.[0];
          const changed = before !== String(index);
          return (
            <li key={key} className={`template-item${sortable.itemClass(key)}`} {...sortable.itemProps(key)}>
              <div className="template-item-head">
                <DragHandle {...sortable.handleProps(key, index)} />
                <div className="template-row-info">
                  <span className="template-num-badge" aria-label={`${tr("Number")} ${index}`}>{index}</span>
                  <span className="template-name">
                    {tr(t.label)}
                    {changed && <span className="template-tag">{before === undefined ? tr("new number") : `${tr("was")} ${before}`}</span>}
                  </span>
                  <span className="template-params">{t.params.length ? t.params.map((p) => tr(p)).join(" · ") : "—"}</span>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
      <div className="form-actions">
        <button type="button" className="studio-button primary" disabled={busy || !dirty} onClick={() => void save(next)}>
          {tr("Save command numbers")}
        </button>
        <button
          type="button"
          className="studio-button"
          disabled={busy}
          onClick={() => {
            setOrder(orderOf(DEFAULT_DESK_COMMANDS));
            setNotice("");
          }}
        >
          {tr("Reset to default order")}
        </button>
      </div>
    </div>
  );
}
