// Which artifact bytes the browser is allowed to load by itself.
//
// This is the switch that decides between `<img src="/api/...">` and a fetched
// blob. Getting it wrong is silent in both directions: answer for a hosted
// transport and every picture 401s, answer never and the virtualized transcript
// goes back to re-downloading each image every time its row scrolls into view.
import { afterEach, describe, expect, test } from "bun:test";
import {
  createGrantTransport,
  createSameOriginTransport,
  type OmgTransport,
} from "@omg-dev/client";

import { configureOmgTransport, omgDirectUrl, selectDirectUrl } from "./omg-client";

/** The minimum a transport has to implement. */
const base: OmgTransport = {
  fetch: async () => new Response(),
  request: async () => ({}) as never,
  openSocket: async () => {
    throw new Error("socket not used in this test");
  },
  openLiveSocket: async () => {
    throw new Error("socket not used in this test");
  },
};

afterEach(() => {
  configureOmgTransport(createSameOriginTransport());
});

describe("selectDirectUrl", () => {
  test("uses the URL a transport offers", () => {
    const transport: OmgTransport = { ...base, assetUrl: (path) => `/proxy${path}` };
    expect(selectDirectUrl(transport, "/api/artifacts/a.png")).toBe("/proxy/api/artifacts/a.png");
  });

  test("falls back to the blob when a transport declines", () => {
    // What a signed/bearer transport answers. It has the method and says no,
    // because an element attribute cannot carry an Authorization header.
    const transport: OmgTransport = { ...base, assetUrl: () => null };
    expect(selectDirectUrl(transport, "/api/artifacts/a.png")).toBeNull();
  });

  test("falls back to the blob for a host that never heard of assetUrl", () => {
    // The backward-compatibility case, and the reason the method is optional.
    // An embedding host ships its own older copy of @omg-dev/client, so this
    // object is all we get, and it must keep working exactly as before.
    expect(selectDirectUrl(base, "/api/artifacts/a.png")).toBeNull();
  });
});

describe("the shipped transports", () => {
  test("same-origin serves artifacts straight to the element", () => {
    const transport = createSameOriginTransport();
    expect(selectDirectUrl(transport, "/api/artifacts/a.png?preview=1")).toBe(
      "/api/artifacts/a.png?preview=1",
    );
    // Same normalization the fetch path applies to a relative path.
    expect(selectDirectUrl(transport, "api/artifacts/a.png")).toBe("/api/artifacts/a.png");
  });

  test("the grant transport declines, because its credential is a header", () => {
    const transport = createGrantTransport({
      baseUrl: "https://box.example",
      getGrant: async () => ({ token: "t", expiresAt: Date.now() + 60_000 }),
    });
    expect(selectDirectUrl(transport, "/api/artifacts/a.png")).toBeNull();
  });
});

describe("omgDirectUrl", () => {
  test("reads the transport the host installed", () => {
    expect(omgDirectUrl("/api/artifacts/a.png")).toBe("/api/artifacts/a.png");
    configureOmgTransport(base);
    expect(omgDirectUrl("/api/artifacts/a.png")).toBeNull();
  });
});
