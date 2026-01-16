# LoRA Search Console

Node.js app that embeds a question with the LoRA Nomic model, runs a Qdrant
similarity search, and asks GPT OSS to produce a grounded answer.

## Run
- Ensure `python` is on PATH and the LoRA model lives in `chat_project/models/epoch_11_75k_data`.
- Set `QDRANT_HOST` (and optional `QDRANT_API_KEY`, `QDRANT_PORT`, `QDRANT_HTTPS`).
- Optionally set `LoRA_Embedding_QDRANT_COLLECTION`.

Then start:
```
npm start
```

Open `http://localhost:5050`.

## Environment
You can override these:
- `GPT_OSS_CHAT_URL` (default `http://ollama.gravity.ind.in:11434/api/chat`)
- `GPT_OSS_MODEL` (default `gpt-oss:120b`)
- `GPT_OSS_SEED` (default `101`)
- `GPT_OSS_TEMPERATURE` (default `0.0`)
- `GPT_OSS_TIMEOUT` (ms)
- `PYTHON_BIN` (default `python`)
