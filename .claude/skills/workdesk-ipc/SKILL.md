---
name: workdesk-ipc
description: Add or change a call between the WorkDesk renderer and main process (IPC). Use when a UI feature needs new data or an action from main.
---

A call lives in four places; touch all of them:

1. `src/shared/api.ts`: the method on the `WorkDeskApi` interface, and its channel name in the `IPC` table (e.g. `setTodoResolved: 'todos:resolve'`).
2. `src/preload/index.ts`: `name: (...a) => ipcRenderer.invoke(IPC.name, ...a)`.
3. `src/main/index.ts`: `ipcMain.handle(IPC.name, (_e, ...a) => service.name(...a))`.
4. The logic: keep it **pure in `src/main/domain/`** with a `*.test.ts` next to it; the service only wires it to files, git or the network.

Push events (main to renderer) follow the existing `onXxx(listener): () => void` pattern in `api.ts`.
Errors reach the renderer as `Error invoking remote method '…': Error: msg`; strip it with the `cleanError` helper.
Finish with the `workdesk-check` skill.
