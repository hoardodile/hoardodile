# Security policy

Hoardodile plugins run as **server-side code** inside the app's restricted
plugin sandbox — treat a plugin like any third-party dependency: only publish
or install from sources you trust. The manifest declares the capabilities the
sandbox grants; installs require explicit user consent.

## Reporting a vulnerability

Please report security issues **privately** — do **not** open a public issue,
pull request or discussion that reveals the details.

1. Open the repository's **Security** tab on GitHub.
2. Click **Report a vulnerability** to create a private advisory.
3. Include the affected hoardodile and plugin versions, a description of the
   vulnerability, reproduction steps and any proof of concept.

Private advisories stay invisible to the public until you publish the fix; we
coordinate the disclosure timeline with you before anything goes public.

## What counts as a security issue

Anything that lets a crafted resource or plugin install break out of the
plugin sandbox, escape the plugin's vault, or read/delete data outside the
plugin's own scope. For usage questions and non-security bugs use the issue
templates instead.
