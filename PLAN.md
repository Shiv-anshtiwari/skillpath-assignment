# Skillpath — Implementation Plan

Source of truth: `Assignment.pdf`. Working agreement: `Claude.md`.

Every step below is a **checkpoint**. After each one I report:
1. What changed, exactly.
2. Why the implementation works.
3. Assumptions and edge cases that remain open.
4. What you should understand that isn't visibly on screen.

Then, at every checkpoint:
- **A.** Explain the implementation.
- **B.** Update `LEARNINGS.md` with the concepts and likely questions from that step.

**No step begins until you approve the previous one.**

---

## Locked decisions

| Decision | Choice | One-line defence |
|---|---|---|
| Retry policy | 3 attempts, 400ms fixed delay, retry on any non-ok status incl. 404 | This API's 404s are injected, not real; fixed delay because backoff solves a load problem this server doesn't have |
| Country-call failure | Default `IN`, render grid, show disclosed + retryable notice | Courses are content, currency is presentation; degrade the presentation, never the content |
| Responsive 3/2/1 | **ResizeObserver** measuring `.sp-section`, `columnsForWidth()` applied inline | Revised at Step 4. Container queries were correct on the canvas but collapse in Framer Preview: `container-type` applies size containment, and Preview's wrapper is content-sized, so `width:100%` resolved against ~0. No containment means no collapse |
| File layout | **Two files**: `CoursesSection.tsx` (React) + `helpers.ts` (pure logic) | Revised at Step 3 - see below. A `.tsx` file cannot run in Node without a JSX transform, so keeping the pure logic separate is what makes the price math and the failure matrix unit-testable |
| 4th card field | `courseType` pill (+ `refundable` badge as a bonus) | Tells the learner the format; `mainCategory` is redundant with the course name |
| Property controls | Heading text (String) + **Max courses** (Number, 1-10, default 10) | Revised at Step 6. Accent colour was dropped once the component existed - the design is near-monochrome and the only colour surface is a refund badge whose green is semantic. Section length is the real landing-page request |
| Loading state | Skeleton cards | On the bonus list, and "nothing happens while loading" is a straight-no |

### Revision: single file -> two files (decided at Step 3)

The original rule was "one file, split only past ~300 lines," argued on the
grounds that nothing here is reused and every file boundary is a tax paid
during the live-change test on the call.

That argument was made before testability was on the table. It held while the
only candidates were `formatPrice` and `fetchJson`. It stopped holding once
`resolveLoad` existed: that function encodes the whole seven-row failure
matrix, and the only way to test it is from Node, which cannot run a `.tsx`
file without a JSX transform. Merging the files would cost the test suite.

**Reuse was never the only reason to split. Testability is the better one.**

The cost the original decision was protecting against does not actually land
here. The live-change test targets the card markup - "add a field to a card" -
and that lives entirely in `CoursesSection.tsx`. `helpers.ts` is never opened
during that exercise, so the second file costs nothing where the tax was
expected.

Split line: `helpers.ts` holds anything pure and testable (constants, types,
`formatPrice`, `fetchJson`, the parsers, `resolveLoad`). `CoursesSection.tsx`
holds React only - state, the effect, derived values, markup. If a decision
ever needs a test, that is the signal it belongs in `helpers.ts`.

Answer for the call: "I split it so the price math and the failure matrix
could be unit tested outside Framer."

---

## Step 1 — Container-query compatibility spike  (CLOSED)

All retests passed after the padding fix. Transitions land at exactly 640 and 1024.

**Superseded at Step 4:** the technique worked on the canvas but collapsed in
Framer Preview, so the grid now measures with a ResizeObserver. The padding fix
below is what kept 640/1024 meaning the same thing after the swap.  ✅ CLOSED

All retests passed after the padding fix. Transitions land at exactly 640 and 1024.

**Superseded at Step 4:** the technique worked on the canvas but collapsed in
Framer Preview, so the grid now measures with a ResizeObserver. The padding fix
below is what kept 640/1024 meaning the same thing after the swap.

