/**
 * Sidebar Navigation Component
 */

import { NavLink } from 'react-router-dom';
import { Home, Folder, Layout, Settings } from 'lucide-react';
import './Sidebar.css';

export function Sidebar() {
  return (
    <aside className="sidebar">
      <nav className="sidebar-nav">
        <NavLink to="/" className="sidebar-link">
          <Home size={20} />
          <span>Dashboard</span>
        </NavLink>
        <NavLink to="/project/default" className="sidebar-link">
          <Folder size={20} />
          <span>Project</span>
        </NavLink>
        <NavLink to="/templates" className="sidebar-link">
          <Layout size={20} />
          <span>Templates</span>
        </NavLink>
        <NavLink to="/settings" className="sidebar-link">
          <Settings size={20} />
          <span>Settings</span>
        </NavLink>
      </nav>
    </aside>
  );
}

