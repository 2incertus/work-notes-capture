# Work Notes Capture

A fast, keyboard-driven PWA for capturing work notes with optional AI processing and task management integration.

Built for people who dump meeting notes, action items, and random thoughts into one place and want a system that actually does something with them.

![Work Notes Capture](https://img.shields.io/badge/stack-FastAPI%20%2B%20vanilla%20JS-e2a846)

## What it does

- **Capture notes** with meeting context, project tags, and priority levels
- **AI processing** (optional) -- send notes to any webhook for summarization, task extraction, and entity recognition
- **Task panel** -- view and complete tasks from Vikunja (optional)
- **Daily brief** -- AI-generated summary of your day's notes
- **Search and filter** -- by project, tag, content, or priority (`tag:blocker`, `project:foo`, `priority:high`)
- **Mini dashboard** -- activity chart, project breakdown, tag distribution (click to cycle)
- **Edit and delete** notes after capture
- **Keyboard shortcuts** -- Ctrl+Enter to capture, `/` to search, `n` for new note, `?` for help

## Design

"Warm Terminal + Arc" -- dark theme with amber/teal accents, JetBrains Mono headings, Inter body text. Per-project color coding. Feels like a terminal that went to design school.

## Quick Start

```bash
cp .env.example .env
# Edit .env with your webhook URL and/or Vikunja credentials
docker compose up -d
```

Open `http://localhost:8310`.

## Running without Docker

```bash
pip install -r requirements.txt
# Set env vars or create .env
uvicorn app:app --host 0.0.0.0 --port 8000
```

## Optional Integrations

Work Notes works standalone -- notes save to a local SQLite database with no external dependencies. The integrations below add superpowers:

### AI Processing Webhook

Set `CHAINLIT_WEBHOOK_URL` to any endpoint that accepts a POST with this JSON:

```json
{
  "note_id": 1,
  "content": "Meeting notes...",
  "tags": ["meeting", "action-item"],
  "meeting": "Sprint Planning",
  "project": "Backend",
  "priority": "medium"
}
```

The app will POST to your webhook on every note capture. Your webhook can later call back to `POST /api/notes/{note_id}/result` with processing results:

```json
{
  "summary": "Sprint planning discussed API migration timeline...",
  "tasks_created": 2,
  "knowledge_items": 1,
  "entities": ["Alice", "Bob", "Sprint 14"]
}
```

The summary and metadata appear on note cards in the UI.

### Vikunja (Task Management)

Set `VIKUNJA_URL` and `VIKUNJA_TOKEN` to see tasks from all your Vikunja projects in the sidebar. You can mark tasks complete directly from the UI. Clicking a task title searches for related notes.

### Daily Brief

The brief panel calls `POST {CHAINLIT_WEBHOOK_URL}/../brief` and displays the response. Expects:

```json
{
  "brief": {
    "summary": "...",
    "decisions": ["..."],
    "tomorrow_priorities": ["..."],
    "stalled": ["..."],
    "patterns": ["..."],
    "stats": { "notes_captured": 3, "tasks_created": 1, "knowledge_items": 2 }
  }
}
```

## API

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/notes?limit=50` | List notes (newest first) |
| POST | `/api/notes` | Create a note |
| PUT | `/api/notes/:id` | Update a note |
| DELETE | `/api/notes/:id` | Delete a note |
| POST | `/api/notes/:id/result` | Store AI processing result |
| GET | `/api/tasks` | List Vikunja tasks |
| POST | `/api/tasks/:id/done` | Toggle task completion |
| GET | `/api/brief` | Get daily brief |
| GET | `/health` | Health check |

## Tech Stack

- **Backend**: Python / FastAPI / aiosqlite
- **Frontend**: Vanilla JS, CSS custom properties, Canvas API
- **Storage**: SQLite (zero config)
- **Container**: Python 3.12 slim

## License

MIT
