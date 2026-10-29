import { t as tr } from "../i18n";
/**
 * Detached "Preview & Program" window (Figma: Detached Preview & Program window): both monitors
 * side by side on another screen. Viewing only: no controls change the output from here.
 */

import { useEffect, useState } from 'react';
import { call } from '../events/api';
import { MonitorHead, PreviewVideo, ProgramVideo } from './DeskMonitor';
import type { DeskState } from '../../../shared/desk';
import './desk.css';

export function DeskMonitorsWindow({ kind }: { kind: 'both' | 'program' | 'preview' }) {
  const [desk, setDesk] = useState<DeskState>({ eventId: null, onAir: [], otherOnAir: 0 });
  const [connected, setConnected] = useState(true);
  const [previewName, setPreviewName] = useState('');
  useEffect(() => {
    document.title = kind === 'both' ? 'Split Control · Preview & Program' : `Split Control · ${kind === 'program' ? 'Program' : 'Preview'}`;
    let alive = true;
    const tick = async () => {
      try {
        const live = await call('live:state');
        const d = live?.eventId ? await call<DeskState>('desk:state', live.eventId) : { eventId: null, onAir: [], otherOnAir: 0 };
        if (alive) { setDesk(d); setConnected(true); }
      } catch {
        if (alive) setConnected(false);
      }
    };
    void tick();
    const t = setInterval(tick, 1000);
    return () => { alive = false; clearInterval(t); };
  }, [kind]);
  const onAir = desk.onAir[0];
  const showPreview = kind !== 'program';
  const showProgram = kind !== 'preview';
  return (
    <div className="desk desk-detached">
      <div className="det-status">
        <span>{onAir ? `● ON AIR · ${onAir.name}` : tr("○ NOT ON AIR")}</span>
        <span className="grow">{previewName ? `Preview: ${previewName}` : ''}</span>
        <button type="button" className="d-btn sm" onClick={() => call('window:closeMonitor', kind)}>{tr("Re-dock")}</button>
      </div>
      <div className={`det-body ${showPreview && showProgram ? '' : 'single'}`}>
        {showPreview && (
          <div className="mon preview">
            <MonitorHead title={tr("PREVIEW")} onAir={false} />
            <PreviewVideo onStatus={s => setPreviewName(s.name || '')} />
            <div className="mon-caption"><span>{previewName || 'Nothing prepared'}</span><span>{tr("Draft · not on air")}</span></div>
          </div>
        )}
        {showProgram && (
          <div className="mon program">
            <MonitorHead title={onAir ? `PROGRAM · ${onAir.name}` : 'PROGRAM'} onAir={!!onAir || desk.otherOnAir > 0} since={onAir?.since} />
            <ProgramVideo />
            <div className="mon-caption"><span>{onAir?.name || (desk.otherOnAir ? tr("Other graphics on air") : tr("Nothing on air"))}</span><span>{onAir?.step ? `Page ${onAir.step}` : ''}</span></div>
          </div>
        )}
      </div>
      <footer className="desk-footer">
        <span><span className={connected ? 'ok' : 'bad'}>● </span>{connected ? 'Connected' : 'Reconnecting…'}</span>
        <span>{tr("Viewing only · live connection to the main window")}</span>
      </footer>
    </div>
  );
}
