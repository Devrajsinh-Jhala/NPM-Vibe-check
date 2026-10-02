# Security policy

## Reporting a vulnerability

Please do not open a public issue for an unpatched vulnerability that could put users at risk.

Report security concerns through GitHub's private vulnerability reporting feature:

https://github.com/Devrajsinh-Jhala/NPM-Vibe-check/security/advisories/new

Include the affected version, a minimal reproduction, expected impact, and any suggested mitigation. Active maintenance has ended; reports may not receive a response or a patch. Do not depend on a guaranteed remediation timeline.

## Supported versions

Version 3.0.0 is the final planned release. No versions receive scheduled security fixes. See [the maintenance policy](MAINTENANCE.md) before relying on this tool in a security-sensitive workflow.

## Security boundary

`npx-vibe` is a pre-execution risk scanner, not a sandbox or proof that a package is safe. It inspects bounded metadata and selected tarball content. It cannot guarantee detection of every malicious behavior, runtime-only payload, compromised dependency, conditional branch, or delayed network response.

By default, package install scripts are ignored during execution. Online AI review is opt-in and receives only bounded package metadata, findings, install scripts, and selected files from the downloaded package tarball.

Local review memory is keyed by verified package integrity and stores only package/version identifiers, hashes, finding identifiers, verdicts, and limited model metadata. It does not store package source, API keys, environment values, npm tokens, or project files. Review memory never skips fresh tarball verification or deterministic scanning.

AI findings are matched back to inspected source excerpts before they are displayed as source-backed evidence. Unsupported AI claims cannot independently elevate a verdict to Block.
