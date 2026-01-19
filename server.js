const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");

const ROOT_DIR = path.resolve(__dirname, "..");
const STATIC_DIR = __dirname;
const EMBED_SCRIPT = path.join(__dirname, "embed_lora.py");
const TRAINED_ROOT = path.join(__dirname, "models");
const DEFAULT_LORA_MODEL = process.env.LORA_MODEL || "epoch_11_75k_data";

function loadDotenv(filePath) {
  if (!fs.existsSync(filePath)) {
    return;
  }
  const content = fs.readFileSync(filePath, "utf8");
  content.split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) {
      return;
    }
    const [key, ...rest] = trimmed.split("=");
    if (!key) {
      return;
    }
    const value = rest.join("=").trim().replace(/^['"]|['"]$/g, "");
    if (!process.env[key]) {
      process.env[key] = value;
    }
  });
}

loadDotenv(path.join(ROOT_DIR, ".env"));
loadDotenv(path.join(__dirname, ".env"));

const config = {
  qdrantHost: process.env.QDRANT_HOST || "",
  qdrantPort: Number(process.env.QDRANT_PORT || 6333),
  qdrantApiKey: process.env.QDRANT_API_KEY || "",
  qdrantHttps: String(process.env.QDRANT_HTTPS || "false").toLowerCase() === "true",
  qdrantCollection:
    process.env.LoRA_Embedding_QDRANT_COLLECTION ||
    "LoRA_epoch_11_75k_data_embeddings",
  searchModeDefault: String(process.env.SEARCH_MODE || "dense").toLowerCase(),
  hybridDenseName: process.env.QDRANT_DENSE_VECTOR_NAME || "dense",
  hybridSparseName: process.env.QDRANT_SPARSE_VECTOR_NAME || "bm25",
  hybridPrefetchLimit: Number(process.env.HYBRID_PREFETCH_LIMIT || 300),
  bm25AvgLen: Number(process.env.BM25_AVG_LEN || 52),
  bm25K: Number(process.env.BM25_K || 1.2),
  bm25B: Number(process.env.BM25_B || 0.75),
  bm25Language: process.env.BM25_LANGUAGE || "en",
  chatUrl: process.env.GPT_OSS_CHAT_URL || "http://ollama.gravity.ind.in:11434/api/chat",
  chatModel: process.env.GPT_OSS_MODEL || "gpt-oss:120b",
  chatSeed: Number(process.env.GPT_OSS_SEED || 101),
  chatTemperature: Number(process.env.GPT_OSS_TEMPERATURE || 0.0),
  chatTimeoutMs: Number(process.env.GPT_OSS_TIMEOUT || 300000),
  pythonBin: process.env.PYTHON_BIN || "python",
};

const NO_MATCH_RESPONSE = "No relevant action points found.";

function logLine(message) {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${message}`);
}

function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 5 * 1024 * 1024) {
        req.destroy();
        reject(new Error("Payload too large."));
      }
    });
    req.on("end", () => {
      if (!body) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch (err) {
        reject(new Error("Invalid JSON body."));
      }
    });
  });
}

function requestJson(urlString, method, payload, headers, timeoutMs) {
  const urlObj = new URL(urlString);
  const lib = urlObj.protocol === "https:" ? https : http;
  const data = payload ? JSON.stringify(payload) : null;

  const options = {
    method,
    hostname: urlObj.hostname,
    port: urlObj.port || (urlObj.protocol === "https:" ? 443 : 80),
    path: urlObj.pathname + urlObj.search,
    headers: {
      "Content-Type": "application/json",
      ...(headers || {}),
    },
  };
  if (data) {
    options.headers["Content-Length"] = Buffer.byteLength(data);
  }

  return new Promise((resolve, reject) => {
    const req = lib.request(options, (res) => {
      let body = "";
      res.on("data", (chunk) => {
        body += chunk;
      });
      res.on("end", () => {
        if (res.statusCode && res.statusCode >= 400) {
          reject(new Error(`HTTP ${res.statusCode}: ${body}`));
          return;
        }
        try {
          resolve(JSON.parse(body));
        } catch (err) {
          reject(new Error("Invalid JSON response."));
        }
      });
    });
    req.on("error", reject);
    req.setTimeout(timeoutMs || 300000, () => {
      req.destroy(new Error("Request timeout."));
    });
    if (data) {
      req.write(data);
    }
    req.end();
  });
}

function buildQdrantUrl(pathname) {
  const scheme = config.qdrantHttps ? "https" : "http";
  return `${scheme}://${config.qdrantHost}:${config.qdrantPort}${pathname}`;
}

