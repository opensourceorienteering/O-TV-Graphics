/**
 * Application Header Component
 */

import './Header.css';

export function Header() {
  return (
    <header className="header">
      <div className="header-left">
        <h1 className="header-title">OL-Grafik</h1>
        <span className="header-subtitle">Orienteering Graphics Controller</span>
      </div>
      <div className="header-right">
        <div className="header-status">
          <span className="status-indicator status-ok"></span>
          <span>Connected</span>
        </div>
      </div>
    </header>
  );
}

