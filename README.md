# Sheraton Okinawa MMP Rate Watcher

This repository checks Marriott for the **MMP / Explore Rate** at:

- **Hotel:** Sheraton Okinawa Sunmarina Resort
- **Marriott property code:** `OKASI`
- **Check-in:** July 25, 2026
- **Check-out:** July 26, 2026
- **Rate code:** `MMP`
- **Schedule:** Every 10 minutes during July 25, 2026 in Japan

The scheduled job checks only while the calendar date in Japan is **July 25, 2026**. When MMP availability first appears, the workflow creates a GitHub issue. Optional Discord and ntfy alerts are also supported.

## Required setup

Open **Settings → Secrets and variables → Actions** and add:

- `MARRIOTT_USERNAME`
- `MARRIOTT_PASSWORD`

Use only an account that is eligible to book the MMP rate. Marriott may require proof of eligibility at check-in.

## Run immediately

Open **Actions → Check Sheraton Okinawa MMP Rate → Run workflow**.

## Optional phone notifications

For ntfy, add:

- `NTFY_TOPIC` — use a private, hard-to-guess topic name
- `NTFY_SERVER` — optional; defaults to `https://ntfy.sh`

For Discord, add:

- `DISCORD_WEBHOOK_URL`

## How it works

The checker logs into Marriott with GitHub Secrets, searches the exact property and dates using corporate code `MMP`, scans the returned page for Explore-rate availability, stores its last result in `data/state.json`, and alerts only when availability first appears or the detected price decreases.

Screenshots from each run are available as GitHub Actions artifacts for three days.

## Important limitation

Marriott can change its site, require CAPTCHA, or block automated browsers. Review the screenshots if a run cannot log in or produces an unexpected result. Never commit your Marriott password or an Explore authorization form.
