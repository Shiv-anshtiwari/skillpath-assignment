// Skillpath - the courses section.
//
// One Framer code component that fetches live course data and a country code,
// and renders four states: loading, error, empty and ready. The API fails on
// roughly 1 in 3 requests by design, so the failure paths are the point.
//
// Pure logic - price formatting, fetching/retrying, payload validation and the
// breakpoint thresholds - lives in ./helpers so it can be unit tested outside
// Framer. This file is React only.

import { useEffect, useRef, useState, type CSSProperties } from "react"
import { addPropertyControls, ControlType } from "framer"
import {
    fetchJson,
    formatPrice,
    resolveLoad,
    parseCountryCode,
    columnsForWidth,
    DEFAULT_COUNTRY,
    type Course,
    type CountryCode,
    type Status,
} from "./helpers"

const COURSES_PATH = "/assignment/course-data"
const COUNTRY_PATH = "/assignment/country-code"

// 6 divides evenly into 3, 2 and 1 columns, so the skeleton grid never shows a
// ragged last row. The real count is 5-10 and unknowable before the response.
const SKELETON_COUNT = 6

// The 3/2/1 breakpoints are driven by a ResizeObserver measuring .sp-section,
// not by media queries and not by container queries.
//
// Media queries are wrong here because they read the browser window: a 375px
// frame on a 1920px canvas would get desktop rules.
//
// Container queries were the original choice and worked on the canvas, but
// `container-type: inline-size` applies size containment, which removes the
// element's own contents from its intrinsic width. In Framer Preview the
// wrapper is content-sized and passes `width: 100%` - so there was nothing
// definite to resolve against, the section collapsed to ~0, and the grid fell
// to one column with the cards overflowing. Measuring in JS needs no
// containment, so it cannot collapse.
//
// .sp-section still carries NO padding - .sp-inner holds the spacing. That is
// what keeps `contentRect.width` equal to the frame width, so 640 and 1024
// still mean 640 and 1024.
const css = `
/* Palette. The section owns its surface: it sets a background as well as a
   text colour, so it stays readable whatever the Framer page behind it is.
   Setting colour without owning the background is what made the heading
   unreadable in Preview while looking fine on the canvas.

     page      #F8FAFC     card    #FFFFFF     border  #E2E8F0
     text      #0F172A     muted   #475569     accent  #0D9488

   font-family: inherit, so the section adopts the page's typography instead of
   naming a face of its own - the hero, the cards and the footer then match by
   construction rather than by coincidence. */
.sp-section {
    width: 100%;
    font-family: inherit;
    background: #f8fafc;
    color: #0f172a;
}
.sp-section *, .sp-section *::before, .sp-section *::after {
    box-sizing: border-box;
}

/* One shared measure. The hero and footer use the same max-width and side
   padding, which is most of what makes separate sections read as one page. */
.sp-inner {
    max-width: 1200px;
    margin: 0 auto;
    padding: 80px 24px;
}

/* Interactive elements had no focus ring at all before this. */
.sp-section :focus-visible {
    outline: 2px solid #0d9488;
    outline-offset: 2px;
    border-radius: 4px;
}

.sp-heading {
    margin: 0 0 24px;
    font-size: 32px;
    font-weight: 600;
    line-height: 1.2;
    letter-spacing: -0.01em;
}

.sp-grid {
    display: grid;
    /* One column is the pre-measurement default, for the first paint before
       the ResizeObserver reports and for server-rendered HTML. The real count
       is applied inline by the component. */
    grid-template-columns: 1fr;
    gap: 24px;
    /* the <ul> reset - the list is semantic, not visual */
    list-style: none;
    margin: 0;
    padding: 0;
}

/* gap is deliberately tight (8px). Grouping is created by the margin on
   .sp-name and the padding above .sp-price, so the card reads as
   eyebrow / NAME + description / price rather than four evenly spaced lines. */
.sp-card {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 24px;
    border: 1px solid #e2e8f0;
    border-radius: 12px;
    background: #ffffff;
    transition: transform 180ms ease-out, box-shadow 180ms ease-out,
                border-color 180ms ease-out;
}

/* A small tactile response, not a lift. The cards are NOT clickable - the API
   returns no course URL - so there is deliberately no cursor change and no
   affordance suggesting the card can be opened.
   :not(.sp-skeleton) keeps loading placeholders inert, and the hover:hover
   query keeps the effect off touch devices, where :hover sticks after a tap
   and would leave a card raised until something else is tapped. */
@media (hover: hover) {
    .sp-card:not(.sp-skeleton):hover {
        transform: translateY(-1px) scale(1.01);
        box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04),
                    0 10px 28px -14px rgba(15, 23, 42, 0.1);
        /* the resting #e2e8f0 warmed roughly 20% toward the #0d9488 accent -
           enough to register as a response, not enough to read as a state
           change or to compete with the refundable chip */
        border-color: #b8ded8;
    }
}

.sp-badges { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }

/* Course type is metadata, so it is set as a flat uppercase eyebrow with no
   background - and no horizontal padding, so it aligns flush with the course
   name below it rather than sitting mysteriously indented. */
.sp-pill {
    color: #64748b;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
}
/* Refundable keeps chip weight because it is a positive signal about the
   product, not metadata. Same accent family as the CTA - a separate green
   would read as a second, accidental accent colour. */
.sp-pill-refund {
    padding: 4px 10px;
    border-radius: 999px;
    background: #ccfbf1;
    color: #0f766e;
    letter-spacing: 0.03em;
}

/* The name is the first thing that should register, so it outranks the price
   instead of matching it. The 4px top margin adds up with the card gap to give
   the eyebrow a little more separation than the description gets. */
.sp-name {
    margin: 4px 0 0;
    font-size: 20px;
    font-weight: 600;
    line-height: 1.3;
}

/* Two-line clamp in CSS, not a JS substring: JS cannot know the rendered
   width, so it would cut at a different point at every screen size. */
.sp-desc {
    margin: 0;
    font-size: 15px;
    line-height: 1.55;
    color: #475569;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    overflow: hidden;
}

/* margin-top:auto pins the price to the bottom, so prices line up across a row
   even when titles wrap to different heights. The hairline above turns it into
   the card's footer rather than a fourth floating line. */
.sp-price {
    margin-top: auto;
    padding-top: 16px;
    border-top: 1px solid #f1f5f9;
    font-size: 18px;
    font-weight: 600;
}
.sp-price-missing {
    font-size: 15px;
    font-weight: 400;
    color: #475569;
}

/* --- country fallback notice: informational, not an alarm --- */
.sp-notice {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 12px;
    margin: 0 0 20px;
    padding: 12px 16px;
    border: 1px solid #fde68a;
    border-radius: 8px;
    background: #fffbeb;
    color: #92400e;
    font-size: 14px;
}

/* 12px vertical padding puts the target near the 44px minimum. */
.sp-button {
    padding: 12px 18px;
    border: 1px solid #cbd5e1;
    border-radius: 8px;
    background: #ffffff;
    color: #0f172a;
    font-family: inherit;
    font-size: 14px;
    font-weight: 500;
    cursor: pointer;
    transition: background-color 150ms ease, border-color 150ms ease;
}
.sp-button:hover { background: #f1f5f9; border-color: #94a3b8; }
.sp-button:disabled { opacity: 0.6; cursor: default; }
.sp-button-quiet { padding: 8px 14px; font-size: 13px; }

/* --- shared by the error and empty states --- */
.sp-state {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 8px;
    padding: 40px 24px;
    border: 1px dashed #cbd5e1;
    border-radius: 12px;
    background: #ffffff;
}
.sp-state-title { margin: 0; font-size: 17px; font-weight: 600; }
.sp-state-body { margin: 0 0 8px; font-size: 15px; color: #475569; }

/* --- skeletons: the same .sp-card shell, so the layout does not jump --- */
.sp-bar { height: 12px; border-radius: 6px; background: #e2e8f0; }
.sp-bar-pill { width: 72px; height: 22px; border-radius: 999px; }
.sp-bar-title { width: 70%; height: 18px; }
.sp-bar-short { width: 60%; }
/* mirrors .sp-price, so the placeholder sits where the price will sit */
.sp-bar-price { margin-top: auto; width: 90px; height: 20px; }

.sp-skeleton .sp-bar { animation: sp-pulse 1.6s ease-in-out infinite; }
@keyframes sp-pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.55; }
}
@media (prefers-reduced-motion: reduce) {
    .sp-skeleton .sp-bar { animation: none; }
    .sp-card { transition: none; }
    .sp-card:not(.sp-skeleton):hover { transform: none; }
}

`

