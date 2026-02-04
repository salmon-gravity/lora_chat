const elements = {
  status: document.getElementById("modelsStatus"),
  questionInput: document.getElementById("modelsQuestionInput"),
  compareButton: document.getElementById("modelsCompare"),
  clearButton: document.getElementById("modelsClear"),
  overlap: document.getElementById("modelsOverlap"),
  onlyLora: document.getElementById("modelsOnlyLora"),
  onlyOllama: document.getElementById("modelsOnlyOllama"),
  fullLora: document.getElementById("modelsFullLora"),
  fullOllama: document.getElementById("modelsFullOllama"),
  overlapCount: document.getElementById("modelsOverlapCount"),
  onlyLoraCount: document.getElementById("modelsOnlyLoraCount"),
  onlyOllamaCount: document.getElementById("modelsOnlyOllamaCount"),
  embeddingMetrics: document.getElementById("modelsEmbeddingMetrics"),
  metricCosine: document.getElementById("metricCosine"),
  metricL2: document.getElementById("metricL2"),
  metricL1: document.getElementById("metricL1"),
  metricSumAbs: document.getElementById("metricSumAbs"),
  metricLoraLen: document.getElementById("metricLoraLen"),
  metricOllamaLen: document.getElementById("metricOllamaLen"),
  metricLoraMean: document.getElementById("metricLoraMean"),
  metricOllamaMean: document.getElementById("metricOllamaMean"),
  modelsCollection: document.getElementById("modelsCollection"),
  modelsTopK: document.getElementById("modelsTopK"),
  loadingOverlay: document.getElementById("modelsLoadingOverlay"),
  loadingTitle: document.getElementById("modelsLoadingTitle"),
  loadingSub: document.getElementById("modelsLoadingSub"),
};

const COMPARE_TOP_K = 100;
const COMPARE_COLLECTION_LORA = "hybrid_with_circular_name_lora";
const COMPARE_COLLECTION_OLLAMA = "hybrid_with_circular_name_ollama_custom_model";

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function inlineFormat(text) {
  return escapeHtml(text);
}

function setStatus(message) {
  if (elements.status) {
    elements.status.textContent = message;
  }
}

function syncCollectionLabel(payload) {
  const collections = (payload && payload.collections) || {};
  const loraLabel = collections.lora || COMPARE_COLLECTION_LORA;
  const ollamaLabel = collections.ollama || COMPARE_COLLECTION_OLLAMA;
  if (elements.modelsCollection) {
    elements.modelsCollection.textContent = `${loraLabel} (LoRA) / ${ollamaLabel} (Ollama)`;
  }
  if (elements.modelsTopK) {
    elements.modelsTopK.textContent = String(COMPARE_TOP_K);
  }
}

function setLoading(isLoading, title, sub) {
  if (!elements.loadingOverlay) {
    return;
  }
  elements.loadingOverlay.classList.toggle("active", isLoading);
  elements.loadingOverlay.setAttribute("aria-hidden", String(!isLoading));
  if (elements.loadingTitle) {
    elements.loadingTitle.textContent = title || "Comparing embeddings";
  }
  if (elements.loadingSub) {
    elements.loadingSub.textContent = sub || "Querying Qdrant and computing differences.";
  }
}

function renderCompareTable(container, rows, columns) {
  if (!container) return;
  if (!rows || !rows.length) {
    container.innerHTML = '<div class="compare-empty">No data.</div>';
    return;
  }
  const thead = columns
    .map((col) => `<th>${escapeHtml(col.label)}</th>`)
    .join("");
  const tbody = rows
    .map((row) => {
      const cells = columns
        .map((col) => {
          const raw = row[col.key];
          const value =
            raw === null || raw === undefined
              ? ""
              : typeof raw === "number"
                ? String(raw)
                : String(raw);
          return `<td>${inlineFormat(value)}</td>`;
        })
        .join("");
      return `<tr>${cells}</tr>`;
    })
    .join("");
  container.innerHTML = `<table><thead><tr>${thead}</tr></thead><tbody>${tbody}</tbody></table>`;
}