**Goal:** prove an injected `<style>` + `@container` works inside a Framer Code Component before anything depends on it. No courses code.

- [x] Component pastes into Framer with no code errors
- [x] Renders on the canvas (not blank, not an error box)
- [x] Desktop-width frame (>= 1024px): 3 columns, readout says DESKTOP
- [x] Tablet-width frame (640-1023px): 2 columns, readout says TABLET
- [x] Mobile-width frame (< 640px): 1 column, readout says MOBILE
- [x] Column changes track the **frame** width, not the browser window width
- [x] Dragging the frame wider/narrower flips columns live
- [x] The red "NOT SUPPORTED" banner never appears
- [x] 7 boxes leave a clean partial last row (no stretched orphans)

### Issue found during Step 1 — breakpoints shifted by padding

**Observed:** 639/640 -> MOBILE, 1023/1024 -> TABLET, 1072 -> DESKTOP.
Every breakpoint was 48px late.

**Cause:** `.sp-wrap` carried `container-type: inline-size` **and** `padding: 24px`
on the same element. A size container query is evaluated against the query
container's **content box**, so with `width: 100%` + `box-sizing: border-box`
the measured width was `frame - 48px`. The 640px rule therefore fired at a
frame width of 688px, and the 1024px rule at 1072px. The observed 1072px
transition matches that prediction exactly.

**Fix chosen:** split the query container from the padded content wrapper.
`.sp-wrap` measures (no padding); `.sp-inner` holds all spacing. The content
box of `.sp-wrap` now equals the frame width, so the CSS numbers 640 and 1024
mean 640 and 1024 in Framer's width field.

**Rejected:** shifting the thresholds to 688/1072 (encodes the bug as a
constant and silently re-breaks if the padding ever changes), and moving the
padding onto the grid (couples section spacing to the grid, leaving the
heading and notice to pad themselves).

**Carries into the real component:** the courses section uses the same
two-element split. Padding never goes on a query container.

- [x] RETEST after fix: transitions land at exactly 640 and 1024
- [x] RETEST: 688 and 1072 are no longer transition points
- [x] RETEST: 24px inset still visible on all four sides

**Fallback if it fails:** swap the grid wrapper for a `ResizeObserver` + `useState` column count. Contained to one wrapper, ~15 minutes.

## Step 2 — Pure helpers, verified in isolation  (CLOSED)

`formatPrice(course, countryCode)` and `fetchJson(path)`. No React.

Written in `src/helpers.ts`, verified by `tests/helpers.test.mjs`
(21 assertions, plain Node, no test framework or dependencies) plus
`tests/live-check.mjs` against the real API. Live run: 10/10 page loads
succeeded across 20 requests at a ~1/3 per-request failure rate, i.e. the
retry policy absorbed roughly 6-7 real injected failures.

These move to the top of `CoursesSection.tsx` at Step 3; they are a separate
file only so they can run outside Framer.

- [x] 199900 paise renders `₹1,999` (NOT `₹1,99,900`) — the straight-no line
- [x] 3999 cents renders `$39.99`
- [x] `/100` is on its own named line, not buried in the format call
- [x] Indian digit grouping correct for a 7-figure paise value
- [x] `fetchJson` uses GET only
- [x] `fetchJson` checks `res.ok`, since failures return valid JSON with a bad status
- [x] Retries up to `MAX_ATTEMPTS`, then throws
- [x] Network rejection (not just bad status) is caught and retried
- [x] `MAX_ATTEMPTS` is a single top-of-file constant

## Step 3 — Fetch + state machine, unstyled  (CLOSED)

Render `<pre>{JSON}</pre>`. Prove behaviour before appearance.

Built in `src/CoursesSection.tsx` (React wiring only) on top of
`src/helpers.ts` (pure logic). The failure matrix lives in `resolveLoad`,
a pure function, so all seven rows are covered by tests rather than by
clicking reload and hoping. Suite is now 33 assertions, all passing.

