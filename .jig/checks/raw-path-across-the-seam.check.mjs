// jig:owned — authored for kondo.
//
// ADR-0008: ids cross the seam, never paths. A channel that accepts a path lets a
// renderer bug — or a compromised renderer — name any file on the machine, which
// is exactly the power the sandbox exists to withhold.
//
// Scoped to the two seam files. Display paths in shared/contract.ts are fine: they
// travel outward, already tildified, and no handler reads them back.

export const id = "raw-path-across-the-seam"
export const title = "A filesystem path crossing the IPC seam"
export const severity = "safety"
export const confidence = "deterministic"

export const deny = {
  "reason": "The seam accepts ids, never filesystem paths (ADR-0008). A path parameter here hands the renderer the power to name any file on disk.",
  "alternative": "Give the entity a composite id (kind:scope:key), send that, and resolve it in the workspace against the current scan — the pattern every existing channel already follows.",
  "override": "Set .jig/off for one pass, or retire the guard via /jig:review if ADR-0008 is superseded."
}

const params = {
  paths: ["electron/preload/**/*.ts","electron/main/ipc.ts"],
  patterns: ["[A-Za-z_$]*(?:Path|Dir|Filename)\\s*:\\s*(?:string|unknown)","\\bfrom\\s+[\"']node:fs[\"']"],
  stripComments: true,
  stripStrings: false,
  perLine: true
}

export const detectors = [
  { runner: "checks", lever: "check-driver", actor: "human-editor", confidence: "deterministic", params },
  { runner: "PostToolUse", lever: "edit-observe-guard", actor: "claude-session", confidence: "deterministic", params }
]

export const fixtures = {
  violation: "import fs from 'node:fs'\nimport { contextBridge, ipcRenderer } from 'electron'\n\nconst api = {\n  readTranscript: (filePath: string) => ipcRenderer.invoke('kondo:read', filePath),\n  listStore: (dirPath: unknown) => ipcRenderer.invoke('kondo:list', dirPath)\n}\n\ncontextBridge.exposeInMainWorld('kondo', { ...api, local: fs })\n",
  nearMiss: "import { channels, type KondoApi } from '../../shared/contract'\n\n// Ids cross the seam; a path never does (ADR-0008).\nexport function register(\n  handle: (channel: string, fn: (id: string) => unknown) => void,\n  api: KondoApi\n): void {\n  handle(channels.sessionDetail, (sessionId: string) => api.sessionDetail(sessionId))\n  handle(channels.sessionList, (projectId: string) => api.sessionList(projectId))\n}\n"
}
