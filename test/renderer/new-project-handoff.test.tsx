// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { App } from "../../src/renderer/app/App.js";
import { BRANDED_LOADING_MIN_MS } from "../../src/renderer/app/startup.js";
import type { AppStateChange } from "../../src/shared/app.js";
import type { ProjectDocumentView } from "../../src/shared/project.js";
import { fakeLqApi, openProject } from "./fake-api.js";

it("opens the form on the start screen and ignores a late reply for the discarded project", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  let emit!: (change: AppStateChange) => void;
  let finishOldRequest!: (view: ProjectDocumentView) => void;
  let finishCloseRefresh!: (view: null) => void;
  const api = fakeLqApi();
  api.app.onStateChanged = listener => { emit = listener; return () => undefined; };
  api.project.current = vi.fn()
    .mockResolvedValueOnce(openProject)
    .mockImplementationOnce(() => new Promise(resolve => { finishOldRequest = resolve; }))
    .mockImplementationOnce(() => new Promise(resolve => { finishCloseRefresh = resolve; }));
  try {
    await act(async () => root.render(<App api={api} />));
    await act(async () => vi.advanceTimersByTimeAsync(BRANDED_LOADING_MIN_MS));
    expect(host.querySelector(".start-screen")).toBeNull();
    await act(async () => emit({ reason: "recent" }));
    await act(async () => {
      emit({ reason: "closed", openNewProject: true });
      emit({ reason: "recent" });
    });
    expect(host.querySelector(".start-screen")).not.toBeNull();
    expect(host.querySelector('[role="dialog"]')?.textContent).toContain("Nuovo progetto");
    await act(async () => { finishCloseRefresh(null); finishOldRequest(openProject); });
    const form = host.querySelector('[role="dialog"]')!;
    expect(form.textContent).toContain("Nuovo progetto");
    expect(host.querySelector(".start-screen")).not.toBeNull();
    const cancel = [...form.querySelectorAll("button")].find(button => button.textContent === "Annulla")!;
    await act(async () => cancel.click());
    expect(host.querySelector(".start-screen")).not.toBeNull();
    expect(host.querySelector('[role="dialog"]')).toBeNull();
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  }
});