Boxes left unchecked below need eyes on Framer, not Node.

**DECISION CLOSED (approved):** helpers stay in a second file so they can be
unit-tested outside Framer. This supersedes the original single-file rule -
reasoning recorded in the decisions section above. No longer revisited at
Step 8.

- [x] Both calls fire in parallel via `Promise.allSettled`
- [x] courses reject -> error state
- [x] courses 200 but not an array -> error state (never `.map` a non-array)
- [x] courses 200 and empty -> empty state, distinct from error
- [x] country rejects -> `DEFAULT_COUNTRY` + `countryFailed` flag, grid still renders
- [x] Loading state visible from the first frame
- [x] No state update after unmount
- [x] Raw `detail` strings from the API never reach the screen
- [x] Observed real 404s and 500s during reloads, handled correctly

### Step 3 outcome

**Verified in Framer (as reported):** after the manual fixes below, the
component loads correctly and the state machine behaves as expected.

**Both failure paths observed live in Framer:**

1. A real course-API failure produced the error state, and the retry button
   recovered from it - so the full loading -> error -> loading -> ready cycle
   is confirmed against the real flaky API, not just against stubs.
2. The country-only failure was observed with the grid intact:

   ```
   status: "ready", country: null, courseCount: 9, showCountryNotice: true
   ```

   Courses still rendered, priced in INR. This is the case the brief
   singles out ("what happens when the country call fails but the course
   call works"), and it behaves as designed: the section degrades the
   presentation and keeps the content.

The empty state still cannot be triggered from the live API - it is stubbed
at Step 8.

**Framer/local parity - resolved.** Two manual fixes were made directly in
Framer and have been mirrored locally; the two copies now agree.

1. Removed the `{ cause }` option from `new Error(...)` in the helpers file,
   because Framer's editor flagged it. Most likely cause: Framer type-checks
   against a lib older than ES2022, where `ErrorOptions` does not exist on the
   `Error` constructor.
2. Corrected the helper filename/import casing so the helpers file resolves
   from `CoursesSection`.

**Bug found while reconciling the local copy - the comma operator.**

The local edit that removed the `cause` option moved a parenthesis:

```js
throw new Error("Could not load data from the server."), { cause: lastError };
```

`throw a, b` is the comma operator: it evaluates both operands and throws the
**last** one. So this threw a plain object, not an Error - `instanceof Error`
was false and `err.message` was `undefined`.

It is valid JavaScript, so there is no syntax error and no editor squiggle.
TypeScript does not flag it either, because `new Error(...)` counts as having
side effects. It was invisible in Framer because the line only runs when all
three attempts fail (~3.7% of loads), and `resolveLoad` ignores the rejection
reason entirely - it only reads `result.status === "rejected"`. The failure
would have surfaced at Step 5, as a blank error message with no obvious cause.

**Only the test suite caught it.** Fixed by restoring a plain
`new Error("Could not load data from the server.")` with no `cause`, and
switching the component import to the extensionless `"./helpers"`.

**Final test result: 33 passed, exit code 0.**

**Local VS Code errors are environment-only** (no `package.json`,
`tsconfig.json` or `node_modules`, so React types and the JSX flag are
missing). Framer supplies all of that in its own build. Deliberately not
fixing this for now - Framer is the build environment.


## Step 4 — CourseCard + grid  (CLOSED)

Card renders name, 2-line clamped description, price, `courseType` pill and a
`refundable` badge shown only when true. Grid is `<ul>`/`<li>` with the Step 1
container-query breakpoints. Loading/error/empty are still raw `<pre>` - Step 5
replaces them.

**Verified in Framer:** all checks pass in Preview and Canvas after the
ResizeObserver swap - 3/2/1 at the right widths, orphan rows correct at 7
cards, descriptions clamping at two lines, prices aligned across rows.

**Refundable badge, confirmed behaviour:** non-refundable courses show no badge
at all. There is deliberately no "Non-refundable" label - the badge is a
positive signal only, so its absence is not a claim.

**Detour:** container queries collapsed in Framer Preview and were replaced by
a ResizeObserver. Full diagnosis in the decisions table above and in
LEARNINGS.md. Test suite went 33 -> 39, the six new ones asserting the 3/2/1
boundaries.

- [x] Name, 2-line clamped description, price, `courseType` pill
- [x] Description clamps via CSS, not JS `substring`
- [x] Card is pure props-in (this is what makes the live edit a one-liner)
- [x] Grid uses the Step 1 container queries
- [x] 5-card and 10-card renders both look right
- [x] Cards in a partial last row are not stretched

## Step 5 — States and recovery UI  (CLOSED)

- [x] Skeleton cards during load
- [x] `StateMessage` shared by error and empty, different copy
- [x] "Try again" re-runs the whole load
- [x] Country-failure notice: disclosed, non-blocking, above the grid
- [x] Country retry re-fetches **only** the country call
- [x] On country retry success: notice disappears, every price reformats
- [x] `refundable` badge shows only when true

### Step 5 outcome

**Verified in Framer:** the country-only retry behaves as designed - the grid
stays in place while it checks, and the currency updates without a full reload.

**Four states, final:**

| State | Renders |
|---|---|
| loading | 6 pulsing skeleton cards in the measured column count, same `.sp-card` shell as the real cards so nothing shifts |
| error | `StateMessage` - "Couldn't load courses" + "Try again" (full reload) |
| empty | `StateMessage` - "No courses available" + "Check again"; wording never implies failure, because a 200 with `[]` is a success |
| ready | the grid, with the country notice above it when the region is unknown |

**The country retry is deliberately not routed through `reloadKey`,** because
that would set status to "loading" and blank a grid that is perfectly fine. It
writes `country` and nothing else. It skips the cancelled-flag discipline: the
only value it can write is `country`, and a concurrent full reload writes a
fresh one anyway, so the worst case is a slightly stale currency rather than a
corrupt grid. `countryRetrying` disables the button because - unlike the error
retry - this button stays mounted during its own request.

**Instrumentation removed:** the debug JSON dump and the FRAMER STYLE banner
are both gone, along with the stale file header that described them.

**Tests: 39 passed, exit code 0.** Component file is 469 lines, ~190 of which
is the CSS string.

## Step 6 — Property controls  (CLOSED)

- [x] Heading text (String) with a sensible default
- [x] Max courses (Number, 1-10, default 10) slicing the displayed list
- [x] Both verified from the Framer panel with the code editor closed
- [x] Neither control can break the layout at any value

### Step 6 outcome

**The two controls** (revised from the Step 0 pick of heading + accent colour):

| Control | Type | Why |
|---|---|---|
| Heading | String, default "Courses" | Copy is the single most common thing a designer changes. Empty string renders no `<h2>` rather than an empty gap |
| Max courses | Number, 1-10, default 10 | "This section is too long, show six" is a real landing-page request. Default 10 means inserting the component truncates nothing |

**Accent colour was dropped** after the component existed: the design is
near-monochrome, and the only colour surfaces are a grey pill and a green
refund badge whose colour is semantic. Adding accent surface purely to justify
a control is backwards.

**Both are render-time only.** Neither prop is in the effect's dependency array,
so changing a control never refetches. Verified in the network tab.

**The maxCourses trap, handled:** `isEmpty` still reads `courses.length`, never
the sliced length. Slicing a non-empty response down is not the same as the API
returning nothing, and showing "No courses available" over real data would be a
lie. Skeleton count follows the control via
`Math.max(1, Math.min(SKELETON_COUNT, maxCourses))` - the lower bound because an
empty loading state is an automatic fail.

### The Preview sizing question, resolved

The component was pinned to a fixed 1200px width in Framer, so it correctly
measured 1200 and rendered 3 columns no matter what the Preview toolbar said.
**Setting the Framer instance to Fill fixed the sizing relationship.**

Measured after the change:

| Preview width | Measured | Columns |
|---|---|---|
| 639 | 624 | 1 |
| 655 | 640 | 2 |
| 932 | 917 | 2 |
| 1039 | 1024 | 3 |
| 1200 | 1200 | 3 |

The consistent ~15px gap is Preview's scrollbar and chrome. **Decision: do not
compensate for it.** The breakpoints stay at 640 and 1024, because the component
should respond to its own real width, not to a number in a toolbar. Shifting
them to make the toolbar read nicely would be the Step 1 padding bug again, in a
new costume.

The ResizeObserver and `columnsForWidth()` were correct throughout. The earlier
Preview collapse was placement, not layout logic.

**Instrumentation removed:** the five-value measurement diagnostic is gone,
along with the `measuredWidth` state that only fed it.

**Open, deferred to the visual pass:** the heading has very low contrast in
Preview. Root cause is known - `.sp-section` sets `color` but no `background`,
so the text sits on whatever the Framer page provides. Canvas is white, the
Preview page is not.

**Tests: 39 passed, exit code 0.**

## Step 7 — Hero + footer

Built as Framer-native layers, not code components. Only the courses section is
required to be code, and using the tool where the tool fits reads better than
routing everything through React.

### Design tokens (shared with the courses section)

| Token | Hex |
|---|---|
| Page background | #F8FAFC |
| Card surface | #FFFFFF |
| Border | #E2E8F0 |
| Text | #0F172A |
| Muted | #475569 |
| Accent | #0D9488 (hover #0F766E) |

Type: **Outfit** headings, **Work Sans** body.
Shared measure: **max-width 1200, side padding 24** in all three sections.

### Page

- [ ] Page background #F8FAFC
- [ ] Page-level font set (Outfit / Work Sans) so the code component's
      `font-family: inherit` resolves to the same system
- [ ] Courses component instance set to **Fill** width

### Hero  (centred)

Left-aligning the hero to share the courses grid's left edge was considered and
**rejected** - the centred hero was kept. With no imagery to balance against,
centred reads as a deliberate standalone statement; the contrast with the
left-aligned grid below marks the change from "statement" to "scannable list".

```
Hero                    Frame - Fill x Fit
└─ Hero Content         Stack down - max-width 1200 - centred - align centre
   ├─ Hero Text         Stack down - gap 16
   │  ├─ Hero Headline  Text - max-width 640
   │  └─ Hero Subline   Text - max-width 620
   └─ Hero CTA          Frame/Link - anchors to the Courses section
      └─ Hero CTA Label Text
```

The nested `Hero Text` stack exists so two different gaps are possible: 16px
inside the text group, and more before the CTA. Framer stacks take only one gap
value, so the grouping has to carry it.

| Layer | Spec |
|---|---|
| Headline | Outfit 600, 60px desktop / 40px phone, line-height 1.1, -0.02em, #0F172A |
| Subline | Work Sans 400, 18px, line-height 1.6, #475569 |
| CTA | Fill #0D9488, text #FFFFFF, radius 10, hover #0F766E, **links to the Courses section** |

**The max-widths exist to control line breaks.** The headline copy is ~34
characters; unconstrained at 60px it runs to roughly 1020px and wraps
unpredictably, and at ~800 it breaks leaving `online.` alone on the second line.
Capping it keeps the break balanced. Same reasoning for the subline, which
otherwise orphans `skills.`.

**The CTA is wired to scroll to the Courses section.** A primary button that
does nothing was the single clearest sign the page was a mockup rather than a
site.

**Copy (final):**

> Skills for people building online.
>
> Practical, self-paced courses for creators, freelancers, and people building
> digital skills.
>
> [ Browse courses ]  -> anchors to the Courses section

Deliberately makes **no claim about who teaches the courses**. The API returns
no instructor data, so any line about creators "who have done the work" would be
invented. Nothing on the page should assert something the data cannot support.

### Footer

```
Footer                  Frame - Fill x Fit - fill #F8FAFC - border-top 1px #E2E8F0
└─ Footer Content       Stack right - space-between - center - max-width 1200 - padding 56/24
   ├─ Footer Links      Stack right - gap 24
   │  ├─ Link - About
   │  ├─ Link - Courses
   │  └─ Link - Contact
   └─ Footer Copyright  Text
```

| Layer | Spec |
|---|---|
| Links | Work Sans 400, 14px, #475569, vertical padding 10-12 so the tap target reaches ~40px, hover #0F172A |
| Copyright | Work Sans 400, 14px, #475569 - "© 2026 Skillpath" |

### Responsive (phone breakpoint only)

- [ ] Hero padding 120 -> 72, headline 60 -> 40
- [ ] Footer content stack -> vertical, gap 16, align left
- [ ] Everything else identical: 1200 measure, 24 side padding, palette

### Checks

- [ ] Hero, courses and footer share the same left/right content edges
- [ ] No seam between sections (all three on #F8FAFC)
- [ ] `font-family: inherit` resolves to Work Sans, NOT a serif fallback
- [ ] CTA and footer links have hover states
- [ ] Full page scrolls cleanly at desktop and at 375px

## Step 8 — Adversarial testing  (CLOSED)

- [x] Empty state forced by stubbing `[]`
- [x] Non-array 200 forced by stubbing
- [x] 15+ hard reloads to sample real API failures
- [x] Continuous resize 320px -> 1920px, no breakage at boundaries
- [x] Both currencies confirmed against real `IN` and `US` responses
- [x] Published link opened in a fresh browser (straight-no: link doesn't open)
- [x] Cold-start load (Render free tier can take 30s+) still shows the loading state

### The two stubbed cases - results

Both live in `tests/adversarial.test.mjs` (13 assertions, all passing). They are
driven through the **same composition the component uses** -
`Promise.allSettled([fetchJson, fetchJson])` then `resolveLoad` - rather than by
calling `resolveLoad` directly, so the stubbed HTTP response passes through the
real fetch and retry layer on its way in.

**Case 1 - a 200 carrying `[]`** reaches the empty state, not the error state.
Status stays `"ready"`, `courses` is `[]`, and `isEmpty` derives true. Also
asserted: `"empty"` never becomes a stored status, and a non-empty response does
not trigger the empty branch.

**Case 2 - a 200 that is not an array** becomes the error state. Verified across
six payload shapes: an error object, an empty object, a bare string, a number,
`null`, and an array wrapped in an object. In every case `courses` is `[]`, so
nothing can reach `.map()`, and `isEmpty` stays false - error and empty remain
distinct states.

**Case 3 - each combined with a country failure.** Empty courses plus a failed
country stays ready and empty; a non-array payload plus a failed country
produces the error state with the country result discarded and no notice shown
on top of the error.

**No bug found, so the implementation was not changed.**

**One behaviour recorded, not fixed:** empty courses plus a failed country
renders the currency notice *and* the empty message together - "showing prices
in rupees" above "No courses available", when there are no prices on screen. It
is unreachable against the live API (which has never returned an empty array in
~80 calls) and harmless, but it is a known cosmetic wrinkle rather than an
oversight.

**The browser-side checks were run separately and reported as passing:** the
resize sweep, repeated hard reloads against the real flaky API, both currencies
against live `IN` and `US` responses, the cold-start load, and the published
Framer link opening in a fresh browser.

## Step 9 — The 200-word note

- [ ] Names the retry-on-404 decision and why it is normally wrong
- [ ] Names the INR default and the asymmetry behind it
- [ ] Admits the empty state could not be triggered from the live API
- [ ] Says what two more days would fix
- [ ] AI usage declared + chat link
