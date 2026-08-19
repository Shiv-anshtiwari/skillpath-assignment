// Step 2 verification. Plain Node, no test framework, no dependencies.
// Run: node tests/helpers.test.mjs
import assert from "node:assert/strict"
import {
    formatPrice, fetchJson, MAX_ATTEMPTS,
    parseCourses, parseCountryCode, resolveLoad, columnsForWidth,
} from "../src/helpers.ts"

let passed = 0
function check(label, fn) {
    try {
        fn()
        console.log("  PASS  " + label)
        passed++
    } catch (e) {
        console.log("  FAIL  " + label + "\n        " + e.message)
        process.exitCode = 1
    }
}
async function checkAsync(label, fn) {
    try {
        await fn()
        console.log("  PASS  " + label)
        passed++
    } catch (e) {
        console.log("  FAIL  " + label + "\n        " + e.message)
        process.exitCode = 1
    }
}

// A real course object, copied verbatim from a live API response.
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
const withPrice = (pricePaise, priceUsdCents = 0) => ({
    ...course,
    pricePaise,
    priceUsdCents,
})

console.log("\nformatPrice")

check("199900 paise -> Rs 1,999 (NOT 1,99,900)", () => {
    assert.equal(formatPrice(course, "IN"), "\u20B91,999")
})
check("3999 cents -> $39.99", () => {
    assert.equal(formatPrice(course, "US"), "$39.99")
})
check("the whole live dataset formats correctly in INR", () => {
    const expected = [
        [199900, "\u20B91,999"], [149900, "\u20B91,499"], [179900, "\u20B91,799"],
        [99900, "\u20B9999"], [79900, "\u20B9799"], [129900, "\u20B91,299"],
        [159900, "\u20B91,599"], [119900, "\u20B91,199"], [89900, "\u20B9899"],
        [169900, "\u20B91,699"],
    ]
    for (const [paise, want] of expected) {
        assert.equal(formatPrice(withPrice(paise), "IN"), want, `${paise} paise`)
    }
})
check("the whole live dataset formats correctly in USD", () => {
    const expected = [
        [3999, "$39.99"], [2999, "$29.99"], [3499, "$34.99"], [1999, "$19.99"],
        [1499, "$14.99"], [2499, "$24.99"], [3199, "$31.99"], [2299, "$22.99"],
        [1799, "$17.99"], [3299, "$32.99"],
    ]
    for (const [cents, want] of expected) {
        assert.equal(formatPrice(withPrice(0, cents), "US"), want, `${cents} cents`)
    }
})
check("Indian grouping: 1 lakh rupees -> Rs 1,00,000 not 100,000", () => {
    assert.equal(formatPrice(withPrice(10000000), "IN"), "\u20B91,00,000")
})
check("Indian grouping: 1 crore rupees -> Rs 1,00,00,000", () => {
    assert.equal(formatPrice(withPrice(1000000000), "IN"), "\u20B91,00,00,000")
})
check("a price with real paise keeps 2 decimals", () => {
    assert.equal(formatPrice(withPrice(199950), "IN"), "\u20B91,999.50")
})
check("USD keeps trailing zeros: 4000 cents -> $40.00", () => {
    assert.equal(formatPrice(withPrice(0, 4000), "US"), "$40.00")
})
check("free course: 0 paise -> Rs 0", () => {
    assert.equal(formatPrice(withPrice(0), "IN"), "\u20B90")
})
check("unknown country code falls back to INR", () => {
    assert.equal(formatPrice(course, "GB"), "\u20B91,999")
    assert.equal(formatPrice(course, ""), "\u20B91,999")
})
check("a missing or non-numeric price returns null, never NaN", () => {
    assert.equal(formatPrice({ ...course, pricePaise: undefined }, "IN"), null)
    assert.equal(formatPrice({ ...course, priceUsdCents: null }, "US"), null)
})

console.log("\nfetchJson")

