# KeyLab — design screens

Exported from the KeyLab design canvas on 2026-11-12. Each artboard is here twice: the `.dc.html` source (markup, CSS and a small logic class) and a rendered `.png` of its default state.

- **Style:** neo-brutalist. Cream `#FFFDF5` / sand `#EFE8D6` surfaces, black 2–3 px borders, hard offset shadows (`3px 3px 0 #000`), square corners. Accents: sun `#FFD24D`, lime `#C6F079`, coral `#F16B53`, sky `#99D6FF`, ink `#2C2A5A`. Type: Archivo (400–900) for UI, Space Mono for labels and numbers. Focus ring: 3 px coral outline.
- **Breakpoints:** desktop 1440 (sidebar + content), mobile 390 (bottom tab bar, 844 px frame that scrolls inside), admin also checked at 1024.
- **Reading a `.dc.html`:** the markup inside `<x-dc>` is a template. `{{name}}` holes, `<sc-if>` and `<sc-for>` are filled from `renderVals()` in the `<script type="text/x-dc">` class at the bottom, which is also where demo data, states and click handlers live. `<dc-import name="X">` embeds the component `X.dc.html` with the other attributes as props. `href="Other.dc.html"` links are the prototype flow. `data-props` lists the states you can switch (the "States" column below).
- **Implementing:** treat these as the visual and behavioural spec, not code to copy. Rebuild them as real components in the web app; keep copy, layout, states and accessibility (labels, roles, 44 px targets, keyboard support) as drawn. Bracketed text such as `[N]` or `[CITY, COUNTRY]` marks values that come from the API.
- **PNG notes:** rendered offline, so web fonts fell back to system fonts; the `.dc.html` names the real ones. Mobile PNGs show the first 844 px; scroll content is in the source.
- **Not included:** the "Pop / Y2K" restyle trial artboards; that style was rejected.

