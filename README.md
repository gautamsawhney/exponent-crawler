# Exponent Interview-Question Crawler

Scrapes question listings from [tryexponent.com](https://www.tryexponent.com/questions) and exports them to an Apify dataset (downloadable as CSV).

## Quick start

```bash
git clone https://github.com/YOUR_GITHUB/exponent-crawler.git
cd exponent-crawler
npm install
apify push   # to your Apify account
```

### Run locally / on Apify Cloud

```bash
apify run --input '{ "startPage": 1, "endPage": 5, "useProxy": true }'
```

After completion, open the run → **Dataset** → **Download as CSV**.

## Input schema

| Field | Type | Default | Notes |
|-------|------|---------|-------|
| `startPage` | integer | 1 | First page to crawl |
| `endPage` | integer | 203 | Last page to crawl |
| `useProxy` | boolean | true | Use Apify proxy group Auto |
| `maxConcurrency` | integer | 5 | Parallel HTTP requests |

## Budget friendliness

* Uses `BasicCrawler` + `requestAsBrowser` (no Playwright), minimal RAM & compute units.
* Retry‑aware, polite concurrency ⇒ avoids extra proxy charges.
