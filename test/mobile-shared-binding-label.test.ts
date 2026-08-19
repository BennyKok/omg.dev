/**
 * Guest-side shared-computer names. The manage screen and the picker both
 * read these helpers; the policy is "section is whose, row is which machine".
 */

import { describe, expect, test } from "bun:test";

import {
  sharedBindingBaseTitle,
  sharedBindingLabel,
  sharedComputerFirstName,
  sharedComputerPickerLabel,
  sharedComputerSubtitle,
  SHARED_REVOKED_DETAIL,
} from "../mobile/src/omg/computer-shared-binding";

const adaMac = {
  ownerUserId: "ada",
  bindingId: "bind-macbook-aa11bb",
  name: "Ada Lovelace",
  email: "ada@example.com",
  hostname: "MacBook",
  online: true,
};

const adaStudio = {
  ownerUserId: "ada",
  bindingId: "bind-studio-cc22dd",
  name: "Ada Lovelace",
  email: "ada@example.com",
  hostname: "studio",
  online: false,
};

const adaEmailOnly = {
  ownerUserId: "ada",
  bindingId: "bind-unknown-ee33ff",
  email: "ada@example.com",
  online: true,
};

describe("shared computer titles", () => {
  test("first-name possessive plus machine identity", () => {
    expect(sharedBindingLabel(adaMac)).toBe("Ada’s MacBook");
    expect(sharedBindingLabel(adaStudio)).toBe("Ada’s studio");
  });

  test("falls back to 'computer' when the share row has no machine name", () => {
    expect(sharedBindingLabel({ name: "Ada", email: "ada@example.com" })).toBe(
      "Ada’s computer",
    );
  });

  test("never possessivizes an email — title is Shared computer", () => {
    expect(sharedComputerFirstName(adaEmailOnly)).toBeNull();
    expect(sharedBindingBaseTitle(adaEmailOnly)).toBe("Shared computer");
    expect(sharedBindingLabel(adaEmailOnly)).toBe("Shared computer");
    expect(sharedBindingLabel({ ownerLabel: "ada@example.com", email: "ada@example.com" })).toBe(
      "Shared computer",
    );
    expect(sharedBindingLabel({ name: "ada@example.com", email: "ada@example.com" })).toBe(
      "Shared computer",
    );
  });

  test("two shares from one owner stay distinct when the API named the boxes", () => {
    const pair = [adaMac, adaStudio];
    expect(sharedBindingLabel(adaMac, pair)).toBe("Ada’s MacBook");
    expect(sharedBindingLabel(adaStudio, pair)).toBe("Ada’s studio");
  });

  test("two nameless shares from one owner get a short unique tail", () => {
    const one = { name: "Ada", email: "ada@example.com", bindingId: "bind-aaaa1111" };
    const two = { name: "Ada", email: "ada@example.com", bindingId: "bind-bbbb2222" };
    const pair = [one, two];
    const labels = [sharedBindingLabel(one, pair), sharedBindingLabel(two, pair)];
    expect(labels[0]).not.toBe(labels[1]);
    expect(labels[0].startsWith("Ada’s computer · ")).toBe(true);
    expect(labels[1].startsWith("Ada’s computer · ")).toBe(true);
  });
});

describe("shared computer subtitles", () => {
  test("named owner gets liveness, not Shared by Ada", () => {
    expect(sharedComputerSubtitle(adaMac)).toBe("Online");
    expect(sharedComputerSubtitle(adaStudio)).toBe("Offline");
  });

  test("email-only puts the address on the subtitle", () => {
    expect(sharedComputerSubtitle(adaEmailOnly)).toBe("ada@example.com");
    expect(sharedComputerSubtitle({ ...adaEmailOnly, online: false })).toBe(
      "ada@example.com",
    );
  });
});

describe("shared computer picker labels", () => {
  test("offline suffix is title-case Offline, matching Ready / Paused / Removed", () => {
    expect(sharedComputerPickerLabel(adaStudio, [adaMac, adaStudio])).toBe(
      "Ada’s studio — Offline",
    );
    expect(sharedComputerPickerLabel(adaMac, [adaMac, adaStudio])).toBe("Ada’s MacBook");
  });
});

describe("revoked-share copy", () => {
  test("the share-specific line is not a restatement of No longer available", () => {
    expect(SHARED_REVOKED_DETAIL).toBe("This computer is no longer shared with you.");
    expect(SHARED_REVOKED_DETAIL.toLowerCase()).not.toBe("no longer available");
  });
});
