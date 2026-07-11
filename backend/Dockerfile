FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app

# Shell form ("sh -c") so ${PORT} -- injected by Render, default 10000 --
# actually expands; 'exec' so the platform's SIGTERM reaches uvicorn directly.
# NEVER --workers > 1: the WebSocket connection registry (ws.py's
# ConnectionManager) is a process-local dict, and a second worker would
# silently break delivery.
CMD ["sh", "-c", "exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-10000} --workers 1"]
