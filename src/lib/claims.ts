/**
 * Product claims stated in more than one place, kept in one spelling.
 *
 * A refusal a user meets on four screens has to read the same on all four, or
 * the four become four different promises. These are renderer copy — a
 * decision this build carries, not a fact read out of a store — so they never
 * cross the seam. Main states its own refusals in its own words, and the
 * capability matrix remains the authority on what a channel will accept.
 */

/**
 * ADR-0010 and entry 098: every plan holding a `write` or `splice` step is
 * refused before any store effect, on every platform. A control that would
 * write a settings file is therefore disabled and says so here, rather than
 * looking available and refusing after the click.
 */
export const SETTINGS_WRITES_SUSPENDED =
  'Kondo does not change settings files yet: it cannot rule out losing a change Claude saves at the same moment. Edit the settings file yourself.'

/**
 * ADR-0021 and decision 107. Kondo resolves precedence over the settings
 * files it reads — the user file, and the project and local files under
 * verified projects — and over two fields only. Managed policy, command-line
 * and supplied settings, live session state and Claude's own defaults are not
 * read, so a source kondo cannot see may still decide the answer.
 */
export const SETTINGS_SOURCES_READ =
  'Kondo compares only the settings files it reads: local, then project, then user. It does not read managed policy or command-line settings, so a source it cannot see may still decide.'

/**
 * ADR-0016. Kondo manages selected Claude Code transcripts. The desktop app
 * contributes local store metadata and filename ID matches, and nothing else:
 * there is no desktop browsing or removal, a match does not compare contents,
 * and a missing match says nothing about what the desktop app holds.
 */
export const CODE_TRANSCRIPTS_ONLY =
  'These are Claude Code conversations saved on this machine. Kondo does not list or remove Claude desktop app conversations.'
