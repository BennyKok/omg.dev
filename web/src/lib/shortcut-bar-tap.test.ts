import { afterEach, describe, expect, test } from "bun:test";
// Installs the happy-dom globals before the module under test is loaded.
import "../test-support/render";
const { composerFieldForTap } = await import("./shortcut-bar");

function composer(extra = "") {
  document.body.innerHTML = `
    <form data-lfg-bar-lift="">
      <div class="bar"><span class="pad">x</span><textarea></textarea>
        <button type="button"><svg class="icon"></svg></button>
        <a href="#">link</a>
      </div>
    </form>
    <textarea class="other"></textarea>
    ${extra}`;
  return {
    field: document.querySelector("form textarea") as HTMLTextAreaElement,
    pad: document.querySelector(".pad")!,
    icon: document.querySelector(".icon")!,
    link: document.querySelector("a")!,
    other: document.querySelector(".other") as HTMLTextAreaElement,
  };
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("composerFieldForTap", () => {
  test("a tap on the composer's padding or its field focuses the field", () => {
    const { field, pad } = composer();
    expect(composerFieldForTap(pad)).toBe(field);
    expect(composerFieldForTap(field)).toBe(field);
  });

  test("buttons and links inside the composer keep their own taps", () => {
    const { icon, link } = composer();
    expect(composerFieldForTap(icon)).toBeNull();
    expect(composerFieldForTap(link)).toBeNull();
  });

  test("a field outside the composer is left to the browser", () => {
    const { other } = composer();
    expect(composerFieldForTap(other)).toBeNull();
  });

  test("a field that already has focus keeps native caret placement", () => {
    const { field } = composer();
    field.focus();
    expect(composerFieldForTap(field)).toBeNull();
  });

  test("a disabled field is left alone", () => {
    const { field, pad } = composer();
    field.disabled = true;
    expect(composerFieldForTap(pad)).toBeNull();
  });
});
