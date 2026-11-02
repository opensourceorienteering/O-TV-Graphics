import { t as tr } from "../i18n";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Folder, Plus, Copy, ArrowRight, Trash2 } from "lucide-react";
import type { EventFolder, EventSummary } from "../../../shared/types/event";
import { call } from "./api";
import { WorkspaceNav } from "./WorkspaceHeader";
import { ask } from "./ask";

/** Names of the looks, for the event cards (an imported look shows its id) */
const LOOK_NAMES: Record<string, string> = {
  standard: "Standard",
  iof: "IOF",
  iof2: "IOF inspired",
  contours: "Contours",
  cz: "ČO",
  bold: "Bold",
  brutal: "Brutal",
  signal: "Signal",
  sof: "Svensk Orientering",
};

export function EventsView() {
  const navigate = useNavigate();
  const dialog = useRef<HTMLDialogElement>(null);
  const [events, setEvents] = useState<EventSummary[]>([]);
  const [folders, setFolders] = useState<EventFolder[]>([]);
  const [folder, setFolder] = useState("all");
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (creating) dialog.current?.showModal();
  }, [creating]);
  const refresh = async () => {
    try {
      const [e, f] = await Promise.all([
        call<EventSummary[]>("event:list"),
        call<EventFolder[]>("folder:list"),
      ]);
      setEvents(e);
      setFolders(f);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void refresh();
  }, []);
  const action = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const newFolder = async () => {
    const n = await ask("Folder name (for example, O-Ringen 2026)");
    if (n?.trim())
      void action(async () => {
        const f = await call<EventFolder>("folder:create", n);
        setFolder(f.id);
        await refresh();
      });
  };
  const shown = events.filter(
    (e) =>
      (folder === "all" ||
        (folder === "none" ? !e.folderId : e.folderId === folder)) &&
      `${e.name} ${e.location || ""}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  return (
    <>
      <WorkspaceNav />
      <main className="studio events-view" id="workspace-main">
        <header className="studio-heading">
          <div>
            <p className="eyebrow">{tr("Broadcast workspace")}</p>
            <h1>{tr("Events")}</h1>
            <p className="muted">{tr("Prepare your event, then run the broadcast.")}</p>
          </div>
          <button
            className="studio-button primary"
            onClick={() => setCreating(true)}
          >
            <Plus size={18} />
             {tr("New event")} </button>
        </header>
        {error && (
          <div role="alert" className="studio-error">
            {error} <button onClick={refresh}>{tr("Retry")}</button>
          </div>
        )}
        <div className="events-layout">
          <aside
            className="studio-panel folder-list"
            aria-label={tr("Event folders")}
          >
            <h2>{tr("Folders")}</h2>
            <button
              aria-pressed={folder === "all"}
              onClick={() => setFolder("all")}
            >
               {tr("All events")} <span>{events.length}</span>
            </button>
            {folders.map((f) => (
              <button
                key={f.id}
                aria-pressed={folder === f.id}
                onClick={() => setFolder(f.id)}
              >
                <Folder size={16} />
                {f.name}
                <span>{events.filter((e) => e.folderId === f.id).length}</span>
              </button>
            ))}
            <button
              aria-pressed={folder === "none"}
              onClick={() => setFolder("none")}
            >
               {tr("No folder")} </button>
            <button onClick={newFolder} disabled={busy}>
              <Plus size={16} />
               {tr("New folder")} </button>
            {folders.some((f) => f.id === folder) && (
              <details className="folder-actions">
                <summary>{tr("Folder options")}</summary>
                <button
                  onClick={async () => {
                    const n = await ask(
                      "Rename folder",
                      folders.find((f) => f.id === folder)?.name,
                    );
                    if (n?.trim())
                      void action(async () => {
                        await call("folder:update", folder, { name: n });
                        await refresh();
                      });
                  }}
                >
                   {tr("Rename folder")} </button>
                <button
                  onClick={async () => {
                    if (
                      confirm(
                        "Remove this folder? Its events will stay in All events.",
                      )
                    )
                      void action(async () => {
                        await call("folder:delete", folder);
                        setFolder("all");
                        await refresh();
                      });
                  }}
                >
                   {tr("Remove folder")} </button>
              </details>
            )}
          </aside>
          <div className="event-list-area">
            <div className="events-list-heading">
              <h2>
                {folder === "all"
                  ? tr("All events")
                  : folder === "none"
                    ? tr("Unfiled events")
                    : folders.find((f) => f.id === folder)?.name}
              </h2>
              <input
                aria-label={tr("Find an event")}
                type="search"
                placeholder={tr("Find an event…")}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            <div className="event-grid">
              {loading ? (
                <p role="status">{tr("Loading events…")}</p>
              ) : shown.length === 0 ? (
                <div className="studio-panel empty-state">
                  <h2>
                    {query
                      ? tr("No matching events")
                      : tr("Your next broadcast starts here")}
                  </h2>
                  <p>
                    {query
                      ? tr("Try another name or clear your search.")
                      : tr("Start with a name. Plan guides you through the rest.")}
                  </p>
                  <button
                    className="studio-button primary"
                    onClick={() => setCreating(true)}
                  >
                     {tr("Create event")} </button>
                </div>
              ) : (
                shown.map((e) => (
                  <article
                    key={e.id}
                    className={`studio-panel event-card ${e.live ? "event-is-live" : ""}`}
                  >
                    <div className="event-card-identity">
                      <h3>
                        <Link to={`/events/${e.id}/plan`}>{e.name}</Link>
                      </h3>
                      <p className="muted">
                        {[e.date, e.location].filter(Boolean).join(" · ") ||
                          "Date and location not set"}
                      </p>
                      <div className="event-meta">
                        <span>
                          {LOOK_NAMES[e.templateSet || ""] || e.templateSet}
                        </span>
                        <span>{e.dataSourceLabel || "Data not connected"}</span>
                      </div>
                    </div>
                    <div className="event-card-progress">
                      <span className={`status-pill ${e.live ? "on-air" : ""}`}>
                        {e.live
                          ? tr("● Live now")
                          : e.status === "done"
                            ? tr("Completed")
                            : e.ready === e.required
                              ? tr("✓ Ready")
                              : tr("In preparation")}
                      </span>
                      {!e.live && e.status !== "done" && (
                        <>
                          <progress
                            aria-label={`${e.name} preparation`}
                            value={e.ready}
                            max={e.required}
                          />
                          <small>
                            {e.ready}  {tr("of")} {e.required}  {tr("ready")} </small>
                        </>
                      )}
                    </div>
                    <div className="event-card-actions">
                      <Link
                        className={`studio-button ${e.live || e.ready === e.required ? "" : "primary"}`}
                        to={`/events/${e.id}/plan`}
                      >
                        {e.ready === e.required ? tr("Settings") : tr("Continue setup")}
                      </Link>
                      <Link
                        className={`studio-button ${e.live || e.ready === e.required ? "primary" : ""}`}
                        to={`/events/${e.id}/live`}
                      >
                        {e.live ? tr("Open Live") : tr("Go to Live")}
                        <ArrowRight size={15} />
                      </Link>
                      <button
                        className="studio-button icon-button"
                        aria-label={`Duplicate ${e.name}`}
                        title={tr("Duplicate event")}
                        disabled={busy}
                        onClick={async () => {
                          const n = await ask(
                            "Name for the copied event",
                            `${e.name} copy`,
                          );
                          if (n?.trim())
                            void action(async () => {
                              const copy = await call("event:create", {
                                name: n,
                                copyFrom: e.id,
                              });
                              navigate(`/events/${copy.id}/plan`);
                            });
                        }}
                      >
                        <Copy size={15} />
                      </button>
                      <button
                        className="studio-button icon-button"
                        aria-label={`Delete ${e.name}`}
                        title={e.live ? tr("End Live before deleting this event") : tr("Delete event")}
                        disabled={busy || e.live}
                        onClick={() => {
                          if (!confirm(`Delete "${e.name}"? Its start list, favourites and settings are removed. This cannot be undone.`)) return;
                          void action(async () => {
                            await call("event:delete", e.id);
                            await refresh();
                          });
                        }}
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </article>
                ))
              )}
            </div>
          </div>
        </div>
        {creating && (
          <dialog
            ref={dialog}
            className="studio-panel studio-dialog studio-prompt"
            onCancel={() => setCreating(false)}
            aria-labelledby="new-event-title"
          >
            <form
              className="studio-form"
              aria-labelledby="new-event-title"
              onSubmit={(e) => {
                e.preventDefault();
                void action(async () => {
                  const created = await call("event:create", {
                    name: name.trim(),
                    folderId: !["all", "none"].includes(folder)
                      ? folder
                      : undefined,
                  });
                  navigate(`/events/${created.id}/plan`);
                });
              }}
            >
              <h2 id="new-event-title">{tr("New event")}</h2>
              <label>
                 {tr("Event name")} <input
                  autoFocus
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </label>
              <p className="muted">
                 {tr("Choose a name you’ll recognise on broadcast day. You can add the date, look and timing data next.")} </p>
              <div className="row">
                <button
                  type="button"
                  className="studio-button"
                  onClick={() => setCreating(false)}
                >
                   {tr("Cancel")} </button>
                <button
                  disabled={busy || !name.trim()}
                  className="studio-button primary"
                >
                   {tr("Create event")} </button>
              </div>
            </form>
          </dialog>
        )}
      </main>
    </>
  );
}
