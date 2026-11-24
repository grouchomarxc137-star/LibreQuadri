import { afterEach, describe, expect, it, vi } from "vitest";
import { BRANDED_LOADING_MAX_MS, BRANDED_LOADING_MIN_MS, ProjectRequestCoordinator,
  showBrandedLoading, startInitialProjectLoad } from "../../src/renderer/app/startup.js";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

function startup(request: () => Promise<string | null>) {
  const coordinator = new ProjectRequestCoordinator<string>();
  let project: string | null | undefined;
  let minimumElapsed = false;
  let maximumElapsed = false;
  const stop = startInitialProjectLoad(coordinator, request,
    current => { project = current; }, () => { project = null; },
    () => { minimumElapsed = true; }, () => { maximumElapsed = true; });
  return {
    coordinator, stop,
    branded: () => showBrandedLoading(project !== undefined, minimumElapsed, maximumElapsed),
    project: () => project,
    open: (current: string) => { coordinator.invalidate(); project = current; },
  };
}

afterEach(() => { vi.useRealTimers(); });

describe("bounded branded startup", () => {
  it("keeps an immediately ready project branded through 1999 ms, then opens at 2000 ms", async () => {
    vi.useFakeTimers();
    const state = startup(() => Promise.resolve("open project"));
    await Promise.resolve();
    expect(state.project()).toBe("open project");
    vi.advanceTimersByTime(BRANDED_LOADING_MIN_MS - 1);
    expect(state.branded()).toBe(true);
    vi.advanceTimersByTime(1);
    expect(state.branded()).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    state.stop();
  });

  it("waits only until 2 seconds when initialization finishes at 1.5 seconds", async () => {
    vi.useFakeTimers();
    const pending = deferred<string | null>();
    const state = startup(() => pending.promise);
    vi.advanceTimersByTime(1500);
    pending.resolve("open project");
    await Promise.resolve();
    expect(state.branded()).toBe(true);
    vi.advanceTimersByTime(499);
    expect(state.branded()).toBe(true);
    vi.advanceTimersByTime(1);
    expect(state.branded()).toBe(false);
    state.stop();
  });

  it("opens immediately when initialization finishes at 2.4 seconds", async () => {
    vi.useFakeTimers();
    const pending = deferred<string | null>();
    const state = startup(() => pending.promise);
    vi.advanceTimersByTime(2400);
    expect(state.branded()).toBe(true);
    pending.resolve("open project");
    await Promise.resolve();
    expect(state.branded()).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    state.stop();
  });

  it("exposes the start shell at 3 seconds if initialization remains unresolved", () => {
    vi.useFakeTimers();
    const pending = deferred<string | null>();
    const state = startup(() => pending.promise);
    vi.advanceTimersByTime(BRANDED_LOADING_MAX_MS - 1);
    expect(state.branded()).toBe(true);
    vi.advanceTimersByTime(1);
    expect(state.branded()).toBe(false);
    expect(state.project()).toBeUndefined();
    state.stop();
  });

  it("ignores a stale late response after a newer project action", async () => {
    vi.useFakeTimers();
    const pending = deferred<string | null>();
    const state = startup(() => pending.promise);
    vi.advanceTimersByTime(BRANDED_LOADING_MAX_MS);
    state.open("newer project");
    pending.resolve("old project");
    await Promise.resolve();
    expect(state.project()).toBe("newer project");
    expect(state.branded()).toBe(false);
    state.stop();
  });

  it("accepts an eventual response after the timeout when no newer action occurred", async () => {
    vi.useFakeTimers();
    const pending = deferred<string | null>();
    const state = startup(() => pending.promise);
    vi.advanceTimersByTime(BRANDED_LOADING_MAX_MS);
    pending.resolve("eventual project");
    await Promise.resolve();
    expect(state.project()).toBe("eventual project");
    expect(state.branded()).toBe(false);
    state.stop();
  });
});
