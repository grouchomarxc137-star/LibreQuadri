import type { ProjectDocumentView } from "../../shared/project.js";
import { Icon } from "../ui/icons.js";

/** Project identity, Distinta action and document identity. */
export function ProjectBar({ project, onDistinta }: {
  readonly project: ProjectDocumentView | null;
  readonly onDistinta?: () => void;
}) {
  return <header className="top-bar">
    <div className="top-bar-identity">
      <span className="top-bar-brand">LibreQuadri</span>
      {project ? <>
        <span className="top-bar-title" title={project.metadata.title}>{project.metadata.title}</span>
        <span className="top-bar-norm">{project.metadata.normCode}</span>
        {project.dirty ? <>
          <span className="top-bar-divider" aria-hidden="true" />
          <span className="project-state"><span className="project-state-dot" aria-hidden="true" />Modificato</span>
        </> : null}
      </> : <span className="top-bar-empty">Nessun progetto aperto</span>}
    </div>
    <div className="top-bar-document">
      {project ? <>
        <Icon name="file" className="librequadri-icon-small" />
        <span className="top-bar-file" title={project.documentName}>{project.documentName}</span>
        <span aria-hidden="true">·</span>
        <span>rev. {project.revision}</span>
      </> : null}
    </div>
    <div className="top-bar-actions">
      <button id="open-distinta" type="button" disabled={!project} onClick={onDistinta}>
        <Icon name="table" /><span>Distinta</span>
      </button>
    </div>
  </header>;
}
