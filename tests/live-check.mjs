// Not a unit test - a one-off sanity run against the real, flaky API.
import { fetchJson, formatPrice } from "../src/helpers.ts"

let ok = 0, failed = 0
for (let i = 0; i < 10; i++) {
    try {
        const courses = await fetchJson("/assignment/course-data")
        const cc = await fetchJson("/assignment/country-code")
        ok++
        if (i === 0) {
            console.log(`country: ${cc.country_code}, ${courses.length} courses`)
            for (const c of courses.slice(0, 3)) {
                console.log(
                    `  ${c.courseName.padEnd(24)} ${String(c.pricePaise).padEnd(7)}` +
                    ` -> ${formatPrice(c, "IN").padEnd(9)} | ` +
                    `${String(c.priceUsdCents).padEnd(5)} -> ${formatPrice(c, "US")}`
                )
            }
        }
    } catch (e) {
        failed++
        console.log(`  load ${i + 1} failed: "${e.message}" (cause: ${e.cause?.message})`)
    }
}
console.log(`\n${ok}/10 full page loads succeeded, ${failed} exhausted all retries`)