function normalizeSearchMode(value) {
  const cleaned = String(value || "").trim().toLowerCase();
  if (cleaned === "dense+bm25" || cleaned === "bm25") {
    return "hybrid";
  }
  if (cleaned === "dense" || cleaned === "hybrid") {
    return cleaned;
  }
  const fallback = String(config.searchModeDefault || "dense").toLowerCase();
  return fallback === "hybrid" ? "hybrid" : "dense";
}

function normalizeQdrantResults(response) {
  if (!response) {
    return [];
  }
  const result = response.result;
  if (Array.isArray(result)) {
    return result;
  }
  if (result && Array.isArray(result.points)) {
    return result.points;
  }
  return [];
}

function listModelFolders() {
  if (!fs.existsSync(TRAINED_ROOT)) {
    return [];
  }
  return fs
    .readdirSync(TRAINED_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

function resolveModelName(modelName) {
  const models = listModelFolders();
  if (!models.length) {
    return DEFAULT_LORA_MODEL;
  }
  if (!modelName) {
    return models.includes(DEFAULT_LORA_MODEL) ? DEFAULT_LORA_MODEL : models[0];
  }
  if (!models.includes(modelName)) {
    throw new Error("Unknown model name.");
  }
  return modelName;
}

function embedQuestion(question, modelName) {
  return new Promise((resolve, reject) => {
    execFile(
      config.pythonBin,
      [EMBED_SCRIPT, "--text", question, "--model", modelName],
      { maxBuffer: 10 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) {
          reject(new Error(stderr || err.message));
          return;
        }
        try {
          const payload = JSON.parse(stdout.trim());
          if (!payload.embedding) {
            reject(new Error("Missing embedding in response."));
            return;
          }
          resolve(payload.embedding);
        } catch (parseErr) {
          reject(new Error("Failed to parse embedding output."));
        }
      }
    );
  });
}

function buildChatMessages(question, matches) {
  const systemPrompt =
    "You answer questions using only the provided action points. " +
    "If the action points are missing or do not answer the question, " +
    `respond with exactly: "${NO_MATCH_RESPONSE}".`;
  const lines = matches.length
    ? matches.map((match) => `${match.action_point}`)
    : ["None."];
  const userPrompt = `Question: ${question}\n\nAction points:\n${lines.join("\n")}`;
  return [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt },
  ];
}

function mapMatches(results, threshold) {
  return results
    .map((item) => {
      const payload = item.payload || {};
      return {
        score: Number(item.score || 0),
        action_id: payload.action_id || null,
        action_point: String(payload.action_point || "").trim(),
      };
    })
    .filter((item) => {
      if (!item.action_point) {
        return false;
      }
      if (threshold === null) {
        return true;
      }
      return item.score >= threshold;
    });
}

async function askQdrantDense(question, topK, threshold, collection, modelName) {
  if (!config.qdrantHost) throw new Error("Missing QDRANT_HOST.");

  const vector = await embedQuestion(question, modelName);
  const targetCollection = collection || config.qdrantCollection;
  const url = buildQdrantUrl(`/collections/${targetCollection}/points/query`);

  const payload = {
    query: vector,
    using: config.hybridDenseName,               // named dense vector
    limit: topK,
    with_payload: ["action_point", "action_id"],
    with_vector: false,
    score_threshold: threshold ?? undefined,     // Qdrant applies it correctly for cosine :contentReference[oaicite:7]{index=7}
  };

  const headers = config.qdrantApiKey ? { "api-key": config.qdrantApiKey } : {};
  const response = await requestJson(url, "POST", payload, headers, 300000);

  const results = normalizeQdrantResults(response);
  return mapMatches(results, null); // already thresholded by Qdrant via score_threshold
}


async function askQdrantHybrid(question, topK, collection, modelName) {
  if (!config.qdrantHost) throw new Error("Missing QDRANT_HOST.");

  const vector = await embedQuestion(question, modelName);
  const targetCollection = collection || config.qdrantCollection;
  const url = buildQdrantUrl(`/collections/${targetCollection}/points/query`);

  const prefetchLimit = Math.max(topK, config.hybridPrefetchLimit || topK);

  const bm25Query = {
    text: question,
    model: "qdrant/bm25",
    options: {
      avg_len: config.bm25AvgLen,
      k: config.bm25K,
      b: config.bm25B,
      // keep language only if you are sure your Qdrant version supports it
      language: config.bm25Language,
    },
  };

  const payload = {
    prefetch: [
      { query: bm25Query, using: config.hybridSparseName, limit: prefetchLimit },
      { query: vector, using: config.hybridDenseName, limit: prefetchLimit },
    ],
    query: { fusion: "rrf" },
    limit: topK,
    with_payload: ["action_point", "action_id"],
    with_vector: false,
  };

  const headers = config.qdrantApiKey ? { "api-key": config.qdrantApiKey } : {};
  const response = await requestJson(url, "POST", payload, headers, 300000);

  const results = normalizeQdrantResults(response);
  // NOTE: hybrid fused score is not cosine; threshold filtering may be misleading
  return mapMatches(results, null);
}


