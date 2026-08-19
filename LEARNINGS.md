# LEARNINGS

Concepts I need to be able to explain on the call. One section per checkpoint.
Written in my own words after Claude explains each step.

---

## Step 1 — Container queries in a Framer Code Component

> **Superseded at Step 4.** The technique passed this spike and worked on the
> Framer canvas, but collapsed in Framer Preview. The grid now measures with a
> ResizeObserver - see "The container-query approach failed in Framer Preview"
> in Step 4. Everything below about the content box and the padding trap still
> applies, and is exactly why the swap was cheap.


### Why container queries instead of media queries

A **media query** asks the *viewport* how wide it is. A **container query** asks
a chosen *ancestor element* how wide it is.

This matters specifically because of the Framer canvas. On the canvas, a 375px
mobile frame sits inside a browser window that might be 1920px wide. A media
query reads 1920px and applies desktop rules, so the phone-sized frame renders
3 columns and looks broken. A container query reads the frame, which is the
thing the layout should actually respond to.

One-line version: **media queries read the window, container queries read the
element.**

### How the mechanism works

1. Put `container-type: inline-size` on a wrapper. That element becomes a
   *query container* measured on its horizontal axis.
2. `@container (min-width: 640px) { ... }` inside it resolves against that
   wrapper's width, not the viewport's.
3. Rules are written mobile-first: 1 column unconditionally, then `min-width`
   overrides in ascending order. Every width in between keeps the last rule that
   matched, so there is no width where the layout is undefined.

`inline-size` also applies size containment on the inline axis: the element's
**width stops responding to its contents** and is set purely by its parent.
That is what we want (fill the frame), and it is why `container-type` belongs
on a wrapper rather than on the grid itself. Height is unaffected, so the
section still grows with its content.

### The bug I hit: breakpoints shifted by the padding

**Symptom:** 639/640 -> MOBILE, 1023/1024 -> TABLET, 1072 -> DESKTOP.
Every breakpoint was 48px late.

**Cause:** one element was doing two jobs.

```css
.sp-wrap {
    container-type: inline-size;
    width: 100%;
    box-sizing: border-box;
    padding: 24px;        /* <- this corrupted the measurement */
}
```

**A size container query is evaluated against the query container's CONTENT
box, not its border box.** This is the non-obvious part. Everywhere else in
CSS, `width: 100%` with `box-sizing: border-box` means "my outer edge matches
my parent" — and that stays true here. But `@container` ignores the outer edge
and asks about the space *inside* the padding.

So for a frame of width `W`: border box = `W`, content box = `W - 48`.

- `min-width: 640px` fires when `W - 48 >= 640`, i.e. **W >= 688**
- `min-width: 1024px` fires when `W - 48 >= 1024`, i.e. **W >= 1072**

The measured 1072px transition matched that prediction to the pixel, which is
what confirmed the diagnosis rather than just making it plausible.

Worth noting: `box-sizing: border-box` **causes** this rather than preventing
it. It pulls the padding inside the 100% width, so the content box ends up
smaller than the frame.

### Why we fixed it by splitting the wrapper

Padding is a *content* concern. Being a query container is a *measurement*
concern. They were sharing an element, so the spacing corrupted the
measurement. The fix separates them:

```
.sp-wrap    container-type: inline-size, width:100%, NO padding   <- measures
  .sp-inner padding: 24px                                          <- spaces
```

The content box of `.sp-wrap` now equals the frame width, so `640` and `1024`
in the CSS mean 640 and 1024 in Framer's width field.

**Rejected alternatives:**

- *Shift the thresholds to 688/1072.* Works today, but the numbers stop meaning
  anything and every breakpoint silently moves if the padding ever changes. It
  encodes the bug as a constant.
- *Move the padding onto the grid.* Fixes the measurement but couples the
  section's outer spacing to the grid, so the heading and the failure notice
  would each need their own padding.

**Rule to carry forward: never put padding on a query container.**

### Why the spike was built the way it was

- The breakpoint **readout** is toggled by the same CSS under test, not by JS.
  A JS width readout would prove that JavaScript can measure the element — it
  would prove nothing about whether the CSS rules fired.
- The **support probe** defaults to *visible* and is hidden inside
  `@supports (container-type: inline-size)`. A probe that defaults to hidden
  tells you nothing when the stylesheet never applies.
- **7 boxes**, an odd count against a 3-column grid, so the partial last row is
  visible before the real 5-10 card grid depends on it.

### Considered and deferred

`container-name`. You can name a container and query it explicitly
(`@container sp-section (min-width: ...)`), which protects against the query
accidentally binding to a different ancestor container. Not needed here since
there is only one container in the tree; worth remembering if nesting appears.

### Likely interview questions

**Q: Why container queries instead of media queries?**
A: Media queries measure the viewport. On the Framer canvas the viewport is the
browser window, so a 375px mobile frame on a 1920px screen would get desktop
rules and render 3 columns. Container queries measure the component's own
wrapper, which is the frame — the thing the layout should actually respond to.

**Q: Why is there an extra wrapper div instead of one padded element?**
A: Because a size container query measures the container's content box. When
padding sat on the same element as `container-type`, the measured width was the
frame minus 48px, so the 640px breakpoint fired at 688px and the 1024px one at
1072px. The outer div now only measures, and the inner div holds the padding,
so the CSS numbers match Framer's width field.

**Q (follow-up): Doesn't `box-sizing: border-box` prevent that?**
A: The opposite. `border-box` pulls the padding inside the 100% width, which
shrinks the content box below the frame width. Container queries read the
content box, so that is exactly what shifted the breakpoints.

---

## Step 2 — The two pure helpers

### formatPrice — the units are the whole point

The API sends the **smallest unit** of each currency. Both branches divide by
100 exactly once, on their own named line:

