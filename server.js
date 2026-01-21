const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execFile } = require("child_process");

const ROOT_DIR = path.resolve(__dirname, "..");
const STATIC_DIR = __dirname;
const EMBED_SCRIPT = path.join(__dirname, "embed_lora.py");
const TRAINED_ROOT = path.join(__dirname, "models");
const DEFAULT_LORA_MODEL = process.env.LORA_MODEL || "epoch_11_75k_data";
const HISTORY_PATH =
  process.env.CHAT_HISTORY_PATH || path.join(__dirname, "history.jsonl");
const HISTORY_LIMIT_DEFAULT = Number(process.env.CHAT_HISTORY_LIMIT || 200);

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

function parseModelList(raw, fallback) {
  const list = String(raw || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  if (!list.length && fallback) {
    return [fallback];
  }
  const unique = Array.from(new Set(list));
  return unique.length ? unique : fallback ? [fallback] : [];
}

const PROVIDERS_PATH =
  process.env.CHAT_PROVIDERS_PATH || path.join(__dirname, "chat_providers.json");

const DEFAULT_PROVIDER_CONFIG = {
  default_provider: "gpt_oss",
  providers: [
    {
      id: "gpt_oss",
      label: "GPT OSS (Ollama)",
      type: "ollama",
      url_env: "GPT_OSS_CHAT_URL",
      models_env: "GPT_OSS_MODELS",
      default_model_env: "GPT_OSS_MODEL",
    },
  ],
};

function envValue(key) {
  return String(process.env[key] || "").trim();
}

function loadProviderConfig() {
  if (!fs.existsSync(PROVIDERS_PATH)) {
    return DEFAULT_PROVIDER_CONFIG;
  }
  try {
    const raw = fs.readFileSync(PROVIDERS_PATH, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.providers)) {
      return DEFAULT_PROVIDER_CONFIG;
    }
    return parsed;
  } catch (err) {
    logLine(`Failed to load chat providers config: ${err.message || err}`);
    return DEFAULT_PROVIDER_CONFIG;
  }
}

const providerConfig = loadProviderConfig();

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
  chatModels: parseModelList(
    process.env.GPT_OSS_MODELS,
    process.env.GPT_OSS_MODEL || "gpt-oss:120b"
  ),
  chatSeed: Number(process.env.GPT_OSS_SEED || 101),
  chatTemperature: Number(process.env.GPT_OSS_TEMPERATURE || 0.0),
  chatTimeoutMs: Number(process.env.GPT_OSS_TIMEOUT || 300000),
  pythonBin: process.env.PYTHON_BIN || "python",
};

const NO_MATCH_RESPONSE = "No relevant action points found.";
const MATCH_PAYLOAD_FIELDS = ["action_point", "action_id", "circular_name"];
const ANALYSIS_BATCH_SIZE = 50;
const ANALYSIS_GROUP_SIZE = 100;