async function askQdrant(question, topK, threshold, collection, modelName, searchMode) {
  const mode = normalizeSearchMode(searchMode);
  if (mode === "hybrid") {
    return askQdrantHybrid(question, topK, collection, modelName);
  }
  return askQdrantDense(question, topK, threshold, collection, modelName);
}

async function askChat(question, matches) {
  const messages = buildChatMessages(question, matches);
  const payload = {
    model: config.chatModel,
    messages,
    stream: false,
    options: { seed: config.chatSeed, temperature: config.chatTemperature },
  };
  const response = await requestJson(
    config.chatUrl,
    "POST",
    payload,
    null,
    config.chatTimeoutMs
  );
  const message = response.message || {};
  return String(message.content || "").trim();
}

async function reframeQuestion(question, incorrect, missing) {
  const systemPrompt =
    "You rewrite user questions for semantic retrieval. " +
    "Return only the rewritten question and nothing else.";
  const incorrectText = incorrect ? incorrect.trim() : "";
  const missingText = missing ? missing.trim() : "";
  const userPrompt = [
    `Original question: ${question}`,
    `What is incorrect: ${incorrectText || "None."}`,
    `What is missing: ${missingText || "None."}`,
    "Rewrite:",
  ].join("\n");
  const payload = {
    model: config.chatModel,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    stream: false,
    options: { seed: config.chatSeed, temperature: 0.0 },
  };
  const response = await requestJson(
    config.chatUrl,
    "POST",
    payload,
    null,
    config.chatTimeoutMs
  );
  const message = response.message || {};
  const content = String(message.content || "").trim();
  return content || question;
}

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

function serveStatic(req, res) {
  const fileMap = {
    "/": "index.html",
    "/index.html": "index.html",
    "/styles.css": "styles.css",
    "/app.js": "app.js",
  };
  const pathname = new URL(req.url, "http://localhost").pathname;
  const fileName = fileMap[pathname];
  if (!fileName) {
    res.writeHead(404);
    res.end("Not found");
    return;
  }
  const filePath = path.join(STATIC_DIR, fileName);
  if (!fs.existsSync(filePath)) {
    res.writeHead(404);
    res.end("Not found");
    return;
  }
  const ext = path.extname(fileName);
  const contentType =
    ext === ".css"
      ? "text/css"
      : ext === ".js"
        ? "application/javascript"
        : "text/html";
  const data = fs.readFileSync(filePath);
  res.writeHead(200, { "Content-Type": contentType });
  res.end(data);
}

