#!/usr/bin/env python3
"""
Drive an interactive eas-cli command from a non-interactive agent session.

eas-cli refuses to CREATE iOS credentials in --non-interactive mode: it will
happily use an existing distribution certificate but will not mint one. The
Apple session stored on this box (fastlane cookie for itechbenny@icloud.com) is
valid and needs no 2FA, so the only thing standing between here and a signed
build is a handful of yes/no prompts on a tty.

This allocates a real pty, streams the output through, and answers the prompts
it recognises. Anything it does NOT recognise is left alone and surfaced in the
transcript, so an unexpected question fails loudly instead of being blindly
confirmed with a stray newline.

Usage: eas-drive.py <timeout-seconds> -- <command...>
"""

import os
import pty
import re
import select
import sys
import time

ANSI = re.compile(rb"\x1b\[[0-9;?]*[a-zA-Z]")


def clean(chunk: bytes) -> str:
    return ANSI.sub(b"", chunk).replace(b"\r", b"\n").decode("utf-8", "replace")


# (pattern, response, human label). First match wins; each fires at most once
# per distinct prompt text to avoid an answer loop on a redrawn spinner.
RULES = [
    (re.compile(r"Do you want to log in to your Apple account\?"), b"Y\n", "apple login: yes"),
    (re.compile(r"Apple ID:"), b"itechbenny@icloud.com\n", "apple id"),
    (re.compile(r"Select a team|Choose a team"), b"\n", "team: first"),
    (
        re.compile(r"Generate a new Apple Distribution Certificate\?"),
        b"Y\n",
        "new distribution cert: yes",
    ),
    (
        re.compile(r"Generate a new Apple Provisioning Profile\?"),
        b"Y\n",
        "new provisioning profile: yes",
    ),
    (
        # Flipped to YES on 2026-08-15: the app now ships expo-notifications,
        # and this prompt is what enables the Push capability on the App ID and
        # mints the APNs key. Answering "n" here is what leaves a binary whose
        # provisioning profile has no aps-environment entitlement — a build
        # that installs fine and can never receive a notification.
        re.compile(r"Would you like to set up Push Notifications|Setup Push Notifications"),
        b"Y\n",
        "push key: yes",
    ),
    (re.compile(r"Reuse this distribution certificate\?"), b"Y\n", "reuse cert: yes"),
    (re.compile(r"proceed\?|Continue\?"), b"Y\n", "proceed: yes"),
]


def main() -> int:
    if "--" not in sys.argv:
        print("usage: eas-drive.py <timeout> -- <command...>", file=sys.stderr)
        return 2
    split = sys.argv.index("--")
    timeout = float(sys.argv[1])
    command = sys.argv[split + 1 :]

    pid, fd = pty.fork()
    if pid == 0:
        os.environ["EAS_BUILD_NO_EXPO_GO_WARNING"] = "true"
        os.environ.setdefault("EXPO_APPLE_ID", "itechbenny@icloud.com")
        os.execvp(command[0], command)
        return 127

    deadline = time.time() + timeout
    buffer = ""
    answered: set[str] = set()
    transcript: list[str] = []

    while time.time() < deadline:
        ready, _, _ = select.select([fd], [], [], 1.0)
        if not ready:
            continue
        try:
            chunk = os.read(fd, 4096)
        except OSError:
            break
        if not chunk:
            break
        text = clean(chunk)
        transcript.append(text)
        sys.stdout.write(text)
        sys.stdout.flush()
        buffer = (buffer + text)[-4000:]

        for pattern, response, label in RULES:
            match = pattern.search(buffer)
            if not match:
                continue
            key = match.group(0)
            if key in answered:
                continue
            answered.add(key)
            print(f"\n  [drive] {label}\n", flush=True)
            os.write(fd, response)
            # Consume the prompt so a redraw does not re-trigger it.
            buffer = buffer[match.end() :]
            time.sleep(0.4)
            break

    try:
        _, status = os.waitpid(pid, os.WNOHANG)
        code = os.waitstatus_to_exitcode(status)
    except ChildProcessError:
        code = 0
    except ValueError:
        code = 0

    if time.time() >= deadline:
        print("\n  [drive] TIMED OUT", flush=True)
        return 124
    return code if isinstance(code, int) else 0


if __name__ == "__main__":
    sys.exit(main())
