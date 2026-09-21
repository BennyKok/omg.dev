import { expect, test } from "bun:test";
import { computerSocketUrl } from "../mobile/src/omg/computer-socket";

test("mobile computer control uses the RFB websocket on the session origin", () => {
  expect(computerSocketUrl("https://sessions.example/")).toBe("wss://sessions.example/api/computer");
  expect(computerSocketUrl("http://127.0.0.1:8766")).toBe("ws://127.0.0.1:8766/api/computer");
});
