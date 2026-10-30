import { t as tr } from "../i18n";
import { useEffect, useState } from "react";
import type { ClubNameRow } from "../../../shared/types/event";
import { call } from "./api";

/** Names longer than this rarely fit a lower third at full size */
const LONG_NAME = 22;

/**
 * The start list's clubs as the data source sends them, with the name graphics will show.
 * A name typed here goes into the app's club name library (app settings), so every event
 * uses it; an empty field goes back to the automatic name.
 */
export function ClubNames({ eventId, version }: { eventId: string; version: number }) {
  const [clubs, setClubs] = useState<ClubNameRow[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [query, setQuery] = useState("");
  const [longOnly, setLongOnly] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");

  const load = async () => {
    const rows = await call<ClubNameRow[]>("startlist:clubs", eventId);
    setClubs(rows);
    setDrafts(Object.fromEntries(rows.map((c) => [c.name, c.override ?? ""])));
  };
  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, [eventId, version]);

  const save = async (name: string) => {
    const current = clubs.find((c) => c.name === name)?.override ?? "";
    const value = (drafts[name] ?? "").trim();
    if (value === current) return;
    setError("");
    try {
      await call("clubNames:set", { [name]: value });
      await load();
      setSaved(name);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const shown = (c: ClubNameRow) => c.override || c.automatic;
  const rows = clubs.filter(
    (c) =>
      (!longOnly || shown(c).length > LONG_NAME) &&
      `${c.name} ${shown(c)}`.toLowerCase().includes(query.toLowerCase()),
  );
  const overrides = clubs.filter((c) => c.override).length;
  const long = clubs.filter((c) => shown(c).length > LONG_NAME).length;

  return (
    <section className="club-names" aria-labelledby="club-names-heading">
      <h3 id="club-names-heading">{tr("Club names on air")}</h3>
      <p className="muted">
        {tr("Graphics use the club's short name when Split Control knows one. Type a shorter name for any club that is too long; leave the field empty to use the automatic name.")}{" "}
        {tr("Names are saved in the app's club name library (Settings → Club names) and used in every event.")}
      </p>
      {error && (
        <p role="alert" className="studio-error">
          {error}
        </p>
      )}
      {!clubs.length ? (
        <p className="empty-state">{tr("Clubs appear here once the start list is loaded.")}</p>
      ) : (
        <>
          <div className="row wrap">
            <label>
              {tr("Find club")}{" "}
              <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} />
            </label>
            <label className="inline-label">
              <input type="checkbox" checked={longOnly} onChange={(e) => setLongOnly(e.target.checked)} />
              {tr("Long names only")} ({long})
            </label>
            <span className="muted">
              {clubs.length} {tr("clubs")} · {overrides} {tr("in the library")}
            </span>
          </div>
          <div className="table-scroll">
            <table className="studio-table">
              <thead>
                <tr>
                  <th scope="col">{tr("Club (from the data source)")}</th>
                  <th scope="col">{tr("Runners")}</th>
                  <th scope="col">{tr("Name on air")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => (
                  <tr key={c.name}>
                    <td>{c.name}</td>
                    <td>{c.runners}</td>
                    <td>
                      <input
                        type="text"
                        aria-label={`${tr("Name on air for")} ${c.name}`}
                        value={drafts[c.name] ?? ""}
                        placeholder={c.automatic}
                        onChange={(e) => {
                          setSaved("");
                          setDrafts({ ...drafts, [c.name]: e.target.value });
                        }}
                        onBlur={() => void save(c.name)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                          if (e.key === "Escape") setDrafts({ ...drafts, [c.name]: c.override ?? "" });
                        }}
                      />
                      {saved === c.name && <small className="muted" role="status"> {tr("Saved")}</small>}
                      {!c.override && c.automatic !== c.name && (
                        <small className="muted"> {tr("Automatic short name")}</small>
                      )}
                      {shown(c).length > LONG_NAME && <small className="warn"> {tr("Long")}</small>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!rows.length && <p className="empty-state">{tr("No clubs match your filters.")}</p>}
          </div>
        </>
      )}
    </section>
  );
}
