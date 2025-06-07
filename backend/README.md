# Backend

FastAPI backend that exposes `/api/containers` listing docker containers.

Run locally:

```bash
pip install -r requirements.txt
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

