import { expect, test } from "bun:test";

import { signedArtifactUrl } from "../src/omg/signed-asset-url";

test("signed artifact URLs preserve media queries and encode the grant", () => {
  expect(
    signedArtifactUrl(
      "https://sessions.omgs.app/",
      "/api/artifacts/clip.mp4?preview=1",
      "short lived+/token",
    ),
  ).toBe(
    "https://sessions.omgs.app/api/artifacts/clip.mp4?preview=1&__omg_grant=short+lived%2B%2Ftoken",
  );
});

test("an absolute-looking path cannot move the grant to another origin", () => {
  const value = signedArtifactUrl(
    "https://sessions.omgs.app",
    "https://evil.example/steal",
    "secret",
  );
  expect(new URL(value).origin).toBe("https://sessions.omgs.app");
});
