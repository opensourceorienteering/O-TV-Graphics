/**
 * Main Control Panel Application
 * React-based UI for controlling graphics
 */

import {
  HashRouter as Router,
  Navigate,
  Route,
  Routes,
  useParams,
} from "react-router-dom";
import type { ReactNode } from "react";
import { ToastProvider } from "./contexts/ToastContext";
import { ToastContainer } from "./components/ToastContainer";
import { TemplatesView } from "./pages/TemplatesView";
import { SettingsView } from "./pages/SettingsView";
import "./App.css";
import "./events/studio.css";
import { EventsView } from "./events/EventsView";
import { EventPlan } from "./events/EventPlan";
import { WorkspaceNav } from "./events/WorkspaceHeader";
import { LiveDesk } from "./desk/LiveDesk";
import { DeskMonitorsWindow } from "./desk/DeskMonitorsWindow";
import "./shared.css";

function WorkspaceScreen({ children }: { children: ReactNode }) {
  return (
    <>
      <WorkspaceNav />
      <main className="studio utility-workspace" id="workspace-main">
        {children}
      </main>
    </>
  );
}

function LegacyEventRoute({ mode }: { mode: "plan" | "live" }) {
  const { projectId = "" } = useParams();
  return <Navigate replace to={`/events/${projectId}/${mode}`} />;
}

export function App() {
  const monitor = new URLSearchParams(window.location.search).get("monitor");
  // Pop-out monitor windows: viewing only, in the live desk's style
  if (monitor === "program" || monitor === "preview" || monitor === "both")
    return <DeskMonitorsWindow kind={monitor} />;
  return (
    <ToastProvider>
      <Router>
        <Routes>
          <Route
            path="/production/:projectId/:rundownId"
            element={<LegacyEventRoute mode="live" />}
          />
          <Route
            path="/project/:projectId"
            element={<LegacyEventRoute mode="plan" />}
          />
          <Route path="/events/:eventId/live" element={<LiveDesk />} />
          <Route path="/events/:eventId/plan" element={<EventPlan />} />
          <Route path="/" element={<EventsView />} />

          <Route
            path="/templates"
            element={
              <WorkspaceScreen>
                <TemplatesView />
              </WorkspaceScreen>
            }
          />
          <Route
            path="/settings"
            element={
              <WorkspaceScreen>
                <SettingsView />
              </WorkspaceScreen>
            }
          />
          <Route path="*" element={<Navigate replace to="/" />} />
        </Routes>
        <ToastContainer />
      </Router>
    </ToastProvider>
  );
}
