// Adversarial cases the live API never produces.
//
// In ~80 calls the API has never returned an empty array or a non-array 200,
// so these paths cannot be verified by reloading the page and hoping. They are
// stubbed here instead, and driven through the SAME composition the component
// uses: Promise.allSettled([fetchJson, fetchJson]) -> resolveLoad.
//
// Run: node tests/adversarial.test.mjs
import assert from "node:assert/strict"
import { fetchJson, resolveLoad } from "../src/helpers.ts"

const COURSES_PATH = "/assignment/course-data"
const COUNTRY_PATH = "/assignment/country-code"

let passed = 0
async function check(label, fn) {
    try {
        await fn()
        console.log("  PASS  " + label)
        passed++
    } catch (e) {
        console.log("  FAIL  " + label + "\n        " + e.message)
        process.exitCode = 1
    }
}

// Route each path to its own stubbed response.
const realFetch = globalThis.fetch
function stubRoutes({ courses, country }) {
    globalThis.fetch = async (url) => {
        const body = String(url).includes("course-data") ? courses : country
        if (body instanceof Error) throw body
        return { ok: true, status: 200, json: async () => body }
    }
}
const okCountry = { country_code: "IN" }

// The component's load path, verbatim in composition.
async function load() {
    const results = await Promise.allSettled([
        fetchJson(COURSES_PATH),
        fetchJson(COUNTRY_PATH),
    ])
    return resolveLoad(results[0], results[1])
}

// The component's derived values, using the same expressions it renders from.
const isEmpty = (s) => s.status === "ready" && s.courses.length === 0
const showCountryNotice = (s) => s.status === "ready" && s.country === null

const course = {
    courseName: "How To YouTube",
    courseCode: "how-to-youtube",
    description: "From concept to creation...",
    mainCategory: "Content Creation",
    shortCourse: "YouTube",
    courseType: "Original",
    pricePaise: 199900,
    priceUsdCents: 3999,
    mangoId: "a1b2c3d4e5f6789012345678",
    refundable: true,
}

console.log("\nCase 1 - courses resolves with an EMPTY array")

await check("a 200 carrying [] reaches the empty state, not the error state", async () => {
    stubRoutes({ courses: [], country: okCountry })
    const state = await load()
    assert.equal(state.status, "ready", "an empty response is a SUCCESS")
    assert.deepEqual(state.courses, [])
    assert.equal(isEmpty(state), true, "the empty branch must render")
})

await check("empty is derived, never a stored status", async () => {
    stubRoutes({ courses: [], country: okCountry })
    const state = await load()
    assert.ok(
        ["loading", "ready", "error"].includes(state.status),
        'status must stay one of the three; "empty" is not a status'
    )
})

await check("a non-empty response does NOT trigger the empty branch", async () => {
    stubRoutes({ courses: [course], country: okCountry })
    const state = await load()
    assert.equal(isEmpty(state), false)
})

console.log("\nCase 2 - courses resolves with a 200 that is NOT an array")

for (const [label, payload] of [
    ["an error object", { detail: "FAAAAAAAAAAA" }],
    ["an empty object", {}],
    ["a bare string", "no courses today"],
    ["a number", 42],
    ["null", null],
    ["a wrapped array", { courses: [course] }],
]) {
    await check(`${label} on a 200 becomes the error state`, async () => {
        stubRoutes({ courses: payload, country: okCountry })
        const state = await load()
        assert.equal(state.status, "error", "must not be treated as data")
        assert.deepEqual(state.courses, [], "nothing must reach .map()")
    })
}

await check("a non-array 200 is NOT mistaken for the empty state", async () => {
    stubRoutes({ courses: { detail: "gg" }, country: okCountry })
    const state = await load()
    assert.equal(isEmpty(state), false, "error and empty must stay distinct")
})

await check("courses.map would be safe on every outcome", async () => {
    for (const payload of [[], [course], { detail: "gg" }, null, "x", 7]) {
        stubRoutes({ courses: payload, country: okCountry })
        const state = await load()
        assert.ok(Array.isArray(state.courses), "courses is always an array")
    }
})

console.log("\nCase 3 - the adversarial cases combined with a country failure")

await check("empty courses + failed country: still ready, still empty", async () => {
    stubRoutes({ courses: [], country: new TypeError("Failed to fetch") })
    const state = await load()
    assert.equal(state.status, "ready")
    assert.equal(isEmpty(state), true)
    // NOTE: showCountryNotice is also true here, so the notice and the empty
    // message render together. Recorded rather than "fixed" - see LEARNINGS.
    assert.equal(showCountryNotice(state), true)
})

await check("non-array courses + failed country: error wins, country discarded", async () => {
    stubRoutes({ courses: { detail: "gg" }, country: new TypeError("Failed to fetch") })
    const state = await load()
    assert.equal(state.status, "error")
    assert.equal(state.country, null)
    assert.equal(showCountryNotice(state), false, "no notice on top of an error")
})

globalThis.fetch = realFetch
console.log(`\n${passed} passed, exit code ${process.exitCode ?? 0}\n`)