```ts
const rupees  = course.pricePaise    / 100   // 199900 paise -> 1999
const dollars = course.priceUsdCents / 100   //   3999 cents ->   39.99
```

`199900` is ₹1,999. Rendering ₹1,99,900 is an explicit straight-no in the
brief. The division stays on a named line rather than inline inside the format
call because this is the single most scrutinised expression in the submission.

### Why Intl.NumberFormat instead of manual string building

`Intl` gives the **Indian digit grouping** for free. Indian numbering groups
the last three digits, then twos: ₹1,00,000 for one lakh, ₹1,00,00,000 for one
crore — not the Western ₹100,000. Hand-rolling that with regex or `toFixed`
means reimplementing a locale rule the platform already knows. `Intl` also
supplies the correct symbol and its placement per locale.

### The decimal decision, and why the two currencies differ

- **INR:** `fractionDigits = pricePaise % 100 === 0 ? 0 : 2`. Indian price
  convention drops paise when there are none — ₹1,999, not ₹1,999.00.
- **USD:** left at the default 2 decimals, because dollar prices conventionally
  keep cents — $39.99 and $40.00, never $40.

This looks inconsistent and is deliberate: it follows each currency's
convention rather than imposing one rule on both.

Why the modulo test instead of just `maximumFractionDigits: 0`: max-0 would
**round** ₹1,999.50 to ₹2,000, silently misreporting a price. Every price in
the live data is a whole rupee today, but the code should not depend on that.

### Returning null instead of "₹NaN"

If the price field is missing or not a number, `formatPrice` returns `null`
rather than formatting `NaN`. The helper's job is formatting; deciding what to
show when there is nothing to format is the component's job at Step 4. This
also stops a bad payload from putting "₹NaN" on screen, which reads as broken.

### Unknown country codes fall through to INR

The check is `if (countryCode === "US")` and everything else formats as INR.
That is not laziness - it is the same fallback decision made for the
country-call failure, expressed in one place instead of two.

### fetchJson — why res.ok, not try/catch alone

**A failed request from this API still returns valid JSON**, e.g.
`{"detail":"FAAAAAAAAAAA"}` with a 404. So `await response.json()` succeeds on
a failure, and a naive `try { return await res.json() } catch` would treat the
error body as data and hand `{detail: ...}` to `.map()`. **The HTTP status is
the only reliable signal**, which is why `res.ok` is checked before the body is
touched.

Related: on a failed response we never call `.json()` at all. The API's joke
error strings ("this aint working dawg", "maybe turn it on and off?") never
enter the program, so they cannot reach the screen by accident. That is a
stronger guarantee than remembering not to render them.

### The retry loop

A `for` loop from 1 to `MAX_ATTEMPTS` with one `try/catch` inside. The catch
handles three different failures identically:

1. a non-ok status thrown above,
2. a network-level rejection from `fetch` itself (offline, DNS, CORS),
3. a malformed JSON body on a 200.

All three mean "that attempt did not produce data," so all three retry.

**Retrying a 404 is normally wrong** - it means the resource does not exist, so
retrying is a client that ignores the protocol. It is right *here* because the
assignment states the 404s are injected, and I confirmed the same URL returns
200 seconds later. The code says this in a comment. Knowing it is normally
wrong is the point.

**Fixed 400ms delay, not exponential backoff.** Backoff protects an overloaded
server. This server is not overloaded, it fails at random by design, so backoff
would only make the page slower for no benefit.

### Error cause

The final throw is a plain user-safe sentence, with the original failure
attached via `new Error(msg, { cause: lastError })`. The UI shows the message;
devtools can still see what actually happened. One line, no debugging lost.

### Measured evidence

- 21 assertions pass in `tests/helpers.test.mjs` (plain Node, no dependencies).
- `tests/live-check.mjs`: **10/10 page loads succeeded** across 20 real requests
  at a ~1/3 per-request failure rate. Without retries that would have been
  roughly 4-5 visibly failed loads.

### Likely interview questions

**Q: Why check `res.ok` when you are already in a try/catch?**
A: `fetch` only rejects on network-level failures, not on 4xx/5xx. This API
returns valid JSON with its error statuses, so `.json()` would succeed on a
404 and I would hand an error object to the grid. The status is the only
reliable signal, so I check it before reading the body - which also means the
API's error text never enters the program.

**Q: Why retry a 404? That resource does not exist.**
A: Normally I would not, and the code says so in a comment. This API injects
fake 404s on about 1 in 3 requests to a URL that provably works, so here they
are transient and worth retrying. Three attempts takes the visible failure rate
from ~33% to ~3.7%.

**Q: Why not exponential backoff?**
A: Backoff exists to relieve an overloaded server. This one is not overloaded,
it is failing at random on purpose, so backoff would only make the page slower
without improving the odds. A fixed 400ms is enough to space the attempts.

**Q: Why does INR drop the decimals but USD keeps them?**
A: Currency convention. Indian prices are written ₹1,999, dollar prices $39.99
or $40.00. I use a modulo check rather than `maximumFractionDigits: 0` because
max-0 would round ₹1,999.50 up to ₹2,000 and misreport the price.

---

## Step 3 — React data flow and the state machine

### The state model

```
status:    "loading" | "ready" | "error"     decides which body renders
courses:   Course[]                          data slot
country:   "IN" | "US" | null                null = not detected
reloadKey: number                            bump to retry
```

Two values are **derived, never stored**:

```ts
const isEmpty = status === "ready" && courses.length === 0
const showCountryNotice = status === "ready" && country === null
```

**Why "empty" is not a status.** If it were, `status: "empty"` with three
courses in the array would be a writable bug. Deriving it from
`courses.length` means the two can never disagree - there is only one source
of truth.

**Why `country` sits outside `status`.** The two API calls are not peers.
Courses are the content: no courses, nothing to render, the section fails.
The country code only picks which of two numbers we already hold gets
formatted, so losing it costs currency accuracy and nothing else. The state
shape says that out loud instead of leaving it to a comment.

