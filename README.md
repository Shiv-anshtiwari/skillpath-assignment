# Skillpath — courses section

Technical assessment for a junior developer role. A Framer landing page for a
fictional learning platform, where one section pulls live data from an API.

The hero and footer are Framer-native layers. **The courses section is a React
code component**, and it is the part worth reading.

## The API

Base URL: `https://syncsphere-hiv6.onrender.com`

| Endpoint | Returns |
|---|---|
| `GET /assignment/course-data` | 5–10 courses; the count changes between calls |
| `GET /assignment/country-code` | `{"country_code": "IN"}` or `{"country_code": "US"}` |

**Roughly 1 in 3 requests fails on purpose** with a 404 or 500, on both
endpoints. Handling that is the point of the exercise, not an edge case.

## The two source files

### `src/helpers.ts` — pure logic, no React

| Export | Does |
|---|---|
| `formatPrice(course, countryCode)` | `199900` paise → `₹1,999`, `3999` cents → `$39.99` |
| `fetchJson(path)` | GET, checks `res.ok`, retries up to 3 times, throws a user-safe error |
| `parseCourses` / `parseCountryCode` | Validate the payload's shape, not just its status |
| `resolveLoad(coursesResult, countryResult)` | The whole failure matrix as one pure function |
| `columnsForWidth(width)` | 3 / 2 / 1 columns at 1024 / 640 |

### `src/CoursesSection.tsx` — React only

State machine, the fetch effect, the responsive measurement, the card and grid
markup, and the two Framer property controls.

**Why two files:** Node runs a `.ts` file directly but not a `.tsx` one without a
JSX transform. Keeping the pure logic separate is what makes the price maths and
the failure matrix unit-testable outside Framer — and those are the two things
that fail *invisibly* rather than obviously.

## Running the tests

No dependencies and no test framework — plain Node with `node:assert`. Node 22+
is required, since the tests import a `.ts` file directly and rely on built-in
type stripping.

```bash
node tests/helpers.test.mjs
```

39 assertions covering price formatting in both currencies (including Indian
lakh grouping), the retry policy, the seven rows of the failure matrix, payload
validation, and the responsive breakpoints at 639/640 and 1023/1024.

A second suite covers the two cases the live API never produces - an empty array
and a 200 whose body is not an array - by stubbing the response and driving it
through the same composition the component uses:

```bash
node tests/adversarial.test.mjs
```

There is also a one-off script that runs the helpers against the real, flaky API:

```bash
node tests/live-check.mjs
```

## How it behaves

**Four states.** Loading shows skeleton cards in the measured column count.
Error and empty share a component with deliberately different copy — an empty
response is a *success*, so its wording never implies a failure. Ready renders
the grid.

**When the country call fails but the courses call succeeds**, the grid still
renders, prices fall back to rupees, and a non-blocking notice says so with a
retry that re-fetches only the country. Courses are content; the currency is a
presentation input. Losing a presentation input should not destroy the content.

**Retries.** `fetchJson` makes up to 3 attempts with a fixed 400ms delay,
including on 404s. Retrying a 404 is normally wrong — it means the resource does
not exist — but this API injects fake 404s on URLs that provably work, and the
code says so in a comment.

**Responsive.** A `ResizeObserver` measures the section's own width. Container
queries were the original approach and worked on the Framer canvas, but
`container-type` applies size containment and collapsed in Framer Preview.
Measuring in JS needs no containment, so it cannot collapse.

**Property controls.** Section heading (text) and maximum courses shown (1–10).
Both are render-time only — neither is in the effect's dependency array, so
changing one never refetches.

## AI usage

Built with Claude Code (Claude Opus). The full conversation is in
[`docs/TRANSCRIPT.md`](docs/TRANSCRIPT.md) — 58 turns, unedited on both sides.

The Claude Code CLI has no native "share conversation" link the way the Claude
and ChatGPT web apps do, so the session was exported from its local transcript
and committed here instead. Tool calls are collapsed to one-line summaries to
keep it readable; local filesystem paths are shortened; nothing said on either
side has been altered.

## Repository layout

| Path | |
|---|---|
| `src/` | The two files that go into Framer as code files |
| `tests/` | Test suite and the live API check |
| `PLAN.md` | Step-by-step build plan, decisions and their revisions |
| `LEARNINGS.md` | Concepts, trade-offs and the reasoning behind each decision |
| `docs/TRANSCRIPT.md` | The full Claude Code conversation behind the build |
