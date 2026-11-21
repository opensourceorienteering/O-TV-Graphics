/**
 * The import helper: one graphic at a time ("2 of 3"), in three steps.
 *   1 Data: match the graphic's fields to Split Control data, or keep them typed in Live
 *   2 Check: the graphic on the sample race, with those matches
 *   3 Where and name: its look, its name in Live, its position, and what it replaces
 * Finish gives it its place and Live entry (templates:finishHelper).
 */
import { t as tr } from "../i18n";
import { useMemo, useRef, useState } from "react";
import { AlertTriangle, Check, CircleDashed, Wand2 } from "lucide-react";
import { createRace } from "../../../../site/preview/sim.js";
import { resolveDeskDeclaration } from "../../../shared/deskDeclaration";
import type { GraphicZone, OGrafManifest, OGrafTemplateInfo, TemplateSetInfo } from "../../../shared/types/ograf";
import { CUSTOM_TEMPLATE_SET } from "../../../shared/types/ograf";
import { DEFAULT_TEMPLATE_SET } from "../../../shared/types/spx";
import { LibraryPreview } from "./LibraryPreview";
import { graphicTitle, lookCards, needsAttention } from "./libraryModel";
import { sampleGraphicData } from "./sampleData";
import {
  buildDesk, buildFieldMap, conflicts, deriveInputs, fieldRows, initialChoices, kindFor, OUR_DATA, replacementFor, ROW_DATA, slug, typeWarning,
  type Choice, type FieldRow, type RowKey,
} from "./helperModel";
import "../components/DataSourceManager.css";

const ZONES: Array<{ id: GraphicZone; label: string }> = [
  { id: "lower", label: "Lower third" },
  { id: "main", label: "Full width (tables)" },
  { id: "side", label: "Side" },
  { id: "corner", label: "Corner" },
  { id: "full", label: "Full screen" },
];

/** Sample values for every one of our keys, from the sample race */
function useSamples() {
  const race = useRef(createRace());
  return useMemo(() => {
    const probe = {
      manifest: { id: "probe", name: "probe", schema: { properties: {} } },
      desk: { key: "probe", kind: "probe", label: "", short: "", params: ["runner", "class", "control"], required: [], feeds: ["timing", "event", "course", "weather"], live: true },
    } as unknown as OGrafTemplateInfo;
    // Near the end of the race, so places and times exist
    return sampleGraphicData(probe, race.current, race.current.end - 60_000);
  }, []);
}

const read = (data: Record<string, unknown>, key: string): unknown =>
  key.split(".").reduce<unknown>((v, k) => (v && typeof v === "object" ? (v as Record<string, unknown>)[k] : undefined), data);

const show = (v: unknown) => (v === undefined || v === null || v === "" ? "—" : typeof v === "object" ? JSON.stringify(v).slice(0, 40) : String(v));

function choiceValue(choice: Choice): string {
  if (choice.kind === "data") return `data:${choice.key}`;
  if (choice.kind === "list") return "list:results";
  return choice.kind;
}