### Is `null` safe for both "not loaded yet" and "detection failed"?

Yes, because **`country` is only ever read when `status === "ready"`**:

| status | country | who reads country |
|---|---|---|
| loading | null | nobody - skeletons render |
| ready | "IN"/"US" | prices |
| ready | null | prices (rupee fallback) + the notice |
| error | anything | nobody |

The variable alone is ambiguous; the pair `(status, country)` is not, and the
pair is all we consume. The risk is someone later writing `country === null`
without the status guard, so the guard is written **once** as
`showCountryNotice` and everything else uses that name.

### Coordination: allSettled, not all or sequential

Neither call needs the other's result, so sequencing them would only add
latency (~2s + ~2s in the worst case, since each retries internally).

- `Promise.all` is all-or-nothing: one rejection discards the other call's
  success. That is exactly wrong when only the country call fails.
- `Promise.allSettled` never rejects and returns
  `{ status: "fulfilled" | "rejected" }` per call, which maps one-to-one onto
  the failure matrix.

`fetchJson` already retries internally, so `allSettled` only sees final
outcomes. **The component knows nothing about retry policy** - that layering
is what keeps the effect short enough to read in one screen.

### resolveLoad - the matrix as a pure function

All the decision-making was pulled out of the effect into `resolveLoad`, which
takes the two settled results and returns `{ status, courses, country }`. It
touches no React, so all seven rows of the failure matrix are covered by unit
tests instead of by reloading the page and hoping the right dice come up.

Validation is on the **shape, not just the HTTP status**:

- `parseCourses` - anything that is not an array becomes an error. A 200
  carrying `{detail: "gg"}` would otherwise reach `.map()` and blank the page,
  which is an automatic fail.
- `parseCountryCode` - only exactly `"IN"` or `"US"` counts as success. A 200
  carrying `{}` or `{"country_code":"XX"}` falls back to `null`, so the user
  gets the notice rather than a silent default.

### The cancelled flag - what it actually protects against

React 18 **removed** the "state update on an unmounted component" warning, so
that is not the reason. Setting state after unmount is a harmless no-op.

The real risk is **out-of-order results**. A load takes up to ~2s because of
retries, so clicking retry mid-flight leaves two loads running, and the slower
one can land last and overwrite newer data. Since the API returns a varying
5-10 courses, that is visible: the card count changes for no reason.

```ts
useEffect(() => {
    let cancelled = false          // a NEW variable on every run
    ...
    return () => { cancelled = true }   // flips only THIS run's copy
}, [reloadKey])
```

Each effect run closes over its own `cancelled`. It is not a shared flag.

**Why retry bumps `reloadKey` instead of calling `load()`.** Changing the
dependency makes React re-run the effect, and React runs the **cleanup first**.
So the old run is disowned before the new one starts, and the same three lines
fix both the retry race and unmount. Calling `load()` straight from the button
would skip the cleanup entirely and let a stale response land on fresh data.

The old requests are **not cancelled, only ignored** - without an
`AbortController` they still complete on the network. `AbortController` was
rejected because an aborted fetch rejects, and `fetchJson`'s retry loop catches
every rejection and retries it, so aborting would make the component fight its
own cleanup unless `AbortError` were special-cased.

### A guard that came for free

The retry button lives inside the error state. Clicking it sets `status` to
`"loading"`, which unmounts the error UI and the button with it. Double-clicks
are impossible without a `disabled` prop or extra state.

### Likely interview questions

**Q: Why is `empty` not one of your statuses?**
A: It is derivable from `courses.length`, and storing it would let the two
disagree - `status: "empty"` with three courses is a bug you can write. I
derive it once so there is a single source of truth.

**Q: What happens if I click retry while a request is still in flight?**
A: The click bumps `reloadKey`, React re-runs the effect and runs the previous
run's cleanup first, which flips that run's `cancelled` flag. The old requests
still finish on the network, but their results are discarded. Only the newest
run can write state, so results landing out of order cannot corrupt the UI.

**Q: Why `allSettled` rather than `Promise.all`?**
A: `all` rejects as soon as one promise rejects, so a failed country call would
throw away a successful courses call. `allSettled` always resolves and reports
each outcome separately, which is what lets the grid render with a currency
fallback instead of failing entirely.

**Q: Your API returned 200. Why still validate the body?**
A: A 200 does not guarantee the shape. If the body were not an array, `.map`
would throw and the section would go blank, which is an automatic fail in this
brief. Same for the country code: I only accept exactly "IN" or "US", so a
malformed 200 shows the fallback notice instead of silently defaulting.

### Why two files, not one (decision revised at Step 3)

The original plan was a single component file, argued on the grounds that
nothing here is reused and every file boundary is a tax paid during the
live-change test on the call.

That reasoning held while the only candidates were `formatPrice` and
`fetchJson`. It stopped holding once `resolveLoad` existed. Node cannot run a
`.tsx` file without a JSX transform, so merging the files would have meant
giving up unit tests on the seven-row failure matrix and on the price maths -
the two things in this build most worth testing, because both are wrong
invisibly rather than obviously.

**Reuse was never the only reason to split a file. Testability is the better
one.** And the cost the original decision was protecting against does not land
here: "add a field to a card" touches only `CoursesSection.tsx`, so `helpers.ts`
is never opened during the live edit.

The split line: `helpers.ts` holds anything pure and testable - constants,
types, `formatPrice`, `fetchJson`, the parsers, `resolveLoad`.
`CoursesSection.tsx` holds React only - state, the effect, derived values,
markup. If a decision ever needs a test, that is the signal it belongs in
`helpers.ts`.

