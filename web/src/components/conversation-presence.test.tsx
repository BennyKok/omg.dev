import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { ConversationParticipant } from "../../../src/conversation-contract";
import { mount, type Mounted } from "../test-support/render";

const { ConversationParticipantRow, HumanTypingIndicator, typingSentence } = await import(
  "./conversation-presence"
);

let ui: Mounted;
beforeEach(() => {
  ui = mount();
});
afterEach(() => ui.cleanup());

function human(
  id: string,
  name: string | null,
  extra: Partial<ConversationParticipant> = {},
): ConversationParticipant {
  return {
    id,
    kind: "human",
    role: "member",
    display: { name, fallback: name || "Member" },
    joinedAt: 0,
    historyAccess: "all",
    ...extra,
  };
}

const ANA = human("human:ana", "Ana");
const BEN = human("human:ben", "Ben");
const BOT: ConversationParticipant = {
  id: "bot:scout",
  kind: "bot",
  role: "member",
  display: { name: "Scout", fallback: "Scout" },
  joinedAt: 0,
  historyAccess: "all",
};

describe("a session with only its creator shows no roster at all", () => {
  test("one participant renders nothing", () => {
    ui.render(<ConversationParticipantRow participants={[ANA]} />);
    expect(ui.host.innerHTML).toBe("");
  });

  test("an empty roster renders nothing", () => {
    ui.render(<ConversationParticipantRow participants={[]} />);
    expect(ui.host.innerHTML).toBe("");
  });

  test("a second person is what makes it appear", () => {
    ui.render(<ConversationParticipantRow participants={[ANA, BEN]} />);
    expect(ui.query("[aria-label^='Conversation participants']")).not.toBeNull();
    expect(ui.query("[aria-label='Ana, member']")).not.toBeNull();
    expect(ui.query("[aria-label='Ben, member']")).not.toBeNull();
  });
});

describe("faces", () => {
  test("draws the photo over an initial, so a failed load still reads", () => {
    const withPhoto = human("human:ana", "Ana");
    withPhoto.display.avatar = "https://example.com/ana.png";
    ui.render(<ConversationParticipantRow participants={[withPhoto, BEN]} />);

    const img = ui.query("img") as HTMLImageElement | null;
    expect(img?.src).toBe("https://example.com/ana.png");
    // The initial is underneath, not replaced by the image.
    expect(ui.text()).toContain("A");
  });

  test("falls back to the server's fallback label when there is no name", () => {
    const nameless = human("human:x", null);
    ui.render(<ConversationParticipantRow participants={[nameless, BEN]} />);
    expect(ui.query("[aria-label='Member, member']")).not.toBeNull();
  });

  test("overflows past five with a count instead of growing the row", () => {
    const many = ["a", "b", "c", "d", "e", "f", "g"].map((key) =>
      human(`human:${key}`, key.toUpperCase()),
    );
    ui.render(<ConversationParticipantRow participants={many} />);
    expect(ui.text()).toContain("+2");
  });

  test("a bot participant keeps its own mascot treatment", () => {
    ui.render(<ConversationParticipantRow participants={[ANA, BOT]} />);
    expect(ui.query("[aria-label='Scout, bot']")).not.toBeNull();
  });
});

describe("typing marks the person, not the row", () => {
  test("a typing participant is labelled as typing", () => {
    ui.render(<ConversationParticipantRow participants={[ANA, BEN]} typingIds={[BEN.id]} />);
    expect(ui.query("[aria-label='Ben, typing']")).not.toBeNull();
    // Everyone else is untouched.
    expect(ui.query("[aria-label='Ana, member']")).not.toBeNull();
  });

  test("no typing ids leaves every label exactly as before", () => {
    ui.render(<ConversationParticipantRow participants={[ANA, BEN]} typingIds={[]} />);
    expect(ui.query("[aria-label*='typing']")).toBeNull();
  });

  test("a typing id nobody in the roster matches changes nothing", () => {
    ui.render(<ConversationParticipantRow participants={[ANA, BEN]} typingIds={["human:ghost"]} />);
    expect(ui.query("[aria-label*='typing']")).toBeNull();
  });
});

describe("typingSentence", () => {
  test("names one and two people, then counts", () => {
    expect(typingSentence([])).toBe("");
    expect(typingSentence(["Ana"])).toBe("Ana is typing");
    expect(typingSentence(["Ana", "Ben"])).toBe("Ana and Ben are typing");
    expect(typingSentence(["Ana", "Ben", "Cy"])).toBe("3 people are typing");
  });
});

describe("HumanTypingIndicator", () => {
  test("renders nothing when nobody is typing", () => {
    ui.render(<HumanTypingIndicator participants={[]} />);
    expect(ui.host.innerHTML).toBe("");
  });

  test("announces politely so it cannot interrupt a screen reader", () => {
    ui.render(<HumanTypingIndicator participants={[ANA]} />);
    const region = ui.query("[aria-live]");
    expect(region?.getAttribute("aria-live")).toBe("polite");
    expect(region?.getAttribute("aria-label")).toBe("Ana is typing");
    expect(ui.text()).toContain("Ana is typing");
  });

  test("shows at most three faces but still counts everyone in the sentence", () => {
    const four = ["a", "b", "c", "d"].map((key) => human(`human:${key}`, key.toUpperCase()));
    ui.render(<HumanTypingIndicator participants={four} />);
    expect(ui.queryAll("[aria-label$=', member']")).toHaveLength(3);
    expect(ui.text()).toContain("4 people are typing");
  });

  test("the animated dots are hidden from assistive tech", () => {
    ui.render(<HumanTypingIndicator participants={[ANA]} />);
    expect(ui.query(".typing-indicator")?.getAttribute("aria-hidden")).toBe("true");
  });
});
