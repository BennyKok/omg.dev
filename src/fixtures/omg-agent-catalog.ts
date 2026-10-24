// A copy of the `omgAgent` objects that the router returns from
// GET /v1/models?agent=omg (vibes proxy.OmgAgentCatalog). Tests apply it so they
// exercise lfg against the shape the router serves, independent of the
// alias-only fallback and of any cache on this machine.
import fixture from "./omg-agent-catalog.json";
import { applyOmgCatalog, type OmgCatalogEntry } from "../omg-models.ts";

export const OMG_ROUTER_FIXTURE: readonly OmgCatalogEntry[] = fixture.models;

export function applyOmgRouterFixture(): void {
  applyOmgCatalog(OMG_ROUTER_FIXTURE);
}
