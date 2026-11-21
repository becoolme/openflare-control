# Security

This project is a single-owner control plane, not a hostile multi-tenant
boundary. The trust model and its limits are documented in
[docs/architecture.md](docs/architecture.md) and the README.

Please report vulnerabilities privately (GitHub Security Advisories on this
repository) instead of opening a public issue. Include:

- affected version/commit,
- a minimal reproduction (route, input, observed vs expected),
- whether a cell token or signing secret is required.

Do not include real tenant data, tokens or signing keys in a report. We aim to
acknowledge within 72 hours.

Deployment expectations: run the plane on a private network, expose it only to
the cells (NetworkPolicy / private ingress), and terminate TLS in front of it.
The reference plane has no per-tenant rate limiting or user authentication by
design — it is a single-owner service.

Hardening expectations:

- Cells authenticate with a bearer token compared in constant time.
- Desired documents are Ed25519-signed over canonical JSON; cells verify
  signature, scope, revision fence, digest and expiry, and fail closed.
- Bundle bytes are served only for digests referenced by a retained
  publication (no existence oracle).
- Secrets never enter the desired document; they are served only through the
  authenticated render-inputs endpoint.
