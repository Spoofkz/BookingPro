# Runbook: Security Incident Response (Account Compromise)

## Detection signals

- User reports unauthorized activity
- Repeated failed logins then suspicious success
- Unusual admin actions in audit logs

## Triage

1. Identify affected user/admin account(s)
2. Review auth session history and audit logs
3. Scope actions performed (bookings, refunds, suspensions, etc.)

## Immediate mitigation

- Revoke all sessions for affected account(s)
- Suspend compromised account if needed
- Rotate admin credentials / enforce reset path
- Review platform admin actions for abuse

## Containment

- If platform admin account compromised, consider temporary admin route access restrictions
- Enable targeted feature kill switches if abuse touches booking/reschedule/promos

## Communication template

- "We detected suspicious account activity and have revoked active sessions while investigating. Some actions may be temporarily restricted as a safety measure."