function DataStep({
  rows,
  choices,
  setChoices,
}: {
  rows: FieldRow[];
  choices: Record<string, Choice>;
  setChoices: (c: Record<string, Choice>) => void;
}) {
  const samples = useSamples();
  const results = (samples.results as Array<Record<string, unknown>> | undefined) ?? [];
  const groups = [...new Set(OUR_DATA.map((d) => d.group))];
  const matched = rows.filter((r) => choices[r.key]?.kind !== "unset").length;

  const set = (key: string, value: string, row: FieldRow) => {
    let next: Choice;
    if (value === "typed") next = { kind: "typed" };
    else if (value === "unset") next = { kind: "unset" };
    else if (value === "list:results") {
      const items: Record<string, RowKey | "typed"> = {};
      for (const item of row.items ?? []) items[item.key] = "typed";
      next = { kind: "list", from: "results", items };
    } else next = { kind: "data", key: value.slice(5) };
    setChoices({ ...choices, [key]: next });
  };

  const rowSample = (key: string) => {
    const derived = (r: Record<string, unknown>) =>
      key === "timeSeconds" ? r.time : key === "diffSeconds" ? r.diff : r[key];
    return results.slice(0, 2).map((r) => show(derived(r))).join(" · ");
  };

  return (
    <div className="import-helper-data">
      <div className="row wrap import-helper-bar">
        <p className="muted">
          {matched} {tr("of")} {rows.length} {tr("fields have a choice")}
        </p>
        <button
          className="studio-button"
          onClick={() => setChoices(Object.fromEntries(rows.map((r) => [r.key, { kind: "typed" } as Choice])))}
          title={tr("The operator fills in every field in Live; no automatic data")}
        >
          {tr("Keep all typed in Live")}
        </button>
      </div>
      <div className="table-scroll">
        <table className="studio-table">
          <thead>
            <tr>
              <th scope="col">{tr("In the graphic")}</th>
              <th scope="col">{tr("Example in graphic")}</th>
              <th scope="col">{tr("Split Control data")}</th>
              <th scope="col">{tr("Sample race")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const choice = choices[row.key] ?? { kind: "unset" };
              const warning = choice.kind === "data" ? typeWarning(row, choice.key) : null;
              return [
                <tr key={row.key}>
                  <th scope="row">
                    {choice.kind === "unset" ? (
                      <AlertTriangle size={14} aria-label={tr("Needs a choice")} className="import-helper-warn" />
                    ) : choice.kind === "typed" ? (
                      <CircleDashed size={14} aria-label={tr("Typed in Live")} />
                    ) : (
                      <Check size={14} aria-label={tr("Matched")} />
                    )}{" "}
                    <code>{row.key}</code>
                    {row.title !== row.key && <span className="muted"> {row.title}</span>}
                    {row.type === "list" && <span className="muted"> · {tr("list")}</span>}
                    {"auto" in choice && choice.auto && (
                      <div className="muted import-helper-note">
                        <Wand2 size={12} aria-hidden="true" /> {tr("Matched automatically")}
                      </div>
                    )}
                  </th>
                  <td>{show(row.example)}</td>
                  <td>
                    <select aria-label={`${tr("Data for")} ${row.key}`} value={choiceValue(choice)} onChange={(e) => set(row.key, e.target.value, row)}>
                      <option value="unset" disabled>
                        {tr("Choose…")}
                      </option>
                      <option value="typed">{tr("Typed in Live")}</option>
                      {row.type === "list" ? (
                        <option value="list:results">{tr("Runners at a timing point")}</option>
                      ) : (
                        groups.map((group) => (
                          <optgroup key={group} label={tr(group)}>
                            {OUR_DATA.filter((d) => d.group === group).map((d) => (
                              <option key={d.key} value={`data:${d.key}`}>
                                {tr(d.label)}
                              </option>
                            ))}
                          </optgroup>
                        ))
                      )}
                    </select>
                    {warning && (
                      <div className="import-helper-warn" role="note">
                        {tr(warning)}
                      </div>
                    )}
                  </td>
                  <td className="muted">
                    {choice.kind === "data"
                      ? show(read(samples, choice.key))
                      : choice.kind === "list"
                        ? `${results.length} ${tr("rows")}`
                        : choice.kind === "unset"
                          ? tr("Needs a choice")
                          : ""}
                  </td>
                </tr>,
                ...(choice.kind === "list"
                  ? (row.items ?? []).map((item) => {
                      const itemChoice = choice.items[item.key] ?? "typed";
                      const itemWarning = itemChoice !== "typed" ? typeWarning(item, itemChoice) : null;
                      return (
                        <tr key={`${row.key}.${item.key}`} className="import-helper-item">
                          <th scope="row">
                            ↳ <code>{item.key}</code>
                          </th>
                          <td>{show(item.example)}</td>
                          <td>
                            <select
                              aria-label={`${tr("Data for")} ${row.key}.${item.key}`}
                              value={itemChoice}
                              onChange={(e) =>
                                setChoices({
                                  ...choices,
                                  [row.key]: { ...choice, auto: false, items: { ...choice.items, [item.key]: e.target.value as RowKey | "typed" } },
                                })
                              }
                            >
                              <option value="typed">{tr("Keep the graphic's own")}</option>
                              {ROW_DATA.map((d) => (
                                <option key={d.key} value={d.key}>
                                  {tr(d.label)}
                                </option>
                              ))}
                            </select>
                            {itemWarning && (
                              <div className="import-helper-warn" role="note">
                                {tr(itemWarning)}
                              </div>
                            )}
                          </td>
                          <td className="muted">{itemChoice !== "typed" ? rowSample(itemChoice) : ""}</td>
                        </tr>
                      );
                    })
                  : []),
              ];
            })}
          </tbody>
        </table>
      </div>
      {!rows.length && <p className="empty-state">{tr("This graphic has no fields: Live shows it as it is.")}</p>}
    </div>
  );
}

