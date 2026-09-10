# Trend Wear v5

Production-ready fashion commerce website with a secure Admin Panel and Turso/libSQL database.

## Required Render environment variables

- `NODE_ENV=production`
- `TURSO_DATABASE_URL` — your real `libsql://...turso.io` URL
- `TURSO_AUTH_TOKEN` — your Turso auth token
- `ADMIN_EMAIL` — admin login email
- `ADMIN_PASSWORD` — minimum 12 characters
- `SITE_URL` — deployed website URL

Turso is mandatory. The server verifies the connection with `SELECT 1` before initializing the schema. A missing or invalid Turso configuration now fails startup instead of silently creating/using a local database.

## Media uploads

The Admin Panel accepts JPG/PNG/WebP uploads up to 2 MB and stores them in the `media` table in Turso. The returned `/api/media/:id` URL can be used for the logo, landing images, category images, product images/gallery and customer review images.

## Features added in v5

- Admin sidebar menu with mobile toggle.
- Demo fashion products seeded into an empty database.
- Product cards include View details, Add to cart and Order now.
- Product details page includes gallery, variants, Add to cart and Order now.
- Customer Reviews system with rating, text and optional screenshot/photo upload.
- Reviews display inside phone-style cards with automatic horizontal scrolling; hover pauses the scroll.
- Review management is available from the Admin Panel.
- Product/category/landing/service/review image upload can be done directly from Admin Panel.
- Existing good store/order/payment/admin features are preserved.

## Run

`npm install`
`npm start`
