import { t as tr } from "../i18n";
import { useEffect, useState } from "react";
import type {
  EventStartList,
  StartListEntry,
} from "../../../shared/types/event";
import { call } from "./api";
import { ask } from "./ask";
import { ClubNames } from "./ClubNames";

export function StartLists({
  eventId,
  onChanged,
}: {
  eventId: string;
  onChanged: () => Promise<void>;
}) {
  const [list, setList] = useState<EventStartList>({ entries: [], updated: 0 });
  const [className, setClassName] = useState("");
  const [query, setQuery] = useState("");
  const [onlyFavourites, setOnlyFavourites] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [start, setStart] = useState(101);
  const [block, setBlock] = useState(100);
  const [radioControls, setRadioControls] = useState<
    Array<{ code: string | number; name: string }>
  >([]);
  const refresh = async () => setList(await call("startlist:get", eventId));
  useEffect(() => {
    refresh().catch((e) => setError(e.message));
  }, [eventId]);
  const run = async (channel: string, ...args: any[]) => {
    setBusy(true);
    setError("");
    try {
      await call(channel, eventId, ...args);
      await refresh();
      await onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const classes = [...new Set(list.entries.map((e) => e.className))].sort();
  const entries = list.entries.filter(
    (e) =>
      (!className || e.className === className) &&
      (!onlyFavourites || e.favourite) &&
      `${e.name} ${e.club} ${e.bib || e.virtualBib || ""}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  const edit = async (
    entry: StartListEntry,
    key: "name" | "club" | "bib" | "note",
  ) => {
    const value = await ask(`Edit ${key}`, entry[key] || "");
    if (value !== null)
      void run("startlist:update", entry.key, { [key]: value });
  };
  return (
    <div className="studio-form">
      {error && (
        <p role="alert" className="studio-error">
          {error}
        </p>
      )}
      <div className="row wrap">
        <button
          className="studio-button primary"
          disabled={busy}
          onClick={() => void run("startlist:refresh")}
        >
           {tr("Refresh from event source")} </button>
        <button
          className="studio-button"
          disabled={busy}
          onClick={() => void run("startlist:import")}
        >
           {tr("Import XML / CSV")} </button>
        <button
          className="studio-button"
          disabled={busy || !list.entries.length}
          onClick={() =>
            void run("startlist:exportPdf", className ? [className] : undefined)
          }
        >
           {tr("Export PDF")} </button>
      </div>
      <p className="muted">
         {tr("Stars and notes are shared with the director page and Live. Imports preserve favourites and virtual bibs.")} </p>
      {!!classes.length && (
        <section className="broadcast-focus">
          <h3>{tr("Favourite classes")}</h3>
          <p className="muted">{tr("Pin the classes the operator will follow most closely.")}</p>
          <div className="class-choices">
            {classes.map((value) => {
              const favourite = list.favouriteClasses?.includes(value) || false;
              return (
                <button
                  key={value}
                  className="studio-button"
                  aria-pressed={favourite}
                  disabled={busy}
                  onClick={() =>
                    void run("startlist:updatePreferences", {
                      favouriteClasses: favourite
                        ? list.favouriteClasses?.filter((item) => item !== value)
                        : [...(list.favouriteClasses || []), value],
                    })
                  }
                >
                  {favourite ? "★" : "☆"} {value}
                </button>
              );
            })}
          </div>
        </section>
      )}
      <div className="row wrap">
        <label>
           {tr("Class")} <select
            value={className}
            onChange={(e) => setClassName(e.target.value)}
          >
            <option value="">{tr("All classes")}</option>
            {classes.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
        <label>
           {tr("Find runner")} <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={tr("Name, club or bib")}
          />
        </label>
        <label className="inline-label">
          <input
            type="checkbox"
            checked={onlyFavourites}
            onChange={(e) => setOnlyFavourites(e.target.checked)}
          />
           {tr("Favourites only")} </label>
      </div>
      <details>
        <summary>{tr("Radio controls")}</summary>
        <p className="muted">
           {tr("Load the selected class’s controls, then pin the ones used during the broadcast.")} </p>
        <button
          className="studio-button"
          disabled={busy || !className}
          onClick={() => {
            setBusy(true);
            setError("");
            void call("event:controls", eventId, className)
              .then(setRadioControls)
              .catch((cause) => setError(cause.message))
              .finally(() => setBusy(false));
          }}
        >
           {tr("Load controls for")} {className || "a selected class"}
        </button>
        <div className="class-choices">
          {radioControls.map((control) => {
            const favourite = list.favouriteControls?.some(
              (item) => item.className === className && String(item.code) === String(control.code),
            );
            return (
              <button
                key={String(control.code)}
                className="studio-button"
                aria-pressed={favourite}
                disabled={busy}
                onClick={() =>
                  void run("startlist:updatePreferences", {
                    favouriteControls: favourite
                      ? list.favouriteControls?.filter(
                          (item) => !(item.className === className && String(item.code) === String(control.code)),
                        )
                      : [...(list.favouriteControls || []), { ...control, className }],
                  })
                }
              >
                {favourite ? "★" : "☆"} {control.name}
              </button>
            );
          })}
        </div>
      </details>
      <details>
        <summary>{tr("Assign virtual bibs")}</summary>
        <p className="muted">
           {tr("For runners without a timing-system bib. V numbers stay inside Split Control and PDFs.")} </p>
        <div className="row wrap">
          <label>
             {tr("First number")} <input
              type="number"
              min="1"
              value={start}
              onChange={(e) => setStart(Number(e.target.value))}
            />
          </label>
          <label>
             {tr("Numbers per class (0 = continuous)")} <input
              type="number"
              min="0"
              value={block}
              onChange={(e) => setBlock(Number(e.target.value))}
            />
          </label>
          <button
            className="studio-button"
            disabled={busy || start < 1 || block < 0}
            onClick={() =>
              void run("startlist:assignBibs", {
                classes: className ? [className] : undefined,
                start,
                perClassBlock: block,
              })
            }
          >
             {tr("Assign bibs")} </button>
          <button
            className="studio-button"
            disabled={busy}
            onClick={async () => {
              if (confirm("Clear virtual bibs for the selected classes?"))
                void run(
                  "startlist:clearBibs",
                  className ? [className] : undefined,
                );
            }}
          >
             {tr("Clear virtual bibs")} </button>
        </div>
      </details>
      <div className="table-scroll">
        <table className="studio-table">
          <thead>
            <tr>
              <th scope="col">{tr("Favourite")}</th>
              <th scope="col">{tr("Class")}</th>
              <th scope="col">{tr("Start")}</th>
              <th scope="col">{tr("Bib")}</th>
              <th scope="col">{tr("Runner")}</th>
              <th scope="col">{tr("Club")}</th>
              <th scope="col">{tr("Notes")}</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.key}>
                <td>
                  <button
                    className="studio-button star"
                    aria-label={`${e.favourite ? "Unstar" : "Star"} ${e.name}`}
                    aria-pressed={!!e.favourite}
                    disabled={busy}
                    onClick={() =>
                      void run("startlist:update", e.key, {
                        favourite: !e.favourite,
                      })
                    }
                  >
                    {e.favourite ? "★" : "☆"}
                  </button>
                </td>
                <td>{e.className}</td>
                <td>
                  <button
                    className="text-button"
                    disabled={busy}
                    aria-label={`Edit start time for ${e.name}`}
                    onClick={async () => {
                      const current = e.startTimeMs
                        ? new Date(e.startTimeMs).toLocaleTimeString("en-GB", {
                            timeZone: list.timeZone || "Europe/Stockholm",
                          })
                        : "";
                      const value = await ask(
                        "Start time in the event time zone (HH:MM:SS; blank clears it)",
                        current,
                      );
                      if (value !== null)
                        void run("startlist:update", e.key, {
                          startTimeText: value,
                        });
                    }}
                  >
                    {e.startTimeMs
                      ? new Date(e.startTimeMs).toLocaleTimeString("en-GB", {
                          timeZone: list.timeZone || "Europe/Stockholm",
                        })
                      : tr("Add start")}
                  </button>
                </td>
                <td>
                  <button
                    className="text-button"
                    onClick={() => edit(e, "bib")}
                  >
                    {e.bib || e.virtualBib || "Add bib"}
                  </button>
                </td>
                <td>
                  <button
                    className="text-button"
                    onClick={() => edit(e, "name")}
                  >
                    {e.name}
                  </button>
                </td>
                <td>
                  <button
                    className="text-button"
                    onClick={() => edit(e, "club")}
                  >
                    {e.club || "Add club"}
                  </button>
                </td>
                <td>
                  <button
                    className="text-button"
                    onClick={() => edit(e, "note")}
                  >
                    {e.note || "Add note"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!entries.length && (
          <p className="empty-state">
            {list.entries.length
              ? tr("No runners match your filters.")
              : tr("Import a start list or refresh it from the event’s data source.")}
          </p>
        )}
      </div>
      <p className="muted">
        {entries.length}  {tr("of")} {list.entries.length}  {tr("runners")} </p>
      <ClubNames eventId={eventId} version={list.updated} />
    </div>
  );
}
