# Required first read

Before inspecting or changing this project, read `migrate-to-rust.txt` in full.
Applies to every coding agent/model working anywhere in this repository.

- Work through the numbered steps in order; preserve completed-step invariants.
- Mark a step `[COMPLETED]` only after its changes and acceptance checks pass.
- Directly below its heading, add terse `Changes:`, `Verified:`, and `Keep:` notes
  with paths, functions, commands, and constraints needed by the next fix.
- Use `[IN PROGRESS]` for partial work; name remaining checks. Never claim an
  unrun check passed. Keep pending steps visible.
- Update `docs/verification.md` with evidence; keep `migrate-to-rust.txt` concise.
- Avoid unrelated rewrites. Preserve user data, public behavior, and existing
  safeguards. Run targeted verification before proceeding to the next step.
- When making small changes that literally require just checking an if-else
  condition or a for loop, do not write tests, run tests or make useless assumptions. Just edit the file.
