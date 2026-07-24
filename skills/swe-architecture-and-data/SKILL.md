# Architecture & data

## Architecture lane

- Prefer **boundaries** that match team ownership and change frequency.  
- Capture **non-functional requirements**: latency, durability, consistency, compliance.  
- Record **trade-offs** (what you gave up) not only the chosen option.  
- Keep diagrams **small and versioned** with the change that invalidates them.

## Data lane

- Treat schemas and pipelines as **contracts**: versioning, compatibility, and SLAs.  
- Define **data quality checks** at the boundary where cost of failure is lowest.  
- Document **lineage** at a useful granularity (source → transform → consumer).  
- Plan **backfills and replays** before declaring a pipeline “done.”

## Shared

- **YAGNI** for distributed patterns until load or org scale demands them.  
- Security and privacy by default: **least data**, **least retention**, **least privilege**.
