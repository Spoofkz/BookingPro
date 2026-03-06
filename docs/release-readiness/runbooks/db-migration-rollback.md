# Runbook: DB Migration Rollback

## Detection signals

- Errors immediately after migration deploy
- Query failures referencing missing/changed columns
- Latency spike due to locks or bad plans

## Triage

1. Identify migration ID and deployment timestamp
2. Check if migration is expand-only, reversible, or one-way
3. Determine if app rollback alone restores service compatibility

## Mitigation paths

### Preferred: Application rollback

1. Roll back to previous app artifact/tag
2. Enable kill switches for impacted features if needed
3. Validate critical endpoints

### Data rollback (rare)

1. Declare incident severity and blast radius
2. Freeze writes if required
3. Restore from backup according to Ops policy
4. Reconcile lost writes manually

## Communication template

- "A schema deployment caused service degradation. We have rolled back the application and are stabilizing the database path. Feature availability may be temporarily reduced."