function updateMetrics(payload) {
  const stats = payload.stats || {};
  if (elements.overlapCount) {
    elements.overlapCount.textContent = stats.overlap_count ?? "-";
  }
  if (elements.onlyLoraCount) {
    elements.onlyLoraCount.textContent = stats.only_lora_count ?? "-";
  }
  if (elements.onlyOllamaCount) {
    elements.onlyOllamaCount.textContent = stats.only_ollama_count ?? "-";
  }

  const emb = payload.embedding_analysis || {};
  const loraStats = emb.lora_stats || {};
  const ollamaStats = emb.ollama_stats || {};
  if (elements.metricCosine) {
    elements.metricCosine.textContent = Number(emb.cosine_similarity || 0).toFixed(6);
  }
  if (elements.metricL2) {
    elements.metricL2.textContent = Number(emb.l2_distance || 0).toFixed(6);
  }
  if (elements.metricL1) {
    elements.metricL1.textContent = Number(emb.l1_distance || 0).toFixed(6);
  }
  if (elements.metricSumAbs) {
    elements.metricSumAbs.textContent = Number(emb.sum_abs_diff || 0).toFixed(6);
  }
  if (elements.metricLoraLen) {
    elements.metricLoraLen.textContent = loraStats.length || "-";
  }
  if (elements.metricOllamaLen) {
    elements.metricOllamaLen.textContent = ollamaStats.length || "-";
  }
  if (elements.metricLoraMean) {
    elements.metricLoraMean.textContent = Number(loraStats.mean || 0).toFixed(6);
  }
  if (elements.metricOllamaMean) {
    elements.metricOllamaMean.textContent = Number(ollamaStats.mean || 0).toFixed(6);
  }
}

function renderResults(payload) {
  syncCollectionLabel(payload);
  updateMetrics(payload);

  renderCompareTable(elements.overlap, payload.overlap || [], [
    { key: "lora_rank", label: "LoRA Rank" },
    { key: "ollama_rank", label: "Ollama Rank" },
    { key: "action_id", label: "Action Id" },
    { key: "circular_name", label: "Circular" },
    { key: "action_point", label: "Action Point" },
  ]);

  renderCompareTable(elements.onlyLora, payload.only_lora || [], [
    { key: "lora_rank", label: "LoRA Rank" },
    { key: "action_id", label: "Action Id" },
    { key: "circular_name", label: "Circular" },
    { key: "action_point", label: "Action Point" },
  ]);

  renderCompareTable(elements.onlyOllama, payload.only_ollama || [], [
    { key: "ollama_rank", label: "Ollama Rank" },
    { key: "action_id", label: "Action Id" },
    { key: "circular_name", label: "Circular" },
    { key: "action_point", label: "Action Point" },
  ]);

  renderCompareTable(
    elements.fullLora,
    ((payload.lora && payload.lora.matches) || []).map((item, index) => ({
      rank: index + 1,
      ...item,
    })),
    [
      { key: "rank", label: "Rank" },
      { key: "score", label: "Score" },
      { key: "action_id", label: "Action Id" },
      { key: "circular_name", label: "Circular" },
      { key: "action_point", label: "Action Point" },
    ]
  );

  renderCompareTable(
    elements.fullOllama,
    ((payload.ollama && payload.ollama.matches) || []).map((item, index) => ({
      rank: index + 1,
      ...item,
    })),
    [
      { key: "rank", label: "Rank" },
      { key: "score", label: "Score" },
      { key: "action_id", label: "Action Id" },
      { key: "circular_name", label: "Circular" },
      { key: "action_point", label: "Action Point" },
    ]
  );
}

async function runComparison() {
  const question = elements.questionInput.value.trim();
  if (!question) {
    setStatus("Enter a question to compare.");
    return;
  }
  setStatus("Comparing embeddings...");
  setLoading(true);
  try {
    const response = await fetch("/api/compare-embeddings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        question,
        topK: COMPARE_TOP_K,
        lora_collection: COMPARE_COLLECTION_LORA,
        ollama_collection: COMPARE_COLLECTION_OLLAMA,
      }),
    });
    const rawText = await response.text();
    let payload = null;
    try {
      payload = rawText ? JSON.parse(rawText) : {};
    } catch (parseErr) {
      throw new Error("Compare endpoint did not return JSON. Is the server updated?");
    }
    if (!response.ok) {
      throw new Error((payload && payload.error) || "Compare failed.");
    }
    renderResults(payload);
    setStatus("Ready.");
  } catch (err) {
    setStatus(err.message || "Compare failed.");
  } finally {
    setLoading(false);
  }
}

function clearResults() {
  if (elements.questionInput) {
    elements.questionInput.value = "";
  }
  renderResults({
    overlap: [],
    only_lora: [],
    only_ollama: [],
    lora: { matches: [] },
    ollama: { matches: [] },
    collections: {
      lora: COMPARE_COLLECTION_LORA,
      ollama: COMPARE_COLLECTION_OLLAMA,
    },
    stats: {},
    embedding_analysis: {},
  });
  setStatus("Idle");
  setLoading(false);
}

function init() {
  syncCollectionLabel({
    collections: {
      lora: COMPARE_COLLECTION_LORA,
      ollama: COMPARE_COLLECTION_OLLAMA,
    },
  });
  clearResults();
  if (elements.compareButton) {
    elements.compareButton.addEventListener("click", runComparison);
  }
  if (elements.clearButton) {
    elements.clearButton.addEventListener("click", clearResults);
  }
}

init();