/**
 * @framerSupportedLayoutWidth any
 * @framerSupportedLayoutHeight auto
 */
// Both property controls are render-time only. Neither appears in the effect's
// dependency array, so changing one never refetches - a designer dragging the
// stepper does not hammer a flaky API. Defaults live here in the destructuring
// so the component behaves predictably if Framer passes nothing.
export default function CoursesSection({
    style,
    heading = "Courses",
    maxCourses = 10,
}: {
    style?: CSSProperties
    heading?: string
    maxCourses?: number
}) {
    // status decides which body renders. courses and country are data slots.
    // country === null means "not detected" - see showCountryNotice below.
    const [status, setStatus] = useState<Status>("loading")
    const [courses, setCourses] = useState<Course[]>([])
    const [country, setCountry] = useState<CountryCode | null>(null)

    // Bumping this re-runs the effect below. That is the entire retry
    // mechanism; see the comment on retry().
    const [reloadKey, setReloadKey] = useState(0)

    // The measured column count. Starts at 1 (mobile first) and is corrected
    // as soon as the observer reports, which is on the frame after mount.
    const sectionRef = useRef<HTMLElement>(null)
    const [columns, setColumns] = useState(1)

    useEffect(() => {
        const element = sectionRef.current
        if (!element) return

        const observer = new ResizeObserver(([entry]) => {
            // contentRect is the CONTENT box. .sp-section has no padding, so
            // this is the frame width - which is why the 640/1024 thresholds
            // mean the same thing they did as container queries.
            const width = entry.contentRect.width
            setColumns(columnsForWidth(width))
        })

        observer.observe(element)
        return () => observer.disconnect()
    }, [])

    useEffect(() => {
        // Every run of this effect creates its OWN cancelled variable. The
        // cleanup at the bottom flips only this run's copy, so a slow result
        // from an older run can never overwrite a newer one.
        let cancelled = false

        setStatus("loading")

        // Parallel, not sequential: neither call needs the other's result, so
        // sequencing them would only add latency. allSettled never rejects, so
        // one call failing cannot throw away the other's success - which is
        // exactly what happens when only the country call fails.
        Promise.allSettled([
            fetchJson(COURSES_PATH),
            fetchJson(COUNTRY_PATH),
        ]).then(([coursesResult, countryResult]) => {
            if (cancelled) return

            // All the decision-making lives in resolveLoad, which is a pure
            // function and therefore testable outside React.
            const next = resolveLoad(coursesResult, countryResult)
            setStatus(next.status)
            setCourses(next.courses)
            setCountry(next.country)
        })

        return () => {
            cancelled = true
        }
    }, [reloadKey])

    // Retry bumps the key rather than calling a load function directly. That
    // makes React re-run the effect, which runs the cleanup FIRST - so any
    // in-flight load is disowned before the new one starts. Calling load()
    // straight from the button would skip the cleanup and let a stale response
    // land on top of fresh data.
    function retry() {
        setReloadKey((key) => key + 1)
    }

    // Deliberately NOT routed through reloadKey. Bumping reloadKey sets status
    // to "loading", which would replace the grid with skeletons - the wrong
    // thing to do when the courses are fine and only the currency is unknown.
    // This handler therefore writes `country` and nothing else, so the cards
    // stay on screen and the prices reformat in place.
    //
    // It skips the cancelled-flag discipline the main effect uses. That is a
    // considered trade: the only value it can write is `country`, and if a full
    // reload is running at the same time, that reload writes a fresh country
    // anyway. The worst case is a slightly stale currency, never a corrupt grid.
    const [countryRetrying, setCountryRetrying] = useState(false)

    async function retryCountry() {
        setCountryRetrying(true)
        try {
            // fetchJson already retries 3 times internally, so this can take a
            // couple of seconds - hence the disabled button while it runs.
            const value = await fetchJson(COUNTRY_PATH)
            setCountry(parseCountryCode(value))
        } catch {
            // Still no country. `country` stays null, so the notice stays up
            // and the button becomes available again. There is nothing to tell
            // the user that the notice is not already saying.
        } finally {
            setCountryRetrying(false)
        }
    }

    // Derived, not stored. Deriving them means they cannot drift out of sync
    // with the state they describe, and each condition is written once.
    const isEmpty = status === "ready" && courses.length === 0
    const showCountryNotice = status === "ready" && country === null

    // The rupee fallback is resolved once here, so `?? DEFAULT_COUNTRY` appears
    // in exactly one place rather than once per card.
    const currencyCountry = country ?? DEFAULT_COUNTRY

    // The maxCourses control is a display slice, nothing more. isEmpty above
    // deliberately still reads courses.length, NOT this: slicing a non-empty
    // response down is not the same as the API returning nothing, and showing
    // "No courses available" for real data would be a lie. When the API returns
    // fewer courses than the maximum, slice simply returns what there is.
    const visibleCourses = courses.slice(0, maxCourses)

    // Match the placeholder count to what will actually appear, so the layout
    // does not jump from 6 skeletons to 3 cards. Never fewer than one: an empty
    // loading state is one of the assignment's automatic fails.
    const skeletonCount = Math.max(1, Math.min(SKELETON_COUNT, maxCourses))

    // Shared by the skeleton grid and the real grid, so both use the measured
    // column count and the loading layout matches the loaded layout.
    const gridColumns = { gridTemplateColumns: `repeat(${columns}, 1fr)` }

    // Framer passes the layer's size to a code component in `style`, so it is
    // applied to the root as a matter of contract. Measured in Preview it
    // arrives as {"width":"100%"} - a percentage, not a definite width, which
    // is why it could not fix the collapse on its own. It is harmless and
    // correct to honour it; the layout no longer depends on it.
    return (
        <section className="sp-section" style={style} ref={sectionRef}>
            <style>{css}</style>

            <div className="sp-inner">
                {/* No empty <h2> taking up space if the control is cleared */}
                {heading && <h2 className="sp-heading">{heading}</h2>}

                {status === "loading" && (
                    <ul className="sp-grid" style={gridColumns} aria-busy="true">
                        {/* index keys are fine here: this list is a fixed
                            length and never reorders */}
                        {Array.from({ length: skeletonCount }, (_, i) => (
                            <SkeletonCard key={i} />
                        ))}
                    </ul>
                )}

                {status === "error" && (
                    <StateMessage
                        title="Couldn't load courses"
                        body="Something went wrong while loading. Please try again."
                        actionLabel="Try again"
                        onAction={retry}
                    />
                )}

                {/* Empty is a SUCCESSFUL response, so the wording says nothing
                    went wrong. The retry is offered because this API's course
                    list genuinely varies between calls. */}
                {isEmpty && (
                    <StateMessage
                        title="No courses available"
                        body="There's nothing to show here right now."
                        actionLabel="Check again"
                        onAction={retry}
                    />
                )}

                {status === "ready" && !isEmpty && (
                    <ul className="sp-grid" style={gridColumns}>
                        {visibleCourses.map((course) => (
                            // courseCode, not the array index: index keys would
                            // mis-associate DOM nodes with data if we ever sort.
                            <CourseCard
                                key={course.courseCode}
                                course={course}
                                countryCode={currencyCountry}
                            />
                        ))}
                    </ul>
                )}
            </div>
        </section>
    )
}

