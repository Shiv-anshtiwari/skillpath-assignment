// Pure logic for the Skillpath courses section. No React, no JSX, no state.
//
// This is a separate file from CoursesSection.tsx on purpose. Node can run a
// .ts file directly but not a .tsx one without a JSX transform, so keeping the
// price conversion, the fetch/retry loop, the payload validation and the
// breakpoint thresholds in here is what makes them unit-testable outside
// Framer. Both are added to a Framer project as code files.
//
// Rule of thumb: if a decision needs a test, it belongs in this file.

export const BASE_URL = "https://syncsphere-hiv6.onrender.com"

// One knob for the whole retry policy. If asked to change retry behaviour on
// the call, this is the only number that moves.
export const MAX_ATTEMPTS = 3

// Fixed, not exponential. Backoff exists to protect an overloaded server;
// this server is not overloaded, it fails at random on purpose. Backoff would
// only make the page slower for no benefit.
export const RETRY_DELAY_MS = 400

/** The shape returned by /assignment/course-data. Typed in full, including
 *  fields we do not render yet, so the available data is visible in one place. */
export type Course = {
    courseName: string
    courseCode: string
    description: string
    mainCategory: string
    shortCourse: string
    courseType: string
    pricePaise: number
    priceUsdCents: number
    mangoId: string
    refundable: boolean
}

export type CountryCode = "IN" | "US"

/** The one status that decides which body the section renders.
 *  "empty" is deliberately NOT a status - it is derived from courses.length,
 *  so the two can never disagree. */
export type Status = "loading" | "ready" | "error"

/** Used when the country call fails or returns something unusable. */
export const DEFAULT_COUNTRY: CountryCode = "IN"

/** Grid breakpoints, measured against the section's own width in pixels. */
export const TABLET_MIN_WIDTH = 640
export const DESKTOP_MIN_WIDTH = 1024

/**
 * 3 columns on desktop, 2 on tablet, 1 on mobile.
 *
 * Mobile-first and inclusive at each boundary: exactly 640 is already tablet,
 * exactly 1024 is already desktop. Pure, so the boundaries can be asserted
 * rather than checked by dragging a frame - which is how the Step 1 padding
 * bug slipped through in the first place.
 */
export function columnsForWidth(width: number): number {
    if (width >= DESKTOP_MIN_WIDTH) return 3
    if (width >= TABLET_MIN_WIDTH) return 2
    return 1
}

/**
 * Formats a course price in the currency for the given country.
 *
 * The units are the trap in this assignment. The API sends the SMALLEST unit
 * of each currency, so both branches divide by 100 exactly once:
 *   pricePaise    199900 paise -> 1999    rupees  -> "₹1,999"
 *   priceUsdCents   3999 cents ->   39.99 dollars -> "$39.99"
 *
 * Returns null if the price field is not a usable number, so the caller
 * decides what to show rather than rendering "₹NaN".
 */
export function formatPrice(
    course: Course,
    countryCode: string
): string | null {
    if (countryCode === "US") {
        if (!Number.isFinite(course.priceUsdCents)) return null

        const dollars = course.priceUsdCents / 100

        // en-US + USD already defaults to 2 decimals, which is the convention
        // for dollar prices: $39.99, and $40.00 rather than $40.
        return new Intl.NumberFormat("en-US", {
            style: "currency",
            currency: "USD",
        }).format(dollars)
    }

    // Anything that is not "US" formats as INR. That includes an unknown or
    // missing country code, which is deliberate: IN is our agreed fallback
    // when the country call fails.
    if (!Number.isFinite(course.pricePaise)) return null

    const rupees = course.pricePaise / 100

    // Indian price convention drops paise when there are none: ₹1,999, not
    // ₹1,999.00. If a price ever does carry paise, show both digits.
    const fractionDigits = course.pricePaise % 100 === 0 ? 0 : 2

    // en-IN also gives the lakh/crore grouping: 12345678 paise -> ₹1,23,456.78
    return new Intl.NumberFormat("en-IN", {
        style: "currency",
        currency: "INR",
        minimumFractionDigits: fractionDigits,
        maximumFractionDigits: fractionDigits,
    }).format(rupees)
}

function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * GETs a path from the API and returns the parsed JSON.
 *
 * This API fails on roughly 1 in 3 requests with an injected 404 or 500, so a
 * single attempt would show an error state about a third of the time. Three
 * attempts brings that to ~3.7%.
 *
 * Throws a plain, user-safe Error once every attempt has failed.
 */
export async function fetchJson(path: string): Promise<unknown> {
    let lastError: unknown

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        try {
            // No method, headers or body: fetch defaults to GET. Every other
            // method on this API returns 405.
            const response = await fetch(BASE_URL + path)

            // A failed request here still returns valid JSON, so parsing would
            // succeed and hide the failure. The status is the only reliable
            // signal, which is why res.ok is checked before res.json().
            if (!response.ok) {
                // Retrying a 404 is wrong in general - it means the resource
                // does not exist. Here the 404s are injected by the assignment
                // on a URL that provably works, so they are worth retrying.
                throw new Error(`Request failed with status ${response.status}`)
            }

            return await response.json()
        } catch (error) {
            // Catches three things: a non-ok status thrown above, a network
            // level rejection from fetch itself, and a malformed JSON body.
            // All three are worth the same retry.
            lastError = error

            if (attempt < MAX_ATTEMPTS) {
                await delay(RETRY_DELAY_MS)
            }
        }
    }

    // The API's failure bodies are jokes ("this aint working dawg"). We never
    // read them, so they cannot reach the screen through this message.
    throw new Error("Could not load data from the server.")
}

/**
 * A 200 does not guarantee a usable body. Anything that is not an array
 * cannot be mapped over, so it is treated as a failure rather than crashing
 * the section - a blank page is an automatic fail in this assignment.
 */
export function parseCourses(value: unknown): Course[] | null {
    return Array.isArray(value) ? (value as Course[]) : null
}

/**
 * Validates the shape, not just the HTTP status. A 200 carrying {} or an
 * unexpected code must fall back to "not detected", not set the country to
 * undefined and silently format rupees with no explanation.
 */
export function parseCountryCode(value: unknown): CountryCode | null {
    const code = (value as { country_code?: unknown } | null)?.country_code
    if (code === "IN") return "IN"
    if (code === "US") return "US"
    return null
}

export type LoadResult = {
    status: Status
    courses: Course[]
    country: CountryCode | null
}

/**
 * The failure matrix, as one pure function.
 *
 * The two calls are not peers. Courses are the content: without them the
 * section has nothing to show. The country code only decides which of two
 * numbers we already hold gets formatted, so losing it costs currency
 * accuracy and nothing else.
 *
 *   courses rejected or not an array -> "error", country discarded
 *   courses ok (even empty)          -> "ready"
 *   country rejected or malformed    -> country: null, courses still render
 */
export function resolveLoad(
    coursesResult: PromiseSettledResult<unknown>,
    countryResult: PromiseSettledResult<unknown>
): LoadResult {
    const courses =
        coursesResult.status === "fulfilled"
            ? parseCourses(coursesResult.value)
            : null

    if (courses === null) {
        return { status: "error", courses: [], country: null }
    }

    const country =
        countryResult.status === "fulfilled"
            ? parseCountryCode(countryResult.value)
            : null

    return { status: "ready", courses, country }
}