// Swap in a fake fetch so the retry policy can be tested without the network.
const realFetch = globalThis.fetch
const calls = []
function stubFetch(...responses) {
    calls.length = 0
    let i = 0
    globalThis.fetch = async (url, options) => {
        calls.push({ url, options })
        const next = responses[Math.min(i++, responses.length - 1)]
        if (next instanceof Error) throw next
        return next
    }
}
const ok = (body) => ({ ok: true, status: 200, json: async () => body })
const bad = (status) => ({
    ok: false,
    status,
    json: async () => ({ detail: "this aint working dawg" }),
})

await checkAsync("returns parsed JSON on success", async () => {
    stubFetch(ok([{ courseName: "x" }]))
    assert.deepEqual(await fetchJson("/assignment/course-data"), [{ courseName: "x" }])
    assert.equal(calls.length, 1, "should not retry a success")
})
await checkAsync("sends GET and no body", async () => {
    stubFetch(ok({ country_code: "IN" }))
    await fetchJson("/assignment/country-code")
    const opts = calls[0].options
    assert.ok(
        opts === undefined || (!opts.method || opts.method === "GET") && !opts.body,
        "fetch must be called with no method/body so it defaults to GET"
    )
})
await checkAsync("builds the full URL from BASE_URL + path", async () => {
    stubFetch(ok({}))
    await fetchJson("/assignment/country-code")
    assert.equal(
        calls[0].url,
        "https://syncsphere-hiv6.onrender.com/assignment/country-code"
    )
})
await checkAsync("retries a 500 and succeeds on attempt 2", async () => {
    stubFetch(bad(500), ok({ country_code: "US" }))
    assert.deepEqual(await fetchJson("/x"), { country_code: "US" })
    assert.equal(calls.length, 2)
})
await checkAsync("retries a 404 and succeeds on attempt 3", async () => {
    stubFetch(bad(404), bad(404), ok({ country_code: "IN" }))
    assert.deepEqual(await fetchJson("/x"), { country_code: "IN" })
    assert.equal(calls.length, 3)
})
await checkAsync(`gives up after exactly ${MAX_ATTEMPTS} attempts`, async () => {
    stubFetch(bad(500))
    await assert.rejects(() => fetchJson("/x"))
    assert.equal(calls.length, MAX_ATTEMPTS)
})
await checkAsync("retries a network-level rejection too", async () => {
    stubFetch(new TypeError("Failed to fetch"), ok({ country_code: "IN" }))
    assert.deepEqual(await fetchJson("/x"), { country_code: "IN" })
    assert.equal(calls.length, 2)
})
await checkAsync("retries a malformed JSON body on a 200", async () => {
    stubFetch(
        { ok: true, status: 200, json: async () => { throw new SyntaxError("bad json") } },
        ok({ country_code: "US" })
    )
    assert.deepEqual(await fetchJson("/x"), { country_code: "US" })
    assert.equal(calls.length, 2)
})
await checkAsync("the thrown message never leaks the API's raw detail", async () => {
    stubFetch(bad(404))
    await assert.rejects(
        () => fetchJson("/x"),
        (err) => {
            assert.equal(err.message, "Could not load data from the server.")
            assert.ok(!err.message.includes("aint working"), "no raw detail")
            assert.ok(!/40\d|50\d/.test(err.message), "no status code in the message")
            return true
        }
    )
})
await checkAsync("never reads the body of a failed response", async () => {
    let bodyWasRead = false
    stubFetch({
        ok: false,
        status: 500,
        json: async () => {
            bodyWasRead = true
            return { detail: "gg" }
        },
    })
    await assert.rejects(() => fetchJson("/x"))
    assert.equal(bodyWasRead, false)
})

console.log("\ncolumnsForWidth - the 3/2/1 boundaries")

