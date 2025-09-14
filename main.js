// main.js — Exponent questions crawler (Playwright + Apify SDK)

import { Actor, log }          from 'apify';
import { PlaywrightCrawler }   from 'crawlee';

await Actor.init();
const input = await Actor.getInput() ?? {};

// ─── INPUT ────────────────────────────────────────────────────────────────
const {
  startPage      = 1,
  endPage        = 203,
  useProxy       = true,
  maxConcurrency = 3,
  scrollDelayMs  = 200,
} = input;

if (endPage < startPage) throw new Error('endPage must be ≥ startPage');

// ─── REQUEST QUEUE ────────────────────────────────────────────────────────
const rq = await Actor.openRequestQueue();
for (let p = startPage; p <= endPage; p += 1) {
  const url = p === 1
    ? 'https://www.tryexponent.com/questions'
    : `https://www.tryexponent.com/questions?page=${p}`;
  log.info(`📄 Queuing page ${p}: ${url}`);
  await rq.addRequest({ url, userData: { pageNo: p } });
}

const proxy = useProxy ? await Actor.createProxyConfiguration() : null;

// ─── CRAWLER ──────────────────────────────────────────────────────────────
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

  /* block heavy assets for speed */
  preNavigationHooks: [
    async ({ page }) =>
      page.route('**/*.{png,jpg,jpeg,svg,gif,woff,woff2}', r => r.abort()),
  ],

  /* MAIN HANDLER */
  requestHandler: async ({ page, request }) => {
    const { pageNo } = request.userData;
    log.info(`➡️ Visiting P${pageNo}: ${request.url}`);

    /* wait until at least one card shows up */
    await page.waitForSelector('li div.block.cursor-pointer', { timeout: 20_000 });
    await autoScroll(page, scrollDelayMs);

    /* extract in browser context */
    const records = await page.evaluate(() => {
      const out   = [];
      const seen  = new Set();

      /* each question “card” is a <div class="block cursor-pointer …"> wrapped in an <li> */
      document.querySelectorAll('li div.block.cursor-pointer').forEach(card => {
        const anchor = card.querySelector('h3 a[href^="/questions/"]');
        if (!anchor) return;

        const slug = anchor.getAttribute('href');
        /* discard /contribute?basedOn=… and dedupe */
        if (slug.includes('contribute') || seen.has(slug)) return;
        seen.add(slug);

        /* core fields */
        const question  = anchor.textContent.trim();
        const link      = 'https://www.tryexponent.com' + slug;

        const companies = Array.from(card.querySelectorAll('img[alt]'))
          .map(img => img.getAttribute('alt')?.trim() ?? '')
          .filter(Boolean)
          .join(', ');

        const tags = Array.from(card.querySelectorAll('div.border.rounded-md.text-xs, span[class*="tag"]'))
          .map(el => el.textContent.trim())
          .filter(Boolean)
          .join(', ');

        const ansAnchor = card.querySelector('a[href$="#answers"]');
        const answers   = ansAnchor
          ? Number(ansAnchor.textContent.match(/(\d+)\s+answers?/i)?.[1] || 0)
          : 0;

        const rawDate =
          card.querySelector('time')?.getAttribute('datetime') ??
          card.querySelector('span.text-gray-500')?.textContent.trim() ??
          '';

        out.push({ question, companies, tags, answers, rawDate, link });
      });

      return out;
    });

    /* push to dataset */
    for (const rec of records) {
      log.debug(`📝 [P${pageNo}] ${rec.question} → ${rec.link}`);
      Actor.pushData({ ...rec, askedWhen: formatDate(rec.rawDate) });
    }

    log.info(`✅ Page ${pageNo} – saved ${records.length} records`);
  },

  failedRequestHandler: async ({ request }) =>
    log.error(`❌ ${request.url} failed after all retries.`),
});

await crawler.run();
log.info('🎉 Crawl complete – download CSV from the run’s *Dataset* tab.');
await Actor.exit();

// ─── HELPERS ──────────────────────────────────────────────────────────────
async function autoScroll(page, delay) {
  await page.evaluate(async d => {
    await new Promise(resolve => {
      let scrolled = 0;
      const step   = 800;
      const timer  = setInterval(() => {
        window.scrollBy(0, step);
        scrolled += step;
        if (scrolled >= document.body.scrollHeight) {
          clearInterval(timer);
          resolve();
        }
      }, d);
    });
  }, delay);
}

function formatDate(str = '') {
  /* "6 months ago" → DD/MM/YYYY */
  const rel = /^(\d+)\s+(day|week|month|year)s?\s+ago/i;
  const m   = str.match?.(rel);
  if (m) {
    const [, n, unit] = m;
    const date  = new Date();
    const prop  = { day: 'Date', week: 'Date', month: 'Month', year: 'FullYear' }[unit];
    const mult  = unit === 'week' ? 7 : 1;
    date[`set${prop}`](date[`get${prop}`]() - n * mult);
    return date.toLocaleDateString('en-GB');
  }
  /* ISO → locale */
  const d = new Date(str);
  return Number.isNaN(d) ? '' : d.toLocaleDateString('en-GB');
}