export function ImportHelper({
  queue,
  templates,
  sets,
  onFinished,
  onClose,
}: {
  queue: OGrafTemplateInfo[];
  templates: OGrafTemplateInfo[];
  sets: TemplateSetInfo[];
  /** After each Finish: the library reloads */
  onFinished: (done: { id: string; setId: string }) => Promise<void>;
  onClose: () => void;
}) {
  // Finished or skipped graphics; the rest are looked up again after every reload, so a graphic
  // that an earlier Finish already made work (it was replaced, say) is not offered again
  const [handled, setHandled] = useState<string[]>([]);
  const waiting = queue
    .map((q) => templates.find((t) => t.manifest.id === q.manifest.id))
    .filter((t): t is OGrafTemplateInfo => !!t && !handled.includes(t.manifest.id) && needsAttention([t]).length > 0);
  const graphic = waiting[0];
  if (!graphic) {
    if (handled.length || queue.length) queueMicrotask(onClose);
    return null;
  }
  const next = (id: string) => setHandled((list) => [...list, id]);
  return (
    <HelperFor
      key={graphic.manifest.id}
      graphic={graphic}
      position={`${Math.min(handled.length + 1, queue.length)} ${tr("of")} ${queue.length}`}
      templates={templates}
      sets={sets}
      onFinished={async (done) => {
        await onFinished(done);
        next(graphic.manifest.id);
      }}
      onSkip={waiting.length > 1 ? () => next(graphic.manifest.id) : undefined}
      onClose={onClose}
    />
  );
}