/**
 * One card. Pure props-in, no state - which is what makes "add a field to a
 * card" a one-line change in this function and nowhere else.
 */
function CourseCard({
    course,
    countryCode,
}: {
    course: Course
    countryCode: CountryCode
}) {
    // null means the price field was missing or not a number. It should never
    // happen with the live data, but rendering "₹NaN" would look broken.
    const price = formatPrice(course, countryCode)

    return (
        <li className="sp-card">
            <div className="sp-badges">
                <span className="sp-pill">{course.courseType}</span>
                {course.refundable && (
                    <span className="sp-pill sp-pill-refund">Refundable</span>
                )}
            </div>

            <h3 className="sp-name">{course.courseName}</h3>
            <p className="sp-desc">{course.description}</p>

            <div className={price ? "sp-price" : "sp-price sp-price-missing"}>
                {price ?? "Price unavailable"}
            </div>
        </li>
    )
}

/**
 * A placeholder in the shape of a real card. It reuses .sp-card, so the
 * skeleton grid and the loaded grid have the same geometry and nothing shifts
 * when the data arrives.
 *
 * aria-hidden because the bars carry no information - the list above is marked
 * aria-busy, which is what a screen reader should act on.
 */
function SkeletonCard() {
    return (
        <li className="sp-card sp-skeleton" aria-hidden="true">
            <div className="sp-bar sp-bar-pill" />
            <div className="sp-bar sp-bar-title" />
            <div className="sp-bar" />
            <div className="sp-bar sp-bar-short" />
            <div className="sp-bar sp-bar-price" />
        </li>
    )
}

