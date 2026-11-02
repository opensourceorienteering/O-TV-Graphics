import { t as tr } from "../i18n";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Link,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import type {
  ProjectPresentation,
  SPXProject,
} from "../../../shared/types/spx";
import type {
  EventFolder,
  EventStartList,
  EventSummary,
} from "../../../shared/types/event";
import type { LiveResultsCompetition } from "../../../shared/types/liveresults";
import type {
  OGrafTemplateInfo,
  TemplateSetInfo,
} from "../../../shared/types/ograf";
import { ProjectGraphicsSettings } from "../components/ProjectGraphicsSettings";
import { DataSourceManager } from "../components/DataSourceManager";
import { CompetitionSelector } from "../components/CompetitionSelector";
import { EventOutput } from "./EventOutput";
import { EventTemplates } from "./EventTemplates";

import { StartLists } from "./StartLists";
import { Monitor } from "./Monitor";
import { call } from "./api";
import { ClubLogoSettings } from "../components/ClubLogoSettings";
import { EventHeader } from "./WorkspaceHeader";
import { EventInfoForm } from "./EventInfoForm";
import { SettingsTransferCard } from "./SettingsTransferCard";
import { EventControls } from "./EventControls";
import { RETIRED_LOGO_URLS, TYR_LOGO_URL } from "../../../shared/branding";
import { DEFAULT_TEMPLATE_SET } from "../../../shared/types/spx";

