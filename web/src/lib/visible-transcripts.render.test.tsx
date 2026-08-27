// Rendered, not asserted against source. The claim under test is behavioural:
// a surface counts as on screen for exactly as long as it is mounted, and the
// subscription that read state depends on sees that change.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { useEffect } from "react";
import { mount, type Mounted } from "../test-support/render";

const {
  addVisibleTranscriptSid,
  removeVisibleTranscriptSid,
  resetVisibleTranscriptsForTest,
  useVisibleTranscriptSids,
} = await import("./visible-transcripts");

/** Prints whatever the registry currently reports. */
function Probe() {
  const sids = useVisibleTranscriptSids();
  return <div>{sids.length ? sids.join(",") : "none"}</div>;
}

/** Stands in for a stage column: registers while mounted, releases on unmount. */
function Column({ sid }: { sid: string }) {
  useEffect(() => {
    addVisibleTranscriptSid(sid);
    return () => removeVisibleTranscriptSid(sid);
  }, [sid]);
  return <span>column {sid}</span>;
}

let ui: Mounted;
beforeEach(() => {
  resetVisibleTranscriptsForTest();
  ui = mount();
});
afterEach(() => {
  ui.cleanup();
  resetVisibleTranscriptsForTest();
});

describe("the on-screen registry, rendered", () => {
  test("nothing is on screen before a surface mounts", () => {
    ui.render(<Probe />);
    expect(ui.text()).toContain("none");
  });

  test("an open column is on screen and a closed one is not", () => {
    ui.render(
      <>
        <Probe />
        <Column sid="s1" />
      </>,
    );
    expect(ui.text()).toContain("s1");

    // Closing the column is an unmount. This is the case the old signal got
    // wrong: `lfg-collapsed:` stays "0" forever, so the session would still
    // have counted as on screen here, and read state would have followed it.
    ui.render(<Probe />);
    expect(ui.text()).toContain("none");
  });

  test("several columns, and closing one leaves the others", () => {
    ui.render(
      <>
        <Probe />
        <Column sid="s1" />
        <Column sid="s2" />
      </>,
    );
    expect(ui.text()).toContain("s1,s2");

    ui.render(
      <>
        <Probe />
        <Column sid="s2" />
      </>,
    );
    expect(ui.text()).toContain("s2");
    expect(ui.text()).not.toContain("s1,");
  });

  test("a surface that was never opened is never on screen", () => {
    // The regression in one line: a session with stale collapse state but no
    // column must not appear here, because read state is driven off this list.
    ui.render(
      <>
        <Probe />
        <Column sid="s1" />
      </>,
    );
    expect(ui.text()).not.toContain("s5");
  });
});
