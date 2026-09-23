# Locking down company phones

Three layers protect a company-owned driver phone. They are not alternatives —
each covers what the one before it cannot.

| Layer | Stops | Does not stop |
| --- | --- | --- |
| Device admin (in the app) | Casual and accidental uninstall | A driver who revokes rights in Settings |
| Fully managed enrolment | Uninstall, entirely | A phone switched off or left at home |
| Device status reporting | Nothing — it tells you | Nothing |

## Layer 1 — Device admin (already in the app)

The app registers as a device administrator. While those rights are active,
Android refuses to uninstall it: long-pressing the icon offers no uninstall
option, and Settings blocks it too.

**This is a speed bump, not a lock.** The rights can be revoked from
**Settings → Security → Device admin apps**, after which uninstall proceeds
normally. Android shows a warning first, written to say plainly that the phone
is company property and that removal will be reported.

Drivers are prompted to enable it. Nothing forces them to, so treat it as
hygiene rather than enforcement — and check the reported status (layer 3)
rather than assuming it was granted.

## Layer 2 — Fully managed enrolment

This is the only configuration where uninstall is genuinely impossible. The
device is owned by a management profile rather than by its user, so the app is
installed as policy and cannot be removed, and settings that would interfere
can be locked.

It requires a **factory reset** of each phone. It cannot be applied to a phone
already set up, which is why it has to be planned rather than retrofitted.

### What you need

- A Google Workspace or free **Android Enterprise** account
- An EMM/MDM that supports fully managed devices. Google's own
  [Android Management API](https://developers.google.com/android/management) is
  free; hosted tools such as Headwind MDM (open source), Scalefusion or Hexnode
  are quicker to set up.

### Enrolment, in outline

1. Create an enterprise in your chosen EMM and define a policy.
2. In the policy, add the driver app as a **required** install, and set
   `installType: FORCE_INSTALLED` — this is what blocks removal.
3. Generate an enrolment token, which the EMM renders as a QR code.
4. On a **factory-reset** phone, tap the first setup screen six times to open
   the QR scanner, then scan the token.
5. The phone completes setup as fully managed and installs the app
   automatically.

### Worth setting in the same policy

- **Kiosk / lock task mode** — pins the phone to the driver app alone. Strong
  anti-theft, and it stops the company phone being used for anything else.
- **Disable factory reset** — otherwise a reset removes management and the app
  with it, which is the obvious way around all of this.
- **Disable safe mode** — safe mode can bypass some device-admin behaviour.
- **Remote lock and wipe** — the actual answer if a phone is stolen.
- **Disable app installation from unknown sources.**

## Layer 3 — Status reporting (already in the app)

Prevention that you cannot verify is not prevention. Every phone reports
whether it still blocks uninstall, and the moment device-admin rights are
revoked is recorded on the device and sent on the next successful sync — it
survives being done deliberately while offline.

Two things to watch:

- **`uninstallBlocked: false`** on a phone that should be protected. Either the
  driver never granted the rights, or they revoked them.
- **A phone that stops reporting entirely** during hours it should be active.
  That covers the cases prevention cannot: app removed, phone off, phone left at
  home.

## Telling drivers

Company phones being managed and tracked — including outside shift hours, since
vehicles go home with drivers — should be stated directly rather than
discovered. The app is visible about it: a permanent notification reads
"Recorded while you are signed in. Sign out to stop."

This is worth doing on its own terms, and also because the alternative is
someone quietly disabling what they were not told about, which is the outcome
all of the above exists to prevent.