const server = http.createServer(async (req, res) => {
  if (req.method === "GET" && req.url.startsWith("/api/models")) {
    const models = listModelFolders();
    sendJson(res, 200, {
      models,
      default_model: DEFAULT_LORA_MODEL,
    });
    logLine(`GET /api/models -> ${models.length} models`);
    return;
  }

  if (req.method === "GET" && req.url.startsWith("/api/collections")) {
    try {
      if (!config.qdrantHost) {
        throw new Error("Missing QDRANT_HOST.");
      }
      const url = buildQdrantUrl("/collections");
      const headers = config.qdrantApiKey ? { "api-key": config.qdrantApiKey } : {};
      const response = await requestJson(url, "GET", null, headers, 300000);
      const collections =
        response && response.result && Array.isArray(response.result.collections)
          ? response.result.collections.map((item) => item.name)
          : [];
      sendJson(res, 200, {
        collections,
        default_collection: config.qdrantCollection,
      });
      logLine(`GET /api/collections -> ${collections.length} collections`);
    } catch (err) {
      sendJson(res, 500, { error: err.message || "Failed to fetch collections." });
      logLine(`GET /api/collections error: ${err.message}`);
    }
    return;
  }

  if (req.method === "GET") {
    serveStatic(req, res);
    return;
  }

  if (req.method === "POST" && req.url.startsWith("/api/ask")) {
    try {
      const payload = await parseJsonBody(req);
      const question = String(payload.question || "").trim();
      if (!question) {
        sendJson(res, 400, { error: "Question is required." });
        return;
      }
      const requestedModel = payload.model ? String(payload.model).trim() : "";
      const requestedCollection = payload.collection
        ? String(payload.collection).trim()
        : "";
      const requestedSearchMode = payload.search_mode || payload.searchMode || "";
      const modelName = resolveModelName(requestedModel);
      const collectionName = requestedCollection || config.qdrantCollection;
      const topK = Math.max(1, Number(payload.topK || 300));
      const threshold = Math.max(0, Math.min(1, Number(payload.threshold || 0.2)));
      const searchMode = normalizeSearchMode(requestedSearchMode);
      const start = Date.now();
      logLine(
        `POST /api/ask mode=${searchMode} model=${modelName} collection=${collectionName} topK=${topK} threshold=${threshold.toFixed(
          2
        )}`
      );
      const matches = await askQdrant(
        question,
        topK,
        threshold,
        collectionName,
        modelName,
        searchMode
      );
      const retrievalMs = Date.now() - start;
      const answer = await askChat(question, matches);
      const totalMs = Date.now() - start;
      sendJson(res, 200, {
        question,
        topK,
        threshold,
        model: modelName,
        collection: collectionName,
        search_mode: searchMode,
        matches,
        answer,
        answer_model: config.chatModel,
        durations: {
          retrieval_ms: retrievalMs,
          total_ms: totalMs,
        },
      });
      logLine(
        `POST /api/ask done matches=${matches.length} total_ms=${totalMs}`
      );
    } catch (err) {
      sendJson(res, 500, { error: err.message || "Server error." });
      logLine(`POST /api/ask error: ${err.message}`);
    }
    return;
  }

  if (req.method === "POST" && req.url.startsWith("/api/reframe")) {
    try {
      const payload = await parseJsonBody(req);
      const question = String(payload.question || "").trim();
      const feedbackIncorrect = String(payload.feedback_incorrect || "").trim();
      const feedbackMissing = String(payload.feedback_missing || "").trim();
      const legacyFeedback = String(payload.feedback || "").trim();
      if (!question) {
        sendJson(res, 400, { error: "Question is required." });
        return;
      }
      if (!feedbackIncorrect && !feedbackMissing && !legacyFeedback) {
        sendJson(res, 400, { error: "Feedback is required." });
        return;
      }
      const requestedModel = payload.model ? String(payload.model).trim() : "";
      const requestedCollection = payload.collection
        ? String(payload.collection).trim()
        : "";
      const requestedSearchMode = payload.search_mode || payload.searchMode || "";
      const modelName = resolveModelName(requestedModel);
      const collectionName = requestedCollection || config.qdrantCollection;
      const topK = Math.max(1, Number(payload.topK || 300));
      const threshold = Math.max(0, Math.min(1, Number(payload.threshold || 0.2)));
      const searchMode = normalizeSearchMode(requestedSearchMode);
      const start = Date.now();
      logLine(
        `POST /api/reframe mode=${searchMode} model=${modelName} collection=${collectionName} topK=${topK} threshold=${threshold.toFixed(
          2
        )} incorrect=${feedbackIncorrect ? "yes" : "no"} missing=${feedbackMissing ? "yes" : "no"}`
      );
      let incorrect = feedbackIncorrect;
      let missing = feedbackMissing;
      if ((!incorrect && !missing) && legacyFeedback) {
        missing = legacyFeedback;
      }
      const reframedQuestion = await reframeQuestion(question, incorrect, missing);
      const reframeMs = Date.now() - start;
      const retrievalStart = Date.now();
      const matches = await askQdrant(
        reframedQuestion,
        topK,
        threshold,
        collectionName,
        modelName,
        searchMode
      );
      const retrievalMs = Date.now() - retrievalStart;
      const answer = await askChat(question, matches);
      const totalMs = Date.now() - start;
      sendJson(res, 200, {
        question,
        reframed_question: reframedQuestion,
        topK,
        threshold,
        model: modelName,
        collection: collectionName,
        search_mode: searchMode,
        matches,
        answer,
        answer_model: config.chatModel,
        durations: {
          reframe_ms: reframeMs,
          retrieval_ms: retrievalMs,
          total_ms: totalMs,
        },
      });
      logLine(
        `POST /api/reframe done matches=${matches.length} total_ms=${totalMs}`
      );
    } catch (err) {
      sendJson(res, 500, { error: err.message || "Server error." });
      logLine(`POST /api/reframe error: ${err.message}`);
    }
    return;
  }

  res.writeHead(404);
  res.end("Not found");
});

const PORT = Number(process.env.PORT || 5050);
server.listen(PORT, () => {
  logLine(`Server listening on http://localhost:${PORT}`);
});
