// The app's one Computer screen connection. Split from computer-connection.ts
// so that file stays free of noVNC and the transport, and tests can build their
// own with fakes.
import RFB from "@novnc/novnc";
import { openOmgSocket, omgTransportGeneration } from "@/lib/omg-client";
import { RfbChannel } from "@/lib/rfb-channel";
import { createComputerConnection } from "@/lib/computer-connection";

export const computerConnection = createComputerConnection({
  async open(target) {
    const socket = await openOmgSocket("/api/computer");
    const rfb = new RFB(target, new RfbChannel(socket) as unknown as object, { shared: true });
    rfb.scaleViewport = true;
    rfb.background = "#0b0b0d";
    // Without this the remote cursor can be invisible, which makes a relative
    // pointer impossible to aim.
    rfb.showDotCursor = true;
    return rfb;
  },
  generation: omgTransportGeneration,
  createHost() {
    const el = document.createElement("div");
    el.style.position = "absolute";
    el.style.inset = "0";
    return el;
  },
});
