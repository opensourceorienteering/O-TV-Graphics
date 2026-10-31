import { t as tr } from "../i18n";
import { useEffect, useMemo, useState } from "react";
import type { EventControlNames, EventStartList } from "../../../shared/types/event";
import { call } from "./api";

interface ClassControl {
  code: string | number;
  name: string;
  sourceName?: string;
}

interface ControlRow {
  code: string;
  sourceName: string;
  classes: string[];
}

/** LiveResults codes are 1000 × passing + control: 1110 is control 110 */
const shortCode = (code: string) => {
  const n = Number(code);
  return Number.isFinite(n) && n >= 1000 ? String(n % 1000) : code;
};

/**
 * Plan → Radio controls: rename the radio controls graphics show ("Mellantid 2 <name>") when the
 * names from the timing data are not good, for the whole competition or for one class.
 */
export function EventControls({ eventId }: { eventId: string }) {
  const [classes, setClasses] = useState<string[]>([]);
  const [byClass, setByClass] = useState<Record<string, ClassControl[]>>({});
  const [names, setNames] = useState<EventControlNames>({ all: {}, classes: {} });
  const [selected, setSelected] = useState("");
  /** The graphics language: automatic names use its word for a split */
  const [language, setLanguage] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const list = await call<EventStartList>("startlist:get", eventId);
      call<{ event: { settings?: { presentation?: { language?: string } } } }>("event:get", eventId)
        .then((state) => setLanguage(state.event.settings?.presentation?.language ?? ""))
        .catch(() => undefined);
      setNames({ all: { ...(list.controlNames?.all ?? {}) }, classes: { ...(list.controlNames?.classes ?? {}) } });
      const cls = await call<string[]>("event:classes", eventId);
      setClasses(cls);
      // "" = all classes (the default): automatic names and clearing act on every class
      setSelected((s) => (s && cls.includes(s) ? s : ""));
      // a few classes at a time: the data source answers from its cache after the first fetch
      const found: Record<string, ClassControl[]> = {};
      for (let i = 0; i < cls.length; i += 4) {
        const part = await Promise.all(
          cls.slice(i, i + 4).map((c) => call<ClassControl[]>("event:controls", eventId, c).catch(() => [])),
        );
        part.forEach((controls, j) => (found[cls[i + j]] = controls));
      }
      setByClass(found);
      setDirty(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId]);

  /** Every radio control in the competition, with the classes that pass it */
  const rows = useMemo<ControlRow[]>(() => {
    const map = new Map<string, ControlRow>();
    for (const [cls, controls] of Object.entries(byClass)) {
      for (const c of controls) {
        const code = String(c.code);
        const row = map.get(code) ?? { code, sourceName: c.sourceName || c.name, classes: [] };
        row.classes.push(cls);
        map.set(code, row);
      }
    }
    return [...map.values()].sort((a, b) => Number(a.code) - Number(b.code));
  }, [byClass]);

  const setAll = (code: string, value: string) => {
    setNames((n) => ({ ...n, all: { ...(n.all ?? {}), [code]: value } }));
    setDirty(true);
  };
  const setClassName = (cls: string, code: string, value: string) => {
    setNames((n) => ({ ...n, classes: { ...(n.classes ?? {}), [cls]: { ...(n.classes?.[cls] ?? {}), [code]: value } } }));
    setDirty(true);
  };

  /**
   * Name controls "Split 1", "Split 2" ... in the order each class passes them: the selected
   * class, or every class when none is selected
   */
  const SPLIT_WORD: Record<string, string> = { sv: "Mellantid", nb: "Mellomtid", cs: "Mezičas" };
  const targets = () => (selected ? [selected] : classes.filter((c) => (byClass[c] ?? []).length));
  const nameAutomatically = () => {
    const word = SPLIT_WORD[language] ?? "Split";
    setNames((n) => {
      const next = { ...(n.classes ?? {}) };
      for (const cls of targets())
        next[cls] = Object.fromEntries((byClass[cls] ?? []).map((c, i) => [String(c.code), `${word} ${i + 1}`]));
      return { ...n, classes: next };
    });
    setDirty(true);
  };
  const clearNames = () => {
    setNames((n) => {
      const next = { ...(n.classes ?? {}) };
      for (const cls of targets()) next[cls] = {};
      return { ...n, classes: next };
    });
    setDirty(true);
  };
  const hasClassNames = (cls: string) => Object.values(names.classes?.[cls] ?? {}).some(Boolean);
  const named = classes.filter(hasClassNames).length;

  const save = async () => {
    setBusy(true);
    setError("");
    try {
      const list = await call<EventStartList>("startlist:updatePreferences", eventId, { controlNames: names });
      setNames({ all: { ...(list.controlNames?.all ?? {}) }, classes: { ...(list.controlNames?.classes ?? {}) } });
      setDirty(false);
      setNotice("Radio control names saved. Graphics on air use them at their next update.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const classRows = (byClass[selected] ?? []).map((c) => String(c.code));
  const sourceOf = (code: string) => rows.find((r) => r.code === code)?.sourceName ?? code;

  return (
    <div className="studio-form control-names">
      {error && <p role="alert" className="studio-error">{error}</p>}
      {notice && <p role="status">{tr(notice)}</p>}
      <p className="muted">
        {tr("Graphics show a radio control as its split number and name, for example \"Mellantid 2 Önnestad\". Rename controls whose names from the timing data do not read well. Leave a field empty to keep the name from the timing data.")}
      </p>

      <section className="connection-card">
        <div className="connection-card-heading">
          <div>
            <h3>{tr("Whole competition")}</h3>
            <p>{tr("A name here is used in every class that passes the control.")}</p>
          </div>
          <button type="button" className="studio-button" disabled={loading || busy} onClick={() => void load()}>
            {tr("Refresh controls")}
          </button>
        </div>
        {loading ? (
          <p className="muted">{tr("Loading radio controls…")}</p>
        ) : rows.length ? (
          <table className="control-table">
            <thead>
              <tr><th>{tr("Control")}</th><th>{tr("Name from timing data")}</th><th>{tr("Name in graphics")}</th><th>{tr("Classes")}</th></tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.code}>
                  <td className="mono">{shortCode(r.code)}</td>
                  <td>{r.sourceName}</td>
                  <td>
                    <input
                      aria-label={`${tr("Name in graphics for control")} ${shortCode(r.code)}`}
                      value={names.all?.[r.code] ?? ""}
                      placeholder={r.sourceName}
                      onChange={(e) => setAll(r.code, e.target.value)}
                    />
                  </td>
                  <td className="muted">{r.classes.length}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="muted">{tr("The timing data has no radio controls yet. Check the data source, then refresh.")}</p>
        )}
      </section>

      {rows.length > 0 && (
        <section className="connection-card">
          <div className="connection-card-heading">
            <div>
              <h3>{tr("Per class")}</h3>
              <p>{tr("A name here is used only in its class and wins over the competition-wide name.")}</p>
            </div>
            <label>
              {tr("Class")}{" "}
              <select value={selected} onChange={(e) => setSelected(e.target.value)}>
                <option value="">{tr("All classes")}</option>
                {classes.map((c) => (
                  <option key={c} value={c}>
                    {c}{Object.keys(names.classes?.[c] ?? {}).some((k) => names.classes?.[c]?.[k]) ? " •" : ""}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {(selected ? classRows.length > 0 : targets().length > 0) && (
            <div className="row wrap">
              <button type="button" className="studio-button" disabled={busy} onClick={nameAutomatically}>
                {selected ? tr("Automatic names") : tr("Automatic names in all classes")}
              </button>
              <button
                type="button"
                className="studio-button"
                disabled={busy || !(selected ? hasClassNames(selected) : named > 0)}
                onClick={clearNames}
              >
                {selected ? tr("Clear names in this class") : tr("Clear names in all classes")}
              </button>
              <span className="muted">
                {tr("Automatic names number the controls in the order each class passes them; graphics then show only the split number.")}
              </span>
            </div>
          )}
          {!selected ? (
            <p className="muted">
              {named
                ? `${named} / ${classes.length} ${tr("classes have their own names (•). Choose a class to see or edit them.")}`
                : tr("No class has its own names. Choose a class to name its controls, or name all classes automatically.")}
            </p>
          ) : classRows.length ? (
            <table className="control-table">
              <thead>
                <tr><th>{tr("Split")}</th><th>{tr("Control")}</th><th>{tr("Competition name")}</th><th>{tr("Name in this class")}</th></tr>
              </thead>
              <tbody>
                {classRows.map((code, i) => {
                  const competition = names.all?.[code] || sourceOf(code);
                  return (
                    <tr key={code}>
                      <td className="mono">{i + 1}</td>
                      <td className="mono">{shortCode(code)}</td>
                      <td>{competition}</td>
                      <td>
                        <input
                          aria-label={`${tr("Name in this class for control")} ${shortCode(code)}`}
                          value={names.classes?.[selected]?.[code] ?? ""}
                          placeholder={competition}
                          onChange={(e) => setClassName(selected, code, e.target.value)}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <p className="muted">{tr("This class has no radio controls.")}</p>
          )}
        </section>
      )}

      <div className="form-actions">
        <button type="button" className="studio-button primary" disabled={busy || !dirty} onClick={() => void save()}>
          {tr("Save radio control names")}
        </button>
      </div>
    </div>
  );
}
