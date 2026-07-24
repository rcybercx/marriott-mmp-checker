const HOTEL = 'Sheraton Okinawa Sunmarina Resort';
const PROPERTY_CODE = 'OKASI';
const CHECK_IN = '2026-07-25';
const CHECK_OUT = '2026-07-26';
const RATE_CODE = 'MMP';

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

const headers = {
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36',
  'accept-language': 'en-US,en;q=0.9',
};

let response;
let body = '';
let error = null;

try {
  response = await fetch(searchUrl, {
    headers,
    redirect: 'follow',
  });
  body = await response.text();
} catch (err) {
  error = err instanceof Error ? err.message : String(err);
}

const normalized = body.toLowerCase();
const hotelVisible = normalized.includes('sheraton okinawa sunmarina') || normalized.includes(PROPERTY_CODE.toLowerCase());
const mmpVisible = normalized.includes('explore rate') || normalized.includes('mmp');
const blocked = normalized.includes('captcha') || normalized.includes('access denied') || normalized.includes('robot');

const result = {
  checkedAtJst: nowJst,
  hotel: HOTEL,
  propertyCode: PROPERTY_CODE,
  checkIn: CHECK_IN,
  checkOut: CHECK_OUT,
  rateCode: RATE_CODE,
  mode: 'public-no-login',
  requestUrl: searchUrl.toString(),
  httpStatus: response?.status ?? null,
  finalUrl: response?.url ?? null,
  hotelVisible,
  mmpTextVisible: mmpVisible,
  blocked,
  error,
};

console.log(JSON.stringify(result, null, 2));

const lines = [
  `**Sheraton Okinawa MMP public test**`,
  `Hotel: ${HOTEL} (${PROPERTY_CODE})`,
  `Dates: ${CHECK_IN} to ${CHECK_OUT}`,
  `Mode: Public / no Marriott login`,
  `HTTP status: ${result.httpStatus ?? 'none'}`,
  `Hotel detected in response: ${hotelVisible ? 'yes' : 'no'}`,
  `MMP/Explore text detected: ${mmpVisible ? 'yes' : 'no'}`,
  `Blocked/challenge detected: ${blocked ? 'yes' : 'no'}`,
  `Checked: ${nowJst} JST`,
  `Search: ${searchUrl.toString()}`,
];

if (error) lines.push(`Error: ${error}`);

if (process.env.TEST_NOTIFICATION === 'true') {
  lines.unshift('🧪 TEST NOTIFICATION — this is not an availability alert.');
}

const webhook = process.env.DISCORD_WEBHOOK_URL;
if (webhook) {
  const discordResponse = await fetch(webhook, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ content: lines.join('\n') }),
  });
  if (!discordResponse.ok) {
    throw new Error(`Discord notification failed with HTTP ${discordResponse.status}`);
  }
  console.log('Discord notification sent.');
} else {
  console.log('DISCORD_WEBHOOK_URL is not configured; notification preview follows:');
  console.log(lines.join('\n'));
}

if (error || blocked) process.exitCode = 2;
