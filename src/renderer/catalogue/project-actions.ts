import type { ProjectApi, ProjectDocumentView } from "../../shared/project.js";

/** Project writes must publish in invocation order, even if several controls fire before React renders busy. */
export class ProjectActionQueue {
  private tail: Promise<void> = Promise.resolve();
  private pending = 0;

  get busy(): boolean { return this.pending > 0; }
  async whenIdle(): Promise<void> { await this.tail; }

  /** Also serialize drawing writes, whose callers need their result or original error. */
  execute<T>(action: () => Promise<T>): Promise<T> {
    this.pending++;
    const result = this.tail.then(action).finally(() => { this.pending--; });
    this.tail = result.then(() => undefined, () => undefined);
    return result;
  }

  enqueue(action: () => Promise<ProjectDocumentView | null>,
    onChange: (project: ProjectDocumentView) => void, onError: (message: string) => void): Promise<boolean> {
    const run = async (): Promise<boolean> => {
      try {
        const updated = await action();
        if (updated) onChange(updated);
        return true;
      } catch (caught) {
        onError(caught instanceof Error ? caught.message : String(caught));
        return false;
      }
    };
    return this.execute(run);
  }
}

const DESIGN_WRITES = new Set<keyof ProjectApi>([
  "addStructural", "placeStructuralItem", "autoPlaceItem", "duplicatePlacedItem", "reconfigureEnclosure", "fillCapacity", "unplaceNode", "unplaceSubtree",
  "removePhysicalRoot", "placeRoot", "placeChild", "moveNode", "insertPackedChild", "reorderPackedNode",
  "movePackedNode", "removePackedNode", "addAnnotation", "updateAnnotation", "removeAnnotation", "undo", "redo",
]);

/** Catalogue and drawing controls are visible together; their writes share the same publication order. */
export function queuedDesignApi(api: ProjectApi, queue: ProjectActionQueue): ProjectApi {
  // Electron contextBridge freezes the exposed API. Proxying a writable copy permits
  // queued wrappers without violating the original methods' non-configurable descriptors.
  return new Proxy({ ...api }, {
    get(target, key, receiver) {
      const value = Reflect.get(target, key, receiver);
      return DESIGN_WRITES.has(key as keyof ProjectApi) && typeof value === "function"
        ? (...args: unknown[]) => queue.execute(async () => Reflect.apply(value, api, args)) : value;
    },
  });
}
