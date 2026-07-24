# Release & operations

## Delivery

- **Pipeline as product**: fast feedback, clear ownership, reproducible builds.  
- **Progressive rollout**: canary, feature flags, or blue/green when impact warrants.  
- **Secrets** via managed stores; rotate and audit access.

## Observability

- **Metrics** for golden signals (latency, traffic, errors, saturation) where applicable.  
- **Structured logs** with correlation ids across services.  
- **Tracing** on critical paths when latency debugging is frequent.

## Operations

- **Runbooks** for start/stop, fail-over, and common incidents.  
- **Backups** tested on restore, not only on creation.  
- **Change records**: what changed, why, and how to revert.