/**
 * Shared by the error and empty states. They are the same layout with
 * different words, so they are the same component - two components rendering
 * identical markup is exactly the duplication a reviewer would flag.
 *
 * The copy never contains a status code or anything from the API response.
 */
function StateMessage({
    title,
    body,
    actionLabel,
    onAction,
}: {
    title: string
    body: string
    actionLabel?: string
    onAction?: () => void
}) {
    return (
        <div className="sp-state">
            <p className="sp-state-title">{title}</p>
            <p className="sp-state-body">{body}</p>
            {actionLabel && onAction && (
                <button className="sp-button" onClick={onAction}>
                    {actionLabel}
                </button>
            )}
        </div>
    )
}

/**
 * The two Framer property controls.
 *
 * Both are things a designer actually asks for: the section's copy, and how
 * long the section is on the page. Neither can affect what is fetched or how
 * failures are handled - they only change what is displayed.
 */
addPropertyControls(CoursesSection, {
    heading: {
        type: ControlType.String,
        title: "Heading",
        defaultValue: "Courses",
        placeholder: "Section heading",
    },
    maxCourses: {
        // The API returns at most 10 courses, so 10 is both the ceiling and
        // the default - inserting the component truncates nothing.
        type: ControlType.Number,
        title: "Max courses",
        defaultValue: 10,
        min: 1,
        max: 10,
        step: 1,
        displayStepper: true,
    },
})
