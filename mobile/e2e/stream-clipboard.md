# Clipboard stream proof

This plan tests the production full Computer and sign-in DOM viewers, real
native clipboard actions, a real RFB bridge and the UTF-8 clipboard handler.
Its Linux browser is a synthetic fixture; no customer account is required.

On the Linux host, reserve these ports and start each command separately:

```sh
Xvfb :186 -screen 0 800x600x24 -nolisten tcp
x11vnc -display :186 -localhost -rfbport 5996 -shared -forever -nopw -noxdamage
DISPLAY=:186 google-chrome --no-first-run --no-default-browser-check --remote-debugging-port=19386 --user-data-dir="$HOME/.cache/lfg/tmp/clipboard-test-chrome" --window-size=800,600 http://localhost:19080/fixture
bun scripts/stream-clipboard-fixture.ts
ssh -N -R 19080:127.0.0.1:19080 bennykok@bennys-macbook-pro-2
```

The fixture reloads Chrome when ready. Use a dedicated simulator, pin its name
with `OMG_SIM_DEVICE`, and build the fixture entry on the Mac:

```sh
cd mobile
OMG_SIM_DEVICE=YOUR_DEDICATED_SIMULATOR \
OMG_E2E_REMOTE_SRC=.omg-e2e-clipboard \
OMG_E2E_ENTRY_FILE=scripts/stream-clipboard-e2e-entry.tsx \
bun run test:e2e --build --plan stream-clipboard --record
```

The plan must open each viewer before checking paste and copy. The native
header verifies exact multiline Unicode text against the remote textarea and
the device clipboard. Copy verification is armed only after selecting remote
text, so preparing the device clipboard cannot count as a successful copy.
Allow the real iOS paste prompt when it appears. Stop the isolated desktop,
fixture, tunnel and dedicated simulator after the run.
