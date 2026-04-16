# Laundry Management System

A full-stack laundry order management app with a React frontend, Clerk authentication, and a Node.js + MongoDB backend.

## Setup Instructions

### 1. Prerequisites

- Node.js 18+
- npm
- MongoDB Atlas cluster or local MongoDB instance
- Clerk account (for authentication)

### 2. Install Dependencies

```bash
npm install
```

### 3. Configure Environment Variables

Create or update .env.local in the project root:

```bash
VITE_CLERK_PUBLISHABLE_KEY=your_clerk_publishable_key
MONGODB_URI=your_mongodb_connection_string
```

Example MongoDB Atlas URI:

```bash
MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/laundry-management?retryWrites=true&w=majority
```

### 4. Run the Project

```bash
npm start
```

This command:

- Builds the React app with Vite
- Starts the Node.js server
- Serves the app at http://127.0.0.1:3000

### 5. Useful Scripts

- npm start: Build + run production server
- npm run server: Run backend server only
- npm run client:dev: Run Vite frontend dev server
- npm run build: Build frontend to dist
- npm run preview: Preview Vite build

## Features Implemented

- Clerk authentication UI:
- Sign in and sign up flows
- Signed-in and signed-out conditional rendering
- User account menu via Clerk UserButton
- Order management:
- Create new orders with multiple garment line items
- Automatic total bill calculation
- Unique order ID generation
- Status update flow across RECEIVED, PROCESSING, READY, DELIVERED
- Order filtering by status and search by customer or phone
- Delivered orders separated into a dedicated list view
- Dashboard:
- Total orders count
- Total revenue
- Orders per status
- MongoDB persistence:
- Orders stored in MongoDB orders collection
- Server-side indexes for created_at and status
- Graceful MongoDB connection shutdown
- Per-user data isolation:
- Orders are tagged by user_id
- API requires user_id for order and dashboard reads
- Each account sees only its own order data

## AI Usage Report

### Tools Used

- GitHub Copilot for iterative coding, refactoring, and bug fixes
- ChatGPT for brainstorming API shape, edge cases, and documentation structure
- aura.build for frontend structuring

### Sample Prompts

- Build a laundry order management app with React frontend and Node backend.
- Add Clerk authentication with signed-in and signed-out UI states.
- Move order storage from in-memory to MongoDB.
- Fix data leakage so each Clerk user only sees their own orders.
- Improve README with setup, features, AI report, and tradeoffs.

### What AI Got Wrong

- Early drafts mixed in-memory and database assumptions, which caused inconsistent behavior.
- Initial auth/data coupling relied too much on client flow and did not fully enforce user scoping.
- Some generated snippets did not fully account for stale state behavior when switching users.

### What Was Improved

- Enforced user-specific data access in backend endpoints.
- Added user_id scoping in frontend fetch/create/update paths.
- Hardened API behavior by requiring user_id for relevant endpoints.
- Reworked docs to match the real implementation instead of outdated in-memory notes.

## Tradeoffs

### What Was Skipped

- Full backend token verification against Clerk JWTs on every request.
- Comprehensive automated test suite (unit + integration + e2e).
- Admin roles and cross-user order management capabilities.
- Rate limiting and production-grade request auditing.

### What I Would Improve With More Time

- Verify Clerk session/JWT server-side and derive user_id from token instead of request body/query.
- Add migration and cleanup scripts for legacy records without user_id.
- Add automated tests for auth boundaries, order lifecycle, and dashboard aggregation.
- Add pagination and indexing strategy improvements for large datasets.
- Add CI pipeline checks for linting, tests, and build.

## API Summary

- POST /orders
- GET /orders
- GET /orders/{order_id}
- PATCH /orders/{order_id}/status
- GET /dashboard
- GET /health

Note: user_id is required for order and dashboard data endpoints in the current implementation.
