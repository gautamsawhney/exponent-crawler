import { Actor, log } from 'apify';
import { PlaywrightCrawler } from 'crawlee';

await Actor.init();
const input = await Actor.getInput() || {};

// ── INPUT ──────────────────────────────────────────────────────────
const {
  startPage      = 1,
  endPage        = 203,
  useProxy       = true,
  maxConcurrency = 3,      // feel free to raise—no $5 cap now
  scrollDelayMs  = 200,    // future-proof if they add infinite scroll
} = input;

if (endPage < startPage) throw new Error('endPage must be ≥ startPage');

// ── REQUEST QUEUE ──────────────────────────────────────────────────
const rq = await Actor.openRequestQueue();
for (let p = startPage; p <= endPage; p++) {
  const url = p === 1
    ? 'https://www.tryexponent.com/questions'
    : `https://www.tryexponent.com/questions?page=${p}`;
  await rq.addRequest({ url, userData: { pageNo: p } });
}

const proxy = useProxy ? await Actor.createProxyConfiguration() : null;

// ── PLAYWRIGHT CRAWLER ─────────────────────────────────────────────
const crawler = new PlaywrightCrawler({
  requestQueue: rq,
  maxConcurrency,
  proxyConfiguration: proxy,
  browserPoolOptions: { useFingerprints: true },

  launchContext: {
    launchOptions: {
      headless: true,
      args: ['--disable-blink-features=AutomationControlled'],
    },
  },

  // Block images / fonts for speed
  preNavigationHooks: [
    async ({ page }) => {
      await page.route('**/*.{png,jpg,jpeg,svg,gif,woff,woff2}', route => route.abort());
    },
  ],

  handlePageFunction: async ({ page, request }) => {
    const { pageNo } = request.userData;
    log.info(`➡️  Page ${pageNo} – browsing…`);

    // Wait until at least one question appears
    await page.waitForSelector('a:has-text("answers")', { timeout: 20000 });

    // Future-proof: gentle scroll to bottom to trigger lazy loading
    await autoScroll(page, scrollDelayMs);

    // Extract data in page context
    const items = await page.evaluate(() => {
      const out = [];
      document.querySelectorAll('a[href^="/questions/"]').forEach((a) => {
        const slug = a.getAttribute('href') || '';
        if (slug.split('/').length !== 3) return; // skip contribute etc.

        const question = (a.querySelector('span, h3')?.textContent || '').trim();
        const link     = 'https://www.tryexponent.com' + slug;

        const companies = Array.from(a.querySelectorAll('img[alt]'))
          .map(img => img.getAttribute('alt').trim())
          .join(', ');

        const tags = Array.from(a.querySelectorAll('div.border.rounded-md.text-xs'))
          .map(div => div.textContent.trim())
          .join(', ');

        const ansMatch = a.textContent.match(/(\\d+)\\s+answers?/i);
        const answersCount = ansMatch ? Number(ansMatch[1]) : 0;

        const rawDate =
          a.querySelector('time')?.getAttribute('datetime') ??
          a.querySelector('span.text-gray-500')?.textContent.trim();

        out.push({ question, companies, tags, answersCount, rawDate, link });
      });
      return out;
    });

    // Normalize dates & push to dataset
    for (const rec of items) {
      const askedWhen = formatDate(rec.rawDate || '');
      Actor.pushData({ ...rec, askedWhen });
    }

    log.info(`✅  Page ${pageNo} – saved ${items.length} records`);
  },

  handleFailedRequestFunction: async ({ request }) =>
    log.error(`❌  ${request.url} failed after retries.`),
});

await crawler.run();
log.info('🎉  Crawl complete – download CSV from the run’s Dataset tab.');
await Actor.exit();

// ── HELPERS ────────────────────────────────────────────────────────
async function autoScroll(page, delay) {
  await page.evaluate(async (d) => {
    await new Promise((resolve) => {
      let total = 0;
      const distance = 600;
      const timer = setInterval(() => {
        window.scrollBy(0, distance);
        total += distance;
        if (total >= document.body.scrollHeight) {
          clearInterval(timer);
          resolve();
        }
      }, d);
    });
  }, delay);
}

function formatDate(str) {
  const rel = /^(\\d+)\\s+(day|week|month|year)s?\\s+ago/i;
  const m   = str?.match?.(rel);
  if (m) {
    const [, n, unit] = m;
    const date = new Date();
    const map  = { day: 'Date', week: 'Date', month: 'Month', year: 'FullYear' };
    const mult = { day: 1, week: 7, month: 1, year: 1 };
    date[`set${map[unit]}`](date[`get${map[unit]}`]() - n * mult[unit]);
    return date.toLocaleDateString('en-GB');
  }
  // ISO or empty
  const d = new Date(str);
  return Number.isNaN(d) ? '' : d.toLocaleDateString('en-GB');
}
