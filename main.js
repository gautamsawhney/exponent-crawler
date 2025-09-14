import { Actor, log } from 'apify';
import { PlaywrightCrawler } from 'crawlee';

await Actor.init();
const input = await Actor.getInput() || {};

// ── INPUT ──────────────────────────────────────────────────────────
const {
  startPage      = 1,
  endPage        = 203,
  useProxy       = true,
  maxConcurrency = 3,
  scrollDelayMs  = 200,
} = input;

if (endPage < startPage) throw new Error('endPage must be ≥ startPage');

// ── REQUEST QUEUE ──────────────────────────────────────────────────
const rq = await Actor.openRequestQueue();
for (let p = startPage; p <= endPage; p++) {
  const url = p === 1
    ? 'https://www.tryexponent.com/questions'
    : `https://www.tryexponent.com/questions?page=${p}`;
  log.info(`📄 Queuing page ${p}: ${url}`);
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
      await page.route('**/*.{png,jpg,jpeg,svg,gif,woff,woff2}', r => r.abort());
    },
  ],

  /* ───────────────────────────────────────────────────────────────┐
   *  Main handler: logs record-by-record, then pushes to dataset   *
   * ───────────────────────────────────────────────────────────────┘ */
  requestHandler: async ({ page, request }) => {
    const { pageNo } = request.userData;
    log.info(`➡️  Visiting page ${pageNo}: ${request.url}`);

    await page.waitForSelector('a:has-text("answers")', { timeout: 20_000 });
    await autoScroll(page, scrollDelayMs);

    const items = await page.evaluate(() => {
      const out = [];
      document.querySelectorAll('a[href^="/questions/"]').forEach((a) => {
        const slug = a.getAttribute('href') ?? '';
        if (slug.split('/').length !== 3) return; // skip non-cards

        out.push({
          question:  (a.querySelector('span, h3')?.textContent || '').trim(),
          link:      'https://www.tryexponent.com' + slug,
          companies: Array.from(a.querySelectorAll('img[alt]'))
                          .map(img => img.getAttribute('alt').trim())
                          .join(', '),
          tags:      Array.from(a.querySelectorAll('div.border.rounded-md.text-xs'))
                          .map(div => div.textContent.trim())
                          .join(', '),
          answers:   Number(a.textContent.match(/(\d+)\s+answers?/i)?.[1] || 0),
          rawDate:   a.querySelector('time')?.getAttribute('datetime')
                   ?? a.querySelector('span.text-gray-500')?.textContent.trim(),
        });
      });
      return out;
    });

    for (const rec of items) {
      log.debug(`📝 [P${pageNo}] ${rec.question}  (${rec.link})`);
      Actor.pushData({ 
        ...rec, 
        askedWhen: formatDate(rec.rawDate || '') 
      });
    }

    log.info(`✅ Page ${pageNo} – saved ${items.length} records`);
  },

  failedRequestHandler: async ({ request }) =>
    log.error(`❌  ${request.url} failed after all retries.`),
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
  const rel = /^(\d+)\s+(day|week|month|year)s?\s+ago/i;
  const m   = str?.match?.(rel);
  if (m) {
    const [, n, unit] = m;
    const date = new Date();
    const map  = { day: 'Date', week: 'Date', month: 'Month', year: 'FullYear' };
    const mult = { day: 1, week: 7, month: 1, year: 1 };
    date[`set${map[unit]}`](date[`get${map[unit]}`]() - n * mult[unit]);
    return date.toLocaleDateString('en-GB');
  }
  const d = new Date(str);
  return Number.isNaN(d) ? '' : d.toLocaleDateString('en-GB');
}
