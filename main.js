import { Actor, log } from 'apify';
import { BasicCrawler, gotScraping } from 'crawlee';
import * as cheerio from 'cheerio';

await Actor.init();
const input = await Actor.getInput() || {};

// ----  INPUT HANDLING  ----
const {
  startPage = 1,
  endPage   = 203,
  useProxy  = true,
  maxConcurrency = 5,
} = input;

if (endPage < startPage) throw new Error('endPage must be ≥ startPage');

// ----  REQUEST QUEUE  ----
const rq = await Actor.openRequestQueue();
for (let p = startPage; p <= endPage; p++) {
  const url = p === 1
    ? 'https://www.tryexponent.com/questions'
    : `https://www.tryexponent.com/questions?page=${p}`;
  await rq.addRequest({ url, userData: { page: p } });
}

const proxy = useProxy ? await Actor.createProxyConfiguration() : null;

// ----  CRAWLER  ----
const crawler = new BasicCrawler({
  requestQueue: rq,
  maxConcurrency,
  handleRequestFunction: async ({ request }) => {
    const { page } = request.userData;
    log.info(`➡️  Page ${page} – fetching…`);

    // Fetch page HTML with browser-like headers
    const { body } = await gotScraping({
      url: request.url,
      proxyUrl: proxy && await proxy.newUrl(),
      timeout: { request: 30_000 }, // 30 s
    });

    const $ = cheerio.load(body);

    // Select only the question cards on the list page
    const cards = $('a[href^="/questions/"]').filter((i, el) =>
      $(el).attr('href').split('/').length === 3);

    if (!cards.length) {
      log.warning(`⏭️  Page ${page} empty or blocked – skipping.`);
      return;
    }

    cards.each((_, el) => {
      const card = $(el);

      const link = 'https://www.tryexponent.com' + card.attr('href');
      const question = card.find('span, h3').first().text().trim();

      const companies = card.find('img[alt]')
        .map((i, img) => $(img).attr('alt').trim())
        .get()
        .join(', ');

      const tags = card.find('div.border.rounded-md.text-xs')
        .map((i, d) => $(d).text().trim())
        .get()
        .join(', ');

      const answersTxt = card.find('a:contains("answers")').text();
      const answersCount = parseInt(answersTxt.match(/\d+/)?.[0] || '0', 10);

      const rawDate =
        card.find('time').attr('datetime') ||
        card.find('span.text-gray-500').first().text().trim();
      const askedWhen = formatDate(rawDate);

      Actor.pushData({
        question,
        companies,
        askedWhen,
        tags,
        answersCount,
        link,
      });
    });

    log.info(`✅  Page ${page} – saved ${cards.length} records`);
  },

  maxRequestRetries: 2,
  handleFailedRequestFunction: async ({ request }) =>
    log.error(`❌  Request ${request.url} failed – giving up.`),
});

await crawler.run();
log.info('🎉  Crawl complete – download CSV from the run’s Dataset tab.');
await Actor.exit();

// ----  HELPERS  ----
function formatDate(str) {
  const REL = /(\d+)\s+(day|week|month|year)s?\s+ago/i;
  if (REL.test(str)) {
    const [, n, unit] = str.match(REL);
    const date = new Date();
    const map = { day: 'Date', week: 'Date', month: 'Month', year: 'FullYear' };
    const mult = { day: 1, week: 7, month: 1, year: 1 };
    date[`set${map[unit]}`](date[`get${map[unit]}`]() - n * mult[unit]);
    return date.toLocaleDateString('en-GB');
  }
  return new Date(str).toLocaleDateString('en-GB');
}