const sections = [
  ["setup", "Data source & event info"],
  ["output", "Output"],
  ["theme", "Theme"],
  ["templates", "Templates"],
  ["startlists", "Start lists"],
  ["controls", "Radio controls"],
  ["final", "Final check"],
] as const;
const legacySections: Record<string, string> = {
  info: "setup",
  data: "setup",
  look: "theme",
  control: "final",
};
export function EventPlan() {
  const { eventId = "" } = useParams();
  const navigate = useNavigate();
  const [event, setEvent] = useState<SPXProject>();
  const [summary, setSummary] = useState<EventSummary>();
  const [sets, setSets] = useState<TemplateSetInfo[]>([]);
  const [templates, setTemplates] = useState<OGrafTemplateInfo[]>([]);
  const [folders, setFolders] = useState<EventFolder[]>([]);
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedSection = searchParams.get("section") || "setup";
  const initialSection = legacySections[requestedSection] || requestedSection;
  const [section, setSection] = useState(
    sections.some(([id]) => id === initialSection) ? initialSection : "setup",
  );
  // Follow ?section= when it changes from outside (links, back/forward)
  useEffect(() => {
    if (
      sections.some(([id]) => id === initialSection) &&
      initialSection !== section
    )
      setSection(initialSection);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialSection]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [lookGraphic, setLookGraphic] = useState("");
  const [lookClass, setLookClass] = useState("");
  const [classes, setClasses] = useState<string[]>([]);
  const [sources, setSources] = useState<any[]>([]);
  const [sourceEventInfo, setSourceEventInfo] =
    useState<LiveResultsCompetition | null>(null);
  const [web, setWeb] = useState<any>();
  const [themeDraft, setThemeDraft] = useState<{
    templateSet: string;
    presentation: ProjectPresentation;
  }>();
  const [eventInfoDirty, setEventInfoDirty] = useState(false);
  const [themeDirty, setThemeDirty] = useState(false);
  const [templatesDirty, setTemplatesDirty] = useState(false);
  /** Two graphics share a command number in Templates: fix it before leaving the step */
  const [templatesBlocked, setTemplatesBlocked] = useState(false);
  const [finalCheck, setFinalCheck] = useState<{
    checkedAt: number;
    database: { ok: boolean; message: string; classes?: number };
    startList: EventStartList;
    ndiEnabled: boolean;
    ndiName?: string;
    weather?: { reading: any; source: string; error?: string };
  }>();
  const refresh = useCallback(async () => {
    const state = await call("event:get", eventId);
    setEvent(state.event);
    setSummary(state.summary);
  }, [eventId]);
  const hasUnsavedChanges = eventInfoDirty || themeDirty || templatesDirty;
  const confirmNavigation = () =>
    !hasUnsavedChanges ||
    confirm("Discard your unsaved settings changes and continue?");
  const selectSection = async (id: string, scrollToTop = false) => {
    if (id === section) return;
    if (section === "templates" && templatesBlocked) {
      setError(
        tr(
          "Two graphics have the same command number. Give each graphic its own number first.",
        ),
      );
      return;
    }
    if (!confirmNavigation()) return;
    if (hasUnsavedChanges) {
      await refresh();
      setEventInfoDirty(false);
      setThemeDirty(false);
      setTemplatesDirty(false);
    }
    setSection(id);
    setSearchParams({ section: id }, { replace: true });
    setNotice("");
    if (scrollToTop) {
      requestAnimationFrame(() => {
        document.querySelector<HTMLElement>(".app-main")?.scrollTo({
          top: 0,
          behavior: "auto",
        });
      });
    }
  };
  useEffect(() => {
    if (!hasUnsavedChanges) return;
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warnBeforeUnload);
    return () => window.removeEventListener("beforeunload", warnBeforeUnload);
  }, [hasUnsavedChanges]);
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  // A stale connection test is redone automatically when Plan opens
  const autoTested = useRef(false);
  useEffect(() => {
    if (autoTested.current || !summary || !event?.dataSource?.competitionId)
      return;
    const data = summary.readiness.find((r) => r.section === "data");
    const at = event.dataSource.lastCheck?.at ?? 0;
    if (data?.ok && Date.now() - at < 15 * 60_000) return;
    autoTested.current = true;
    void call("event:test", eventId)
      .then(refresh)
      .catch(() => undefined);
  }, [summary, event, eventId, refresh]);
  useEffect(() => {
    void run(async () => {
      await refresh();
      const [s, t, f, w] = await Promise.all([
        call("templates:getSets"),
        call("templates:getAll"),
        call("folder:list"),
        call("output:getWebInfo"),
      ]);
      setSets(s);
      setTemplates(t);
      setFolders(f);
      setWeb(w);
    });
  }, [eventId]);
  useEffect(() => {
    if (section === "setup")
      call("dataSource:getAll")
        .then(setSources)
        .catch((e) => setError(e.message));
  }, [section]);
  const updateThemeDraft = useCallback(
    (draft: { templateSet: string; presentation: ProjectPresentation }) =>
      setThemeDraft(draft),
    [],
  );
  const save = async (updates: Partial<SPXProject>) => {
    await call("event:update", eventId, updates);
    await refresh();
    setNotice("Saved");
  };
  const previewSet =
    section === "theme"
      ? themeDraft?.templateSet || event?.templateSet || DEFAULT_TEMPLATE_SET
      : event?.templateSet || DEFAULT_TEMPLATE_SET;
  const available = templates.filter((t) => t.setId === previewSet);
  useEffect(() => {
    if (!event || !templates.length || !["setup", "theme"].includes(section))
      return;
    const template =
      templates.find(
        (t) => t.manifest.id === lookGraphic && t.setId === previewSet,
      ) ||
      templates.find(
        (t) =>
          t.setId === previewSet &&
          (t.manifest as any).v_olgrafik_kind === "event-title",
      );
    if (template) {
      if (lookGraphic !== template.manifest.id)
        setLookGraphic(template.manifest.id);
      call(
        "preview:template",
        eventId,
        template.manifest.id,
        lookClass || undefined,
        section === "theme" ? themeDraft : undefined,
      ).catch((e) => setError(e.message));
    }
  }, [
    eventId,
    previewSet,
    JSON.stringify(themeDraft?.presentation),
    event?.name,
    event?.info?.date,
    section,
    lookGraphic,
    lookClass,
    templates,
  ]);
  const sectionIndex = sections.findIndex(([id]) => id === section);
  const pending = summary?.readiness.filter((r) => !r.optional && !r.ok) || [];
  const readinessFor = (id: string) => {
    if (id === "setup") {
      const required = summary?.readiness.filter((item) =>
        ["info", "data"].includes(item.section),
      );
      return required?.length ? required.every((item) => item.ok) : false;
    }
    if (id === "theme")
      return summary?.readiness.find((item) => item.section === "look")?.ok;
    if (id === "final")
      return pending.length ? "Setup items remain" : "Run the final check";
    // Optional: the built-in defaults work without changes
    if (id === "templates" || id === "controls") return true;
    return summary?.readiness.find((item) => item.section === id)?.ok;
  };
  const completedSteps = sections.filter(([id]) => readinessFor(id)).length;
  /** What a step still needs, shown under it in the step list */
  const stepHint = (id: string) => {
    if (id === "final")
      return pending.length
        ? `${pending.length} ${pending.length === 1 ? "thing" : "things"} to prepare`
        : "Run the final check";
    const sections =
      id === "setup" ? ["info", "data"] : id === "theme" ? ["look"] : [id];
    const item = summary?.readiness.find(
      (r) => sections.includes(r.section) && !r.ok,
    );
    return item?.detail || item?.label || "In progress";
  };
  const runFinalCheck = async () => {
    const [database, startList, ndi, weather] = await Promise.all([
      call("event:test", eventId),
      call("startlist:get", eventId),
      call("output:getNDIInfo"),
      call("desk:weather", eventId, true).catch((e: Error) => ({
        reading: null,
        source: "none",
        error: e.message,
      })),
    ]);
    await refresh();
    setFinalCheck({
      checkedAt: Date.now(),
      database,
      startList,
      ndiEnabled: !!ndi.enabled,
      ndiName: ndi.name,
      weather,
    });
    if (!database.ok) throw new Error(database.message);
    setNotice("Final check complete.");
  };
  useEffect(() => {
    if (section === "final" && !finalCheck) void run(runFinalCheck);
  }, [section]);
  const sectionGuides: Record<string, string> = {
    setup: "Connect timing data, then confirm the event details it will use.",
    output: "Choose and test where your graphics will be sent.",
    theme: "Choose one consistent theme for the event and preview it live.",
    templates:
      "Set each graphic's defaults, its number and whether Live shows it. Export or import your setup.",
    startlists: "Bring in your runners, then star the ones you want to follow.",
    controls: "Rename radio controls whose names from the timing data do not read well on air.",
    final: "Check the database and review the complete broadcast setup.",
  };
  if (!event)
    return (
      <div className="studio">
        <p role="status">{tr(error || "Loading event…")}</p>
        <Link to="/">{tr("Back to Events")}</Link>
      </div>
    );
  return (
    <main className="studio plan-workspace" id="workspace-main">
      <EventHeader
        eventId={eventId}
        name={event.name}
        mode="plan"
        onBeforeNavigate={confirmNavigation}
      >
        <span>{tr("Prepare your broadcast")}</span>
        <span className="status-divider">/</span>
        <span>
          {completedSteps} {tr("of")} {sections.length}{" "}
          {tr("steps complete")}{" "}
        </span>
      </EventHeader>
      {error && (
        <div role="alert" className="studio-error">
          {error} <button onClick={() => setError("")}>{tr("Dismiss")}</button>
        </div>
      )}
      {notice && (
        <p role="status" className="studio-notice">
          {tr(notice)}
        </p>
      )}
      <div className="plan-layout no-context">
        <aside
          className="studio-panel plan-checklist"
          aria-label={tr("Preparation checklist")}
        >
          <div className="setup-progress">
            <span className="eyebrow">{tr("Event setup")}</span>
            <progress
              aria-label={tr("Event preparation")}
              value={completedSteps}
              max={sections.length}
            />
          </div>
          {sections.map(([id, label], index) => {
            const ready = readinessFor(id);
            return (
              <button
                key={id}
                aria-current={section === id ? "step" : undefined}
                onClick={() => void selectSection(id)}
              >
                <span aria-label={ready ? tr("Ready") : tr("Needs attention")}>
                  {ready ? "✓" : index + 1}
                </span>
                <span className="checklist-copy">
                  <span className="checklist-label">{tr(label)}</span>
                  <small>{ready ? tr("Complete") : tr(stepHint(id))}</small>
                </span>
              </button>
            );
          })}
        </aside>
        <section
          className={`studio-panel plan-content ${section === "setup" ? "setup-content" : ""}`}
        >
          <div className="plan-section-heading">
            <p className="eyebrow">
              {tr("Step")} {sectionIndex + 1} {tr("of")} {sections.length}
            </p>
            <h2>{tr(sections.find((s) => s[0] === section)?.[1] || "")}</h2>
            <p className="muted">{tr(sectionGuides[section])}</p>
          </div>
          {section === "setup" && (
            <EventInfoForm
              event={event}
              setEvent={setEvent}
              folders={folders}
              busy={busy}
              onDirtyChange={setEventInfoDirty}
              onSave={() =>
                void run(async () => {
                  await save({
                    name: event.name,
                    info: event.info,
                    settings: event.settings,
                    folderId: event.folderId,
                    status: event.status,
                  });
                  setEventInfoDirty(false);
                })
              }
              onLink={(key, enabled) =>
                void run(() =>
                  save({
                    folderInheritance: {
                      ...event.folderInheritance,
                      [key]: enabled,
                    },
                  }),
                )
              }
              onDefaults={() =>
                void run(async () => {
                  await call("folder:update", event.folderId, {
                    defaults: {
                      templateSet: event.templateSet,
                      presentation: event.settings?.presentation,
                      dataSource: event.dataSource && {
                        sourceId: event.dataSource.sourceId,
                        baseUrl: event.dataSource.baseUrl,
                      },
                      info: {
                        organiser: event.info?.organiser,
                        series: event.info?.series,
                        timeZone: event.info?.timeZone,
                      },
                    },
                  });
                  setNotice("Folder defaults saved");
                })
              }
            />
          )}
          {section === "theme" && (
            <>
              <section className="connection-card theme-preview">
                <Monitor kind="preview" />
                <details className="studio-panel preview-options">
                  <summary>{tr("Choose a preview graphic")}</summary>{" "}
                  <div className="studio-form">
                    <label>
                      {tr("Graphic")}{" "}
                      <select
                        value={lookGraphic}
                        onChange={(e) => setLookGraphic(e.target.value)}
                      >
                        <option value="">{tr("Choose a graphic")}</option>
                        {available.map((t) => (
                          <option key={t.manifest.id} value={t.manifest.id}>
                            {t.manifest.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <div className="row wrap">
                      <button
                        className="studio-button"
                        disabled={busy}
                        onClick={() =>
                          void run(async () =>
                            setClasses(await call("event:classes", eventId)),
                          )
                        }
                      >
                        {tr("Load event classes")}{" "}
                      </button>
                      <label>
                        {tr("Data")}{" "}
                        <select
                          value={lookClass}
                          onChange={(e) => setLookClass(e.target.value)}
                        >
                          <option value="">{tr("Sample data")}</option>
                          {classes.map((c) => (
                            <option key={c}>{c}</option>
                          ))}
                        </select>
                      </label>
                      <button
                        className="studio-button primary"
                        disabled={busy || !lookGraphic}
                        onClick={() =>
                          void run(async () => {
                            await call(
                              "preview:template",
                              eventId,
                              lookGraphic,
                              lookClass || undefined,
                              section === "theme" ? themeDraft : undefined,
                            );
                          })
                        }
                      >
                        {tr("Preview graphic")}{" "}
                      </button>
                    </div>
                    <p className="muted">
                      {tr(
                        "Theme changes update this preview immediately. Sample previews are labelled and never go on air.",
                      )}{" "}
                    </p>
                  </div>
                </details>
              </section>
              <ProjectGraphicsSettings
                project={event}
                sets={sets}
                onSaved={() => void run(refresh)}
                onDraftChange={updateThemeDraft}
                onDirtyChange={setThemeDirty}
              />
              <details className="settings-disclosure">
                <summary>{tr("Manage club logos")}</summary>
                <ClubLogoSettings />
              </details>
            </>
          )}
          {section === "setup" && (
            <div className="studio-form data-source-section">
              <div>
                <h3>{tr("1. Choose event data")}</h3>
                <p className="muted">
                  {tr(
                    "Select the timing source and competition first. Split Control can then fill in event details for you.",
                  )}
                </p>
              </div>
              <label>
                {tr("Event data source")}{" "}
                <select
                  value={event.dataSource?.sourceId || ""}
                  onChange={(e) =>
                    void run(async () => {
                      await save({ dataSource: { sourceId: e.target.value } });
                    })
                  }
                >
                  <option value="">{tr("Choose a source")}</option>
                  {sources
                    .filter((s) => s.enabled)
                    .map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                </select>
              </label>
              {event.dataSource?.sourceId && (
                <CompetitionSelector
                  sourceId={event.dataSource.sourceId}
                  selectedCompetitionId={event.dataSource.competitionId}
                  onSelectedCompetitionLoaded={setSourceEventInfo}
                  onSelect={(c) => {
                    setSourceEventInfo(c);
                    void run(() =>
                      save({
                        dataSource: {
                          sourceId: event.dataSource!.sourceId,
                          competitionId: c?.id,
                          competitionName: c?.name,
                        },
                      }),
                    );
                  }}
                />
              )}
              {sourceEventInfo && (
                <div className="source-info-suggestion">
                  <div>
                    <strong>
                      {tr("Use details from")} {sourceEventInfo.name}?
                    </strong>
                    <p className="muted">
                      {tr(
                        "Copy its name, date and organiser into Event info. You can edit them before saving.",
                      )}{" "}
                    </p>
                  </div>
                  <button
                    className="studio-button"
                    onClick={() => {
                      setEvent({
                        ...event,
                        name: sourceEventInfo.name || event.name,
                        info: {
                          ...event.info,
                          date: sourceEventInfo.date || event.info?.date,
                          organiser:
                            sourceEventInfo.organizer || event.info?.organiser,
                        },
                      });
                      setEventInfoDirty(true);
                      setNotice(
                        "Source details copied. Review Event info, then save it.",
                      );
                    }}
                  >
                    {tr("Use source details")}{" "}
                  </button>
                </div>
              )}
              <div className="row">
                <button
                  className="studio-button primary"
                  disabled={busy || !event.dataSource?.competitionId}
                  onClick={() =>
                    void run(async () => {
                      const r = await call("event:test", eventId);
                      await refresh();
                      if (!r.ok) throw new Error(r.message);
                      setNotice(`Connected · ${r.message}`);
                    })
                  }
                >
                  {tr("Test connection")}{" "}
                </button>
                <span className="muted">
                  {event.dataSource?.lastCheck
                    ? `${event.dataSource.lastCheck.ok ? "✓" : "Attention:"} ${event.dataSource.lastCheck.message}`
                    : tr("Not tested yet")}
                </span>
              </div>
              <details
                onToggle={(e) => {
                  if (!(e.target as HTMLDetailsElement).open)
                    void call("dataSource:getAll")
                      .then(setSources)
                      .catch((err) => setError(err.message));
                }}
              >
                <summary>{tr("Add or configure data sources")}</summary>
                <DataSourceManager />
                <button
                  className="studio-button"
                  onClick={() =>
                    void call("dataSource:getAll")
                      .then(setSources)
                      .catch((e) => setError(e.message))
                  }
                >
                  {tr("Refresh source list")}{" "}
                </button>
              </details>
            </div>
          )}
          {section === "templates" && event && (
            <EventTemplates
              eventId={eventId}
              event={event}
              onSaved={() => void run(refresh)}
              onDirtyChange={setTemplatesDirty}
              onBlockedChange={setTemplatesBlocked}
            />
          )}
          {section === "startlists" && (
            <StartLists eventId={eventId} onChanged={refresh} />
          )}
          {section === "controls" && <EventControls eventId={eventId} />}
          {section === "output" && (
            <EventOutput eventId={eventId} onChange={() => void refresh()} />
          )}
          {section === "final" && (
            <div className="studio-form final-check">
              <div className="row wrap final-check-actions">
                <button
                  className="studio-button"
                  disabled={busy}
                  onClick={() => void run(runFinalCheck)}
                >
                  {busy ? "Checking…" : tr("Run final check")}
                </button>
                {finalCheck && (
                  <span className="muted">
                    {tr("Checked")}{" "}
                    {new Date(finalCheck.checkedAt).toLocaleTimeString()}
                  </span>
                )}
              </div>

              <div className="final-summary-grid">
                <section>
                  <h3>{tr("Data & event")}</h3>
                  <dl>
                    <div>
                      <dt>{tr("Event")}</dt>
                      <dd>{event.name}</dd>
                    </div>
                    <div>
                      <dt>{tr("Date")}</dt>
                      <dd>{event.info?.date || "Not set"}</dd>
                    </div>
                    <div>
                      <dt>{tr("Location")}</dt>
                      <dd>{event.info?.location || "Not set"}</dd>
                    </div>
                    <div>
                      <dt>{tr("Weather")}</dt>
                      <dd>
                        {finalCheck?.weather?.reading
                          ? `${tr("Automatic")} · ${tr(finalCheck.weather.reading.condition)} · ${finalCheck.weather.reading.temperature} °C`
                          : finalCheck?.weather
                            ? `${tr("Not available:")} ${finalCheck.weather.error}`
                            : "—"}
                      </dd>
                    </div>
                    <div>
                      <dt>{tr("Organiser")}</dt>
                      <dd>{event.info?.organiser || "Not set"}</dd>
                    </div>
                    <div>
                      <dt>{tr("Time zone")}</dt>
                      <dd>{event.info?.timeZone || "Europe/Stockholm"}</dd>
                    </div>
                    <div>
                      <dt>{tr("Source")}</dt>
                      <dd>{summary?.dataSourceLabel || "Not set"}</dd>
                    </div>
                    <div>
                      <dt>{tr("Competition")}</dt>
                      <dd>{event.dataSource?.competitionName || "Not set"}</dd>
                    </div>
                    <div>
                      <dt>{tr("Database")}</dt>
                      <dd>
                        {finalCheck
                          ? `${finalCheck.database.ok ? "Connected" : "Attention"} · ${finalCheck.database.message}`
                          : tr("Not checked")}
                      </dd>
                    </div>
                  </dl>
                </section>
                <section>
                  <h3>{tr("Broadcast setup")}</h3>
                  <dl>
                    <div>
                      <dt>{tr("Theme")}</dt>
                      <dd>
                        {sets.find((set) => set.id === event.templateSet)
                          ?.name ||
                          event.templateSet ||
                          "Standard"}
                      </dd>
                    </div>
                    <div>
                      <dt>{tr("Name display")}</dt>
                      <dd>
                        {event.settings?.presentation?.identity || "Automatic"}
                      </dd>
                    </div>
                    <div>
                      <dt>{tr("Event logo")}</dt>
                      <dd>
                        {(() => {
                          const logo = event.settings?.presentation?.logoUrl;
                          return !logo || RETIRED_LOGO_URLS.includes(logo)
                            ? tr("No logo")
                            : logo === TYR_LOGO_URL
                              ? tr("OK Tyr logo")
                              : tr("Custom logo");
                        })()}
                      </dd>
                    </div>
                    <div>
                      <dt>{tr("Web output")}</dt>
                      <dd>
                        {summary?.liveOutputs?.web
                          ? `${tr("On in Live")} · ${web?.localhostUrl ?? ""}`
                          : tr("Off")}
                      </dd>
                    </div>
                    <div>
                      <dt>{tr("NDI output")}</dt>
                      <dd>
                        {summary?.liveOutputs?.ndi
                          ? `${tr("On in Live")} · ${finalCheck?.ndiName || "NDI"}`
                          : tr("Off")}
                      </dd>
                    </div>
                    <div>
                      <dt>{tr("Live graphics")}</dt>
                      <dd>{tr("Prepared during operation")}</dd>
                    </div>
                  </dl>
                </section>
                <section>
                  <h3>{tr("Loaded data")}</h3>
                  <dl>
                    <div>
                      <dt>{tr("Source classes")}</dt>
                      <dd>{finalCheck?.database.classes ?? "—"}</dd>
                    </div>
                    <div>
                      <dt>{tr("Loaded classes")}</dt>
                      <dd>
                        {finalCheck
                          ? new Set(
                              finalCheck.startList.entries.map(
                                (entry) => entry.className,
                              ),
                            ).size
                          : "—"}
                      </dd>
                    </div>
                    <div>
                      <dt>{tr("Runners")}</dt>
                      <dd>{finalCheck?.startList.entries.length ?? "—"}</dd>
                    </div>
                    <div>
                      <dt>{tr("Favourite runners")}</dt>
                      <dd>
                        {finalCheck?.startList.entries.filter(
                          (entry) => entry.favourite,
                        ).length ?? "—"}
                      </dd>
                    </div>
                    <div>
                      <dt>{tr("Favourite classes")}</dt>
                      <dd>
                        {finalCheck?.startList.favouriteClasses?.length ?? "—"}
                      </dd>
                    </div>
                    <div>
                      <dt>{tr("Radio controls")}</dt>
                      <dd>
                        {finalCheck?.startList.favouriteControls?.length ?? "—"}
                      </dd>
                    </div>
                  </dl>
                </section>
              </div>

              {pending.length > 0 && (
                <div className="final-check-warning" role="status">
                  <strong>
                    {tr("Complete these items before going live:")}
                  </strong>
                  <ul>
                    {pending.map((item) => (
                      <li key={item.section}>
                        {tr(item.label)}: {tr(item.detail)}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <button
                className="studio-button primary go-live-button"
                disabled={
                  busy || !finalCheck?.database.ok || pending.length > 0
                }
                onClick={() =>
                  void run(async () => {
                    await runFinalCheck();
                    // The desk turns on the outputs chosen in Plan → Output when it opens
                    navigate(`/events/${eventId}/live`);
                  })
                }
              >
                {tr("Go live")}{" "}
              </button>
              {(!finalCheck || pending.length > 0) && (
                <p className="muted">
                  {tr(
                    "Run the final check and resolve required setup items to enable Go live.",
                  )}{" "}
                </p>
              )}
              <SettingsTransferCard
                eventId={eventId}
                onImported={() => void run(refresh)}
              />
            </div>
          )}
          <footer className="plan-step-footer">
            <button
              className="studio-button"
              disabled={sectionIndex === 0}
              onClick={() => selectSection(sections[sectionIndex - 1][0])}
            >
              {tr("Back")}{" "}
            </button>
            {sectionIndex < sections.length - 1 ? (
              <button
                className="studio-button"
                disabled={section === "templates" && templatesBlocked}
                title={
                  section === "templates" && templatesBlocked
                    ? tr(
                        "Two graphics have the same command number. Give each graphic its own number first.",
                      )
                    : undefined
                }
                onClick={() =>
                  void selectSection(sections[sectionIndex + 1][0], true)
                }
              >
                {tr("Next:")} {tr(sections[sectionIndex + 1][1])} →
              </button>
            ) : (
              <span />
            )}
          </footer>
        </section>
      </div>
    </main>
  );
}
