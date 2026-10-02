# Maintenance status

Version **3.0.0 is the final planned release** of npx-vibe. Active maintenance ends on October 2, 2026.

The npm package, public source, documentation, GitHub Action, and MCP implementation remain available under the MIT license. Ending maintenance does not unpublish existing releases or prevent you from using or forking them.

No further features, compatibility updates, bug fixes, or security patches are scheduled. Issues, pull requests, and private security reports may not receive a response. Do not rely on this project for a guaranteed security response or ongoing protection.

## Reproducible use

Pin the npm package to `3.0.0`, the Action to `v3.0.0` (or its commit SHA), and integrations to agent result schema `3`. Read [the migration guide](MIGRATING.md) before updating from an earlier release.

npx-vibe depends on external npm registry, GitHub, OSV, and optional model-provider services. Their availability, data, APIs, and model names can change independently of this frozen release. A completed scan is a bounded review, not proof of safety. Never treat an incomplete result as permission to execute.

## Continuing development

Forks are welcome. Use your own package name, MCP namespace, support contact, and publishing credentials. Preserve the MIT license and attribution, and make it clear that your fork has independent maintenance and support.