function HelperFor({
  graphic,
  position,
  templates,
  sets,
  onFinished,
  onSkip,
  onClose,
}: {
  graphic: OGrafTemplateInfo;
  position: string;
  templates: OGrafTemplateInfo[];
  sets: TemplateSetInfo[];
  onFinished: (done: { id: string; setId: string }) => Promise<void>;
  onSkip?: () => void;
  onClose: () => void;
}) {
  const rows = useMemo(() => fieldRows(graphic.manifest.schema), [graphic]);
  const inLook = graphic.setId !== CUSTOM_TEMPLATE_SET;
  const looks = useMemo(() => lookCards(sets, templates).map((c) => c.set), [sets, templates]);
  const ownKind = typeof graphic.manifest.v_olgrafik_kind === "string" ? (graphic.manifest.v_olgrafik_kind as string) : "";

  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [choices, setChoices] = useState<Record<string, Choice>>(() => initialChoices(rows));
  const [mode, setMode] = useState<"existing" | "new">("existing");
  // The default look first (Standard), else the first look
  const [lookId, setLookId] = useState(inLook ? graphic.setId : (looks.find((l) => l.id === DEFAULT_TEMPLATE_SET) ?? looks[0])?.id ?? "");
  const [newLookName, setNewLookName] = useState("");
  // "Standard – Name strap" is "Name strap" in Live: the look is clear from where it is
  const lookName = looks.find((l) => l.id === graphic.setId)?.name ?? "";
  const [label, setLabel] = useState(() => {
    const name = graphic.desk?.label ?? graphic.manifest.name ?? "";
    return lookName && name.startsWith(`${lookName} – `) ? name.slice(lookName.length + 3) : name;
  });
  const [short, setShort] = useState("");
  const [zone, setZone] = useState<GraphicZone>(graphic.zone ?? "lower");
  const [replaces, setReplaces] = useState<string | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const unset = rows.filter((r) => (choices[r.key] ?? { kind: "unset" }).kind === "unset");
  const inputs = deriveInputs(choices).inputs;
  const targetLook = inLook ? graphic.setId : mode === "existing" ? lookId : slug(newLookName);
  const kind = inLook && ownKind
    ? ownKind
    : kindFor(targetLook, label, templates.filter((t) => t.setId === targetLook && t.manifest.id !== graphic.manifest.id).map((t) => t.desk?.kind ?? ""));
  const desk = buildDesk({ label, short, choices });
  const fieldMap = buildFieldMap(choices);

  // The graphic as Live would have it, for the Check step (kept the same while nothing changes,
  // so the preview isn't reloaded on every render)
  const checkKey = step === 2 ? JSON.stringify([kind, desk, fieldMap, zone]) : "idle";
  const checked = useMemo(() => {
    const manifest = { ...graphic.manifest, v_olgrafik_kind: kind, v_olgrafik_desk: desk, v_olgrafik_fieldMap: fieldMap } as OGrafManifest;
    const resolved = resolveDeskDeclaration(manifest);
    return { template: { ...graphic, manifest, desk: resolved.desk, deskWarnings: resolved.warnings, zone } as OGrafTemplateInfo, warnings: resolved.warnings };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checkKey]);

  const target = inLook || mode === "existing" ? { lookId: targetLook } : { newLookName };
  const problems = conflicts({ target, label, looks, templates, selfId: graphic.manifest.id });
  const lookGraphics = templates.filter((t) => t.setId === targetLook && t.desk && t.manifest.id !== graphic.manifest.id);
  const suggested = replacementFor(templates, targetLook, inputs, graphic.manifest.id);
  // Offered for a graphic coming into the look; a look's own graphic replaces nothing unless chosen
  const replacing = replaces === undefined ? (inLook ? null : suggested?.manifest.id ?? null) : replaces;

  const finish = async () => {
    setBusy(true);
    setError("");
    try {
      const result = await window.electronAPI.invoke("templates:finishHelper", {
        graphicId: graphic.manifest.id,
        target,
        kind,
        zone,
        desk,
        fieldMap,
        replaces: replacing,
      });
      if (!result?.success) throw new Error(result?.error);
      await onFinished(result.data);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const steps = [tr("Data"), tr("Check"), tr("Where and name")];

  return (
    <div className="modal-overlay" onKeyDown={(e) => e.key === "Escape" && onClose()}>
      <div className="modal-content import-helper" role="dialog" aria-modal="true" aria-labelledby="import-helper-title">
        <div className="modal-header">
          <h3 id="import-helper-title">
            {tr("Set up")} {graphic.manifest.name} <span className="muted">· {position}</span>
          </h3>
          <button className="icon-button" aria-label={tr("Close")} onClick={onClose}>
            ×
          </button>
        </div>
        <ol className="import-helper-steps">
          {steps.map((name, i) => (
            <li key={name} aria-current={step === i + 1 ? "step" : undefined} className={step === i + 1 ? "is-current" : ""}>
              {i + 1} {name}
            </li>
          ))}
        </ol>
        <div className="modal-body">
          {step === 1 && (
            <>
              <p>{tr("Match the graphic's fields to Split Control data. Fields typed in Live are filled in by the operator.")}</p>
              <DataStep rows={rows} choices={choices} setChoices={setChoices} />
            </>
          )}
          {step === 2 && (
            <>
              <p>{tr("The graphic on the sample race, with these matches. Show it, step it and hide it.")}</p>
              {checked.warnings.length > 0 && (
                <ul className="import-helper-warn" role="alert">
                  {checked.warnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              )}
              <div className="import-helper-check">
                <LibraryPreview template={checked.template} />
              </div>
              {(graphic.manifest as { renderRequirements?: unknown }).renderRequirements !== undefined && (
                <p className="muted">
                  {tr("Render requirements")}: <code>{JSON.stringify((graphic.manifest as { renderRequirements?: unknown }).renderRequirements)}</code>
                </p>
              )}
            </>
          )}
          {step === 3 && (
            <div className="import-helper-where">
              {inLook ? (
                <p>
                  {tr("Look")}: <strong>{looks.find((l) => l.id === graphic.setId)?.name ?? graphic.setId}</strong>{" "}
                  <span className="muted">{tr("(a graphic already in a look stays there)")}</span>
                </p>
              ) : (
                <fieldset>
                  <legend>{tr("Where")}</legend>
                  <label className="row">
                    <input type="radio" checked={mode === "existing"} onChange={() => setMode("existing")} /> {tr("Add to look")}{" "}
                    <select aria-label={tr("Look")} value={lookId} onChange={(e) => { setLookId(e.target.value); setMode("existing"); setReplaces(undefined); }}>
                      {looks.map((l) => (
                        <option key={l.id} value={l.id}>
                          {l.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="row">
                    <input type="radio" checked={mode === "new"} onChange={() => setMode("new")} /> {tr("New look")}{" "}
                    <input type="text" aria-label={tr("New look name")} value={newLookName} onFocus={() => setMode("new")} onChange={(e) => { setNewLookName(e.target.value); setReplaces(undefined); }} />
                  </label>
                </fieldset>
              )}
              <div className="row wrap">
                <label>
                  {tr("Label in Live")}
                  <input type="text" value={label} onChange={(e) => setLabel(e.target.value)} />
                </label>
                <label>
                  {tr("Short label")}
                  <input type="text" value={short} placeholder={label} onChange={(e) => setShort(e.target.value)} />
                </label>
                <label>
                  {tr("Position")}
                  <select value={zone} onChange={(e) => setZone(e.target.value as GraphicZone)}>
                    {ZONES.map((z) => (
                      <option key={z.id} value={z.id}>
                        {tr(z.label)}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              {(inLook || mode === "existing") && lookGraphics.length > 0 && (
                <label>
                  {tr("Use instead of")}{" "}
                  <select value={replacing ?? ""} onChange={(e) => setReplaces(e.target.value || null)}>
                    <option value="">{tr("nothing (add alongside)")}</option>
                    {lookGraphics.map((t) => (
                      <option key={t.manifest.id} value={t.manifest.id}>
                        {graphicTitle(t)}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {suggested && replacing === suggested.manifest.id && (
                <p className="studio-warning" role="note">
                  <AlertTriangle size={15} aria-hidden="true" /> {graphicTitle(suggested)} {tr("also asks for the same in Live. This graphic takes its place, with its command number and favourites. Choose nothing to add it alongside.")}
                </p>
              )}
              {problems.length > 0 && (
                <ul className="import-helper-warn" role="alert">
                  {problems.map((p) => (
                    <li key={p}>{tr(p)}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
          {error && (
            <p role="alert" className="studio-error">
              {error}
            </p>
          )}
        </div>
        <div className="modal-footer">
          <button className="studio-button" onClick={onClose}>
            {tr("Cancel")}
          </button>
          {onSkip && (
            <button className="studio-button" onClick={onSkip}>
              {tr("Skip")}
            </button>
          )}
          {step > 1 && (
            <button className="studio-button" onClick={() => setStep((step - 1) as 1 | 2)}>
              {tr("Back")}
            </button>
          )}
          {step < 3 ? (
            <button
              className="studio-button primary"
              disabled={unset.length > 0 || (step === 2 && checked.warnings.length > 0)}
              title={unset.length ? `${tr("Needs a choice")}: ${unset.map((r) => r.key).join(", ")}` : undefined}
              onClick={() => setStep((step + 1) as 2 | 3)}
            >
              {tr("Next")}
            </button>
          ) : (
            <button className="studio-button primary" disabled={busy || problems.length > 0} onClick={() => void finish()}>
              {tr("Finish")}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
