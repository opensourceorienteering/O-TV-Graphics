import { t as tr } from "../i18n";
/**
 * Club logos: the logos that ship with this build, plus logos added by hand.
 * Users never fetch logos from Eventor; maintainers refresh them before a release.
 */

import { useEffect, useState } from 'react';

interface Status {
  folder: string;
  bundled: { folder: string; source: string; downloadedAt: number; clubs: number; logos: number }[];
  manualLogos: number;
}

const help: React.CSSProperties = { fontSize: '0.8rem', color: '#888', margin: '0.25rem 0 0' };

export function ClubLogoSettings() {
  const [status, setStatus] = useState<Status | null>(null);

  const refresh = async () => {
    const result = await window.electronAPI.invoke('clubLogos:status');
    if (result?.success) setStatus(result.data);
  };
  useEffect(() => { refresh(); }, []);

  return (
    <div>
      <h3 style={{ margin: '0 0 0.5rem 0' }}>{tr("Club logos")}</h3>
      <div style={{ fontSize: '0.875rem', color: '#ccc' }}>
        {status?.bundled.length ? status.bundled.map(b => (
          <div key={b.folder}>
            {b.logos}  {tr("logos for")} {b.clubs}  {tr("clubs from")} {b.source}{tr(", included in this version (")}{new Date(b.downloadedAt).toLocaleDateString()})
          </div>
        )) : <div>{tr("No club logos are included in this version.")}</div>}
        <div style={{ marginTop: '0.25rem' }}>{status?.manualLogos ?? 0}  {tr("logos added by hand")}</div>
      </div>
      <p style={help}>
         {tr("Logos come with the app and are updated with new versions; nothing is fetched from Eventor. To add or replace a logo, put an image named after the club (e.g.")} <code>OK Linné.png</code>{tr(") in the logo folder. Your logos take priority over the included ones.")} </p>
      <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem' }}>
        <button className="btn btn-secondary btn-sm" onClick={() => window.electronAPI.invoke('clubLogos:openFolder')}>
           {tr("Open logo folder")} </button>
        <button className="btn btn-secondary btn-sm" onClick={refresh}>{tr("Refresh")}</button>
      </div>
    </div>
  );
}
