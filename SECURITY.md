# Security policy

## Reporting a vulnerability

Please do not open a public issue for an unpatched vulnerability that could put users at risk.

Report security concerns through GitHub's private vulnerability reporting feature:

https://github.com/Devrajsinh-Jhala/NPM-Vibe-check/security/advisories/new

Include the affected version, a minimal reproduction, expected impact, and any suggested mitigation. Reports will be acknowledged as quickly as possible and handled before public disclosure when the issue is confirmed.

## Supported versions

Security fixes are provided for the latest published version of `npx-vibe`.

## Security boundary

`npx-vibe` is a pre-execution risk scanner, not a sandbox or proof that a package is safe. It inspects bounded metadata and selected tarball content. It cannot guarantee detection of every malicious behavior, runtime-only payload, compromised dependency, conditional branch, or delayed network response.

By default, package install scripts are ignored during execution. Online AI review is opt-in and receives only bounded package metadata, findings, install scripts, and selected files from the downloaded package tarball.
