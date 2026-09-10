# R TEX BD — Production-ready clothing store

A responsive women’s three-piece e-commerce site with Turso/libSQL, secure server-side admin authorization, product variants, stock-aware checkout, reviews, admin order management and a lightweight shopping assistant.

## Stack
- Node.js + Express 5
- EJS server-rendered UI + custom responsive CSS/JS
- Turso/libSQL via `@libsql/client`
- Cookie-based signed admin session
- Multer for validated image uploads
- Helmet, rate limiting, Zod validation

## Environment
Copy `.env.example` to `.env` and set:
- `TURSO_DATABASE_URL`
- `TURSO_AUTH_TOKEN`
- `SESSION_SECRET`
- `ADMIN_USERNAME`
- `ADMIN_PASSWORD`
- `PORT` (Render provides this automatically)
- `NODE_ENV=production`
- `GEMINI_API_KEY` is optional for a future AI layer; current assistant is deterministic and store-grounded.
- `UPLOAD_DIR` defaults to `./uploads`.

## Local setup
```bash
npm install
cp .env.example .env
npm start
```
The app automatically creates/updates the schema on startup.

## Render
Build command: `npm install`
Start command: `npm start`
Set all environment variables in Render. For persistent product image uploads, attach a Render persistent disk and set `UPLOAD_DIR` to the mounted path (for example `/var/data/uploads`). Without persistent disk, uploaded local files can be lost when Render replaces the service instance.

## Admin
Open `/admin/login`. Set your own `ADMIN_USERNAME` and `ADMIN_PASSWORD` in the server environment. There is no hard-coded production admin password.

## Important production notes
- WhatsApp header/contact number defaults to `01629380347` / `8801629380347` and is editable from Admin Settings.
- Product images are stored as files, while Turso stores their URLs. Do not use ephemeral Render storage for production uploads.
- The checkout currently records orders as unpaid and supports cash-on-delivery style ordering. A real payment gateway should only be enabled when provider credentials and merchant requirements are supplied.
- The review system uses moderation: customers submit reviews; admins approve/unpublish them. Approved reviews auto-scroll on the home page.