| Artboard | Files | Size | Kind | States (`data-props` enums) |
| --- | --- | --- | --- | --- |
| 1 · Build / Home — mobile | [Main.dc.html](screens/Main.dc.html) · [png](screens/Main.png) | 390×844 | screen | `theme`: light/dark |
| 2 · Switch library — mobile | [SwitchesMobile.dc.html](screens/SwitchesMobile.dc.html) · [png](screens/SwitchesMobile.png) | 390×844 | screen | `theme`: light/dark; `sheet`: peek/open |
| 3 · Mods workshop — mobile | [ModsMobile.dc.html](screens/ModsMobile.dc.html) · [png](screens/ModsMobile.png) | 390×844 | screen | `theme`: light/dark |
| 4 · Keycaps studio — mobile | [KeycapsMobile.dc.html](screens/KeycapsMobile.dc.html) · [png](screens/KeycapsMobile.png) | 390×844 | screen | `theme`: light/dark; `tab`: profile/material/colors/legends/artisan |
| 5 · My builds & share — mobile | [BuildsMobile.dc.html](screens/BuildsMobile.dc.html) · [png](screens/BuildsMobile.png) | 390×844 | screen | `theme`: light/dark |
| 6 · Case & plate — mobile | [CaseMobile.dc.html](screens/CaseMobile.dc.html) · [png](screens/CaseMobile.png) | 390×844 | screen | `theme`: light/dark |
| 7 · Sound playground — mobile | [PlaygroundMobile.dc.html](screens/PlaygroundMobile.dc.html) · [png](screens/PlaygroundMobile.png) | 390×844 | screen | `theme`: light/dark |
| Ink (dark) variant · Home | [HomeLight.dc.html](screens/HomeLight.dc.html) · [png](screens/HomeLight.png) | 390×844 | screen |  |
| Ink (dark) variant · Switch detail sheet | [SwitchesLight.dc.html](screens/SwitchesLight.dc.html) · [png](screens/SwitchesLight.png) | 390×844 | screen |  |
| 1 · Build / Home — desktop | [HomeDesktop.dc.html](screens/HomeDesktop.dc.html) · [png](screens/HomeDesktop.png) | 1440×1110 | page |  |
| 2 · Switch library — desktop | [SwitchesDesktop.dc.html](screens/SwitchesDesktop.dc.html) · [png](screens/SwitchesDesktop.png) | 1440×1440 | page | `theme`: light/dark |
| 3 · Mods workshop — desktop | [ModsDesktop.dc.html](screens/ModsDesktop.dc.html) · [png](screens/ModsDesktop.png) | 1440×1190 | page | `theme`: light/dark |
| 4 · Keycaps studio — desktop | [KeycapsDesktop.dc.html](screens/KeycapsDesktop.dc.html) · [png](screens/KeycapsDesktop.png) | 1440×1300 | page |  |
| 5 · My builds & share — desktop | [BuildsDesktop.dc.html](screens/BuildsDesktop.dc.html) · [png](screens/BuildsDesktop.png) | 1440×1120 | page | `theme`: light/dark |
| 6 · Case & plate — desktop | [CaseDesktop.dc.html](screens/CaseDesktop.dc.html) · [png](screens/CaseDesktop.png) | 1440×1030 | page | `theme`: light/dark |
| 7 · Sound playground — desktop | [PlaygroundDesktop.dc.html](screens/PlaygroundDesktop.dc.html) · [png](screens/PlaygroundDesktop.png) | 1440×1080 | page | `theme`: light/dark |
| Component sheet · states · tokens | [Components.dc.html](screens/Components.dc.html) · [png](screens/Components.png) | 1440×1900 | component |  |
| Keyboard preview | [Keyboard.dc.html](screens/Keyboard.dc.html) · [png](screens/Keyboard.png) | 760×330 | component | `layout`: 60/65/75/tkl/100; `profile`: cherry/oem/sa/xda/mt3; `material`: pbt/abs; `legend`: top-left/center/front/blank; `font`: grotesk/mono/rounded; `artisanEsc`: none/arcade/handheld/resin; `artisanEnter`: none/arcade/handheld/resin; `caseMat`: alu/pc/plastic/wood; `plate`: alu/brass/fr4/pc/pom |
| Switch card | [SwitchCard.dc.html](screens/SwitchCard.dc.html) · [png](screens/SwitchCard.png) | 184×236 | component | `state`: default/loading |
| Force curve | [ForceCurve.dc.html](screens/ForceCurve.dc.html) · [png](screens/ForceCurve.png) | 340×200 | component | `curve`: linear/tactile/clicky |
| Sound waveform | [Waveform.dc.html](screens/Waveform.dc.html) · [png](screens/Waveform.png) | 340×96 | component | `profile`: Deep/Poppy/Clacky/Muted |
| Mod toggle card | [ToggleCard.dc.html](screens/ToggleCard.dc.html) · [png](screens/ToggleCard.png) | 340×196 | component |  |
| Build summary card | [BuildCard.dc.html](screens/BuildCard.dc.html) · [png](screens/BuildCard.png) | 360×460 | component | `variant`: summary/share |
| Marketing nav | [MktNav.dc.html](screens/MktNav.dc.html) · [png](screens/MktNav.png) | 1440×78 | component | `active`: none/features/switches/pricing/community |
| Marketing footer | [MktFooter.dc.html](screens/MktFooter.dc.html) · [png](screens/MktFooter.png) | 1440×320 | component |  |
| Admin top bar | [AdminTopbar.dc.html](screens/AdminTopbar.dc.html) · [png](screens/AdminTopbar.png) | 1208×66 | component |  |
| Admin sidebar | [AdminSidebar.dc.html](screens/AdminSidebar.dc.html) · [png](screens/AdminSidebar.png) | 232×900 | component | `active`: overview/switches/sounds/keycaps/mods/users/community/reports/settings |
| Sidebar item | [SidebarItem.dc.html](screens/SidebarItem.dc.html) · [png](screens/SidebarItem.png) | 220×44 | component | `icon`: overview/switches/sounds/keycaps/mods/users/community/reports/settings/site; `demo`: none/hover/focus |
| Status badge | [StatusBadge.dc.html](screens/StatusBadge.dc.html) · [png](screens/StatusBadge.png) | 120×24 | component | `status`: recorded/missing/processing/published/draft/hidden/reported/featured/pro/free/active/suspended/invited |
| KPI tile | [KpiTile.dc.html](screens/KpiTile.dc.html) · [png](screens/KpiTile.png) | 280×136 | component | `state`: ready/loading/empty/error |
| Toast | [Toast.dc.html](screens/Toast.dc.html) · [png](screens/Toast.png) | 440×72 | component | `kind`: success/error/info |
| Pricing card | [PricingCard.dc.html](screens/PricingCard.dc.html) · [png](screens/PricingCard.png) | 380×520 | component | `tier`: free/pro |
| Testimonial card | [TestimonialCard.dc.html](screens/TestimonialCard.dc.html) · [png](screens/TestimonialCard.png) | 380×230 | component | `tone`: paper/ink/sky |
| Data table row | [DataTableRow.dc.html](screens/DataTableRow.dc.html) · [png](screens/DataTableRow.png) | 1000×56 | component | `state`: default/hover/selected/focus/loading |
| FAQ item | [FaqItem.dc.html](screens/FaqItem.dc.html) · [png](screens/FaqItem.png) | 720×150 | component |  |
| Upload drop zone | [UploadDropZone.dc.html](screens/UploadDropZone.dc.html) · [png](screens/UploadDropZone.png) | 520×140 | component | `state`: idle/dragover/uploading/done/error; `profile`: Deep/Poppy/Clacky/Muted |
| M1 · Landing — desktop | [MktLanding.dc.html](screens/MktLanding.dc.html) · [png](screens/MktLanding.png) | 1440×7300 | page |  |
| M1 · Landing — mobile | [MktLandingMobile.dc.html](screens/MktLandingMobile.dc.html) · [png](screens/MktLandingMobile.png) | 390×8200 | screen |  |
| M2 · Sign up / Log in — desktop | [MktAuth.dc.html](screens/MktAuth.dc.html) · [png](screens/MktAuth.png) | 1440×1000 | page | `mode`: signup/login; `state`: default/error |
| M2 · Sign up / Log in — mobile | [MktAuthMobile.dc.html](screens/MktAuthMobile.dc.html) · [png](screens/MktAuthMobile.png) | 390×900 | screen | `mode`: signup/login |
| M3 · Onboarding (3 steps) — desktop | [MktOnboarding.dc.html](screens/MktOnboarding.dc.html) · [png](screens/MktOnboarding.png) | 1440×1000 | page | `step`: 1/2/3 |
| M3 · Onboarding (3 steps) — mobile | [MktOnboardingMobile.dc.html](screens/MktOnboardingMobile.dc.html) · [png](screens/MktOnboardingMobile.png) | 390×844 | screen | `step`: 1/2/3 |
| M4 · Pricing — desktop | [MktPricing.dc.html](screens/MktPricing.dc.html) · [png](screens/MktPricing.png) | 1440×2280 | page |  |
| M4 · Pricing — mobile | [MktPricingMobile.dc.html](screens/MktPricingMobile.dc.html) · [png](screens/MktPricingMobile.png) | 390×2900 | screen |  |
| M5 · Switch library (public) — desktop | [MktLibrary.dc.html](screens/MktLibrary.dc.html) · [png](screens/MktLibrary.png) | 1440×2400 | page |  |
| M5 · Switch library (public) — mobile | [MktLibraryMobile.dc.html](screens/MktLibraryMobile.dc.html) · [png](screens/MktLibraryMobile.png) | 390×2700 | screen |  |
| M6 · Switch detail — desktop | [MktSwitch.dc.html](screens/MktSwitch.dc.html) · [png](screens/MktSwitch.png) | 1440×2150 | page |  |
| M6 · Switch detail — mobile | [MktSwitchMobile.dc.html](screens/MktSwitchMobile.dc.html) · [png](screens/MktSwitchMobile.png) | 390×2350 | screen |  |
| Component sheet 2 · marketing & admin states | [ComponentsKit.dc.html](screens/ComponentsKit.dc.html) · [png](screens/ComponentsKit.png) | 1440×2900 | component |  |
| A1 · Overview — desktop | [AdminOverview.dc.html](screens/AdminOverview.dc.html) · [png](screens/AdminOverview.png) | 1440×1400 | page | `kpiState`: ready/loading/empty/error |
| A2 · Switches — desktop | [AdminSwitches.dc.html](screens/AdminSwitches.dc.html) · [png](screens/AdminSwitches.png) | 1440×1100 | page | `tableState`: ready/loading/empty/error |
| A3 · Add / edit switch — desktop | [AdminSwitchEdit.dc.html](screens/AdminSwitchEdit.dc.html) · [png](screens/AdminSwitchEdit.png) | 1440×1500 | page |  |
| A4 · Sound library — desktop | [AdminSounds.dc.html](screens/AdminSounds.dc.html) · [png](screens/AdminSounds.png) | 1440×1250 | page | `selected`: coralpop/milkyellow/inkblack/protoorange; `uploadState`: idle/dragover/uploading/done/error |
| A5 · Keycap sets & mods — desktop | [AdminCatalog.dc.html](screens/AdminCatalog.dc.html) · [png](screens/AdminCatalog.png) | 1440×1250 | page | `tab`: keycaps/mods |
| A6 · Users — desktop | [AdminUsers.dc.html](screens/AdminUsers.dc.html) · [png](screens/AdminUsers.png) | 1440×1100 | page | `tableState`: ready/loading/empty/error |
| A7 · Community moderation — desktop | [AdminCommunity.dc.html](screens/AdminCommunity.dc.html) · [png](screens/AdminCommunity.png) | 1440×1200 | page | `queueState`: ready/empty |
| A8 · Settings, roles & audit log — desktop | [AdminSettings.dc.html](screens/AdminSettings.dc.html) · [png](screens/AdminSettings.png) | 1440×1350 | page |  |
| A1 · Overview — tablet check 1024 | [AdminOverviewTablet.dc.html](screens/AdminOverviewTablet.dc.html) · [png](screens/AdminOverviewTablet.png) | 1024×1700 | component | `kpiState`: ready/loading/empty/error |
| Component sheet 3 · user profile | [ComponentsProfile.dc.html](screens/ComponentsProfile.dc.html) · [png](screens/ComponentsProfile.png) | 1440×2100 | component |  |
| P1 · My profile — desktop | [ProfileDesktop.dc.html](screens/ProfileDesktop.dc.html) · [png](screens/ProfileDesktop.png) | 1440×2400 | page | `state`: ready/loading/new; `toast`: none/saved |
| P1 · My profile — mobile | [ProfileMobile.dc.html](screens/ProfileMobile.dc.html) · [png](screens/ProfileMobile.png) | 390×844 | screen | `state`: ready/loading/new; `toast`: none/saved |
| P2 · Public profile — desktop | [PublicProfileDesktop.dc.html](screens/PublicProfileDesktop.dc.html) · [png](screens/PublicProfileDesktop.png) | 1440×2300 | page | `state`: ready/loading/private/notfound; `toast`: none/followed |
| P2 · Public profile — mobile | [PublicProfileMobile.dc.html](screens/PublicProfileMobile.dc.html) · [png](screens/PublicProfileMobile.png) | 390×844 | screen | `state`: ready/loading/private/notfound; `toast`: none/followed |
| P3 · Edit profile — desktop | [EditProfileDesktop.dc.html](screens/EditProfileDesktop.dc.html) · [png](screens/EditProfileDesktop.png) | 1440×2050 | page | `demo`: none/errors/saveError |
| P3 · Edit profile — mobile | [EditProfileMobile.dc.html](screens/EditProfileMobile.dc.html) · [png](screens/EditProfileMobile.png) | 390×844 | screen | `demo`: none/errors/saveError |
| P4 · Account settings — desktop | [AccountDesktop.dc.html](screens/AccountDesktop.dc.html) · [png](screens/AccountDesktop.png) | 1440×1150 | page | `section`: account/plan/sound/notifications/privacy/danger; `plan`: free/pro |
| P4 · Account settings — mobile | [AccountMobile.dc.html](screens/AccountMobile.dc.html) · [png](screens/AccountMobile.png) | 390×844 | screen | `section`: account/plan/sound/notifications/privacy/danger; `plan`: free/pro |
| P5 · Profile states — mobile | [ProfileStates.dc.html](screens/ProfileStates.dc.html) · [png](screens/ProfileStates.png) | 3920×1000 | component |  |

`canvas.json` is the canvas layout (positions and titles), kept only for reference.