function logLine(message) {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${message}`);
}

function ensureDirectory(filePath) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function createRequestId() {
  if (crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function buildHistoryConfig(
  searchMode,
  modelName,
  collectionName,
  topK,
  threshold,
  chatModel,
  chatProvider
) {
  return {
    search: {
      mode: searchMode,
      top_k: topK,
      threshold,
      collection: collectionName,
    },
    qdrant: {
      host: config.qdrantHost,
      port: config.qdrantPort,
      https: config.qdrantHttps,
      dense_vector_name: config.hybridDenseName,
      sparse_vector_name: config.hybridSparseName,
      prefetch_limit: config.hybridPrefetchLimit,
      bm25_avg_len: config.bm25AvgLen,
      bm25_k: config.bm25K,
      bm25_b: config.bm25B,
      bm25_language: config.bm25Language,
      api_key_present: Boolean(config.qdrantApiKey),
    },
    embedding: {
      lora_model: modelName,
      script: path.basename(EMBED_SCRIPT),
    },
    llm: {
      provider: chatProvider ? chatProvider.id : "",
      model: chatModel,
      url: chatProvider ? chatProvider.url : config.chatUrl,
      seed: chatProvider ? chatProvider.seed : config.chatSeed,
      temperature: chatProvider ? chatProvider.temperature : config.chatTemperature,
    },
  };
}

function appendHistoryRecord(record) {
  try {
    ensureDirectory(HISTORY_PATH);
    fs.appendFileSync(HISTORY_PATH, `${JSON.stringify(record)}\n`, "utf8");
  } catch (err) {
    logLine(`History write error: ${err.message || err}`);
  }
}

function readHistory(limit) {
  if (!fs.existsSync(HISTORY_PATH)) {
    return { items: [], total: 0 };
  }
  const content = fs.readFileSync(HISTORY_PATH, "utf8");
  const lines = content.split(/\r?\n/).filter((line) => line.trim().length > 0);
  const total = lines.length;
  const sliceFrom = Math.max(0, total - limit);
  const items = [];
  for (const line of lines.slice(sliceFrom)) {
    try {
      items.push(JSON.parse(line));
    } catch (err) {
      continue;
    }
  }
  items.reverse();
  return { items, total };
}

function findHistoryRecord(recordId) {
  if (!recordId) {
    return null;
  }
  if (!fs.existsSync(HISTORY_PATH)) {
    return null;
  }
  const content = fs.readFileSync(HISTORY_PATH, "utf8");
  const lines = content.split(/\r?\n/).filter((line) => line.trim().length > 0);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i];
    try {
      const record = JSON.parse(line);
      const ids = [record.record_id, record.id, record.request_id]
        .filter(Boolean)
        .map((value) => String(value));
      if (ids.includes(String(recordId))) {
        return record;
      }
    } catch (err) {
      continue;
    }
  }
  return null;
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

function resolveProviderNumber(provider, key, fallback) {
  const envKey = provider[`${key}_env`];
  const envRaw = envKey ? envValue(envKey) : "";
  const directValue = provider[key];
  const raw = envRaw || (directValue !== undefined ? String(directValue) : "");
  if (!raw) {
    return fallback;
  }
  const numeric = Number(raw);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function substituteEnvValues(text) {
  return String(text || "").replace(/\$\{([A-Z0-9_]+)\}/g, (_, key) => envValue(key));
}

function buildProviderMeta(definition) {
  const url =
    definition.url ||
    (definition.base_url && definition.path
      ? `${definition.base_url}${definition.path}`
      : "") ||
    (definition.url_env ? envValue(definition.url_env) : "");
  const models =
    definition.models ||
    parseModelList(
      definition.models_env ? envValue(definition.models_env) : "",
      definition.default_model_env ? envValue(definition.default_model_env) : ""
    );
  const defaultModel =
    definition.default_model ||
    (definition.default_model_env ? envValue(definition.default_model_env) : "") ||
    models[0] ||
    "";
  const headers = {};
  if (definition.headers) {
    Object.entries(definition.headers).forEach(([key, value]) => {
      const resolved = substituteEnvValues(value);
      if (resolved) {
        headers[key] = resolved;
      }
    });
  }
  const apiKeyEnv = definition.api_key_env;
  const apiKey = apiKeyEnv ? envValue(apiKeyEnv) : "";
  if (definition.type === "openai" && apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }
  return {
    id: definition.id,
    label: definition.label || definition.id,
    type: definition.type || "ollama",
    url,
    headers,
    models,
    default_model: defaultModel,
    response_path: definition.response_path || definition.responsePath || "",
    request_template: definition.request_template || definition.requestTemplate || null,
    temperature: resolveProviderNumber(definition, "temperature", config.chatTemperature),
    seed: resolveProviderNumber(definition, "seed", config.chatSeed),
    timeout_ms: resolveProviderNumber(definition, "timeout_ms", config.chatTimeoutMs),
    enabled: Boolean(url) && models.length > 0,
  };
}

function listChatProviders() {
  if (!providerConfig || !Array.isArray(providerConfig.providers)) {
    return [];
  }
  return providerConfig.providers.map(buildProviderMeta);
}

function getChatProviderMeta(requestedId) {
  const providers = listChatProviders();
  if (!providers.length) {
    throw new Error("No chat providers configured.");
  }
  const fallbackId =
    providerConfig.default_provider || providers[0].id || providers[0].label;
  const cleaned = String(requestedId || "").trim();
  const targetId = cleaned || fallbackId;
  const provider = providers.find((item) => item.id === targetId);
  if (!provider) {
    throw new Error("Unknown chat provider.");
  }
  return provider;
}

function resolveChatProvider(requestedId) {
  const provider = getChatProviderMeta(requestedId);
  if (!provider.enabled) {
    throw new Error("Chat provider is not configured.");
  }
  return provider;
}

function resolveChatModel(provider, modelName) {
  const cleaned = String(modelName || "").trim();
  const available = provider.models || [];
  if (!available.length) {
    return cleaned || provider.default_model;
  }
  if (!cleaned) {
    return available.includes(provider.default_model)
      ? provider.default_model
      : available[0];
  }
  if (!available.includes(cleaned)) {
    throw new Error("Unknown chat model.");
  }
  return cleaned;
}

function applyTemplate(value, context) {
  if (Array.isArray(value)) {
    return value.map((item) => applyTemplate(item, context));
  }
  if (value && typeof value === "object") {
    const out = {};
    Object.entries(value).forEach(([key, val]) => {
      out[key] = applyTemplate(val, context);
    });
    return out;
  }
  if (typeof value !== "string") {
    return value;
  }
  if (value === "{{messages}}") {
    return context.messages;
  }
  return value.replace(/\{\{(model|temperature|seed)\}\}/g, (_, key) => {
    const replacement = context[key];
    return replacement === undefined || replacement === null ? "" : String(replacement);
  });
}

function getPathValue(payload, path) {
  if (!path) {
    return null;
  }
  const normalized = path.replace(/\[(\d+)\]/g, ".$1");
  const parts = normalized.split(".").filter(Boolean);
  let current = payload;
  for (const part of parts) {
    if (current && typeof current === "object" && part in current) {
      current = current[part];
    } else {
      return null;
    }
  }
  return current;
}

function buildChatRequest(provider, model, messages, overrides = {}) {
  const temperature =
    overrides.temperature !== undefined ? overrides.temperature : provider.temperature;
  const seed = overrides.seed !== undefined ? overrides.seed : provider.seed;
  const base = {
    model,
    messages,
    temperature,
    seed,
  };
  let payload = null;
  if (provider.type === "openai") {
    payload = {
      model,
      messages,
      temperature,
      stream: false,
    };
    if (Number.isFinite(seed)) {
      payload.seed = seed;
    }
  } else if (provider.type === "custom" && provider.request_template) {
    payload = applyTemplate(provider.request_template, base);
  } else {
    payload = {
      model,
      messages,
      stream: false,
      options: {
        seed,
        temperature,
      },
    };
  }
  return {
    url: provider.url,
    headers: provider.headers || {},
    payload,
    timeout_ms: provider.timeout_ms,
  };
}

function parseChatResponse(provider, response) {
  if (provider.type === "openai") {
    return String(
      response?.choices?.[0]?.message?.content || response?.choices?.[0]?.text || ""
    ).trim();
  }
  if (provider.type === "custom" && provider.response_path) {
    const value = getPathValue(response, provider.response_path);
    if (value === null || value === undefined) {
      return "";
    }
    return typeof value === "string" ? value.trim() : JSON.stringify(value);
  }
  return String(response?.message?.content || "").trim();
}

async function requestChat(provider, model, messages, overrides) {
  const request = buildChatRequest(provider, model, messages, overrides);
  const response = await requestJson(
    request.url,
    "POST",
    request.payload,
    request.headers,
    request.timeout_ms
  );
  return parseChatResponse(provider, response);
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
    `respond with exactly: "${NO_MATCH_RESPONSE}". ` +
    "If circular references are provided, include a short References section listing " +
    "the circular names you used. Do not mention action ids, indices, or similarity scores.";
  const lines = matches.length
    ? matches.map((match) => {
        if (match.circular_name) {
          return `${match.action_point}\nCircular: ${match.circular_name}`;
        }
        return `${match.action_point}`;
      })
    : ["None."];
  const userPrompt = `Question: ${question}\n\nAction points:\n${lines.join("\n")}`;
  return [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt },
  ];
}

function buildAnalysisMessages(question, matches) {
  const systemPrompt =
    "You identify which action points are relevant to the question. " +
    "Return ONLY valid JSON with a single key 'relevant_indices' containing an array " +
    "of 1-based indices for relevant items. Use the same numbering shown in the list.";
  const lines = matches.map((match, index) => {
    const suffix = match.circular_name ? ` (Circular: ${match.circular_name})` : "";
    return `${index + 1}. ${match.action_point}${suffix}`;
  });
  const userPrompt = [
    `Question: ${question}`,
    "",
    "Action points:",
    ...lines,
    "",
    "Return JSON: {\"relevant_indices\": [1, 5, 9]}",
  ].join("\n");
  return [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt },
  ];
}

function chunkArray(items, size) {
  if (!items || size <= 0) {
    return [];
  }
  const chunks = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

function extractJsonObject(text) {
  if (!text) {
    return "";
  }
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenceMatch) {
    return fenceMatch[1].trim();
  }
  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return text.slice(firstBrace, lastBrace + 1).trim();
  }
  return text.trim();
}

function parseRelevantIndices(raw, expectedCount) {
  const extracted = extractJsonObject(raw);
  let payload = null;
  try {
    payload = JSON.parse(extracted);
  } catch (err) {
    throw new Error("LLM response is not valid JSON.");
  }
  const rawIndices =
    (payload && payload.relevant_indices) ||
    (payload && payload.relevantIndexes) ||
    (payload && payload.relevant) ||
    (payload && payload.indices) ||
    payload;
  if (!Array.isArray(rawIndices)) {
    throw new Error("LLM response does not contain a relevant_indices array.");
  }
  const numeric = rawIndices
    .map((entry) => {
      if (typeof entry === "number") {
        return entry;
      }
      const parsed = Number(String(entry).trim());
      return Number.isFinite(parsed) ? parsed : null;
    })
    .filter((value) => Number.isFinite(value));

  const hasZero = numeric.some((value) => value === 0);
  const indices = hasZero ? numeric.map((value) => value + 1) : numeric;

  const valid = new Set();
  indices.forEach((value) => {
    const rounded = Math.round(value);
    if (rounded >= 1 && rounded <= expectedCount) {
      valid.add(rounded);
    }
  });
  return valid;
}

function extractCircularName(payload) {
  const raw =
    payload.circular_name ||
    payload.circular_title ||
    payload.circular_reference ||
    payload.circular_ref ||
    payload.circular ||
    "";
  const text = String(raw || "").trim();
  return text || null;
}

function buildAnalysisFilePath(recordId) {
  const safeId = String(recordId || "analysis")
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .slice(0, 64);
  return path.join(__dirname, "analysis", `analysis_${safeId}.jsonl`);
}

function cleanupAnalysisArtifacts(recordId, keepPath) {
  const safeId = String(recordId || "analysis")
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .slice(0, 64);
  const dir = path.join(__dirname, "analysis");
  if (!fs.existsSync(dir)) {
    return;
  }
  const prefix = `analysis_${safeId}_`;
  const files = fs.readdirSync(dir);
  files.forEach((file) => {
    if (!file.startsWith(prefix)) {
      return;
    }
    const fullPath = path.join(dir, file);
    if (keepPath && path.resolve(fullPath) === path.resolve(keepPath)) {
      return;
    }
    try {
      fs.unlinkSync(fullPath);
    } catch (err) {
      logLine(`Failed to remove old analysis file ${file}: ${err.message || err}`);
    }
  });
}

function initAnalysisFile(filePath) {
  ensureDirectory(filePath);
  fs.writeFileSync(filePath, "", "utf8");
}

function writeAnalysisLine(filePath, payload) {
  ensureDirectory(filePath);
  fs.appendFileSync(filePath, `${JSON.stringify(payload)}\n`, "utf8");
}

function readAnalysisSummary(filePath) {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  const content = fs.readFileSync(filePath, "utf8");
  const lines = content.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (!lines.length) {
    return null;
  }
  let meta = null;
  let summary = null;
  let relevantCount = 0;
  let irrelevantCount = 0;
  const groups = [];
  const groupDetails = [];
  for (const line of lines) {
    try {
      const payload = JSON.parse(line);
      if (payload && payload.summary) {
        summary = payload;
      }
      if (!meta && payload && payload.match_count !== undefined && payload.question) {
        meta = payload;
      }
      if (
        payload &&
        payload.relevant_count !== undefined &&
        payload.irrelevant_count !== undefined &&
        payload.group_index !== undefined
      ) {
        const groupSummary = {
          group_index: Number(payload.group_index || 0),
          start_index: Number(payload.start_index || 0),
          end_index: Number(payload.end_index || 0),
          relevant_count: Number(payload.relevant_count || 0),
          irrelevant_count: Number(payload.irrelevant_count || 0),
        };
        groups.push(groupSummary);
        relevantCount += groupSummary.relevant_count;
        irrelevantCount += groupSummary.irrelevant_count;
        groupDetails.push({
          group_index: groupSummary.group_index,
          start_index: groupSummary.start_index,
          end_index: groupSummary.end_index,
          relevant: Array.isArray(payload.relevant) ? payload.relevant : [],
          irrelevant: Array.isArray(payload.irrelevant) ? payload.irrelevant : [],
        });
      }
    } catch (err) {
      continue;
    }
  }
  const orderedGroups = groups.sort((a, b) => a.group_index - b.group_index);
  const orderedDetails = groupDetails.sort((a, b) => a.group_index - b.group_index);
  if (summary) {
    return {
      analysis_id: summary.analysis_id || (meta ? meta.analysis_id : ""),
      record_id: summary.record_id || (meta ? meta.record_id : ""),
      match_count:
        summary.match_count !== undefined
          ? Number(summary.match_count)
          : Number(summary.relevant_count || 0) + Number(summary.irrelevant_count || 0),
      relevant_count: Number(summary.relevant_count || 0),
      irrelevant_count: Number(summary.irrelevant_count || 0),
      llm: summary.llm || (meta ? meta.llm : null),
      groups: orderedGroups,
      group_details: orderedDetails,
    };
  }
  if (!meta && !orderedGroups.length) {
    return null;
  }
  const matchCount =
    meta && meta.match_count !== undefined
      ? Number(meta.match_count || 0)
      : relevantCount + irrelevantCount;
  return {
    analysis_id: meta ? meta.analysis_id : "",
    record_id: meta ? meta.record_id : "",
    match_count: matchCount,
    relevant_count: relevantCount,
    irrelevant_count: irrelevantCount,
    llm: meta ? meta.llm || null : null,
    groups: orderedGroups,
    group_details: orderedDetails,
  };
}

function mapMatches(results, threshold) {
  return results
    .map((item) => {
      const payload = item.payload || {};
      return {
        score: Number(item.score || 0),
        action_id: payload.action_id || null,
        action_point: String(payload.action_point || "").trim(),
        circular_name: extractCircularName(payload),
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
    with_payload: MATCH_PAYLOAD_FIELDS,
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
    with_payload: MATCH_PAYLOAD_FIELDS,
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

async function askChat(provider, chatModel, question, matches) {
  const messages = buildChatMessages(question, matches);
  return requestChat(provider, chatModel, messages);
}

async function reframeQuestion(question, incorrect, missing, provider, chatModel) {
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
  const messages = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt },
  ];
  const content = await requestChat(provider, chatModel, messages, {
    temperature: 0.0,
  });
  return content || question;
}

async function classifyMatches(question, matches, provider, chatModel) {
  const batches = chunkArray(matches, ANALYSIS_BATCH_SIZE);
  const labels = [];
  for (const batch of batches) {
    const messages = buildAnalysisMessages(question, batch);
    const response = await requestChat(provider, chatModel, messages, { temperature: 0.0 });
    const relevantSet = parseRelevantIndices(response, batch.length);
    for (let i = 0; i < batch.length; i += 1) {
      labels.push(relevantSet.has(i + 1) ? "relevant" : "irrelevant");
    }
  }
  return labels;
}

async function runAnalysis(record, provider, chatModel, topK, analysisPath) {
  const analysisId = createRequestId();
  const recordId = record.record_id || record.id || record.request_id || analysisId;
  const question = record.question || record.retrieval_query || "";
  const retrievalQuery =
    record.retrieval_query || record.reframed_question || record.question || "";
  const modelName = record.model || DEFAULT_LORA_MODEL;
  const collectionName = record.collection || config.qdrantCollection;
  const searchMode = normalizeSearchMode(record.search_mode || record.searchMode || "");
  const threshold =
    typeof record.threshold === "number"
      ? record.threshold
      : record.config && record.config.search
        ? Number(record.config.search.threshold || 0)
        : 0;

  const matches = await askQdrant(
    retrievalQuery,
    topK,
    threshold,
    collectionName,
    modelName,
    searchMode
  );

  initAnalysisFile(analysisPath);
  const meta = {
    analysis_id: analysisId,
    record_id: recordId,
    timestamp: new Date().toISOString(),
    question,
    retrieval_query: retrievalQuery,
    search_mode: searchMode,
    top_k: topK,
    threshold,
    model: modelName,
    collection: collectionName,
    llm: {
      provider: provider.id,
      model: chatModel,
    },
    match_count: matches.length,
  };
  writeAnalysisLine(analysisPath, meta);

  const groups = chunkArray(matches, ANALYSIS_GROUP_SIZE);
  let totalRelevant = 0;
  let totalIrrelevant = 0;
  const groupSummaries = [];
  const groupDetails = [];

  for (let groupIndex = 0; groupIndex < groups.length; groupIndex += 1) {
    const group = groups[groupIndex];
    const labels = await classifyMatches(question, group, provider, chatModel);
    const relevant = [];
    const irrelevant = [];
    labels.forEach((label, idx) => {
      const match = group[idx];
      const item = {
        action_point: match.action_point,
        circular_name: match.circular_name,
      };
      if (label === "relevant") {
        relevant.push(item);
      } else {
        irrelevant.push(item);
      }
    });
    totalRelevant += relevant.length;
    totalIrrelevant += irrelevant.length;

    const groupSummary = {
      group_index: groupIndex,
      start_index: groupIndex * ANALYSIS_GROUP_SIZE,
      end_index: groupIndex * ANALYSIS_GROUP_SIZE + group.length - 1,
      relevant_count: relevant.length,
      irrelevant_count: irrelevant.length,
    };
    groupSummaries.push(groupSummary);
    groupDetails.push({
      group_index: groupSummary.group_index,
      start_index: groupSummary.start_index,
      end_index: groupSummary.end_index,
      relevant,
      irrelevant,
    });

    writeAnalysisLine(analysisPath, {
      analysis_id: analysisId,
      group_index: groupSummary.group_index,
      start_index: groupSummary.start_index,
      end_index: groupSummary.end_index,
      source_count: group.length,
      relevant_count: groupSummary.relevant_count,
      irrelevant_count: groupSummary.irrelevant_count,
      relevant,
      irrelevant,
    });
  }

  writeAnalysisLine(analysisPath, {
    analysis_id: analysisId,
    record_id: recordId,
    summary: true,
    match_count: matches.length,
    relevant_count: totalRelevant,
    irrelevant_count: totalIrrelevant,
    completed_at: new Date().toISOString(),
    llm: {
      provider: provider.id,
      model: chatModel,
    },
  });

  return {
    analysis_id: analysisId,
    record_id: recordId,
    file: path.relative(__dirname, analysisPath),
    match_count: matches.length,
    relevant_count: totalRelevant,
    irrelevant_count: totalIrrelevant,
    groups: groupSummaries,
    group_details: groupDetails,
  };
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
    "/history": "history.html",
    "/history.html": "history.html",
    "/analyse": "analyse.html",
    "/analyse.html": "analyse.html",
    "/compare": "compare.html",
    "/compare.html": "compare.html",
    "/styles.css": "styles.css",
    "/app.js": "app.js",
    "/history.js": "history.js",
    "/analyse.js": "analyse.js",
    "/compare.js": "compare.js",
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

  if (req.method === "GET" && req.url.startsWith("/api/chat-models")) {
    try {
      const urlObj = new URL(req.url, "http://localhost");
      const providerParam = urlObj.searchParams.get("provider") || "";
      const provider = getChatProviderMeta(providerParam);
      sendJson(res, 200, {
        provider: provider.id,
        models: provider.models || [],
        default_model: provider.default_model || "",
        enabled: provider.enabled,
      });
      logLine(
        `GET /api/chat-models provider=${provider.id} -> ${provider.models.length} models`
      );
    } catch (err) {
      sendJson(res, 400, { error: err.message || "Failed to load chat models." });
      logLine(`GET /api/chat-models error: ${err.message}`);
    }
    return;
  }

  if (req.method === "GET" && req.url.startsWith("/api/chat-providers")) {
    const providers = listChatProviders().map((provider) => ({
      id: provider.id,
      label: provider.label,
      type: provider.type,
      enabled: provider.enabled,
      models: provider.models || [],
      default_model: provider.default_model || "",
    }));
    const fallbackProvider =
      providerConfig.default_provider || (providers[0] ? providers[0].id : "");
    sendJson(res, 200, {
      providers,
      default_provider: fallbackProvider,
    });
    logLine(`GET /api/chat-providers -> ${providers.length} providers`);
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

  if (req.method === "GET" && req.url.startsWith("/api/history")) {
    const urlObj = new URL(req.url, "http://localhost");
    const limitParam = Number(urlObj.searchParams.get("limit") || 0);
    const limit = Math.max(1, limitParam || HISTORY_LIMIT_DEFAULT);
    const result = readHistory(limit);
    sendJson(res, 200, {
      items: result.items,
      total: result.total,
      limit,
    });
    logLine(`GET /api/history -> ${result.items.length} items`);
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
      const requestId = createRequestId();
      const requestedModel = payload.model ? String(payload.model).trim() : "";
      const requestedCollection = payload.collection
        ? String(payload.collection).trim()
        : "";
      const requestedSearchMode = payload.search_mode || payload.searchMode || "";
      const requestedChatProvider =
        payload.chat_provider || payload.chatProvider || "";
      const requestedChatModel = payload.chat_model || payload.chatModel || "";
      const modelName = resolveModelName(requestedModel);
      const chatProvider = resolveChatProvider(requestedChatProvider);
      const chatModel = resolveChatModel(chatProvider, requestedChatModel);
      const collectionName = requestedCollection || config.qdrantCollection;
      const topK = Math.max(1, Number(payload.topK || 300));
      const threshold = Math.max(0, Math.min(1, Number(payload.threshold || 0.2)));
      const searchMode = normalizeSearchMode(requestedSearchMode);
      const start = Date.now();
      logLine(
        `POST /api/ask mode=${searchMode} model=${modelName} chat_provider=${chatProvider.id} chat_model=${chatModel} collection=${collectionName} topK=${topK} threshold=${threshold.toFixed(
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
      const answer = await askChat(chatProvider, chatModel, question, matches);
      const totalMs = Date.now() - start;
      const historyRecord = {
        id: requestId,
        record_id: requestId,
        type: "ask",
        timestamp: new Date().toISOString(),
        question,
        retrieval_query: question,
        search_mode: searchMode,
        top_k: topK,
        threshold,
        model: modelName,
        collection: collectionName,
        config: buildHistoryConfig(
          searchMode,
          modelName,
          collectionName,
          topK,
          threshold,
          chatModel,
          chatProvider
        ),
        matches,
        answer,
        answer_provider: chatProvider.id,
        answer_model: chatModel,
        durations: {
          retrieval_ms: retrievalMs,
          total_ms: totalMs,
        },
      };
      appendHistoryRecord(historyRecord);
      sendJson(res, 200, {
        question,
        topK,
        threshold,
        model: modelName,
        collection: collectionName,
        search_mode: searchMode,
        matches,
        answer,
        answer_provider: chatProvider.id,
        answer_model: chatModel,
        durations: {
          retrieval_ms: retrievalMs,
          total_ms: totalMs,
        },
        request_id: requestId,
        record_id: requestId,
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
      const requestId = createRequestId();
      const requestedModel = payload.model ? String(payload.model).trim() : "";
      const requestedCollection = payload.collection
        ? String(payload.collection).trim()
        : "";
      const requestedSearchMode = payload.search_mode || payload.searchMode || "";
      const requestedChatProvider =
        payload.chat_provider || payload.chatProvider || "";
      const requestedChatModel = payload.chat_model || payload.chatModel || "";
      const modelName = resolveModelName(requestedModel);
      const chatProvider = resolveChatProvider(requestedChatProvider);
      const chatModel = resolveChatModel(chatProvider, requestedChatModel);
      const collectionName = requestedCollection || config.qdrantCollection;
      const topK = Math.max(1, Number(payload.topK || 300));
      const threshold = Math.max(0, Math.min(1, Number(payload.threshold || 0.2)));
      const searchMode = normalizeSearchMode(requestedSearchMode);
      const start = Date.now();
      logLine(
        `POST /api/reframe mode=${searchMode} model=${modelName} chat_provider=${chatProvider.id} chat_model=${chatModel} collection=${collectionName} topK=${topK} threshold=${threshold.toFixed(
          2
        )} incorrect=${feedbackIncorrect ? "yes" : "no"} missing=${feedbackMissing ? "yes" : "no"}`
      );
      let incorrect = feedbackIncorrect;
      let missing = feedbackMissing;
      if ((!incorrect && !missing) && legacyFeedback) {
        missing = legacyFeedback;
      }
      const reframedQuestion = await reframeQuestion(
        question,
        incorrect,
        missing,
        chatProvider,
        chatModel
      );
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
      const answer = await askChat(chatProvider, chatModel, question, matches);
      const totalMs = Date.now() - start;
      const historyRecord = {
        id: requestId,
        record_id: requestId,
        type: "reframe",
        timestamp: new Date().toISOString(),
        question,
        reframed_question: reframedQuestion,
        retrieval_query: reframedQuestion,
        feedback: {
          incorrect,
          missing,
        },
        search_mode: searchMode,
        top_k: topK,
        threshold,
        model: modelName,
        collection: collectionName,
        config: buildHistoryConfig(
          searchMode,
          modelName,
          collectionName,
          topK,
          threshold,
          chatModel,
          chatProvider
        ),
        matches,
        answer,
        answer_provider: chatProvider.id,
        answer_model: chatModel,
        durations: {
          reframe_ms: reframeMs,
          retrieval_ms: retrievalMs,
          total_ms: totalMs,
        },
      };
      appendHistoryRecord(historyRecord);
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
        answer_provider: chatProvider.id,
        answer_model: chatModel,
        durations: {
          reframe_ms: reframeMs,
          retrieval_ms: retrievalMs,
          total_ms: totalMs,
        },
        request_id: requestId,
        record_id: requestId,
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

  if (req.method === "POST" && req.url.startsWith("/api/analyse")) {
    try {
      const payload = await parseJsonBody(req);
      const recordId = String(payload.record_id || payload.recordId || "").trim();
      if (!recordId) {
        sendJson(res, 400, { error: "record_id is required." });
        return;
      }
      const requestedTopK = Number(payload.topK || payload.top_k || 1000);
      const topK = Math.max(1, requestedTopK);
      const cacheOnly = Boolean(payload.cache_only || payload.cacheOnly);
      const requestedChatProvider =
        payload.chat_provider || payload.chatProvider || "";
      const requestedChatModel = payload.chat_model || payload.chatModel || "";
      const record = findHistoryRecord(recordId);
      if (!record) {
        sendJson(res, 404, { error: "Record not found." });
        return;
      }
      const analysisPath = buildAnalysisFilePath(recordId);
      cleanupAnalysisArtifacts(recordId, analysisPath);
      const cachedSummary = readAnalysisSummary(analysisPath);
      if (cachedSummary) {
        sendJson(res, 200, {
          ...cachedSummary,
          file: path.relative(__dirname, analysisPath),
          cached: true,
        });
        logLine(`POST /api/analyse cache hit record_id=${recordId}`);
        return;
      }
      if (cacheOnly) {
        sendJson(res, 404, { error: "No cached analysis.", cached: false });
        logLine(`POST /api/analyse cache miss record_id=${recordId}`);
        return;
      }
      const chatProvider = resolveChatProvider(requestedChatProvider);
      const chatModel = resolveChatModel(chatProvider, requestedChatModel);

      logLine(
        `POST /api/analyse record_id=${recordId} topK=${topK} chat_provider=${chatProvider.id} chat_model=${chatModel}`
      );
      const result = await runAnalysis(
        record,
        chatProvider,
        chatModel,
        topK,
        analysisPath
      );
      sendJson(res, 200, { ...result, cached: false });
      logLine(
        `POST /api/analyse done record_id=${recordId} matches=${result.match_count}`
      );
    } catch (err) {
      sendJson(res, 500, { error: err.message || "Server error." });
      logLine(`POST /api/analyse error: ${err.message}`);
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
