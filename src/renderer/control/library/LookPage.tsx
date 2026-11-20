/** One look: its graphics, and a preview of the selected one */
import { t as tr } from "../i18n";
import { useState } from "react";
import { ArrowLeft, Download, PlusCircle, Trash2 } from "lucide-react";
import { LibraryPreview } from "./LibraryPreview";
import { SourceBadges } from "./LibraryHome";
import { graphicTitle, replacedBy, type LookCard } from "./libraryModel";
import type { OGrafTemplateInfo } from "../../../shared/types/ograf";

function stepsLabel(stepCount: number | undefined) {
  if (stepCount === undefined) return null;
  if (stepCount === -1) return tr("Dynamic pages");
  if (stepCount === 0) return tr("Automatic");
  if (stepCount === 1) return tr("Single step");
  return `${stepCount} ${tr("steps")}`;
}

function GraphicTile({
  template,
  selected,
  replacedByName,
  busy,
  onSelect,
  onRemove,
}: {
  template: OGrafTemplateInfo;
  selected: boolean;
  /** Name of the graphic used instead of this one in Live */
  replacedByName?: string;
  busy: boolean;
  onSelect: () => void;
  onRemove: () => void;
}) {
  const kind = (template.manifest as { v_olgrafik_kind?: unknown }).v_olgrafik_kind;
  const tile = (
    <button
      className={`template-card library-tile${selected ? " is-selected" : ""}${replacedByName ? " is-replaced" : ""}`}
      aria-pressed={selected}
      onClick={onSelect}
    >
      <span className="template-card-heading">
        <span className="library-tile-title">
          {template.addition && <PlusCircle size={15} className="library-added" aria-label={tr("Added to this look")} />}
          <strong>{graphicTitle(template)}</strong>
        </span>
      </span>
      {replacedByName && (
        <span className="muted">
          {tr("Replaced by")} {replacedByName}
        </span>
      )}
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
  if (!template.addition) return tile;
  // An added graphic can be taken out again (a button can't sit inside the tile's button)
  return (
    <div className="library-tile-wrap">
      {tile}
      <button
        className="studio-button subtle library-tile-remove"
        disabled={busy}
        onClick={onRemove}
        aria-label={`${tr("Remove")} ${template.manifest.name}`}
        title={tr("Remove this graphic from the look")}
      >
        <Trash2 size={14} aria-hidden="true" /> {tr("Remove")}
      </button>
    </div>
  );
}

export function LookPage({
  card,
  initialTemplateId,
  busy,
  onBack,
  replaces,
  onExport,
  onRemove,
  onRemoveAddition,
}: {
  card: LookCard;
  /** New graphic id → the id it replaces in this look */
  replaces: Record<string, string>;
  initialTemplateId?: string;
  busy: boolean;
  onBack: () => void;
  onExport: () => void;
  onRemove: () => void;
  onRemoveAddition: (template: OGrafTemplateInfo) => void;
}) {
  const { set, graphics } = card;
  const replaced = replacedBy(graphics, replaces);
  // A built-in look exports only what was added to it
  const canExport = set.source === "imported" || (set.source === "built-in" && (set.additions ?? 0) > 0);
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
          {canExport && (
            <button
              className="studio-button"
              onClick={onExport}
              disabled={busy}
              title={
                set.source === "imported"
                  ? tr("Save this look as a .splitlook file, to share it or use it on another computer")
                  : tr("Save the graphics added to this look as a .splitlook file, for another computer that has the look")
              }
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
              replacedByName={replaced.get(template.manifest.id)}
              busy={busy}
              onSelect={() => setPicked(template.manifest.id)}
              onRemove={() => onRemoveAddition(template)}
            />
          ))}
        </div>
        {selected && <LibraryPreview template={selected} />}
      </div>
    </section>
  );
}
