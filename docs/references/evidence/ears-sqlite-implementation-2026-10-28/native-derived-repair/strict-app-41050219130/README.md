# Original app failure on the preceding maintenance checkpoint

Run [41050219130](https://github.com/spankyed/apack/actions/runs/41050219130), source
`4903c50a4a39bba91c8dff495d54764e1472ff18`, job `124049776401` app-and-rest.
The three SQLite platform jobs pass, but this required app shard fails. It is not full-strict green.

All 27 external-pack tests pass. The bundled-ui fixture then fails its unchanged assertion: after
`editor.fill('Bundled editor typed')`, `scribbles-text` remains `Bundled editor` for five seconds.
The captured console error array is empty. The original test trace and completed job log are retained;
binary trace archives/screenshots remain private. This trace lacks DOM/ProseMirror document state, so it
does not establish cause. Neither an increased timeout nor a rewritten success assertion is justified.

Failure-only DOM/document/initialization diagnostics are added to the same fixture and typechecked/linted;
a focused app diagnostic run is still required after publication. The fixture uses the normal default
storage composition, so this is not evidence of SQLite installed UI acceptance. The failure remains open.
Other live jobs and the separately queued audit checkpoint are preserved rather than restarted.
