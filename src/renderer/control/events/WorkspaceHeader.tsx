import { t as tr } from "../i18n";
import { useState, type ReactNode } from "react";
import { Link, NavLink } from "react-router-dom";
import { ArrowLeft, Keyboard, Layers, Settings } from "lucide-react";
import { KeyboardShortcutsDialog } from "../components/KeyboardShortcuts";
import { BrandMark } from "../components/BrandMark";

export function WorkspaceNav() {
  return (
    <header className="workspace-nav">
      <Link to="/" className="workspace-brand" aria-label="Split Control, Orienteering Graphics: all events">
        <BrandMark />
      </Link>
      <nav aria-label={tr("Application")}>
        <NavLink to="/" end>
           {tr("Events")} </NavLink>
        <NavLink to="/templates">
          <Layers size={15} aria-hidden="true" />
           {tr("Graphics library")} </NavLink>
        <NavLink to="/settings">
          <Settings size={15} aria-hidden="true" />
           {tr("Settings")} </NavLink>
      </nav>
    </header>
  );
}
export function EventHeader({
  eventId,
  name,
  mode,
  children,
  onBeforeNavigate,
}: {
  eventId: string;
  name: string;
  mode: "plan" | "live";
  children?: ReactNode;
  onBeforeNavigate?: () => boolean;
}) {
  const [controlsOpen, setControlsOpen] = useState(false);
  return (
    <header className="event-header">
      <Link
        to="/"
        className="event-back"
        aria-label={tr("Back to Events")}
        onClick={(event) => {
          if (onBeforeNavigate && !onBeforeNavigate()) event.preventDefault();
        }}
      >
        <ArrowLeft size={19} />
        <span>{tr("Events")}</span>
      </Link>
      <div className="event-identity">
        <h1>{name}</h1>
        {children && <div className="event-status-line">{children}</div>}
      </div>
      <div className="event-header-actions">
        <nav className="mode-switch" aria-label={tr("Event mode")}>
          <Link
            to={`/events/${eventId}/plan`}
            aria-current={mode === "plan" ? "page" : undefined}
            onClick={(event) => {
              if (mode !== "plan" && onBeforeNavigate && !onBeforeNavigate())
                event.preventDefault();
            }}
          >
             {tr("Settings")} </Link>
          <Link
            to={`/events/${eventId}/live`}
            aria-current={mode === "live" ? "page" : undefined}
            onClick={(event) => {
              if (mode !== "live" && onBeforeNavigate && !onBeforeNavigate())
                event.preventDefault();
            }}
          >
             {tr("Live")} </Link>
        </nav>
        <button
          className="studio-button controls-button"
          onClick={() => setControlsOpen(true)}
        >
          <Keyboard size={16} aria-hidden="true" />
           {tr("Controls")} </button>
      </div>
      <KeyboardShortcutsDialog
        open={controlsOpen}
        onClose={() => setControlsOpen(false)}
      />
    </header>
  );
}
