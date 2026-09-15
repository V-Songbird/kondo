# Reload through a parameterless window lifecycle signal

The render-failure fallback must be able to reload the app, but a
page-initiated `window.location.reload()` cannot recover while the main window
unconditionally denies `will-navigate`.

## Considered options

- **Allow same-URL navigation.** Rejected: recovery does not need an exception
  to the navigation-denial policy or renderer-supplied destinations.
- **Parameterless lifecycle signal (chosen).** Expose `kondoReload` beside
  `kondoReady`, with a shared channel constant. The owning window listens on
  its own `webContents.ipc`, verifies the sender is its main frame, and calls
  `webContents.reload()` on those same contents. No workspace method is needed.

## Consequences

The renderer cannot choose another window, URL or file to load. The splash
has no reload listener; child frames cannot request a main-window reload.
Navigation denial, sandboxing, CSP and store confinement stay intact. Reload
recreates renderer state; it does not undo or assert recovery of mutations.
Fixture smoke verifies actual recovery; mocked Electron tests pin ownership,
frame restrictions and unchanged navigation denial.
