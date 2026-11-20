/** One look: its graphics, and a preview of the selected one */
import { t as tr } from "../i18n";
import { useState } from "react";
import { ArrowLeft, Download, Trash2 } from "lucide-react";
import { LibraryPreview } from "./LibraryPreview";
import { SourceBadges } from "./LibraryHome";
import type { LookCard } from "./libraryModel";
import type { OGrafTemplateInfo } from "../../../shared/types/ograf";

function stepsLabel(stepCount: number | undefined) {
  if (stepCount === undefined) return null;
  if (stepCount === -1) return tr("Dynamic pages");
  if (stepCount === 0) return tr("Automatic");
  if (stepCount === 1) return tr("Single step");
  return `${stepCount} ${tr("steps")}`;
}

function GraphicTile({ template, selected, onSelect }: { template: OGrafTemplateInfo; selected: boolean; onSelect: () => void }) {
  const kind = (template.manifest as { v_olgrafik_kind?: unknown }).v_olgrafik_kind;
  return (
    <button className={`template-card library-tile${selected ? " is-selected" : ""}`} aria-pressed={selected} onClick={onSelect}>
      <span className="template-card-heading">
        <strong>{template.desk?.label ?? template.manifest.name}</strong>
      </span>
      {typeof kind === "string" && <code className="muted">{kind}</code>}
      {template.deskWarnings?.map((warning) => (
        <span role="status" className="library-warning" key={warning}>{warning}</span>
      ))}
      <span className="template-badges">
        {template.dataSourceConfig && <span>{tr("Timing data")}</span>}
        {stepsLabel(template.manifest.stepCount) && <span>{stepsLabel(template.manifest.stepCount)}</span>}
      </span>
    </button>
  );
}

export function LookPage({
  card,
  initialTemplateId,
  busy,
  onBack,
  onExport,
  onRemove,
}: {
  card: LookCard;
  initialTemplateId?: string;
  busy: boolean;
  onBack: () => void;
  onExport: () => void;
  onRemove: () => void;
}) {
  const { set, graphics } = card;
  const [picked, setPicked] = useState<string | undefined>(undefined);
  // The tile picked on this page, else the one asked for, else the first graphic
  const selectedId = [picked, initialTemplateId].find((id) => id && graphics.some((g) => g.manifest.id === id)) ?? graphics[0]?.manifest.id;
  const selected = graphics.find((g) => g.manifest.id === selectedId);

  return (
    <section className="look-page">
      <div className="template-group-heading">
        <div>
          <button className="studio-button subtle" onClick={onBack}>
            <ArrowLeft size={15} aria-hidden="true" /> {tr("Looks")}
          </button>
          <h2>
            {set.name} <SourceBadges set={set} />
          </h2>
          {set.description && <p>{set.description}</p>}
        </div>
        <div className="look-actions">
          <span>
            {graphics.length} {tr("graphics")}
          </span>
          {set.source && (
            <button
              className="studio-button"
              onClick={onExport}
              disabled={busy}
              title={tr("Save this look as a zip file, to share it or use it on another computer")}
            >
              <Download size={15} aria-hidden="true" />
              {tr("Export…")}
            </button>
          )}
          {set.source === "imported" && (
            <button className="studio-button" onClick={onRemove} disabled={busy}>
              <Trash2 size={15} aria-hidden="true" />
              {tr("Remove")}
            </button>
          )}
        </div>
      </div>
      <div className="look-page-body">
        <div className="template-grid">
          {graphics.map((template) => (
            <GraphicTile
              key={template.manifest.id}
              template={template}
              selected={template.manifest.id === selectedId}
              onSelect={() => setPicked(template.manifest.id)}
            />
          ))}
        </div>
        {selected && <LibraryPreview template={selected} />}
      </div>
    </section>
  );
}
