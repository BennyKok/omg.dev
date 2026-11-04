# Remote access

omg.dev runs cloud Computers. Open https://app.omg.dev to use yours.

Connecting a personal machine through the hosted relay was removed after
IR-2026-11-01. `omg connect` exits with a retirement message. The local runtime
continues to work on localhost. No background relay worker starts with serve.

An installed older binary must be updated or stopped on its own machine.
It can ignore a 410 from the retired regions route and continue to retry.
