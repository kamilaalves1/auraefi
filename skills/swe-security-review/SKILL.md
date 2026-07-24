# Security review

## Scope

- **AuthN/AuthZ** paths: session handling, token storage, privilege checks.  
- **Input** validation and output encoding; injection surfaces.  
- **Secrets**: no hardcoding; rotation and least privilege.  
- **Dependencies**: known CVE posture; pin or justify drift.

## Method

1. Identify **assets** (data, keys, admin actions).  
2. List **threats** (spoofing, tampering, repudiation, information disclosure, DoS, elevation).  
3. Map **controls** already present vs gaps.  
4. Rate **severity** with exploitability + impact.

## Reporting

- **Repro** or code pointer for each finding.  
- **Fix** suggestion proportional to risk.  
- **No destructive testing** without written approval.
