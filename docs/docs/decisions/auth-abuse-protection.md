---
title: Auth abuse protection
description: Lockout, password policy, token lifespans, refresh token rotation and account enumeration.
---

# Auth abuse protection

Settings in the Keycloak realm that limit guessing, flooding and finding out
who has an account.

## Brute force: temporary lockout only

After 5 wrong passwords in a row the account is locked for one minute. The
wait grows with each further block of failures and never exceeds 15 minutes.

**Never a permanent lock.** A permanent lock would let anyone lock any user
out for good just by guessing, and only an admin could undo it. The 15 minute
cap bounds the lockout an attacker can force on a victim.

Lockout per user does not stop one password tried across many accounts. A
rate limit per client address covers that at the edge of a deployed setup.

## No account enumeration

Login, forgot password and a locked account all answer the same for known and
unknown emails. Keycloak's "account is temporarily disabled" text is replaced
by the wrong-password text, because otherwise two quick guesses would reveal
whether an email has an account.

Two places deliberately still tell:

- **Registration says "Email already exists".** Hiding it would need a custom
  Keycloak extension. Accepted, and bounded by a rate limit.
- **The "account exists" page after a social login.** It shows only to someone
  who just proved they own that email at Google or GitHub.

## Password policy

At least 8 characters, and not equal to the username or email.

## Lifespans

| What | Lifespan | Why |
| --- | --- | --- |
| Access token | 5 minutes | The gateway refreshes it out of sight, so a short token costs nothing. |
| SSO session idle / max | 30 minutes / 10 hours | Same as the gateway session timeouts. |
| Reset link | 15 minutes | Long enough for mail delay, short enough to bound misuse. |

## Refresh token rotation: off

This one is counter to common advice, and it was decided by test. With
rotation on and several requests arriving at token expiry, all but one failed,
because Keycloak rejects a reused refresh token. With it off, all succeeded.

Rotation mainly protects public clients, where the refresh token sits in a
browser or app. Here it never leaves the gateway and Redis, and using it also
needs the client secret. To be revisited if tokens ever leave the server.

## Accepted gap: older reset links

Keycloak checks each reset link on its own. If a user requests two, the older
unused one still works until it expires. Only someone with that older mail
can use it, for at most 15 minutes. A check pins that bound.

## Checked by

`./verify attacks` runs each attack and passes when the attack fails safely:
enumeration, credential stuffing, lockout, password policy, link reuse,
expired links and older links. Table:
[Forgot password and verify](https://github.com/vandatnguyen919/playaround/blob/main/README.md#forgot-password-and-verify).

Full text, with every value:
[Auth abuse protection in PRODUCT.md](https://github.com/vandatnguyen919/playaround/blob/main/PRODUCT.md#auth-abuse-protection).
