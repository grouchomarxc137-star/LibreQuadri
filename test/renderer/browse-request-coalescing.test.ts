import { expect, it } from "vitest";
import { BrowseSession, emptyBrowseState } from "../../src/renderer/catalogue/browse-state.js";
import type { CatalogueBrowseRequest, CatalogueBrowseResult } from "../../src/shared/catalogue.js";
const result = (totalCount = 0): CatalogueBrowseResult => ({ products: [], packages: [], packageCount: 0,
  facets: { brand: null, configurability: null, attributes: [] }, totalCount, offset: 0, hasMore: false });
const tick = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
function open() {
  const requests: CatalogueBrowseRequest[] = [];
  const pending: Array<{ resolve: (value: CatalogueBrowseResult) => void; reject: (error: Error) => void }> = [];
  const states: string[] = [];
  const session = new BrowseSession({ browse: request => {
    requests.push(request); return new Promise<CatalogueBrowseResult>((resolve, reject) => pending.push({ resolve, reject }));
  } }, state => states.push(state.status));
  return { session, requests, pending, states };
}
it("keeps one in-flight request and replaces intermediate clicks with the latest complete criteria", async () => {
  const { session, requests, pending } = open();
  session.select({ nodeId: 1 }); session.select({ nodeId: 2 });
  const latest = { nodeId: 3, listedOnly: true, attributeFilters: [{ attributeCode: "poles", values: [2] }] };
  session.select(latest);
  expect(requests).toHaveLength(1);
  pending[0]!.resolve(result(100)); await tick();
  expect(session.state.status).toBe("loading"); expect(requests).toHaveLength(2);
  expect(requests[1]).toMatchObject({ ...latest, offset: 0 });
  pending[1]!.resolve(result(3)); await tick(); expect(session.state.totalCount).toBe(3);
});
it("continues with the latest selection after a superseded request fails", async () => {
  const { session, pending, requests, states } = open();
  session.select({ nodeId: 1 }); session.select({ nodeId: 2 });
  pending[0]!.reject(new Error("stale failure")); await tick();
  expect(states).not.toContain("error"); expect(requests[1]?.nodeId).toBe(2);
  pending[1]!.reject(new Error("current failure")); await tick(); expect(session.state.status).toBe("error");
  session.select({ nodeId: 2 }); expect(requests).toHaveLength(3);
  pending[2]!.resolve(result(2)); await tick(); expect(session.state.status).toBe("ready");
});
it("drops pending work on clearing or disposal and supports StrictMode reselection", async () => {
  const { session, pending, requests } = open();
  session.select({ nodeId: 1 }); session.select({ nodeId: 2 }); session.select(null);
  pending[0]!.resolve(result()); await tick(); expect(requests).toHaveLength(1); expect(session.state).toEqual(emptyBrowseState);
  session.select({ nodeId: 3 }); session.select({ nodeId: 4 }); session.dispose();
  pending[1]!.resolve(result(99)); await tick(); expect(requests).toHaveLength(2);
  session.select({ nodeId: 5 }); pending[2]!.resolve(result(5)); await tick(); expect(session.state.totalCount).toBe(5);
});
it("handles a synchronous API failure without blocking retries", async () => {
  let fail = true;
  const session = new BrowseSession({ browse: () => { if (fail) throw new Error("offline"); return Promise.resolve(result(1)); } }, () => {});
  session.select({ nodeId: 1 }); await tick(); expect(session.state.status).toBe("error");
  fail = false; session.select({ nodeId: 1 }); await tick(); expect(session.state.totalCount).toBe(1);
});
