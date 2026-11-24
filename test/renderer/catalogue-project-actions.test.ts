import { describe, expect, it, vi } from "vitest";
import type { ProjectDocumentView } from "../../src/shared/project.js";
import { ProjectActionQueue, queuedDesignApi } from "../../src/renderer/catalogue/project-actions.js";
import { fakeProjectApi, openProject } from "./fake-api.js";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

describe("Catalogo project actions", () => {
  it.each([false, true])("serializes writes, preserves failures and leaves reads immediate (frozen API: %s)", async frozen => {
    const queue = new ProjectActionQueue(), first = deferred<ProjectDocumentView>();
    const api = fakeProjectApi();
    api.fillCapacity = vi.fn(() => first.promise);
    api.frontAssets = vi.fn(async () => ({}));
    api.undo = vi.fn(async () => { throw new Error("Annulla rifiutato"); });
    if (frozen) Object.freeze(api);
    const design = queuedDesignApi(api, queue), published: number[] = [];
    const fill = design.fillCapacity({ capacityKind: "din_rail" }).then(view => { published.push(view.revision); });
    const remove = queue.enqueue(async () => ({ ...openProject, revision: 6 }), view => published.push(view.revision), vi.fn());
    expect(queue.busy).toBe(true);
    await design.frontAssets(); expect(api.frontAssets).toHaveBeenCalledOnce(); expect(published).toEqual([]);
    first.resolve({ ...openProject, revision: 5 });
    await fill; await remove; await queue.whenIdle();
    expect(published).toEqual([5, 6]); expect(queue.busy).toBe(false);
    await expect(design.undo()).rejects.toThrow("Annulla rifiutato");
    expect(await queue.enqueue(async () => openProject, vi.fn(), vi.fn())).toBe(true);
  });
  it("adds a carpenteria through a frozen bridge API without changing its methods", async () => {
    const queue = new ProjectActionQueue(), first = deferred<ProjectDocumentView>();
    const api = fakeProjectApi();
    api.addStructural = vi.fn(function (this: typeof api) {
      expect(this).toBe(api);
      return first.promise;
    });
    Object.freeze(api);
    const original = api.addStructural;
    const design = queuedDesignApi(api, queue);
    const request = { kind: "enclosure" as const, configuration: { modelId: 1, selectedOptionIds: [] } };
    const result = design.addStructural(request);
    expect(queue.busy).toBe(true);
    await Promise.resolve();
    expect(original).toHaveBeenCalledWith(request);
    first.resolve(openProject);
    expect(await result).toBe(openProject);
    expect(queue.busy).toBe(false);
    expect(api.addStructural).toBe(original);
    expect(Object.isFrozen(api)).toBe(true);
  });
  it("publishes consecutive Remove results in order, even when clicks precede a busy render", async () => {
    const queue = new ProjectActionQueue();
    const first = deferred<ProjectDocumentView>();
    const second = deferred<ProjectDocumentView>();
    const removeFirst = vi.fn(() => first.promise);
    const removeSecond = vi.fn(() => second.promise);
    const shown: number[] = [];
    const onChange = (view: ProjectDocumentView) => shown.push(view.revision);
    const onError = vi.fn();
    const a = queue.enqueue(removeFirst, onChange, onError);
    const b = queue.enqueue(removeSecond, onChange, onError);
    await Promise.resolve();
    expect(removeFirst).toHaveBeenCalledOnce();
    expect(removeSecond).not.toHaveBeenCalled();
    first.resolve({ ...openProject, revision: 5 });
    expect(await a).toBe(true);
    await Promise.resolve();
    expect(removeSecond).toHaveBeenCalledOnce();
    second.resolve({ ...openProject, revision: 6 });
    expect(await b).toBe(true);
    expect(shown).toEqual([5, 6]);
    expect(onError).not.toHaveBeenCalled();
  });

  it("reports a refused removal and still runs the next queued action", async () => {
    const queue = new ProjectActionQueue();
    const onChange = vi.fn();
    const onError = vi.fn();
    const refused = queue.enqueue(async () => { throw new Error("posizionato"); }, onChange, onError);
    const next = queue.enqueue(async () => openProject, onChange, onError);
    expect(await refused).toBe(false);
    expect(await next).toBe(true);
    expect(onError).toHaveBeenCalledWith("posizionato");
    expect(onChange).toHaveBeenCalledOnce();
  });
});
