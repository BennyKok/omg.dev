#!/usr/bin/env python3
"""
Open `eas credentials -p ios` and print the menus WITHOUT changing anything.

Read-only by design: it sends only Enter/arrow keys along a caller-supplied
path and never types a value, so it can answer "what does EAS already hold for
this account?" without provisioning something as a side effect.

Usage: eas-peek.py <seconds> [keys...]
  keys: "down", "up", "enter", or literal text to send
"""

import os
import pty
import re
import select
import sys
import time

ANSI = re.compile(rb"\x1b\[[0-9;?]*[a-zA-Z]")
KEYS = {
    "down": b"\x1b[B",
    "up": b"\x1b[A",
    "enter": b"\r",
    "esc": b"\x1b",
    # Answers for (Y/n) confirmations. Named rather than passed as bare "y"/"n"
    # so a stray literal can never reach a free-text field — the credential
    # guard below still runs first regardless.
    "yes": b"y\r",
    "no": b"n\r",
}

# Prompts this script must never answer.
#
# This is not hypothetical. On 2026-08-12 a run passed literal "y" tokens as
# steps, eas-cli asked for an Apple ID, and the "y" was typed into it — turning
# a prefilled itechbenny@icloud.com into "y", then sending "y" as the password.
# Apple answered -20209 (account locked) and the bogus id was persisted to
# ~/.app-store/auth/username.json.
#
# So: bail out instead of sending anything at a credential prompt. A read-only
# explorer has no business near these fields, and "it only sends arrow keys"
# was not actually true of the arbitrary-text escape hatch.
CREDENTIAL_PROMPT = re.compile(
    r"Apple ID\s*:|Password\s*(\(for[^)]*\))?\s*:|Verification code|"
    r"Two-factor|Username\s*:|Secret|Token\s*:",
    re.I,
)


def clean(chunk: bytes) -> str:
    return ANSI.sub(b"", chunk).replace(b"\r", b"\n").decode("utf-8", "replace")


def main() -> int:
    timeout = float(sys.argv[1])
    steps = sys.argv[2:]

    pid, fd = pty.fork()
    if pid == 0:
        os.environ["EAS_BUILD_NO_EXPO_GO_WARNING"] = "true"
        os.execvp("npx", ["npx", "eas-cli@latest", "credentials", "-p", "ios"])
        return 127

    deadline = time.time() + timeout
    step = 0
    quiet_since = time.time()
    tail = ""

    while time.time() < deadline:
        ready, _, _ = select.select([fd], [], [], 0.5)
        if ready:
            try:
                chunk = os.read(fd, 4096)
            except OSError:
                break
            if not chunk:
                break
            text = clean(chunk)
            sys.stdout.write(text)
            sys.stdout.flush()
            tail = (tail + text)[-500:]
            quiet_since = time.time()
            continue

        # Output has settled — the menu is fully drawn, so advance one step.
        if time.time() - quiet_since > 1.5 and step < len(steps):
            if CREDENTIAL_PROMPT.search(tail):
                print(
                    "\n  [peek] STOPPING: a credential prompt is on screen.\n"
                    "  This script does not answer those. Nothing was sent.\n",
                    flush=True,
                )
                break
            key = steps[step]
            payload = KEYS.get(key)
            if payload is None:
                print(
                    f"\n  [peek] REFUSING to type literal text {key!r}.\n"
                    "  Only down/up/enter/esc are allowed — free text is how the\n"
                    "  2026-08-12 Apple-ID incident happened.\n",
                    flush=True,
                )
                break
            print(f"\n  [peek] send {key}\n", flush=True)
            os.write(fd, payload)
            step += 1
            quiet_since = time.time()

    os.write(fd, b"\x03")  # Ctrl-C, leave nothing running
    time.sleep(0.3)
    try:
        os.kill(pid, 9)
    except ProcessLookupError:
        pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
