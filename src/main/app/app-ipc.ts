import { existsSync } from "node:fs";
import path from "node:path";

import { APP_CHANNELS } from "../../shared/app.js";
import type { ProjectDocumentService } from "../project/project-document-service.js";
import {
  openProjectInteractive,
  type ProjectFileDialogs,
  type ProjectInvokeEvent,
  type ProjectIpcRegistry,
  type ProjectLifecycleOperationGuard,
} from "../project/project-ipc.js";
import { recentFolderLabel, type RecentProjectHandles, type RecentProjectStore } from "./recent-projects.js";

export interface AppIpcDependencies {
  readonly service: ProjectDocumentService;
  readonly dialogs: ProjectFileDialogs;
  readonly lifecycle: ProjectLifecycleOperationGuard;
  readonly recent: RecentProjectStore;
  readonly handles: RecentProjectHandles;
  readonly isTrustedSender: (event: ProjectInvokeEvent) => boolean;
  /** Called after an operation that may change the project or the recent list. */
  readonly afterChange?: () => void;
  readonly fileExists?: (filename: string) => boolean;
}

function recentId(value: unknown): string {
  if (typeof value !== "string" || !/^[0-9a-f-]{36}$/i.test(value)) throw new Error("Voce recente non valida.");
  return value;
}

export function registerAppIpc(registry: ProjectIpcRegistry, dependencies: AppIpcDependencies): () => void {
  const { service, dialogs, lifecycle, recent, handles } = dependencies;
  const fileExists = dependencies.fileExists ?? existsSync;
  const trusted = (event: ProjectInvokeEvent): void => {
    if (!dependencies.isTrustedSender(event)) throw new Error("Untrusted IPC sender");
  };
  const after = <T>(result: T): T => {
    dependencies.afterChange?.();
    return result;
  };
  const resolve = (value: unknown): string => {
    const filename = handles.pathFor(recentId(value));
    if (!filename) throw new Error("La voce recente non è più disponibile. Aggiorna l'elenco.");
    return filename;
  };

  registry.handle(APP_CHANNELS.recentProjects, (event) => {
    trusted(event);
    return handles.views(recent.list());
  });
  registry.handle(APP_CHANNELS.openRecent, (event, id) => {
    trusted(event);
    const filename = resolve(id);
    if (!fileExists(filename)) {
      throw new Error(`Il file «${path.basename(filename)}» non si trova più in ${recentFolderLabel(filename)}. Puoi rimuoverlo dall'elenco.`);
    }
    return lifecycle.run(() => openProjectInteractive(service, dialogs, filename)).finally(() => dependencies.afterChange?.());
  });
  registry.handle(APP_CHANNELS.nativeEdit, (event, command) => {
    trusted(event);
    if (command !== "undo" && command !== "redo") throw new Error("Comando di modifica non valido.");
    const sender = (event as ProjectInvokeEvent & { sender?: { undo(): void; redo(): void } }).sender;
    if (!sender) throw new Error("Finestra non disponibile.");
    if (command === "undo") sender.undo(); else sender.redo();
  });
  registry.handle(APP_CHANNELS.forgetRecent, (event, id) => {
    trusted(event);
    recent.forget(resolve(id));
    return after(handles.views(recent.list()));
  });
  return () => {
    for (const channel of [APP_CHANNELS.recentProjects, APP_CHANNELS.openRecent, APP_CHANNELS.forgetRecent, APP_CHANNELS.nativeEdit]) {
      registry.removeHandler(channel);
    }
  };
}