**Q: Why is this split across two files?**
A: `helpers.ts` is pure logic with no React in it, so it runs in Node and I can
unit test it - the price conversion and the API failure matrix are both things
that fail invisibly, so I wanted assertions on them rather than reloading the
page and hoping. The component file holds only React wiring and markup.

### Step 3 closing notes - Framer vs local, and one real bug

**Framer is a different environment from the local folder.** Two things had to
change by hand to get the component running there:

1. **`new Error(msg, { cause })` was rejected by Framer's editor.** The second
   argument (`ErrorOptions`) is ES2022; Framer most likely type-checks against
   an older lib where the `Error` constructor takes only a message. The fix was
   to drop `cause` entirely rather than work around it - it was a
   developer-convenience feature, not something the UI depends on.
2. **File naming and import resolution.** Framer stores code files as `.tsx`,
   while the local helpers file is `.ts` so Node's type stripping can run the
   tests on it. The **extensionless** import `from "./helpers"` is what works
   in both places: TypeScript resolves `helpers.ts` locally, and it is Framer's
   own convention. Writing `from "./helpers.ts"` is a TypeScript error (TS5097)
   unless `allowImportingTsExtensions` is on.

### The comma operator bug - the most useful thing I learned this step

Removing the `cause` option moved one parenthesis:

```js
// intended
throw new Error("Could not load data from the server.")

// what was actually written
throw new Error("Could not load data from the server."), { cause: lastError };
```

`throw a, b` is the **comma operator**. It evaluates both operands and produces
the **last** one, so this threw a plain object literal instead of an Error:

```
is an Error   : false
e.message     : undefined
thrown value  : {"cause":"original"}
```

**Why nothing caught it except the test suite:**

- It is **valid JavaScript**, so there is no syntax error and no red squiggle.
- **TypeScript does not flag it.** Its "left side of comma operator is unused"
  check does not fire, because `new Error(...)` is a constructor call and counts
  as having side effects.
- **Framer looked fine.** That line only runs when all three attempts fail
  (~3.7% of loads), and `resolveLoad` never reads the rejection reason - it only
  checks `result.status === "rejected"`. The damage was real but dormant. It
  would have surfaced at Step 5 as an error state with a blank message.

The general lesson: **the type checker and the running app can both be happy
while the code is wrong.** Assertions are what cover the gap, and they are worth
most exactly where failures are silent - here, the price maths and the error
path, neither of which announces itself when it breaks.

### Likely interview questions

**Q: Why is there no `cause` on your thrown error?**
A: I had one originally so the underlying failure was visible in devtools, but
Framer's editor rejected the second `Error` argument - it is ES2022 and Framer
appears to type-check against an older lib. The UI never depended on it, so I
dropped it rather than working around it. Removing it is also what exposed a
comma-operator bug that was silently throwing a plain object instead of an
Error.

**Q: How did you catch a bug that TypeScript and the running app both missed?**
A: The unit tests. The thrown value stopped being an `Error`, so `err.message`
became `undefined` - but that line only executes when all three retries fail,
which is about 3.7% of loads, and nothing in the component reads the rejection
reason yet. It was valid JavaScript, so nothing flagged it. The assertion on the
error message was the only thing that noticed.

---

## Step 4 — The card and the responsive grid

### Card props: course + countryCode

```tsx
<CourseCard course={course} countryCode={currencyCountry} />
```

The card holds the whole `course` object and formats its own price. The
alternative was to pre-format in the parent and pass `price="Rs 1,999"`.

Passing the object wins for one specific reason: **"add a field to a card" is
then a one-line change inside `CourseCard` and nowhere else** - which is
literally the exercise they run on the call. The null-price decision is also a
rendering decision, so it belongs in the card rather than the parent.

`CourseCard` holds no state. Pure props in, JSX out.

### The fallback is resolved once

```tsx
const currencyCountry = country ?? DEFAULT_COUNTRY
```

Same discipline as `showCountryNotice`: the `?? DEFAULT_COUNTRY` fallback
appears in exactly one place in the whole component, not once per card. If the
default currency ever changes, there is one line to edit.

### margin-top: auto - why prices line up

Grid rows stretch cards to equal height, but their content does not match: a
one-line title next to a two-line title pushes everything below it out of
alignment.

```css
.sp-card  { display: flex; flex-direction: column; }
.sp-price { margin-top: auto; }
```

`margin-top: auto` on the last child absorbs all the leftover vertical space,
pinning the price to the bottom of the card. **Prices then align across a row
no matter how the titles wrap** - the alignment people actually notice.

### The two-line clamp is CSS, not JavaScript

```css
display: -webkit-box;
-webkit-box-orient: vertical;
-webkit-line-clamp: 2;
overflow: hidden;
```

A JS `substring` cannot know the rendered width, so it would cut at a different
point at every screen size and every column count. CSS clamps at the real line
box and adds the ellipsis itself. The `-webkit-` prefix is required even in
Firefox and Chrome - it is a prefixed property that was standardised as-is.

Descriptions in this API run 107-132 characters, so they always clamp. The
course names are short (27 chars at most), so the title is left to wrap
naturally - the flex layout already absorbs the height difference.

### Keys: courseCode, not the array index

Index keys are wrong the moment the list order can change. If the optional
"sort by price" gets built, index keys would keep DOM nodes attached to the
wrong data as items move. `courseCode` is unique across all 10 courses and
readable in React DevTools.

### The grid, and orphan rows

The column count is applied inline from a measured value (see the
ResizeObserver section below); the stylesheet keeps `1fr` as the
pre-measurement default.

```css
.sp-grid { display: grid; grid-template-columns: 1fr; gap: 20px; }
```
```tsx
<ul className="sp-grid" style={{ gridTemplateColumns: `repeat(${columns}, 1fr)` }}>
```

