# Plan: Plugin installation key diagnostics

Status: **in progress**

`readPluginInventory` (`electron/main/workspace/user-store.ts:520` at `a48ccdf`)
reported an incomplete `installed_plugins.json` entry as `Incomplete plugin
installation entry for <key>` even when the key failed the
`<name>@<marketplace>` grammar. Such a key is arbitrary file text, and
`Scan.errors` carried it to the renderer. Plan 117 left this as a follow-up of
[ADR-0022](../adr/0022-project-settings-data-deny-by-default.md).

## Scope

- Name the key only when it matches `PLUGIN_KEY`: a plugin id is an identity
  ADR-0002 and ADR-0008 already publish. Any other key gets a fixed sentence that
  still says the entry is incomplete and that absence cannot be established.
- The other `readPluginInventory` diagnostics carry no file text: read failures
  describe the exception for Kondo's own path, JSON syntax errors use the fixed
  sentence from 117, and the object and version checks are fixed sentences. They
  stay unchanged.
- Completeness and cleanup semantics stay unchanged: a malformed key still
  leaves the inventory partial, so absence remains unprovable (100).

## Out of scope

- `scanPlugins` still displays a declared `installPath`, including one that
  escapes the store, as the manifest's own record of the install.
- Renderer changes: none.

## Tests

`test/user-store.test.ts` writes a synthetic manifest with a valid plugin, a
malformed sentinel key and a well-formed key with invalid installations. The
inventory stays partial, the malformed key gets the fixed sentence and the
well-formed one is named. The serialized `pluginsList` envelope lacks the
sentinel and still lists the valid plugin.

## Done when

A malformed installation key never appears in a scan diagnostic, a well-formed
plugin id still does, and inventory completeness is unchanged.
