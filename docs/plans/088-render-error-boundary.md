# Plan: Render failure recovery

Status: **done — verified locally; awaiting user acceptance**

A descendant render failure currently unmounts App and leaves an empty window.
Task 088 adds a last-resort renderer fallback with the error message, the
build-stamped application version and a keyboard-accessible reload action.

## Scope

- Wrap App in a React error boundary in `src/main.tsx`.
- Keep the native drag strip, Signal theme tokens and existing `band-pencil`
  error treatment. Focus the failure heading and expose the error as an alert.
- Normalize unknown thrown values defensively and render them as text.
- Extend fixture smoke to check a populated root after the initial scan,
  exercise an actual descendant render throw and recover with keyboard reload.

## Out of scope

Event-handler and asynchronous failures keep their existing handling. Reload
does not imply rollback or recovery of store mutations. No new data bridge, disk
access, network calls, runtime dependencies or production crash switch.

## Decisions

| Decision | Rationale |
| --- | --- |
| Use `getDerivedStateFromError` above App | A failed descendant can be replaced without depending on its state. |
| Reuse `__KONDO_VERSION__` | The same package version already identifies the running app. |
| Use the existing error band and theme tokens | The prompt's older style description now belongs to the Signal system. |
| Inject a synthetic input event only through CDP test code | Exercises the real App boundary without shipping a crash API. |
| Identify the intentional caught-error console event by object identity | Unexpected exceptions, console errors and requests must still fail smoke. |

## Seam changes

The fallback uses the existing renderer-ready notification so an early render
failure can hand over from the splash. Desktop verification showed that the
navigation-denial handler prevents `window.location.reload()`. Add a separate,
parameterless `kondoReload` lifecycle signal beside `kondoReady`, handled only
by the owning main window's main frame. Main reloads its existing contents;
it accepts no URL or path. Preserve unconditional navigation denial and test
the owning-window/main-frame restriction (ADR-0014).

## Tests and acceptance checklist

- [x] `npm test`: normalization, safe fallback markup and normal children;
  real descendant catching is covered by Electron smoke, not server rendering.
- [x] `npm run typecheck`: strict TypeScript.
- [x] `npm run lint`: existing lint policy.
- [x] `npm run build`: build for fixture desktop checks.
- [x] `npm run test:e2e`: populated startup, controlled render failure,
  message/version/alert/focus, keyboard reload, light/dark at both window sizes,
  unchanged fixture stores/journal, and retained renderer health gates.
- [x] `git diff --check`: clean whitespace and required documentation.

## Observed result

On Windows, 477 unit tests passed; five existing file-symlink cases skipped
because the environment refused symlink creation. All 18 desktop smoke tests
passed against synthetic stores. The two deliberate render failures produced
the expected alert, escaped message, package version and focused heading;
Tab/Enter reloaded into a populated Library without changing fixture stores or
journal bytes. Screenshots inspected in Chalk and Carbon at both window sizes
show wrapped error text, an unclipped action and visible focus. Renderer health
checks remained active through reloads and process relaunch.

The final scope includes the window lifecycle signal described above, its
mocked ownership/security test, and enabling JSX in the test TypeScript project
so the renderer component's static tests can use the app project reference.
The fallback follows the current Signal design while retaining `band-pencil`.
Screen-reader announcements and macOS/Linux desktop behavior were not tested.

## Done when

An App render failure displays a readable, accessible recovery screen; its
reload button starts a populated application again against the synthetic
fixture. Required checks pass and the result is ready for user acceptance.