Because the columns are `1fr`, a 7th card in a 3-column grid occupies exactly
one column and does not stretch. **The thing to avoid is "fixing" the gap with
`justify-content: center`** - that would centre the orphans and misalign them
against the rows above. The variable 5-10 card count needs no special handling
at all.

### ul / li instead of divs

A list of courses is a list. Screen readers announce "list, 9 items", which is
genuinely useful when the count varies between loads. The cost is one line of
reset (`list-style: none; margin: 0; padding: 0`). Heading is `<h2>` because
the hero owns the page's `<h1>`, and the card title is `<h3>` under it.

### Why all the styling is in one <style> block

Three things cannot be done with inline style objects: container queries,
`-webkit-line-clamp` (four properties that read terribly as an object), and
hover/focus states. Splitting the styling between CSS and `style={{}}` would
mean two places to look for every visual question, so it all lives in one
contiguous block at the top of the file.

### Likely interview questions

**Q: Why does the card take the whole course object instead of just the fields
it renders?**
A: So adding a field is a one-line change inside the card. If I passed
individual props I would have to edit the type, the call site and the card for
every new field.

**Q: Why is the price pinned with `margin-top: auto` rather than a fixed card
height?**
A: A fixed height breaks as soon as a title wraps to two lines or the font
changes. `margin-top: auto` absorbs whatever space is left, so prices align
across a row regardless of the content above them.

**Q: Why not truncate the description in JavaScript?**
A: JavaScript cannot know the rendered width, so it would cut at a different
point in one, two and three column layouts. CSS clamps at the real line box.

**Q: What happens with 7 courses in a 3-column grid?**
A: The last row holds one card at one column width. `1fr` columns keep it the
same size as every other card - nothing stretches, and nothing needs handling
for the varying count.

### The container-query approach failed in Framer Preview

Container queries worked on the Framer canvas and passed the Step 1 spike, but
collapsed in **Preview**: a very narrow single column with a horizontal
scrollbar, at a frame set to 1200px.

**The mechanism.** `container-type: inline-size` applies inline-axis size
containment, which removes the element's own contents from its intrinsic width.
That is invisible while the parent has a definite width - which the canvas
always supplies. Framer's Preview wrapper is content-sized instead:

```
contained element contributes 0 intrinsic width
   -> content-sized wrapper resolves to ~0
   -> width: 100% of ~0 is ~0
   -> grid falls to the 1-column default
   -> cards overflow the collapsed box -> scrollbar
```

The scrollbar is the tell. A merely narrow container gives one column and no
overflow; overflow means the box is narrower than the content's minimum width.

**How it was diagnosed, in order:**

1. **One-line test** - commented out `container-type`. Preview went wide
   immediately, which isolated containment as the cause rather than a guess
   about breakpoints or placement.
2. **Tried the Framer sizing contract** - Framer passes a code component's size
   in a `style` prop, so it was applied to the root. No change.
3. **Printed the prop** - it arrives as `{"width":"100%"}`. A percentage, not a
   definite width, so it re-posed the same question one level up. That is why
   applying it could not have worked.

**Things that do NOT fix it, and why:**

- Moving `container-type` to an inner wrapper - the root's intrinsic width then
  comes from a contained child, so it collapses one level down instead.
- `min-width: 100%` - still a percentage of a collapsed parent.
- `@framerSupportedLayoutWidth any-prefer-fixed` - pushes the component toward
  a *fixed* width, which fights the responsiveness the section is graded on.
- `contain-intrinsic-inline-size` - works, but requires a hardcoded pixel
  number that is inert when the parent is definite and wrong when it is narrow.

**There is no CSS fix from inside the component.** Container queries require the
parent's inline size to be definite. That is the contract.

### Why ResizeObserver, and why the swap was cheap

```tsx
const observer = new ResizeObserver(([entry]) => {
    setColumns(columnsForWidth(entry.contentRect.width))
})
observer.observe(element)
return () => observer.disconnect()
```

No containment, so nothing can collapse: the section's contents contribute
their own intrinsic width again.

**`contentRect` is the CONTENT box** - the same box a container query measured.
And `.sp-section` still carries no padding, because of the Step 1 wrapper split.
That is what made this a drop-in swap rather than a re-derivation: **640 and
1024 still mean 640 and 1024.** If the padding had still been on the query
container, every threshold would have needed recomputing.

The thresholds also moved into a pure function:

```ts
export function columnsForWidth(width: number): number {
    if (width >= DESKTOP_MIN_WIDTH) return 3
    if (width >= TABLET_MIN_WIDTH) return 2
    return 1
}
```

which means the boundaries are now **asserted at 639/640 and 1023/1024**, plus a
test pinning 687/688 and 1071/1072 as non-boundaries so the Step 1 padding bug
cannot come back silently. That is strictly better than the CSS version, where
the thresholds could only be checked by dragging a frame.

**Two costs, worth knowing:**

- One frame at 1 column on first paint - `ResizeObserver` fires after layout.
- It needs a browser, so server-rendered HTML starts at one column and corrects
  on hydration. That is why the CSS default stays at `1fr`.

### Likely interview questions

**Q: Why measure with JavaScript instead of using CSS container queries?**
A: I started with container queries and they worked on the Framer canvas. They
collapsed in Preview, because `container-type` applies size containment - the
element stops contributing its own width - and Framer's Preview wrapper is
content-sized, so there was nothing definite to resolve against. I confirmed it
by commenting out one line and by printing the `style` prop Framer passes, which
turned out to be `width: 100%`. A ResizeObserver needs no containment, so it
cannot collapse.

**Q: Did moving to JavaScript change your breakpoints?**
A: No, and that was deliberate. `contentRect` is the content box, the same box a
container query measures, and the section has no padding - the padding is on an
inner wrapper. So 640 still means 640. I also moved the thresholds into a pure
function so I could assert the boundaries instead of dragging a frame.

---

## Step 5 — The four states

### Skeletons reuse the real card shell

