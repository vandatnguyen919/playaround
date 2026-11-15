# KeyLab — user stories

44 stories in five phases. Each one is also a ticket in the Notion Task Manager (Project = KeyLab); the ticket links back here. Endpoint IDs point into [api-design-v1.md](api-design-v1.md) and [openapi-v1.yaml](openapi-v1.yaml); modules are packages in [modulith-plan.md](modulith-plan.md); screens link to the design artboards in [design/screens](design/screens/) (source `.dc.html` plus a rendered `.png`).

| Phase | Dates | Stories | Points |
| --- | --- | --- | --- |
| [KL1 · Catalog & sound](#kl1--catalog--sound) | 2026-11-16 → 2026-12-06 | 6 | 22 |
| [KL2 · Builder](#kl2--builder) | 2026-12-07 → 2027-01-03 | 11 | 30 |
| [KL3 · Profiles & community](#kl3--profiles--community) | 2027-01-04 → 2027-01-31 | 12 | 34 |
| [KL4 · Account & billing](#kl4--account--billing) | 2027-02-01 → 2027-02-21 | 8 | 24 |
| [KL5 · Admin operations](#kl5--admin-operations) | 2027-02-22 → 2027-03-14 | 7 | 24 |

## KL1 · Catalog & sound

2026-11-16 → 2026-12-06

### US-37 · Add or edit a switch with specs and force curve

As an editor, I want to add or edit a switch with its specs and force curve, so the library has real data to show.

- **Module:** `catalog` · **Endpoints:** ADM-02 · **Depends on:** — · **Points:** 5 · **Priority:** High
- **Screens:** Add / edit switch → [AdminSwitchEdit](design/screens/AdminSwitchEdit.png)
- **Ticket:** [Notion](https://www.notion.so/4130b3b780c681e7ad2ec9b5f90a92a1)

**Done when**

- [ ] Create, edit and delete a draft switch: name, brand, type, stem colour, force, actuation, travel, spring, photo
- [ ] Force curve points editable and drawn live; invalid specs return 422 with field errors
- [ ] Drafts never appear in the public library

### US-38 · Upload press and release recordings per variant

As an editor, I want to upload press and release recordings per variant and see their processing status, so every switch can be heard.

- **Module:** `sound` · **Endpoints:** ADM-04, ADM-05 · **Depends on:** US-37 · **Points:** 5 · **Priority:** High
- **Screens:** Add switch, Sound library → [AdminSwitchEdit](design/screens/AdminSwitchEdit.png), [AdminSounds](design/screens/AdminSounds.png)
- **Ticket:** [Notion](https://www.notion.so/4130b3b780c681c9a015d92c6a1a5d18)

**Done when**

- [ ] Presigned WAV upload (48 kHz, 24-bit) for stock, lubed and foam × press and release
- [ ] Processing answers 202 and moves to ready or failed with peaks, duration and loudness
- [ ] Sound library lists recordings per switch and shows the no-sound state

### US-39 · Publish a switch to the public library

As an editor, I want to publish a switch only once its stock sounds exist, then see it in the public library.

- **Module:** `catalog` · **Endpoints:** ADM-03, CAT-01 · **Depends on:** US-37, US-38 · **Points:** 3 · **Priority:** High
- **Screens:** Add switch, Switch library → [AdminSwitchEdit](design/screens/AdminSwitchEdit.png), [MktLibrary](design/screens/MktLibrary.png), [MktLibraryMobile](design/screens/MktLibraryMobile.png)
- **Ticket:** [Notion](https://www.notion.so/4130b3b780c681279b3fcec9524ba219)

**Done when**

- [ ] Publish refused with 409 missing_required_sounds until stock press and release are ready
- [ ] SoundProcessed event updates the switch's sound status in catalog
- [ ] Published switch shows in the public library within one cache window, with the New sticker if chosen

### US-02 · Browse and filter the switch library

As a visitor, I want to filter switches by type and sound profile, so I can find candidates fast.

- **Module:** `catalog` · **Endpoints:** CAT-01 · **Depends on:** US-39 · **Points:** 3 · **Priority:** High
- **Screens:** Switch library (app and public) → [SwitchesDesktop](design/screens/SwitchesDesktop.png), [SwitchesMobile](design/screens/SwitchesMobile.png), [MktLibrary](design/screens/MktLibrary.png), [MktLibraryMobile](design/screens/MktLibraryMobile.png)
- **Ticket:** [Notion](https://www.notion.so/4130b3b780c68166838dea471220833c)

**Done when**

- [ ] Filters type, profile, sound status and search; cursor paging of 24
- [ ] Empty result shows the empty state with a clear-filters action
- [ ] Public responses cached 300 s with ETag

### US-03 · Compare up to three switch sounds side by side

As a visitor, I want to play the press and release of up to three switches side by side, so I hear the difference.

- **Module:** `sound` · **Endpoints:** CAT-01, CAT-03 · **Depends on:** US-02 · **Points:** 3 · **Priority:** High
- **Screens:** Landing compare strip, Switches → [MktLanding](design/screens/MktLanding.png), [MktLandingMobile](design/screens/MktLandingMobile.png), [SwitchesDesktop](design/screens/SwitchesDesktop.png), [SwitchesMobile](design/screens/SwitchesMobile.png)
- **Ticket:** [Notion](https://www.notion.so/4130b3b780c681dbbe98eefe11de5e05)

**Done when**

- [ ] Pick up to three switches; each plays press then release from the CDN
- [ ] Waveforms drawn from stored peaks, not decoded in the browser
- [ ] Switches without a recording show “Sound coming soon” and cannot be picked

### US-04 · Switch detail page

As a visitor, I want a switch page with specs, force curve and similar switches, so I can decide.

- **Module:** `catalog` · **Endpoints:** CAT-02, CAT-03, CAT-04 · **Depends on:** US-02 · **Points:** 3 · **Priority:** High
- **Screens:** Switch detail → [MktSwitch](design/screens/MktSwitch.png), [MktSwitchMobile](design/screens/MktSwitchMobile.png), [SwitchesLight](design/screens/SwitchesLight.png)
- **Ticket:** [Notion](https://www.notion.so/4130b3b780c6817da58cffcc50a2cd58)

**Done when**

- [ ] Specs, force curve, stroke and mod-variant pickers with playback
- [ ] Sounds similar row from CAT-04
- [ ] “Use in a build” opens the builder with this switch selected

## KL2 · Builder

2026-12-07 → 2027-01-03

### US-05 · Toggle mods and hear before and after

As a builder, I want to toggle mods and hear the before and after, so I know what each mod does.

- **Module:** `sound` · **Endpoints:** CAT-07, BLD-10 · **Depends on:** US-04 · **Points:** 5 · **Priority:** High
- **Screens:** Mods workshop → [ModsDesktop](design/screens/ModsDesktop.png), [ModsMobile](design/screens/ModsMobile.png)
- **Ticket:** [Notion](https://www.notion.so/4130b3b780c681d9a258da5233c014d8)

**Done when**

- [ ] GET /v1/sound-recipe returns samples, filters, meter position and word for any parts mix
- [ ] Each mod card plays before and after; sound meter moves with every toggle
- [ ] Recipe responses cacheable so toggling feels instant (< 100 ms from cache)

### US-06 · Pick a keycap set and hear the shift

As a builder, I want to pick a keycap set and hear how it shifts the sound.

- **Module:** `catalog` · **Endpoints:** CAT-05, CAT-06, BLD-10 · **Depends on:** US-05 · **Points:** 3 · **Priority:** High
- **Screens:** Keycaps studio → [KeycapsDesktop](design/screens/KeycapsDesktop.png), [KeycapsMobile](design/screens/KeycapsMobile.png)
- **Ticket:** [Notion](https://www.notion.so/4130b3b780c681bc8764c9a1fbb41020)

**Done when**

- [ ] Keycap sets listed with material, profile and colourway on the keyboard preview
- [ ] Changing a set re-fetches the sound recipe and plays a sample
- [ ] Deep-to-bright shift shown for each set

### US-07 · Choose case, plate and mount

As a builder, I want to choose case material, plate and mount and hear the change.

- **Module:** `catalog` · **Endpoints:** CAT-08, BLD-10 · **Depends on:** US-05 · **Points:** 3 · **Priority:** High
- **Screens:** Case & plate → [CaseDesktop](design/screens/CaseDesktop.png), [CaseMobile](design/screens/CaseMobile.png)
- **Ticket:** [Notion](https://www.notion.so/4130b3b780c6814eb078f2cba86d3725)

**Done when**

- [ ] Case materials, colours, plates and mounts from CAT-08
- [ ] Each change updates the preview and the sound meter
- [ ] Selection is kept in the builder state for saving

### US-08 · Save and rename a build

As a member, I want to save a build and rename it later.

- **Module:** `builds` · **Endpoints:** BLD-01, BLD-02, BLD-04 · **Depends on:** US-05 · **Points:** 3 · **Priority:** High
- **Screens:** Build, My builds → [HomeDesktop](design/screens/HomeDesktop.png), [Main](design/screens/Main.png), [BuildsDesktop](design/screens/BuildsDesktop.png), [BuildsMobile](design/screens/BuildsMobile.png)
- **Ticket:** [Notion](https://www.notion.so/4130b3b780c68103a41cd60e64b4cfad)

**Done when**

- [ ] POST /v1/builds with Idempotency-Key; new builds start private
- [ ] Rename via PATCH with If-Match; a stale tag shows a reload prompt (412)
- [ ] My builds lists public and private builds

### US-09 · Open and hear a shared build link

As a visitor, I want to open a shared build link and hear it without signing up.

- **Module:** `builds` · **Endpoints:** BLD-03, BLD-10 · **Depends on:** US-08 · **Points:** 2 · **Priority:** High
- **Screens:** Shared build → [BuildsDesktop](design/screens/BuildsDesktop.png), [BuildCard](design/screens/BuildCard.png)
- **Ticket:** [Notion](https://www.notion.so/4130b3b780c681b69aa4dd208ce2662b)

**Done when**

- [ ] Public build opens for guests; a private one returns 404 to others
- [ ] Keyboard preview plays the build's sound recipe
- [ ] Link preview metadata uses the share image

### US-14 · Type on any build in the playground

As a member, I want to type on any build in the playground.

- **Module:** `builds` · **Endpoints:** BLD-03, BLD-10 · **Depends on:** US-09 · **Points:** 3 · **Priority:** High
- **Screens:** Sound playground → [PlaygroundDesktop](design/screens/PlaygroundDesktop.png), [PlaygroundMobile](design/screens/PlaygroundMobile.png)
- **Ticket:** [Notion](https://www.notion.so/4130b3b780c681aa89dee78070b306dd)

**Done when**

- [ ] Playground loads any public or own build by id
- [ ] Physical keyboard and on-screen taps both play the recipe
- [ ] Desk pad and volume settings respected

### US-12 · Make a build private or delete it

As a member, I want to make a build private or delete it.

- **Module:** `builds` · **Endpoints:** BLD-04, BLD-05 · **Depends on:** US-08 · **Points:** 2 · **Priority:** Low
- **Screens:** My builds, My profile → [BuildsDesktop](design/screens/BuildsDesktop.png), [BuildsMobile](design/screens/BuildsMobile.png), [ProfileDesktop](design/screens/ProfileDesktop.png), [ProfileMobile](design/screens/ProfileMobile.png)
- **Ticket:** [Notion](https://www.notion.so/4130b3b780c6816d9f3bd2b9bf661fa2)

**Done when**

- [ ] Visibility toggle with If-Match
- [ ] Delete asks for confirmation; deleting the daily driver clears the pin
- [ ] Deleted builds return 404 on their old link

### US-10 · Parts list for a build

As a member, I want a parts list for my build, so I can buy it.

- **Module:** `builds` · **Endpoints:** BLD-07 · **Depends on:** US-08 · **Points:** 2 · **Priority:** Low
- **Screens:** My builds → [BuildsDesktop](design/screens/BuildsDesktop.png), [BuildsMobile](design/screens/BuildsMobile.png)
- **Ticket:** [Notion](https://www.notion.so/4130b3b780c681d09ce4ee533b76b4d7)

**Done when**

- [ ] Case, plate, PCB, switches + 4 spares, keycaps, stabilizers and mods with quantities
- [ ] Copy list button copies plain text
- [ ] Shop links left as a placeholder

### US-11 · Share card image of a build

As a member, I want a share card image of my build.

- **Module:** `builds` · **Endpoints:** BLD-08 · **Depends on:** US-08 · **Points:** 3 · **Priority:** Minimal
- **Screens:** My builds → [BuildsDesktop](design/screens/BuildsDesktop.png), [BuildsMobile](design/screens/BuildsMobile.png)
- **Ticket:** [Notion](https://www.notion.so/4130b3b780c68172bce5cc9a978e1feb)

**Done when**

- [ ] GET /v1/builds/{id}/share-image returns a PNG matching the share card design
- [ ] Image rendered on first request and cached until the build changes
- [ ] Save image downloads it; Copy link copies the build URL

### US-13 · Keep a guest build after sign-up

As a guest who signs up, I want the build I made as a guest to be kept.

- **Module:** `builds` · **Endpoints:** BLD-09 · **Depends on:** US-08 · **Points:** 2 · **Priority:** Low
- **Screens:** Sign up → [MktAuth](design/screens/MktAuth.png), [MktAuthMobile](design/screens/MktAuthMobile.png)
- **Ticket:** [Notion](https://www.notion.so/4130b3b780c68180920ae7cfd2821463)

**Done when**

- [ ] Up to 3 guest builds in local storage are imported after the first sign-in
- [ ] Imported builds start private
- [ ] Local copies cleared only after the import succeeds

### US-01 · Onboarding: experience, sound, layout

As a new member, I want to answer three questions (experience, sound, layout), so the builder starts set up for me.

- **Module:** `community` · **Endpoints:** ME-06 · **Depends on:** US-08 · **Points:** 2 · **Priority:** Low
- **Screens:** Onboarding → [MktOnboarding](design/screens/MktOnboarding.png), [MktOnboardingMobile](design/screens/MktOnboardingMobile.png)
- **Ticket:** [Notion](https://www.notion.so/4130b3b780c6816d9a04d1bb0ae67dba)

**Done when**

- [ ] Three steps, each skippable; answers saved with PUT /v1/me/onboarding
- [ ] The final step opens the builder with the chosen layout and a matching switch
- [ ] Onboarding shows once per account

## KL3 · Profiles & community

2027-01-04 → 2027-01-31

### US-24 · Edit name, username, bio, location and links

As a member, I want to edit my name, username (checked as I type), bio, location and links.

- **Module:** `community` · **Endpoints:** ME-02, ME-03 · **Depends on:** US-08 · **Points:** 3 · **Priority:** High
- **Screens:** Edit profile → [EditProfileDesktop](design/screens/EditProfileDesktop.png), [EditProfileMobile](design/screens/EditProfileMobile.png)
- **Ticket:** [Notion](https://www.notion.so/4130b3b780c681e382eed3b5493afde0)

**Done when**

- [ ] Live username availability check; taken returns 409 username_taken
- [ ] Inline 422 errors per field (name ≤ 40, username 3–20, bio ≤ 160, valid URLs)
- [ ] Save returns to My profile with the saved toast

### US-26 · Choose daily driver and public tabs

As a member, I want to choose my daily driver and which tabs are public.

- **Module:** `community` · **Endpoints:** ME-02 · **Depends on:** US-24 · **Points:** 2 · **Priority:** High
- **Screens:** Edit profile → [EditProfileDesktop](design/screens/EditProfileDesktop.png), [EditProfileMobile](design/screens/EditProfileMobile.png)
- **Ticket:** [Notion](https://www.notion.so/4130b3b780c6816a93bbd80f85057fff)

**Done when**

- [ ] Only my public builds can be pinned
- [ ] Public tabs toggles hide tabs from visitors (403 tab_private on their endpoints)
- [ ] Changes show on My profile right after save

### US-25 · Upload and crop an avatar

As a member, I want to upload and crop an avatar, or keep my initials.

- **Module:** `community` · **Endpoints:** ME-04, ME-05 · **Depends on:** US-24 · **Points:** 3 · **Priority:** Low
- **Screens:** Edit profile → [EditProfileDesktop](design/screens/EditProfileDesktop.png), [EditProfileMobile](design/screens/EditProfileMobile.png)
- **Ticket:** [Notion](https://www.notion.so/4130b3b780c6812eb599c6d0ff51b417)

**Done when**

- [ ] PNG or JPG at least 400 × 400 px, presigned upload, crop saved with the avatar
- [ ] Remove returns to initials on the chosen colour
- [ ] Wrong file type shows an error toast

### US-16 · My profile page

As a member, I want my profile to show my sound signature, stats, daily driver and badges.

- **Module:** `community` · **Endpoints:** ME-01, SOC-01 · **Depends on:** US-24, US-26 · **Points:** 5 · **Priority:** High
- **Screens:** My profile → [ProfileDesktop](design/screens/ProfileDesktop.png), [ProfileMobile](design/screens/ProfileMobile.png)
- **Ticket:** [Notion](https://www.notion.so/4130b3b780c681a28757cdf2268c0904)

**Done when**

- [ ] Header, stats, sound signature, daily driver with playable keyboard, badges, tabs
- [ ] New-user and loading states as designed
- [ ] Stats shown from real counts once available, placeholders until then

### US-17 · View someone's public profile

As a visitor, I want to see someone's public builds, collections and activity.

- **Module:** `community` · **Endpoints:** SOC-01, SOC-02, SOC-04, SOC-05, SOC-06 · **Depends on:** US-16 · **Points:** 3 · **Priority:** High
- **Screens:** Public profile → [PublicProfileDesktop](design/screens/PublicProfileDesktop.png), [PublicProfileMobile](design/screens/PublicProfileMobile.png)
- **Ticket:** [Notion](https://www.notion.so/4130b3b780c681c2939ed38e1ebc402b)

**Done when**

- [ ] Only public builds and public collections are listed
- [ ] Private profile returns restricted: true and shows the private state; unknown user shows not found
- [ ] Activity hidden when the owner turns it off

### US-18 · Follow and unfollow people

As a member, I want to follow and unfollow people, and request to follow private profiles.

- **Module:** `community` · **Endpoints:** SOC-07, SOC-08 · **Depends on:** US-17 · **Points:** 3 · **Priority:** High
- **Screens:** Public profile → [PublicProfileDesktop](design/screens/PublicProfileDesktop.png), [PublicProfileMobile](design/screens/PublicProfileMobile.png)
- **Ticket:** [Notion](https://www.notion.so/4130b3b780c681a8a07bce9b0d03fa9e)

**Done when**

- [ ] PUT and DELETE /v1/me/following/{username} are idempotent
- [ ] Private profiles answer 202 requested; button shows Requested
- [ ] Followers and following lists page by cursor

### US-19 · Try their setup in the playground

As a member, I want “Try their setup” to load someone's daily driver in the playground.

- **Module:** `builds` · **Endpoints:** SOC-01, BLD-03, BLD-10 · **Depends on:** US-17, US-14 · **Points:** 2 · **Priority:** Low
- **Screens:** Public profile, Playground → [PublicProfileDesktop](design/screens/PublicProfileDesktop.png), [PublicProfileMobile](design/screens/PublicProfileMobile.png), [PlaygroundDesktop](design/screens/PlaygroundDesktop.png), [PlaygroundMobile](design/screens/PlaygroundMobile.png)
- **Ticket:** [Notion](https://www.notion.so/4130b3b780c68114a156f52e4bb934e7)

**Done when**

- [ ] Button opens the playground with their daily driver loaded
- [ ] Hidden when the owner turns off Let people try my setup
- [ ] Works for guests too

### US-20 · Community gallery with authors

As a visitor, I want to browse community builds and open the author's profile.

- **Module:** `community` · **Endpoints:** SOC-11, SOC-01 · **Depends on:** US-17 · **Points:** 3 · **Priority:** High
- **Screens:** Landing gallery → [MktLanding](design/screens/MktLanding.png), [MktLandingMobile](design/screens/MktLandingMobile.png)
- **Ticket:** [Notion](https://www.notion.so/4130b3b780c681b1ad44d829da7823fc)

**Done when**

- [ ] Featured (4 slots in order), new and popular lists
- [ ] Author link on each BuildCard opens the public profile
- [ ] Hidden and suspended authors' builds never appear

### US-21 · Like builds and see them in Liked

As a member, I want to like builds and find them in my Liked tab.

- **Module:** `community` · **Endpoints:** SOC-09, SOC-03 · **Depends on:** US-20 · **Points:** 2 · **Priority:** High
- **Screens:** Landing, My profile → [MktLanding](design/screens/MktLanding.png), [MktLandingMobile](design/screens/MktLandingMobile.png), [ProfileDesktop](design/screens/ProfileDesktop.png), [ProfileMobile](design/screens/ProfileMobile.png)
- **Ticket:** [Notion](https://www.notion.so/4130b3b780c6817381e1c632c0984bc1)

**Done when**

- [ ] PUT and DELETE /v1/me/likes/{build_id} are idempotent; heart toggles instantly
- [ ] Liked tab lists builds with authors, newest first
- [ ] Like counts update on the card

### US-22 · Collections of builds and switches

As a member, I want collections of builds and switches, like “Office quiet”.

- **Module:** `community` · **Endpoints:** SOC-10, SOC-04, SOC-05 · **Depends on:** US-16 · **Points:** 3 · **Priority:** Low
- **Screens:** My profile → [ProfileDesktop](design/screens/ProfileDesktop.png), [ProfileMobile](design/screens/ProfileMobile.png)
- **Ticket:** [Notion](https://www.notion.so/4130b3b780c681c4b797d546869462ea)

**Done when**

- [ ] Create, rename, set visibility and delete collections
- [ ] Add or remove a build or switch from any card
- [ ] Private collections visible only to the owner

### US-15 · Copy someone's build to remix it

As a member, I want to copy someone's build into my builds to remix it.

- **Module:** `builds` · **Endpoints:** BLD-06 · **Depends on:** US-17 · **Points:** 2 · **Priority:** Low
- **Screens:** Public profile → [PublicProfileDesktop](design/screens/PublicProfileDesktop.png), [PublicProfileMobile](design/screens/PublicProfileMobile.png)
- **Ticket:** [Notion](https://www.notion.so/4130b3b780c6813ba8cbd71aecab6ca6)

**Done when**

- [ ] Copy creates a private build credited with copiedFrom
- [ ] Only public builds can be copied
- [ ] The copy opens in the builder

### US-23 · Report or block a profile

As a member, I want to report or block a profile.

- **Module:** `community` · **Endpoints:** SOC-12, SOC-13 · **Depends on:** US-17 · **Points:** 3 · **Priority:** Low
- **Screens:** Public profile → [PublicProfileDesktop](design/screens/PublicProfileDesktop.png), [PublicProfileMobile](design/screens/PublicProfileMobile.png)
- **Ticket:** [Notion](https://www.notion.so/4130b3b780c68119ae11c6cb5728aed3)

**Done when**

- [ ] Report with a reason lands in the moderation queue
- [ ] Blocked users get 404 on my profile and can't follow me
- [ ] Block list manageable from Settings · Privacy

## KL4 · Account & billing

2027-02-01 → 2027-02-21

### US-31 · Upgrade to Pro

As a free member, I want to upgrade to Pro from Settings or the pricing page.

- **Module:** `billing` · **Endpoints:** ACC-03, ACC-04, ACC-07 · **Depends on:** — · **Points:** 5 · **Priority:** High
- **Screens:** Settings · Plan, Pricing → [AccountDesktop](design/screens/AccountDesktop.png), [AccountMobile](design/screens/AccountMobile.png), [MktPricing](design/screens/MktPricing.png), [MktPricingMobile](design/screens/MktPricingMobile.png)
- **Ticket:** [Notion](https://www.notion.so/4130b3b780c6812aa717f08705796bdf)

**Done when**

- [ ] Plans from GET /v1/plans; prices stay placeholders until the provider is chosen
- [ ] Checkout session created with Idempotency-Key and redirects to the provider
- [ ] Webhook (ACC-08) switches the plan to Pro; Settings shows it after return

### US-29 · Privacy settings

As a member, I want to set who sees my profile and whether my activity shows.

- **Module:** `account` · **Endpoints:** ACC-01 · **Depends on:** US-17 · **Points:** 3 · **Priority:** High
- **Screens:** Settings · Privacy → [AccountDesktop](design/screens/AccountDesktop.png), [AccountMobile](design/screens/AccountMobile.png)
- **Ticket:** [Notion](https://www.notion.so/4130b3b780c681819060ef82f47be418)

**Done when**

- [ ] Visibility public, followers only or private, applied to SOC endpoints
- [ ] Show activity and Let people try my setup toggles
- [ ] Each change saved immediately with a toast

### US-34 · Delete my account

As a member, I want to delete my account, with a confirmation and a grace period.

- **Module:** `account` · **Endpoints:** ACC-10 · **Depends on:** — · **Points:** 3 · **Priority:** High
- **Screens:** Settings · Danger zone → [AccountDesktop](design/screens/AccountDesktop.png), [AccountMobile](design/screens/AccountMobile.png)
- **Ticket:** [Notion](https://www.notion.so/4130b3b780c68120a782d1607a459656)

**Done when**

- [ ] Dialog requires typing DELETE; API needs a sign-in within 5 minutes
- [ ] Answers 202; data deleted after 14 days unless the user signs in again
- [ ] Public builds and profile disappear immediately

### US-27 · Sound settings

As a member, I want to set master volume, default ambient and mute on startup.

- **Module:** `account` · **Endpoints:** ACC-01 · **Depends on:** — · **Points:** 2 · **Priority:** Low
- **Screens:** Settings · Sound → [AccountDesktop](design/screens/AccountDesktop.png), [AccountMobile](design/screens/AccountMobile.png)
- **Ticket:** [Notion](https://www.notion.so/4130b3b780c6819e96efe66a1fd8ec1f)

**Done when**

- [ ] Master volume 0–100 with a test sound
- [ ] Default ambient none, rain, café or office
- [ ] Mute on startup respected by builder and playground

### US-28 · Notification settings

As a member, I want to choose which notifications I get.

- **Module:** `account` · **Endpoints:** ACC-01 · **Depends on:** — · **Points:** 2 · **Priority:** Low
- **Screens:** Settings · Notifications → [AccountDesktop](design/screens/AccountDesktop.png), [AccountMobile](design/screens/AccountMobile.png)
- **Ticket:** [Notion](https://www.notion.so/4130b3b780c6812f8663f8f41fd8cdda)

**Done when**

- [ ] Toggles for likes, follows, comments and product news
- [ ] Product news defaults off
- [ ] Each toggle saved with a toast

### US-30 · Manage sign-in methods

As a member, I want to manage Google and Apple sign-in and change my email or password.

- **Module:** `account` · **Endpoints:** ACC-02 · **Depends on:** — · **Points:** 3 · **Priority:** Low
- **Screens:** Settings · Account → [AccountDesktop](design/screens/AccountDesktop.png), [AccountMobile](design/screens/AccountMobile.png)
- **Ticket:** [Notion](https://www.notion.so/4130b3b780c68177aba2cdb997034f7b)

**Done when**

- [ ] Linked identities read from Keycloak; unlinking the last one returns 409 last_identity
- [ ] Linking, email and password changes redirect through the gateway to Keycloak flows
- [ ] Settings shows Connected or Not connected per provider

### US-32 · Invoices and billing portal

As a Pro member, I want my invoices and a way to update my card or cancel.

- **Module:** `billing` · **Endpoints:** ACC-05, ACC-06 · **Depends on:** US-31 · **Points:** 3 · **Priority:** Low
- **Screens:** Settings · Plan → [AccountDesktop](design/screens/AccountDesktop.png), [AccountMobile](design/screens/AccountMobile.png)
- **Ticket:** [Notion](https://www.notion.so/4130b3b780c681d9acbcf7026a0b6ab6)

**Done when**

- [ ] Invoices newest first with PDF download
- [ ] Portal session link for card updates and cancellation
- [ ] Free members see the no-invoices state

### US-33 · Export my data

As a member, I want to export my data.

- **Module:** `account` · **Endpoints:** ACC-09 · **Depends on:** — · **Points:** 3 · **Priority:** Low
- **Screens:** Settings · Danger zone → [AccountDesktop](design/screens/AccountDesktop.png), [AccountMobile](design/screens/AccountMobile.png)
- **Ticket:** [Notion](https://www.notion.so/4130b3b780c681c29538c1d218b14ced)

**Done when**

- [ ] Export answers 202 and builds a ZIP of builds, collections and settings
- [ ] Short-lived download link emailed and shown when ready
- [ ] One export at a time per user

## KL5 · Admin operations

2027-02-22 → 2027-03-14

### US-42 · Moderation queue and featured slots

As an editor, I want to work the moderation queue and order the 4 featured slots.

- **Module:** `moderation` · **Endpoints:** ADM-09, ADM-10 · **Depends on:** US-23, US-20 · **Points:** 5 · **Priority:** High
- **Screens:** Community moderation → [AdminCommunity](design/screens/AdminCommunity.png)
- **Ticket:** [Notion](https://www.notion.so/4130b3b780c6817da773d21cb43c94fe)

**Done when**

- [ ] Queue of reported builds and first posts with approve, hide and feature
- [ ] Featured slots reorderable; a fifth returns 409 slots_full
- [ ] Decisions show on the public gallery right away

### US-41 · Find, suspend and reinstate users

As an admin, I want to find a user, see their builds and suspend or reinstate them.

- **Module:** `account` · **Endpoints:** ADM-08 · **Depends on:** US-23 · **Points:** 3 · **Priority:** High
- **Screens:** Admin users → [AdminUsers](design/screens/AdminUsers.png)
- **Ticket:** [Notion](https://www.notion.so/4130b3b780c681c7995afe9b6445e5d1)

**Done when**

- [ ] Search by handle or email, filter by plan; detail panel with builds and activity
- [ ] Suspend hides their public builds; reinstate restores them
- [ ] Admin role only; editors get 403

### US-36 · Search, filter and bulk-publish switches

As an editor, I want to search, filter and bulk-publish switches.

- **Module:** `catalog` · **Endpoints:** ADM-02, ADM-06 · **Depends on:** US-39 · **Points:** 3 · **Priority:** Low
- **Screens:** Admin switches → [AdminSwitches](design/screens/AdminSwitches.png)
- **Ticket:** [Notion](https://www.notion.so/4130b3b780c68191952eede6a7b26422)

**Done when**

- [ ] Search, type and sound-status filters; loading, empty and error states
- [ ] Bulk publish, unpublish and delete with a result per switch
- [ ] One switch without sounds does not block the rest

### US-40 · Manage keycap sets and mods

As an editor, I want to manage keycap sets and mods and switch a mod on or off in the builder.

- **Module:** `catalog` · **Endpoints:** ADM-07 · **Depends on:** — · **Points:** 3 · **Priority:** Low
- **Screens:** Keycap sets & mods → [AdminCatalog](design/screens/AdminCatalog.png)
- **Ticket:** [Notion](https://www.notion.so/4130b3b780c681d6861bf8c5c8669e58)

**Done when**

- [ ] Create, edit and delete keycap sets with their sound shift
- [ ] Mods with four effects and a live toggle
- [ ] Hidden mods disappear from the builder

### US-43 · Team roles and app settings

As an admin, I want to manage team roles and app settings.

- **Module:** `backoffice` · **Endpoints:** ADM-11, ADM-12 · **Depends on:** — · **Points:** 3 · **Priority:** Low
- **Screens:** Admin settings → [AdminSettings](design/screens/AdminSettings.png)
- **Ticket:** [Notion](https://www.notion.so/4130b3b780c681da9339c6d7572179e1)

**Done when**

- [ ] Invite by email and change role (admin, editor, viewer), synced with Keycloak groups
- [ ] App settings: guest builds, review first posts, compare on switch pages, New badge days, maintenance mode
- [ ] Each change saved with a toast

### US-44 · Audit log of admin changes

As an admin, I want an audit log of every admin change.

- **Module:** `backoffice` · **Endpoints:** ADM-13 · **Depends on:** US-43 · **Points:** 2 · **Priority:** Low
- **Screens:** Admin settings → [AdminSettings](design/screens/AdminSettings.png)
- **Ticket:** [Notion](https://www.notion.so/4130b3b780c68196be2be41605a504bc)

**Done when**

- [ ] Every /v1/admin write records who, what, when, before and after
- [ ] Filter by actor, action and date; export
- [ ] Read-only: no endpoint edits or deletes events

### US-35 · Overview KPIs and charts

As a viewer, I want KPIs and charts for a date range, so I can see how KeyLab is doing.

- **Module:** `backoffice` · **Endpoints:** ADM-01 · **Depends on:** US-44 · **Points:** 5 · **Priority:** Low
- **Screens:** Admin overview → [AdminOverview](design/screens/AdminOverview.png), [AdminOverviewTablet](design/screens/AdminOverviewTablet.png)
- **Ticket:** [Notion](https://www.notion.so/4130b3b780c68165af54c96e9c160594)

**Done when**

- [ ] KPI tiles with deltas, daily builds, most-played switches, sound preference split
- [ ] Needs-attention panel: reported, missing sounds, processing
- [ ] Loading, empty and error states per tile; 1024 tablet layout
