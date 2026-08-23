# Security Policy

Hoardodile is a privacy-first, self-hosted archiving app. Your data stays on your own storage, under your control — security is a core part of that promise.

## Supported versions

Only the latest release is supported. Versions below the current release do not receive security backports — this is a pre-1.0 project, and the fix always ships with the next release.

## Reporting a vulnerability

Please use GitHub's private security advisory flow:

1. Open this repository's **Security** tab.
2. Select **Report a vulnerability** to create a private advisory.
3. Publish the report — it is not publicly visible until you choose to.

Reports are never accepted via public issues. There is no external email address; the advisory is the only, canonical channel.

Please include in your report:

- The release tag (e.g. `v0.1.0`) or commit hash you are running.
- The operating system and how it is deployed (web, desktop, Docker, etc.).
- Steps to reproduce and the observed impact.
- A suggested fix is welcome but not required.

**Never include content from your library, its URLs, or other stored data** — those are private by design and will be redacted otherwise.

## What to expect

- The report is acknowledged as soon as possible.
- Details are not disclosed publicly before a fix ships — no partial disclosures, no grace-period posting.
- The fix ships in the next release (see README for release channel).
- If you want, credit for the report will be given in the advisory and release notes.

## Scope

**In scope**

- Remote code execution
- Authentication bypass, privilege escalation, SQL injection
- Path traversal or filesystem access outside the storage root
- Sandbox escape via imported content (plugins, documents, media)
- Disclosure of private library data
- Electron shell issues (arbitrary code execution, broken isolation)

**Out of scope**

- Missing hardening or security features
- Plugin-specific defects (file a bug report instead)
- Misconfiguration by the library administrator
- Dependencies with no upstream fix (CVE already published upstream)
- Self-inflicted issues from running untrusted code outside the sandbox
- DoS in a single-user local deployment