`SkeletonCard` renders `.sp-card` with grey bars inside it, and the skeleton
grid uses the same measured column count as the real grid:

```tsx
const gridColumns = { gridTemplateColumns: `repeat(${columns}, 1fr)` }
```

Both grids share that object. A loading state at one column that jumps to three
would be worse than no skeletons at all - the point of a skeleton is that the
layout does not move when the data lands. `.sp-bar-price` even carries the same
`margin-top: auto` as the real price, so the placeholder sits where the price
will sit.

**Six of them**, because 6 divides evenly into 3, 2 and 1 columns and never
leaves a ragged row. The real count is 5-10 and unknowable before the response,
so the number is arbitrary - it just should not look broken.

The pulse is a slow opacity animation guarded by
`@media (prefers-reduced-motion: reduce)`, which switches it off for anyone who
has asked their OS for less motion.

This is also the direct answer to one of the six straight-no conditions:
"nothing happens while it's loading".

### Error and empty are the same component, deliberately

`StateMessage` takes a title, a body and an optional action. Error and empty are
the same layout with different words, and **two components rendering identical
markup is exactly the duplication a reviewer flags**.

The wording is the part that matters:

- **Error:** "Couldn't load courses / Something went wrong while loading."
- **Empty:** "No courses available / There's nothing to show here right now."

Empty is a **successful** response - a 200 carrying `[]` - so its copy never
implies a failure. It still offers "Check again", because this API's course list
genuinely varies between calls, and a dead end with no action is worse than an
action that might not be needed.

Neither message contains a status code or anything from the response body. It
cannot: `fetchJson` never reads the body of a failed response.

### The country-only retry - the interesting one

```tsx
async function retryCountry() {
    setCountryRetrying(true)
    try {
        const value = await fetchJson(COUNTRY_PATH)
        setCountry(parseCountryCode(value))
    } catch {
        // still no country - the notice stays, the button comes back
    } finally {
        setCountryRetrying(false)
    }
}
```

**Why it does not use `reloadKey`.** Everything at Step 3 says retries go through
the key so the effect re-runs and the cleanup disowns stale work. This one
deliberately does not, because bumping `reloadKey` sets `status` to `"loading"`
and would replace a perfectly good grid with skeletons. The user asked to fix
the *currency*, not to reload the section. So this writes `country` and nothing
else: the cards stay, and every price reformats in place because `formatPrice`
is called during render rather than cached per card.

**What it gives up, and why that is acceptable.** No cancelled flag, so it sits
outside the Step 3 discipline. The trade is bounded: the only value it can write
is `country`. If a full reload is in flight, both write a country and the later
one wins - worst case a slightly stale currency, never a corrupt grid. That is a
very different blast radius from the courses race, which could have changed the
card count under the user.

**Why `countryRetrying` exists when the error button needed no such flag.** The
error retry gets a free guard: clicking it flips `status` to `"loading"`, which
unmounts the error UI and the button with it. This button stays mounted through
its own request, and `fetchJson` takes up to ~2s because of its three internal
attempts - so without the flag, impatient clicking fires overlapping requests.

**The empty catch is deliberate.** If the retry fails, `country` stays null, the
notice stays up and the button comes back. That already tells the user
everything true. A second error message would be noise stacked on a notice that
is already saying it.

**One consequence:** `parseCountryCode` returns null for a malformed 200, so a
successful-but-junk response is treated exactly like a failure through this new
entry point too. The Step 3 validation rule holds wherever the country is set.

### Likely interview questions

**Q: Why does the country retry not go through the same retry mechanism as the
error state?**
A: Because the main retry sets status to "loading", which would blank the grid.
The courses are fine in that scenario - only the currency is unknown - so the
retry writes just the country and the cards never leave the screen.

**Q: Isn't skipping the cancelled flag there inconsistent?**
A: It is a deliberate exception with a bounded cost. That handler can only write
`country`, and a concurrent full reload writes a fresh country anyway, so the
worst outcome is a slightly stale currency. The flag matters for courses because
a stale response there could change the card count under the user.

**Q: Why is there a disabled state on that button but not the other one?**
A: The error retry unmounts itself - clicking it switches to the loading state,
which removes the button. The country retry stays on screen while it runs, and
the request can take a couple of seconds because of the internal retries, so it
needs an explicit guard against repeat clicks.

**Q: Why do the empty and error states share a component?**
A: They are the same layout with different copy. Duplicating the markup would
mean two places to change for any visual fix. The distinction that matters is
the wording - empty is a successful response, so it never says anything went
wrong.

---

## Step 6 — Property controls, and what the Preview width actually is

### Choosing controls that someone would ask for

The two shipped are **Heading** (String) and **Max courses** (Number, 1-10,
default 10).

Accent colour was in the original plan and got dropped once the component
existed. The design is near-monochrome: a grey type pill and a green refund
badge whose colour is *semantic* - green means refundable, so brand-tinting it
would destroy the meaning. To make an accent control feel useful I would have
had to add accent surface to the design purely so the control had something to
do. **Building UI to justify a control is backwards.**

Max courses replaced it because "this section is too long, just show six" is a
real landing-page request that a designer should not need a developer for.

### Both controls are render-time only

```tsx
export default function CoursesSection({
    style,
    heading = "Courses",
    maxCourses = 10,
}) {
```

Defaults live in the destructuring, so the component behaves predictably if
Framer passes nothing. **Neither prop appears in the effect's dependency array**,
so dragging the stepper never refetches - which matters when the API fails one
request in three. Verified in the network tab, not assumed.

### The maxCourses trap

```tsx
const isEmpty = status === "ready" && courses.length === 0   // NOT the slice
const visibleCourses = courses.slice(0, maxCourses)
const skeletonCount = Math.max(1, Math.min(SKELETON_COUNT, maxCourses))
```

