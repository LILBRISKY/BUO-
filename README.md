# BUO marketplace

BUO is a Nigerian-focused e-commerce marketplace MVP built with React + Vite on the frontend and Express on the backend. It includes a live storefront, category browsing, product search, cart, wishlist, checkout, AI shopping assistant, and demo analytics.

## Stack

- Frontend: React + Vite + Tailwind
- Backend: Node.js + Express
- Data: seed catalog and API-backed mock data
- Auth: JWT-based demo auth with bcrypt hashing
- Payments: Paystack-ready, DEMO mode when credentials are unavailable

## Run locally

1. Copy `.env.example` to `.env` and fill in your values.
2. Install dependencies:
   `npm install`
3. Start development server:
   `npm run dev`
4. Open `http://localhost:5173`

## Production build

- `npm run build`
- `npm run start`

## Notes

- PostgreSQL schema files are in `server/db/schema.sql` and `server/db/seed.sql`.
- The app defaults to demo-safe behavior when external services are not configured.
- Payment, AI, and database integrations remain clearly marked as DEMO unless real credentials are added.
