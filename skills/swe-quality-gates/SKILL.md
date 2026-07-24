# Quality gates

## Test design

- Align cases to **acceptance criteria** and **risk** (happy, edge, abuse).  
- Prefer **deterministic** data; document seeds or fixtures.  
- Capture **evidence**: steps, expected vs actual, logs, screenshots when UI.

## Release readiness

- [ ] Critical paths pass on **target environment**  
- [ ] **Monitoring** and alerts cover new failure modes  
- [ ] **Runbooks** updated for operators  
- [ ] **Rollback** validated or timeboxed

## When to block

- Data loss or corruption risk without mitigation.  
- Security regression with plausible exploit path.  
- Broken **contract** with external consumers.