**`isEmpty` must read the unsliced length.** Slicing a non-empty response down
is not the same as the API returning nothing - reading the sliced length would
let a display control produce "No courses available" over real data.

`Math.max(1, ...)` on the skeleton count is deliberate insurance. The control's
`min: 1` should make zero unreachable, but an empty loading state is one of the
six automatic fails, so it is not a place to rely on the UI enforcing a bound.

When the API returns fewer courses than the maximum, `slice` just returns what
exists. No clamping code, no off-by-one.

### Preview width is not component width

The component was pinned to a **fixed 1200px** width in Framer. So it correctly
measured 1200 and rendered 3 columns regardless of what the Preview toolbar
said. Setting the Framer instance to **Fill** fixed the relationship.

After the change:

| Preview toolbar | Measured | Columns |
|---|---|---|
| 639 | 624 | 1 |
| 655 | 640 | 2 |
| 932 | 917 | 2 |
| 1039 | 1024 | 3 |
| 1200 | 1200 | 3 |

The steady ~15px gap is Preview's scrollbar and chrome.

**Decision: do not compensate for it.** The breakpoints stay at 640 and 1024,
because the component should respond to its own real width, not to a number in a
toolbar. Nudging the thresholds so the toolbar reads nicely would be the Step 1
padding bug again in a new costume - encoding an environment quirk as a
constant, which then silently misbehaves everywhere else.

**The lesson:** when a measurement and an expectation disagree, find out which
one is lying before changing either. Here the logic was right the whole time -
twice over. The first Preview collapse was containment, the second was a fixed
layer width. Neither was the grid.

### Likely interview questions

**Q: Why those two controls?**
A: Copy and section length are what a designer actually asks for. I had planned
an accent colour, but once the component existed there was nothing meaningful to
tint - the only coloured element is a refund badge whose green is semantic. I
was not going to add decoration just to give a control a job.

**Q: What happens if the maximum is higher than the number of courses returned?**
A: `slice` returns what exists, so you see 5 when the API sends 5. The important
part is that the empty state still reads the unsliced length - otherwise a
display setting could claim there are no courses when there are.

**Q: Your breakpoints fire ~15px off the Preview width. Why not adjust them?**
A: Because that 15px is Preview's scrollbar, not the component's width. The
component measures itself, and it is measuring correctly. Shifting the
thresholds to match an external toolbar would encode an environment quirk as a
constant and break everywhere that quirk does not exist.

---

## Step 7 — Typography, surfaces and the visual pass

### The heading contrast bug: owning your surface

The section heading was readable on the Framer canvas and nearly invisible in
Preview. The cause was not the colour value:

```css
.sp-section { color: #1a1a1a; }   /* no background */
```

The component **set a text colour without owning the surface behind it**. The
cards had their own white background, so they were fine; the heading sat
directly on whatever the Framer page happened to be. Canvas was white, the
Preview page was not.

The fix is a rule rather than a hex value: **any element that sets a text colour
also sets the background it sits on.** `.sp-section` now declares both, so the
section is readable regardless of what is behind it, and Canvas and Preview
agree by construction instead of by luck.

### font-family: inherit

The section previously named `Inter`. It now uses `font-family: inherit`, so it
adopts the page's typography (Outfit for headings, Work Sans for body) rather
than naming a face of its own. The hero, the cards and the footer then match
**by construction**, not by someone remembering to keep three places in sync.

The risk, which had to be tested rather than assumed: `inherit` only works if
something above the component sets a font. If the page body sets none, it falls
through to the browser default and renders serif - and there is no way to write
`inherit` with a fallback in a single declaration. The fallback plan was to name
the faces explicitly.

### The palette

| Token | Hex | Contrast on #F8FAFC |
|---|---|---|
| Page | #F8FAFC | - |
| Card | #FFFFFF | - |
| Border | #E2E8F0 | - |
| Text | #0F172A | ~16:1 |
| Muted | #475569 | ~7.5:1 |
| Accent | #0D9488 (hover #0F766E) | - |

