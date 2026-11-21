/** Graphics library home: one card per look, graphics needing attention, search across looks */
import { t as tr } from "../i18n";
import { AlertTriangle } from "lucide-react";
import type { LookCard } from "./libraryModel";
import { CUSTOM_TEMPLATE_SET } from "../../../shared/types/ograf";
import type { OGrafTemplateInfo } from "../../../shared/types/ograf";

export function SourceBadges({ set }: { set: LookCard["set"] }) {
  return (
    <>
      {set.source && (
        <span className="look-source">
          {set.source === "imported"
            ? set.replacesBuiltIn
              ? tr("Imported · replaces built-in")
              : tr("Imported")
            : tr("Built in")}
        </span>
      )}
      {set.approvedEventsOnly && (
        <span className="look-source look-source--approved">{tr("Only use at approved events")}</span>
      )}
    </>
  );
}

export function LibraryHome({
  cards,
  needs,
  results,
  onOpen,
  onFix,
}: {
  cards: LookCard[];
  needs: OGrafTemplateInfo[];
  /** Search results; null when nothing is searched */
  results: Array<{ template: OGrafTemplateInfo; lookName: string }> | null;
  onOpen: (lookId: string, templateId?: string) => void;
  /** Open the import helper on these graphics */
  onFix: (graphics: OGrafTemplateInfo[]) => void;
}) {
  if (results) {
    return results.length ? (
      <ul className="library-results studio-panel">
        {results.map(({ template, lookName }) => (
          <li key={`${template.setId}/${template.manifest.id}`}>
            <button
              className="library-result"
              disabled={template.setId === CUSTOM_TEMPLATE_SET}
              title={template.setId === CUSTOM_TEMPLATE_SET ? tr("Not in a look yet: see Needs attention") : undefined}
              onClick={() => onOpen(template.setId, template.manifest.id)}
            >
              <strong>{template.manifest.name}</strong>
              <span className="muted">{tr(lookName)}</span>
            </button>
          </li>
        ))}
      </ul>
    ) : (
      <div className="screen-state studio-panel">
        <h2>{tr("No matching graphics")}</h2>
        <p>{tr("Try another name.")}</p>
      </div>
    );
  }
  return (
    <>
      {needs.length > 0 && (
        <section className="library-attention studio-panel" aria-label={tr("Needs attention")}>
          <AlertTriangle size={18} aria-hidden="true" />
          <div>
            <strong>
              {tr("Needs attention")}: {needs.length} {needs.length === 1 ? tr("graphic") : tr("graphics")}
            </strong>
            <p className="library-attention-list">
              {needs.map((t, i) => (
                <span key={`${t.setId}/${t.manifest.id}`}>
                  {i > 0 && ", "}
                  <button className="link-button" onClick={() => onFix([t])} title={tr("Set up this graphic")}>
                    {t.manifest.name}
                  </button>
                </span>
              ))}
            </p>
          </div>
          <button className="studio-button" onClick={() => onFix(needs)} title={tr("Match their fields to Split Control data, or keep them typed in Live, and give them a place in a look")}>
            {tr("Fix…")}
          </button>
        </section>
      )}
      <div className="look-cards">
        {cards.map(({ set, graphics }) => (
          <button key={set.id} className="look-card studio-panel" onClick={() => onOpen(set.id)}>
            <span className="look-card-logo">
              {set.logoPreview ? <img src={set.logoPreview} alt="" /> : <span aria-hidden="true">—</span>}
            </span>
            <span className="look-card-name">{set.name}</span>
            <span className="look-card-meta">
              <SourceBadges set={set} />
              <span>
                {graphics.length} {graphics.length === 1 ? tr("graphic") : tr("graphics")}
              </span>
              {(set.additions ?? 0) > 0 && (
                <span className="look-source" title={tr("Graphics added to this look")}>
                  +{set.additions} {tr("added")}
                </span>
              )}
            </span>
            {(set.colors?.length || set.fonts) && (
              <span className="look-card-style">
                {set.colors?.map((c) => (
                  <span key={c} className="look-card-dot" style={{ background: c }} aria-hidden="true" />
                ))}
                {set.fonts && <span className="muted">{set.fonts}</span>}
              </span>
            )}
          </button>
        ))}
      </div>
    </>
  );
}
