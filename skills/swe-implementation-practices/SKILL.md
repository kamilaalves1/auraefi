# Implementation

## Delivery

- **Small PRs** with a single narrative; link issue or ticket id.  
- **Feature flags** or config toggles for risky behavior.  
- **Rollback story**: what fails first, how to revert, what data migrates.

## Testing

- Test **behavior users rely on**, not implementation details—unless stability demands it.  
- Add **regression** when fixing bugs: fail first, then fix.  
- Document **manual test** steps when automation is not worth it yet.

## Code review

- Call out **correctness**, **security**, **observability**, and **maintainability**.  
- Prefer suggestions with **examples**; avoid style debates—use formatter/linter.  
- Approve with **explicit risks** noted if shipping under pressure.
