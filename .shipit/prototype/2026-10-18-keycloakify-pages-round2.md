# Prototype round 2: labels and split layout (2026-10-18)

## Questions

1. Should login and forgot password fields have text labels like the register
   form?
2. Should the page use a 1:1 split layout: dark silk wave panel left, auth
   panel right, per Dan's reference image?

## What changed

- Labels on every field, red asterisk on required ones. Login is
  "Email address*" and "Password*". Forgot password is "Email address*".
  Register and reset keep their labels. Labels use the shadcn Label primitive
  via a shared RequiredLabel.
- Split screen 1:1 on desktop (grid-cols-2). Left half is a rounded dark
  panel (m-3, rounded-[1.5rem]) with abstract silk / liquid metal waves:
  layered SVG band paths with dark to silver gradients, a radial sheen, and a
  slow 24s/38s drift animation. Uppercase headline "One cookie. Zero tokens."
  and one line of product copy sit at the bottom left over a dark gradient.
- Right half is the auth form on white, max-w-sm, left aligned headings, per
  the reference image. Social buttons are full width and stacked. The primary
  button is near-black (bg-foreground).
- Below lg the wave panel hides and the form centers.

## Files

- src/mockups/AuthShell.tsx: AuthShell (split layout), SilkWaves,
  RequiredLabel, SubmitButton, shared fields
- src/mockups/*.tsx: the five pages, updated for labels and SubmitButton

## Status

Both questions answered yes in the mockups and confirmed. Deviations kept
from round 1: OTP title "Check your email", login has no name field. New
deviation: the wave panel carries product copy instead of the reference photo
grid.

## Notes for later

- Playwright clicks on the mockup nav hang on actionability checks, probably
  because of the continuous silk animation. Use force clicks or dispatchEvent
  when driving these pages with a browser tool.
