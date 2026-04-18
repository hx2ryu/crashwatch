# Playbooks

Playbooks are short, vendor-neutral write-ups of common crash categories: typical symptoms, first-pass diagnostics, and remediation patterns. They are intended to be **reused across projects**; there are no company or app specifics here.

Planned entries:

- `native-oom.md` — native-heap exhaustion, image-decoder leaks, Android low-memory killer
- `anr-main-thread.md` — ANRs due to blocking work on the UI thread
- `rn-bridge.md` — React Native / Hermes crash patterns
- `network.md` — transport-level exceptions (DNS, timeout, TLS)
- `third-party-sdk.md` — crashes from vendored SDKs
- `cold-start-npe.md` — null-pointer exceptions during app init

Contributions welcome. Guidelines for new playbooks:

1. Describe the **symptom pattern** in stack-frame / regex form so a detector can match it.
2. List **first-pass diagnostics** as a checklist.
3. Give **two or three canonical remediations**, ranked by effort vs impact.
4. Link upstream references (AOSP docs, framework bug trackers) rather than company-internal systems.
