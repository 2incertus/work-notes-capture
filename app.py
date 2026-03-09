"""Work Notes Capture — fast note intake PWA with async AI processing."""

import json
import logging
import os
import time
from pathlib import Path

import aiosqlite
import httpx
from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

log = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO)

app = FastAPI()

STATIC_DIR = Path(__file__).parent / "static"
DB_PATH = "/data/notes.db"
CHAINLIT_WEBHOOK_URL = os.getenv("CHAINLIT_WEBHOOK_URL", "http://chainlit:8000/api/work-notes/process")
VIKUNJA_URL = os.getenv("VIKUNJA_URL", "http://localhost:3456")
VIKUNJA_TOKEN = os.getenv("VIKUNJA_TOKEN", "")


async def _init_db():
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("""
            CREATE TABLE IF NOT EXISTS notes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                content TEXT NOT NULL,
                tags TEXT DEFAULT '[]',
                meeting TEXT,
                project TEXT,
                priority TEXT DEFAULT 'low',
                status TEXT DEFAULT 'pending',
                result TEXT,
                created_at REAL NOT NULL
            )
        """)
        await db.commit()


@app.on_event("startup")
async def startup():
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    await _init_db()


@app.get("/health")
async def health():
    return {"ok": True}


@app.post("/api/notes")
async def create_note(request: Request):
    body = await request.json()
    content = body.get("content", "").strip()
    if not content:
        return JSONResponse({"error": "content is required"}, status_code=400)

    tags = json.dumps(body.get("tags", []))
    meeting = body.get("meeting") or None
    project = body.get("project") or None
    priority = body.get("priority", "low")
    now = time.time()

    async with aiosqlite.connect(DB_PATH) as db:
        cursor = await db.execute(
            "INSERT INTO notes (content, tags, meeting, project, priority, created_at) VALUES (?, ?, ?, ?, ?, ?)",
            [content, tags, meeting, project, priority, now],
        )
        await db.commit()
        note_id = cursor.lastrowid

    # Fire async webhook to Chainlit for AI processing (don't wait)
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            await client.post(CHAINLIT_WEBHOOK_URL, json={
                "note_id": note_id,
                "content": content,
                "tags": body.get("tags", []),
                "meeting": meeting,
                "project": project,
                "priority": priority,
            })
    except Exception as e:
        log.warning(f"Webhook failed (will retry later): {e}")

    return JSONResponse({"ok": True, "id": note_id}, status_code=201)


@app.get("/api/notes")
async def list_notes(request: Request):
    limit = int(request.query_params.get("limit", "20"))
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        rows = await db.execute_fetchall(
            "SELECT * FROM notes ORDER BY created_at DESC LIMIT ?", [limit]
        )
    notes = []
    for r in rows:
        notes.append({
            "id": r["id"],
            "content": r["content"],
            "tags": json.loads(r["tags"]) if r["tags"] else [],
            "meeting": r["meeting"],
            "project": r["project"],
            "priority": r["priority"],
            "status": r["status"],
            "result": json.loads(r["result"]) if r["result"] else None,
            "created_at": r["created_at"],
        })
    return JSONResponse({"notes": notes})


@app.delete("/api/notes/{note_id}")
async def delete_note(note_id: int):
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("DELETE FROM notes WHERE id = ?", [note_id])
        await db.commit()
    return JSONResponse({"ok": True})


@app.put("/api/notes/{note_id}")
async def update_note(note_id: int, request: Request):
    body = await request.json()
    fields = []
    values = []
    for key in ("content", "meeting", "project", "priority"):
        if key in body:
            fields.append(f"{key} = ?")
            values.append(body[key] if body[key] else None)
    if "tags" in body:
        fields.append("tags = ?")
        values.append(json.dumps(body["tags"]))
    if not fields:
        return JSONResponse({"error": "nothing to update"}, status_code=400)
    values.append(note_id)
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(f"UPDATE notes SET {', '.join(fields)} WHERE id = ?", values)
        await db.commit()
    return JSONResponse({"ok": True})


@app.post("/api/notes/{note_id}/result")
async def update_result(note_id: int, request: Request):
    body = await request.json()
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            "UPDATE notes SET status = 'processed', result = ? WHERE id = ?",
            [json.dumps(body), note_id],
        )
        await db.commit()
    return JSONResponse({"ok": True})


@app.get("/api/brief")
async def get_brief():
    """Proxy to Chainlit brief endpoint."""
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(f"{CHAINLIT_WEBHOOK_URL.rsplit('/', 1)[0]}/brief")
            return JSONResponse(resp.json())
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=502)


@app.get("/api/tasks")
async def list_tasks(request: Request):
    """Proxy open tasks from Vikunja."""
    if not VIKUNJA_TOKEN:
        return JSONResponse({"error": "Vikunja not configured"}, status_code=503)
    try:
        headers = {"Authorization": f"Bearer {VIKUNJA_TOKEN}"}
        async with httpx.AsyncClient(timeout=10) as client:
            # Fetch tasks from all projects, open first
            tasks = []
            resp = await client.get(
                f"{VIKUNJA_URL}/api/v1/projects",
                headers=headers,
            )
            projects = {p["id"]: p["title"] for p in resp.json()}
            for pid, ptitle in projects.items():
                resp = await client.get(
                    f"{VIKUNJA_URL}/api/v1/projects/{pid}/tasks",
                    headers=headers,
                    params={"per_page": 50, "sort_by": "done", "order_by": "asc"},
                )
                for t in resp.json():
                    tasks.append({
                        "id": t["id"],
                        "title": t["title"],
                        "done": t["done"],
                        "due_date": t.get("due_date", ""),
                        "priority": t.get("priority", 0),
                        "project_id": pid,
                        "project": ptitle,
                        "labels": [l["title"] for l in (t.get("labels") or [])],
                        "created": t.get("created", ""),
                    })
            # Sort: open first, then by due date
            tasks.sort(key=lambda t: (t["done"], t["due_date"] or "9999"))
            return JSONResponse({"tasks": tasks})
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=502)


@app.post("/api/tasks/{task_id}/done")
async def toggle_task_done(task_id: int, request: Request):
    """Mark a Vikunja task as done or undone."""
    if not VIKUNJA_TOKEN:
        return JSONResponse({"error": "Vikunja not configured"}, status_code=503)
    body = await request.json()
    done = body.get("done", True)
    try:
        headers = {"Authorization": f"Bearer {VIKUNJA_TOKEN}", "Content-Type": "application/json"}
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(
                f"{VIKUNJA_URL}/api/v1/tasks/{task_id}",
                headers=headers,
                json={"done": done},
            )
            return JSONResponse(resp.json())
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=502)


@app.get("/")
async def index():
    return FileResponse(
        STATIC_DIR / "index.html",
        headers={"Cache-Control": "no-cache, must-revalidate"},
    )


app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
