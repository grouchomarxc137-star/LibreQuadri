import { useEffect, useMemo, useState, type ReactNode } from "react";
import { formatMoneyE4 } from "../../shared/money.js";
import { suspectSavedArticleLinks } from "../../shared/reviewed-article-links.js";
import type { LqApi } from "../../shared/catalogue.js";
import type { ProjectDocumentView } from "../../shared/project.js";
import { EngineeringNotice } from "./EngineeringDialog.js";
import { CatalogueScreen } from "../catalogue/CatalogueScreen.js";
import { ProjectActionQueue, queuedDesignApi } from "../catalogue/project-actions.js";
import { ProgettazioneScreen } from "../project/ProgettazioneScreen.js";
import { ProjectBar } from "./ProjectBar.js";
import { DistintaDialog } from "./DistintaDialog.js";
import type { ShellAction, ShellState } from "./shell-state.js";
import { documentEditBlocked, registerDocumentEditBlocker } from "./edit-commands.js";
import { QuickAddProvider } from "./QuickAdd.js";

function OpenPricingNotice({ report }: { report: ProjectDocumentView["openReconciliation"] }) {
  const [dismissed, setDismissed] = useState(false);
  const amount = (value: number | null) => value === null ? "incompleto" : formatMoneyE4(value, "EUR");
  if (dismissed || (!report?.pricing && !report?.pricingFailed)) return null;
  const price = report.pricing;
  return <div className="engineering-notice pricing-notice" role="status">
    <span>{price
      ? `Prezzi di listino aggiornati nella copia di lavoro (${price.snapshots} articoli). Totale preventivo: ${amount(price.beforeE4)} → ${amount(price.afterE4)}.`
      : "Aggiornamento automatico dei prezzi non riuscito. Sono in uso i prezzi salvati."}</span>
    <button type="button" onClick={() => setDismissed(true)}>Chiudi</button>
  </div>;
}

export function SavedArticleReviewNotice({ items }: { items: ProjectDocumentView["configuredItems"] }) {
  const suspects = suspectSavedArticleLinks(items);
  if (!suspects.length) return null;
  return <div className="engineering-notice">
    <details>
      <summary>Articoli da verificare in Distinta ({suspects.length})</summary>
      <p>Il progetto conserva gli articoli e i prezzi salvati. Verifica questi collegamenti prima di usare il preventivo.</p>
      <ul>{suspects.map(row => <li key={`${row.itemUuid}:${row.seq}`}>
        {row.modelName} · Salvato {row.saved} · Riferimento TiQuadri {row.expected}
      </li>)}</ul>
    </details>
  </div>;
}

/** One persistent drawing and catalogue controller; only the dock contents switch. */
export function ProjectShell({ api, project, shell, dispatch, onProjectChange, statusBar }: {
  readonly api: LqApi; readonly project: ProjectDocumentView; readonly shell: ShellState;
  readonly dispatch: (action: ShellAction) => void;
  readonly onProjectChange: (project: ProjectDocumentView) => void; readonly statusBar: ReactNode;
}) {
  const actionQueue = useMemo(() => new ProjectActionQueue(), []);
  const designApi = useMemo(() => queuedDesignApi(api.project, actionQueue), [api.project, actionQueue]);
  useEffect(() => registerDocumentEditBlocker(() => actionQueue.busy), [actionQueue]);
  const openDistinta = () => { if (!documentEditBlocked()) dispatch({ type: "open-dialog", dialog: "distinta" }); };
  return <div className="app-frame project-frame">
    <div><ProjectBar project={project} onDistinta={openDistinta} />
      <EngineeringNotice api={api.project} project={project} onVerify={() => dispatch({ type: "open-dialog", dialog: "engineering" })} />
      <OpenPricingNotice key={project.metadata.uuid} report={project.openReconciliation} />
      <SavedArticleReviewNotice items={project.configuredItems} />
    </div>
    <div className="workspace-host">
      <QuickAddProvider key={project.metadata.uuid} api={api.project} project={project} queue={actionQueue}
        onProjectChange={onProjectChange}>
        <section id="workspace-design" className="workspace-pane workspace-pane-docked">
          <CatalogueScreen api={api.catalogue} configurationApi={api.configuration} projectApi={api.project}
            project={project} onProjectChange={onProjectChange} actionQueue={actionQueue}
            view={shell.catalogueView} onViewChange={view => dispatch({ type: "catalogue-view", view })}
            autoPlace={shell.placementMode === "auto"}
            activeLineUuid={shell.activeLineUuid} onActiveLineChange={lineUuid => dispatch({ type: "active-line", lineUuid })}
            onShowQuotation={openDistinta} renderDocked={(navigation, results, details) =>
              <ProgettazioneScreen project={project} api={designApi} configurationApi={api.configuration}
                onProjectChange={onProjectChange} section={shell.designSection} placementMode={shell.placementMode}
                onSectionChange={section => dispatch({ type: "design-section", section })}
                onPlacementModeChange={mode => dispatch({ type: "placement-mode", mode })}
                catalogueNavigation={navigation} catalogueResults={results} catalogueDetails={details} modalOpen={shell.dialog !== null} />
            } />
        </section>
      </QuickAddProvider>
    </div>
    {statusBar}
    {shell.dialog === "distinta" ? <DistintaDialog project={project} api={api.project} actionQueue={actionQueue}
      onProjectChange={onProjectChange} onClose={() => dispatch({ type: "close-dialog" })}
      onOpenLine={lineUuid => dispatch({ type: "open-line", lineUuid })}
      onBrowse={() => { dispatch({ type: "close-dialog" }); dispatch({ type: "design-section", section: "device" }); }} /> : null}
  </div>;
}