The previous muted grey (#5c5c5c) was close to the level design guidance warns
against for body text. Both values now clear the 4.5:1 floor comfortably.

One accent, used for the CTA, the refundable chip and the focus ring. The refund
badge moved from green into the accent family so the page does not carry two
unrelated highlight colours.

### Card hierarchy: spacing does the grouping

The original card had no reading order - the type pill read first, the title and
price were identical (18px/600), and a uniform 12px gap made four unrelated
lines. Now:

```
ORIGINAL                 11px uppercase eyebrow, no background, no padding
   12px
Course Name              20px - outranks the price
   8px                   tight: the description belongs to the title
description
   24px + hairline
Price                    card footer, separated by a 1px rule
```

Three points worth being able to explain:

- **The eyebrow lost its horizontal padding along with its background.** With the
  chip gone, `padding-left: 10px` would have left the text mysteriously indented
  relative to the course name. Flush alignment is what makes the card's left edge
  look deliberate.
- **"Refundable" kept chip weight** because it is a claim about the product, not
  metadata. That is why it now owns its padding and radius instead of inheriting
  from the type pill - the two are no longer variations of one thing.
- **Grouping comes from margins and padding, not from the flex gap.** The base gap
  is 8px; a 4px top margin on the name and 16px padding above the price create
  three groups out of four elements.

### The card hover, and its three guards

```css
.sp-card { transition: transform 180ms ease-out, box-shadow 180ms ease-out,
                       border-color 180ms ease-out; }

@media (hover: hover) {
    .sp-card:not(.sp-skeleton):hover {
        transform: translateY(-1px) scale(1.01);
        box-shadow: 0 1px 2px rgba(15,23,42,.04), 0 10px 28px -14px rgba(15,23,42,.1);
        border-color: #b8ded8;
    }
}
```

**No `cursor: pointer`, deliberately.** The cards are not clickable - the API
returns no course URL - so the effect is a tactile acknowledgement, not an
affordance promising something to open.

- `:not(.sp-skeleton)` - skeletons reuse `.sp-card`, so without it the loading
  placeholders would lift on hover, which looks like a bug.
- `@media (hover: hover)` - on touch devices `:hover` sticks after a tap and the
  card would stay raised until something else was tapped.
- Reduced motion drops the transition and the transform but **keeps the shadow
  and the border tint** - neither is motion, so the feedback survives.

The border tint is the resting `#e2e8f0` warmed about 20% toward the accent.
A fully teal border would read as selection and compete with the refund chip.

### Framer Preview sizing - see also Step 6

Two separate Preview problems, neither of which was the grid:

1. `container-type: inline-size` collapsing against a content-sized wrapper.
2. The component pinned to a fixed 1200px width, so it measured 1200 regardless
   of the Preview toolbar. Setting the instance to **Fill** fixed it.

Both times the responsive logic was correct and the environment was misleading.
The breakpoints were left at 640/1024 rather than nudged to match the toolbar,
because the ~15px difference is Preview's scrollbar, not the component's width.

### Hero and footer

Built as **Framer-native layers**, not code components. Only the courses section
is required to be code, and the brief says not to overthink the rest. Using the
tool where the tool fits reads better than routing everything through React.

**The hero stays centred.** Left-aligning it to share the grid's left edge was
considered and rejected: with no imagery to balance against, centred reads as a
deliberate standalone statement, and the contrast with the left-aligned grid
marks the shift from statement to scannable list.

**The CTA anchors to the Courses section.** A primary button that did nothing was
the clearest sign the page was a mockup rather than a site.

**The hero copy makes no claim about instructors.** The API returns no instructor
data, so a line about creators "who have done the work" would have been invented.
Same principle as not hardcoding the courses.

**The footer is three links plus a copyright line**, as the brief specifies.

### Likely interview questions

**Q: Why does the courses section set its own background?**
A: It was setting a text colour without owning the surface behind it, so the
heading was readable on the canvas and nearly invisible in Preview, where the
page background differs. Any element that sets a text colour should set the
background it sits on.

**Q: Why `font-family: inherit` instead of naming the font?**
A: So the section adopts the page's typography and matches the hero and footer
by construction. The trade-off is that it depends on something above it setting a
font - if nothing does, it falls back to the browser default, which is why I
tested it rather than assuming.

**Q: The cards have a hover effect but are not clickable. Why?**
A: It is a tactile acknowledgement, not an affordance - which is why there is no
cursor change and no border colour strong enough to read as selection. The API
returns no course URL, so there is nothing to link to. I also excluded skeletons
and touch devices, where `:hover` sticks after a tap.

---

## Step 8 — The two cases the live API never produced

In roughly 80 calls the API never returned an empty array or a non-array 200. So
these paths could not be verified by reloading and hoping - they had to be
stubbed. `tests/adversarial.test.mjs`, 13 assertions.

### Testing the composition, not just the function

`resolveLoad` already had unit coverage for both cases, but that tests the
decision function in isolation. The adversarial suite drives the stubbed
response through **the same composition the component uses**:

```js
const results = await Promise.allSettled([fetchJson(COURSES), fetchJson(COUNTRY)])
return resolveLoad(results[0], results[1])
```

so the payload passes through the real fetch and retry layer on its way in. It
also recomputes `isEmpty` and `showCountryNotice` with the same expressions the
component renders from, which is what makes these tests about *which state the
user sees* rather than about a return value.

**The honest limitation:** the render branch itself is not covered - there is no
DOM here, and the derived booleans are recomputed in the test rather than read
from the component. If someone changed the JSX condition without changing the
expression, these tests would still pass.

### Results

**Empty array on a 200** -> `status: "ready"`, `courses: []`, `isEmpty` true. An
empty response is a **success**, and the empty branch renders. Also asserted that
`"empty"` never becomes a stored status.

**Non-array on a 200** -> error state, across six payload shapes: an error
object, `{}`, a bare string, a number, `null`, and an array wrapped in an object.
In every case `courses` is `[]`, so nothing can reach `.map()` - which is the
straight-no this guard exists to prevent - and `isEmpty` stays false, so error
and empty remain distinct.

**Combined with a country failure** -> empty stays ready and empty; the non-array
payload produces an error with the country result discarded and no notice
stacked on top of the error.

**No bug found. The implementation was not changed.**

### The one thing the tests surfaced

Empty courses **plus** a failed country renders the currency notice and the empty
message together: "couldn't detect your region, showing prices in rupees" sitting
above "No courses available" - when there are no prices on screen at all.

It is unreachable against the live API and harmless, so it was recorded rather
than fixed. Worth knowing it exists: it comes from `showCountryNotice` and
`isEmpty` being derived independently, which is the same independence that makes
them impossible to get out of sync. The fix, if it were ever needed, is one
condition - not a redesign.

### The general lesson

Stubs and live checks prove different things. **Stubs cover cases I thought of,
including ones the real API will not produce on demand. The live run proves my
model of the API is right.** Neither substitutes for the other: stubs cannot
catch a wrong assumption about reality, and a flaky API cannot be made to fail
on cue.

### Likely interview questions

**Q: How did you test the empty state if the API never returns an empty list?**
A: I stubbed the response and drove it through the same composition the component
uses, so it goes through the real fetch and retry layer. I also checked six
non-array payloads, because a 200 does not guarantee the shape - if a non-array
reached `.map()` the section would blank, which is an automatic fail in this
brief.

**Q: What did those tests find?**
A: No bug in either case. They did surface one cosmetic wrinkle - if the course
list were empty *and* the country call failed, the currency notice would show
above the empty message even though no prices are on screen. It is unreachable
against the live API, so I recorded it instead of adding a condition for it.
