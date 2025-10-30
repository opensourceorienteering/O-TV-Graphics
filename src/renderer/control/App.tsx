/**
 * Main Control Panel Application
 * React-based UI for controlling graphics
 */

import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { ToastProvider } from './contexts/ToastContext';
import { ToastContainer } from './components/ToastContainer';
import { Header } from './components/Header';
import { Sidebar } from './components/Sidebar';
import { Dashboard } from './pages/Dashboard';
import { ProjectView } from './pages/ProjectView';
import { ProductionView } from './pages/ProductionView';
import { TemplatesView } from './pages/TemplatesView';
import { SettingsView } from './pages/SettingsView';
import './App.css';

export function App() {
  return (
    <ToastProvider>
      <Router
        future={{
          v7_startTransition: true,
          v7_relativeSplatPath: true
        }}
      >
        <Routes>
          {/* Production Mode - Full screen without header/sidebar */}
          <Route path="/production/:projectId/:rundownId" element={<ProductionView />} />

          {/* Normal views with header/sidebar */}
          <Route path="*" element={
            <div className="app">
              <Header />
              <div className="app-body">
                <Sidebar />
                <main className="app-main">
                  <Routes>
                    <Route path="/" element={<Dashboard />} />
                    <Route path="/project/:projectId" element={<ProjectView />} />
                    <Route path="/templates" element={<TemplatesView />} />
                    <Route path="/settings" element={<SettingsView />} />
                  </Routes>
                </main>
              </div>
            </div>
          } />
        </Routes>
        <ToastContainer />
      </Router>
    </ToastProvider>
  );
}