check("below 640 is one column", () => {
    for (const w of [0, 1, 320, 375, 500, 639]) {
        assert.equal(columnsForWidth(w), 1, `${w}px`)
    }
})
check("exactly 640 is already two columns", () => {
    assert.equal(columnsForWidth(639), 1)
    assert.equal(columnsForWidth(640), 2)
})
check("640 to 1023 is two columns", () => {
    for (const w of [640, 700, 800, 1023]) {
        assert.equal(columnsForWidth(w), 2, `${w}px`)
    }
})
check("exactly 1024 is already three columns", () => {
    assert.equal(columnsForWidth(1023), 2)
    assert.equal(columnsForWidth(1024), 3)
})
check("1024 and above is three columns", () => {
    for (const w of [1024, 1200, 1440, 1920, 5000]) {
        assert.equal(columnsForWidth(w), 3, `${w}px`)
    }
})
check("688 and 1072 are NOT boundaries - the Step 1 padding bug", () => {
    assert.equal(columnsForWidth(687), 2, "would have been 1 with the old bug")
    assert.equal(columnsForWidth(688), 2)
    assert.equal(columnsForWidth(1071), 3, "would have been 2 with the old bug")
    assert.equal(columnsForWidth(1072), 3)
})

console.log("\nparseCourses / parseCountryCode")

check("parseCourses accepts an array, including an empty one", () => {
    assert.deepEqual(parseCourses([course]), [course])
    assert.deepEqual(parseCourses([]), [])
})
check("parseCourses rejects anything not an array", () => {
    for (const junk of [null, undefined, {}, { detail: "FAAAAAAAAAAA" }, "", 5]) {
        assert.equal(parseCourses(junk), null, JSON.stringify(junk))
    }
})
check("parseCountryCode accepts only IN and US", () => {
    assert.equal(parseCountryCode({ country_code: "IN" }), "IN")
    assert.equal(parseCountryCode({ country_code: "US" }), "US")
})
check("parseCountryCode rejects a malformed 200", () => {
    for (const junk of [null, undefined, {}, { country_code: "XX" },
                        { country_code: null }, { countryCode: "IN" }, "IN"]) {
        assert.equal(parseCountryCode(junk), null, JSON.stringify(junk))
    }
})

console.log("\nresolveLoad - the failure matrix")

const okResult = (value) => ({ status: "fulfilled", value })
const rejResult = () => ({ status: "rejected", reason: new Error("boom") })

check("courses ok + country ok -> ready with the country set", () => {
    const r = resolveLoad(okResult([course]), okResult({ country_code: "US" }))
    assert.deepEqual(r, { status: "ready", courses: [course], country: "US" })
})
check("courses ok + country rejected -> ready, country null, courses intact", () => {
    const r = resolveLoad(okResult([course]), rejResult())
    assert.equal(r.status, "ready")
    assert.equal(r.country, null)
    assert.equal(r.courses.length, 1, "a country failure must NOT drop the courses")
})
check("courses ok + malformed country 200 -> treated the same as rejected", () => {
    const r = resolveLoad(okResult([course]), okResult({ country_code: "XX" }))
    assert.equal(r.status, "ready")
    assert.equal(r.country, null)
})
check("courses ok but EMPTY -> ready, so empty stays derivable", () => {
    const r = resolveLoad(okResult([]), okResult({ country_code: "IN" }))
    assert.equal(r.status, "ready")
    assert.deepEqual(r.courses, [])
})
check("courses rejected -> error, even when country succeeded", () => {
    const r = resolveLoad(rejResult(), okResult({ country_code: "IN" }))
    assert.equal(r.status, "error")
    assert.deepEqual(r.courses, [])
    assert.equal(r.country, null)
})
check("courses 200 but not an array -> error, never handed to .map", () => {
    const r = resolveLoad(okResult({ detail: "gg" }), okResult({ country_code: "IN" }))
    assert.equal(r.status, "error")
})
check("both rejected -> error", () => {
    assert.equal(resolveLoad(rejResult(), rejResult()).status, "error")
})
check("resolveLoad never returns the string 'empty' as a status", () => {
    const r = resolveLoad(okResult([]), rejResult())
    assert.ok(["loading", "ready", "error"].includes(r.status))
})

globalThis.fetch = realFetch
console.log(`\n${passed} passed, exit code ${process.exitCode ?? 0}\n`)
