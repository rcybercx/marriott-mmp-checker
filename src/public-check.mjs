import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const HOTEL = 'Sheraton Okinawa Sunmarina Resort';
const PROPERTY_CODE = 'OKASI';
const CHECK_IN = '2026-07-25';
const CHECK_OUT = '2026-07-26';
const RATE_CODE = 'MMP';
const ARTIFACT_DIR = 'artifacts/public-test';

await fs.mkdir(ARTIFACT_DIR, { recursive: true });

const nowJst = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Tokyo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
}).format(new Date());

const searchUrl = new URL('https://www.marriott.com/search/findHotels.mi');
searchUrl.searchParams.set('destinationAddress.destination', HOTEL);
searchUrl.searchParams.set('propertyCode', PROPERTY_CODE);
searchUrl.searchParams.set('fromDate', CHECK_IN);
searchUrl.searchParams.set('toDate', CHECK_OUT);
searchUrl.searchParams.set('clusterCode', 'corp');
searchUrl.searchParams.set('corporateCode', RATE_CODE);
searchUrl.searchParams.set('useRewardsPoints', 'false');

const token = process.env.BROWSERLESS_TOKEN;
if (!token) throw new Error('BROWSERLESS_TOKEN is not configured.');

const endpoint = new URL('wss://production-sfo.browserless.io/stealth');
endpoint.searchParams.set('token', token);
endpoint.searchParams.set('proxy', 'residential');
endpoint.searchParams.set('proxyCountry', 'jp');
endpoint.searchParams.set('blockAds', 'true');
endpoint.searchParams.set('solveCaptchas', 'true');

let browser;
let page;
let responseStatus = null;
let finalUrl = null;
let title = null;
let bodyText = '';
let error = null;

try {
  browser = await chromium.connectOverCDP(endpoint.toString(), { timeout: 120000 });
  const context = browser.contexts()[0];
  if (!context) throw new Error('Browserless did not provide a default browser context.');

  await context.setExtraHTTPHeaders({
    'accept-language': 'en-US,en;q=0.9',
    'upgrade-insecure-requests': '1',
  });
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });

  page = await context.newPage();
  await page.setViewportSize({ width: 1440, height: 1100 });
  page.setDefaultTimeout(30000);

  const response = await page.goto(searchUrl.toString(), {
    waitUntil: 'domcontentloaded',
    timeout: 90000,
  });

  responseStatus = response?.status() ?? null;
  await page.waitForTimeout(12000);

  try {
    await page.waitForLoadState('networkidle', { timeout: 20000 });
  } catch {
    // Marriott pages may keep analytics connections open.
  }

  finalUrl = page.url();
  title = await page.title();
  bodyText = await page.locator('body').innerText({ timeout: 15000 }).catch(() => '');

  await page.screenshot({
    path: path.join(ARTIFACT_DIR, 'marriott-page.png'),
    fullPage: true,
  });

  await fs.writeFile(path.join(ARTIFACT_DIR, 'page.html'), await page.content(), 'utf8');
} catch (err) {
  error = err instanceof Error ? err.message : String(err);

  if (page) {
    await page.screenshot({
      path: path.join(ARTIFACT_DIR, 'marriott-error.png'),
      fullPage: true,
    }).catch(() => {});
  }
} finally {
  await browser?.close().catch(() => {});
}

const normalized = `${title ?? ''}\n${bodyText}`.toLowerCase();
const hotelVisible = normalized.includes('sheraton okinawa sunmarina') || normalized.includes(PROPERTY_CODE.toLowerCase());
const mmpVisible = normalized.includes('explore rate') || normalized.includes('explore friends rate') || normalized.includes('mmp');
const blockedTerms = [
  'access denied',
  'captcha',
  'verify you are human',
  'unusual traffic',
  'request unsuccessful',
  'reference #',
];
const blocked = responseStatus === 403 || blockedTerms.some((term) => normalized.includes(term));

const yenMatches = [...bodyText.matchAll(/(?:JPY|¥)\s?([0-9]{1,3}(?:,[0-9]{3})*)/gi)]
  .map((match) => Number(match[1].replaceAll(',', '')))
  .filter(Number.isFinite);
const lowestVisibleYen = yenMatches.length ? Math.min(...yenMatches) : null;

const result = {
  checkedAtJst: nowJst,
  hotel: HOTEL,
  propertyCode: PROPERTY_CODE,
  checkIn: CHECK_IN,
  checkOut: CHECK_OUT,
  rateCode: RATE_CODE,
  mode: 'browserless-stealth-residential-jp',
  requestUrl: searchUrl.toString(),
  httpStatus: responseStatus,
  finalUrl,
  pageTitle: title,
  hotelVisible,
  mmpTextVisible: mmpVisible,
  lowestVisibleYen,
  blocked,
  error,
};

await fs.writeFile(
  path.join(ARTIFACT_DIR, 'result.json'),
  `${JSON.stringify(result, null, 2)}\n`,
  'utf8',
);

console.log(JSON.stringify(result, null, 2));

const statusEmoji = blocked ? '🛑' : hotelVisible ? '✅' : '⚠️';
const lines = [
  '🧪 **BROWSERLESS TEST — not yet an availability alert**',
  `${statusEmoji} **Sheraton Okinawa Browserless test**`,
  `Hotel: ${HOTEL} (${PROPERTY_CODE})`,
  `Dates: ${CHECK_IN} to ${CHECK_OUT}`,
  'Mode: Browserless stealth + Japan residential proxy',
  `HTTP status: ${responseStatus ?? 'none'}`,
  `Page title: ${title || 'none'}`,
  `Hotel detected: ${hotelVisible ? 'yes' : 'no'}`,
  `MMP/Explore text detected: ${mmpVisible ? 'yes' : 'no'}`,
  `Lowest visible price: ${lowestVisibleYen ? `¥${lowestVisibleYen.toLocaleString('en-US')}` : 'none'}`,
  `Blocked/challenge detected: ${blocked ? 'yes' : 'no'}`,
  `Checked: ${nowJst} JST`,
  `Final URL: ${finalUrl || searchUrl.toString()}`,
];

if (error) lines.push(`Error: ${error.slice(0, 500)}`);
lines.push('Screenshot, HTML, and result JSON were saved to the workflow artifacts.');

const webhook = process.env.DISCORD_WEBHOOK_URL;
if (webhook) {
  const discordResponse = await fetch(webhook, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      username: 'MARRIOTT MMP',
      content: lines.join('\n'),
      allowed_mentions: { parse: [] },
    }),
  });

  if (!discordResponse.ok) {
    throw new Error(`Discord notification failed with HTTP ${discordResponse.status}`);
  }

  console.log('Discord notification sent.');
} else {
  console.log('DISCORD_WEBHOOK_URL is not configured; notification preview follows:');
  console.log(lines.join('\n'));
}

if (error) process.exitCode = 1;
