# Kanban Board — Real-Time Multi-User Task Board

A production-quality Kanban board with real-time WebSocket sync, conflict resolution (CRDT-inspired), fractional indexing for O(1) reordering, and offline-queue support.

---

## Quick Start

```bash
# Clone and run (requires Docker + Docker Compose)
git clone <repo-url>
cd kanban-board
docker compose up --build
```

Open **http://localhost:5173** in two browser tabs to test multi-user sync.

---

## Architecture

| Layer | Technology |
|---|---|
| Backend | Node.js 20 + Express + TypeScript |
| WebSockets | `ws` library (raw, no Socket.IO) |
| Database | PostgreSQL 16 with ACID transactions |
| Frontend | React 18 + Vite + TypeScript |
| Drag & Drop | dnd-kit |
| State | Zustand (optimistic UI) |
| Ordering | Fractional indexing (O(1) amortized) |

---

## Development Setup (without Docker)

### Prerequisites
- Node.js 20+
- PostgreSQL 16

### Backend
```bash
cd backend
cp .env.example .env
# Edit .env with your DATABASE_URL
npm install
npm run migrate      # Run DB migrations
npm run dev          # Starts on :4000
```

### Frontend
```bash
cd frontend
cp .env.example .env
npm install
npm run dev          # Starts on :5173
```

---

## Environment Variables

### Backend `.env`
```
DATABASE_URL=postgres://kanban:kanban_secret@localhost:5432/kanban_db
PORT=4000
CLIENT_ORIGIN=http://localhost:5173
NODE_ENV=development
```

### Frontend `.env`
```
VITE_WS_URL=ws://localhost:4000
VITE_API_URL=http://localhost:4000
```

---

## Running Tests
```bash
cd backend
npm test            # Jest: integration + unit tests
```

---

## Deployment

**Live URL:** [https://kanban-app-yflm.onrender.com](https://kanban-app-yflm.onrender.com)

The app is deployed as a single service on Render with:
- **Backend + Frontend**: Render web service (Node.js serves the built React app)
- **Database**: Render managed PostgreSQL

### Cold Start
Free-tier containers may sleep after 15 min of inactivity. First request after cold start takes **~5–10 seconds**. The frontend shows a "Reconnecting…" indicator while the WebSocket re-establishes.

---

## Key Features

- **Real-time sync** — changes propagate to all clients within 200 ms (localhost)
- **Conflict resolution** — field-level merge; deterministic LWW on true conflicts
- **Fractional indexing** — O(1) amortized drag-and-drop reordering
- **Optimistic UI** — instant local updates, reconcile on server ack
- **Offline queue** — actions queue when disconnected, replay on reconnect
- **Presence indicators** — see who's viewing or editing each task
- **Error boundaries** — graceful degradation on component failures

See [DESIGN.md](./DESIGN.md) for the full technical design.
