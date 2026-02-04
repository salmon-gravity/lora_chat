const elements = {
  status: document.getElementById("status"),
  questionInput: document.getElementById("questionInput"),
  topKInput: document.getElementById("topKInput"),
  thresholdRange: document.getElementById("thresholdRange"),
  thresholdInput: document.getElementById("thresholdInput"),
  searchModeSelect: document.getElementById("searchModeSelect"),
  modelSelect: document.getElementById("modelSelect"),
  collectionSelect: document.getElementById("collectionSelect"),
  chatProviderSelect: document.getElementById("chatProviderSelect"),
  chatModelSelect: document.getElementById("chatModelSelect"),
  askButton: document.getElementById("askButton"),
  clearButton: document.getElementById("clearButton"),
  matchCount: document.getElementById("matchCount"),
  totalTime: document.getElementById("totalTime"),
  displayQuestion: document.getElementById("displayQuestion"),
  answerModel: document.getElementById("answerModel"),
  initialAnswerBody: document.getElementById("initialAnswerBody"),
  refinedAnswerBody: document.getElementById("refinedAnswerBody"),
  initialTime: document.getElementById("initialTime"),
  refinedTime: document.getElementById("refinedTime"),
  initialModel: document.getElementById("initialModel"),
  refinedModel: document.getElementById("refinedModel"),
  reframedQuestion: document.getElementById("reframedQuestion"),
  feedbackIncorrect: document.getElementById("feedbackIncorrect"),
  feedbackMissing: document.getElementById("feedbackMissing"),
  refineButton: document.getElementById("refineButton"),
  feedbackHint: document.getElementById("feedbackHint"),
  copyAnswer: document.getElementById("copyAnswer"),
  chunkFilter: document.getElementById("chunkFilter"),
  toggleChunks: document.getElementById("toggleChunks"),
  chunksContent: document.getElementById("chunksContent"),
  chunkList: document.getElementById("chunkList"),
  chunkSourceSelect: document.getElementById("chunkSourceSelect"),
  chunkDetailText: document.getElementById("chunkDetailText"),
  copyChunk: document.getElementById("copyChunk"),
  logView: document.getElementById("logView"),
  clearLogs: document.getElementById("clearLogs"),
  loadingOverlay: document.getElementById("loadingOverlay"),
  loadingTitle: document.getElementById("loadingTitle"),
  loadingSub: document.getElementById("loadingSub"),
  historyLimit: document.getElementById("historyLimit"),
  refreshHistory: document.getElementById("refreshHistory"),
  historyList: document.getElementById("historyList"),
  historyMeta: document.getElementById("historyMeta"),
  historyQuestion: document.getElementById("historyQuestion"),
  historyQuery: document.getElementById("historyQuery"),
  historyAnswer: document.getElementById("historyAnswer"),
  historyRaw: document.getElementById("historyRaw"),
  compareQuestionInput: document.getElementById("compareQuestionInput"),
  compareButton: document.getElementById("compareButton"),
  compareClear: document.getElementById("compareClear"),
  compareStatus: document.getElementById("compareStatus"),
  compareSummary: document.getElementById("compareSummary"),
  compareEmbeddingSummary: document.getElementById("compareEmbeddingSummary"),
  compareOverlap: document.getElementById("compareOverlap"),
  compareOnlyLora: document.getElementById("compareOnlyLora"),
  compareOnlyOllama: document.getElementById("compareOnlyOllama"),
  compareFullLora: document.getElementById("compareFullLora"),
  compareFullOllama: document.getElementById("compareFullOllama"),
};

const DEFAULT_TOP_K = 300;
const DEFAULT_THRESHOLD = 0.2;
const DEFAULT_SEARCH_MODE = "dense";
const DEFAULT_HISTORY_LIMIT = 200;
const COMPARE_TOP_K = 100;
const COMPARE_COLLECTION = "hybrid_with_circular_name_lora";
const ROW_HEIGHT = 86;

const state = {
  initialMatches: [],
  refinedMatches: [],
  chunkSource: "initial",
  filteredMatches: [],
  selectedChunk: null,
  chunksVisible: true,
  models: [],
  collections: [],
  chatProviders: [],
  selectedChatProvider: "",
  question: "",
  lastAnswerText: "",
  logs: [],
  isLoading: false,
  history: [],
  selectedHistoryIndex: null,
  compareResult: null,
};

class VirtualList {
  constructor(container, rowHeight, renderRow, overscan = 6) {
    this.container = container;
    this.rowHeight = rowHeight;
    this.renderRow = renderRow;
    this.overscan = overscan;
    this.items = [];
    this.renderedStart = 0;
    this.renderedEnd = 0;
    this.spacer = document.createElement("div");
    this.spacer.className = "list-spacer";
    this.inner = document.createElement("div");
    this.inner.className = "list-inner";
    this.container.innerHTML = "";
    this.container.appendChild(this.spacer);
    this.container.appendChild(this.inner);
    this.container.addEventListener("scroll", () => this.render());
    window.addEventListener("resize", () => this.render(true));
  }

  setItems(items) {
    this.items = items || [];
    this.spacer.style.height = `${this.items.length * this.rowHeight}px`;
    this.render(true);
  }

  render(force = false) {
    const { scrollTop, clientHeight } = this.container;
    const start = Math.max(0, Math.floor(scrollTop / this.rowHeight) - this.overscan);
    const end = Math.min(
      this.items.length,
      Math.ceil((scrollTop + clientHeight) / this.rowHeight) + this.overscan
    );
    if (!force && start === this.renderedStart && end === this.renderedEnd) {
      return;
    }
    this.renderedStart = start;
    this.renderedEnd = end;
    this.inner.innerHTML = "";
    for (let i = start; i < end; i += 1) {
      const row = this.renderRow(this.items[i], i);
      row.style.top = `${i * this.rowHeight}px`;
      row.style.height = `${this.rowHeight}px`;
      this.inner.appendChild(row);
    }
  }
}

const chunkList = new VirtualList(elements.chunkList, ROW_HEIGHT, renderChunkRow);

function setStatus(message) {
  elements.status.textContent = message;
}

function setLoadingMessage(title, subText) {
  if (!elements.loadingTitle || !elements.loadingSub) {
    return;
  }
  elements.loadingTitle.textContent = title || "Generating answer";
  elements.loadingSub.textContent = subText || "Searching and grounding a response.";
}

function addLog(message) {
  const timestamp = new Date().toLocaleTimeString("en-US", { hour12: false });
  const entry = `[${timestamp}] ${message}`;
  state.logs.unshift(entry);
  if (state.logs.length > 200) {
    state.logs.pop();
  }
  elements.logView.textContent = state.logs.join("\n");
}

function formatCount(value) {
  if (!Number.isFinite(value)) {
    return "0";
  }
  return value.toLocaleString("en-US");
}

function formatDuration(ms) {
  if (!Number.isFinite(ms)) {
    return "00:00";
  }
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function formatTimestamp(iso) {
  if (!iso) {
    return "-";
  }
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return "-";
  }
  return date.toLocaleString("en-US", { hour12: false });
}

function historyTitle(record) {
  return (
    record.question ||
    record.reframed_question ||
    record.retrieval_query ||
    "Untitled request"
  );
}

function historyMode(record) {
  return record.search_mode || (record.search && record.search.mode) || "-";
}

function historyMatchesCount(record) {
  return Array.isArray(record.matches) ? record.matches.length : 0;
}

function historyTotalMs(record) {
  return record.durations ? record.durations.total_ms : null;
}

function findChatProvider(providerId) {
  return state.chatProviders.find((provider) => provider.id === providerId);
}

function formatAnswerModel(providerId, modelName) {
  if (!providerId && !modelName) {
    return "Model: -";
  }
  const provider = findChatProvider(providerId);
  const label = provider ? provider.label : providerId;
  if (label && modelName) {
    return `Model: ${label} / ${modelName}`;
  }
  if (label) {
    return `Model: ${label}`;
  }
  return `Model: ${modelName || "-"}`;
}

function scoreToColor(score) {
  const clamped = Math.max(0, Math.min(1, score));
  const hue = Math.round(120 * clamped);
  return `hsl(${hue}, 55%, 42%)`;
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function inlineFormat(text) {
  const codeTokens = [];
  let formatted = text.replace(/`([^`]+)`/g, (match, code) => {
    const token = `@@CODE${codeTokens.length}@@`;
    codeTokens.push(code);
    return token;
  });
  formatted = formatted.replace(/\[(.+?)\]\((https?:\/\/[^)]+)\)/g, (match, label, url) => {
    return `<a href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>`;
  });
  formatted = formatted.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  formatted = formatted.replace(/__([^_]+)__/g, "<strong>$1</strong>");
  formatted = formatted.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  formatted = formatted.replace(/@@CODE(\d+)@@/g, (match, index) => {
    const code = codeTokens[Number(index)] || "";
    return `<code>${code}</code>`;
  });
  return formatted;
}

function renderCompareTable(container, rows, columns) {
  if (!container) {
    return;
  }
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
          return `<td>${inlineFormat(escapeHtml(value))}</td>`;
        })
        .join("");
      return `<tr>${cells}</tr>`;
    })
    .join("");
  container.innerHTML = `<table><thead><tr>${thead}</tr></thead><tbody>${tbody}</tbody></table>`;
}

function renderCompareSummary(payload) {
  if (!elements.compareSummary) {
    return;
  }
  if (!payload) {
    elements.compareSummary.textContent = "";
    if (elements.compareEmbeddingSummary) {
      elements.compareEmbeddingSummary.textContent = "";
    }
    return;
  }
  const stats = payload.stats || {};
  const summary = [
    `Collection: ${payload.collection || "-"}`,
    `Top K: ${payload.top_k || COMPARE_TOP_K}`,
    `LoRA count: ${stats.lora_count ?? 0}`,
    `Ollama count: ${stats.ollama_count ?? 0}`,
    `Overlap: ${stats.overlap_count ?? 0}`,
    `Only LoRA: ${stats.only_lora_count ?? 0}`,
    `Only Ollama: ${stats.only_ollama_count ?? 0}`,
  ];
  elements.compareSummary.textContent = summary.join(" | ");

  if (elements.compareEmbeddingSummary) {
    const emb = payload.embedding_analysis || {};
    const loraStats = emb.lora_stats || {};
    const ollamaStats = emb.ollama_stats || {};
    const embSummary = [
      `Embedding cosine: ${Number(emb.cosine_similarity || 0).toFixed(6)}`,
      `L2: ${Number(emb.l2_distance || 0).toFixed(6)}`,
      `L1: ${Number(emb.l1_distance || 0).toFixed(6)}`,
      `LoRA len: ${loraStats.length || "-"}`,
      `Ollama len: ${ollamaStats.length || "-"}`,
      `LoRA mean: ${Number(loraStats.mean || 0).toFixed(6)}`,
      `Ollama mean: ${Number(ollamaStats.mean || 0).toFixed(6)}`,
    ];
    elements.compareEmbeddingSummary.textContent = embSummary.join(" | ");
  }
}

function renderCompareResults(payload) {
  state.compareResult = payload;
  renderCompareSummary(payload);

  renderCompareTable(elements.compareOverlap, payload.overlap || [], [
    { key: "lora_rank", label: "LoRA Rank" },
    { key: "ollama_rank", label: "Ollama Rank" },
    { key: "action_id", label: "Action Id" },
    { key: "circular_name", label: "Circular" },
    { key: "action_point", label: "Action Point" },
  ]);

  renderCompareTable(elements.compareOnlyLora, payload.only_lora || [], [
    { key: "lora_rank", label: "LoRA Rank" },
    { key: "action_id", label: "Action Id" },
    { key: "circular_name", label: "Circular" },
    { key: "action_point", label: "Action Point" },
  ]);

  renderCompareTable(elements.compareOnlyOllama, payload.only_ollama || [], [
    { key: "ollama_rank", label: "Ollama Rank" },
    { key: "action_id", label: "Action Id" },
    { key: "circular_name", label: "Circular" },
    { key: "action_point", label: "Action Point" },
  ]);

  renderCompareTable(
    elements.compareFullLora,
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
    elements.compareFullOllama,
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

async function compareEmbeddings() {
  const question = elements.compareQuestionInput.value.trim();
  if (!question) {
    if (elements.compareStatus) {
      elements.compareStatus.textContent = "Enter a question to compare.";
    }
    return;
  }
  if (elements.compareStatus) {
    elements.compareStatus.textContent = "Comparing embeddings...";
  }
  addLog(`Compare: collection=${COMPARE_COLLECTION} topK=${COMPARE_TOP_K}`);
  try {
    const response = await fetch("/api/compare-embeddings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        question,
        topK: COMPARE_TOP_K,
        collection: COMPARE_COLLECTION,
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
    renderCompareResults(payload);
    if (elements.compareStatus) {
      elements.compareStatus.textContent = "Comparison ready.";
    }
  } catch (err) {
    if (elements.compareStatus) {
      elements.compareStatus.textContent = err.message || "Compare failed.";
    }
    addLog(`Compare error: ${err.message || "request failed"}`);
  }
}

function parseTableRow(line) {
  let trimmed = line.trim();
  if (trimmed.startsWith("|")) {
    trimmed = trimmed.slice(1);
  }
  if (trimmed.endsWith("|")) {
    trimmed = trimmed.slice(0, -1);
  }
  return trimmed.split("|").map((cell) => cell.trim());
}

function isTableSeparator(line) {
  return /^[\s|\-:]+$/.test(line) && line.includes("-");
}

function renderMarkdown(text) {
  if (!text) {
    return "";
  }
  const escaped = escapeHtml(text);
  const lines = escaped.split(/\r?\n/);
  const html = [];
  let inCode = false;
  let inList = null;
  let inBlockquote = false;

  const closeList = () => {
    if (inList) {
      html.push(`</${inList}>`);
      inList = null;
    }
  };

  const closeBlockquote = () => {
    if (inBlockquote) {
      html.push("</blockquote>");
      inBlockquote = false;
    }
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.trim().startsWith("```")) {
      closeList();
      closeBlockquote();
      if (!inCode) {
        const lang = line.trim().slice(3).trim();
        const classAttr = lang ? ` class="language-${lang}"` : "";
        html.push(`<pre><code${classAttr}>`);
        inCode = true;
      } else {
        html.push("</code></pre>");
        inCode = false;
      }
      continue;
    }

    if (inCode) {
      html.push(`${line}\n`);
      continue;
    }

    if (i + 1 < lines.length && line.includes("|") && isTableSeparator(lines[i + 1])) {
      closeList();
      closeBlockquote();
      const headerCells = parseTableRow(line);
      const bodyRows = [];
      let j = i + 2;
      while (j < lines.length && lines[j].includes("|")) {
        bodyRows.push(parseTableRow(lines[j]));
        j += 1;
      }
      html.push("<table><thead><tr>");
      headerCells.forEach((cell) => {
        html.push(`<th>${inlineFormat(cell)}</th>`);
      });
      html.push("</tr></thead><tbody>");
      bodyRows.forEach((row) => {
        html.push("<tr>");
        row.forEach((cell) => {
          html.push(`<td>${inlineFormat(cell)}</td>`);
        });
        html.push("</tr>");
      });
      html.push("</tbody></table>");
      i = j - 1;
      continue;
    }

    const blockquoteMatch = line.match(/^\s*>\s?(.*)$/);
    if (blockquoteMatch) {
      closeList();
      if (!inBlockquote) {
        html.push("<blockquote>");
        inBlockquote = true;
      }
      const textContent = blockquoteMatch[1];
      if (textContent.trim()) {
        html.push(`<p>${inlineFormat(textContent)}</p>`);
      } else {
        html.push("<br />");
      }
      continue;
    }
    closeBlockquote();

    const bulletMatch = line.match(/^\s*[-*+]\s+(.+)$/);
    if (bulletMatch) {
      if (inList !== "ul") {
        closeList();
        html.push("<ul>");
        inList = "ul";
      }
      html.push(`<li>${inlineFormat(bulletMatch[1])}</li>`);
      continue;
    }
    const orderedMatch = line.match(/^\s*\d+\.\s+(.+)$/);
    if (orderedMatch) {
      if (inList !== "ol") {
        closeList();
        html.push("<ol>");
        inList = "ol";
      }
      html.push(`<li>${inlineFormat(orderedMatch[1])}</li>`);
      continue;
    }

    if (!line.trim()) {
      closeList();
      continue;
    }

    closeList();
    const headingMatch = line.match(/^(#{1,6})\s+(.*)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      html.push(`<h${level}>${inlineFormat(headingMatch[2])}</h${level}>`);
      continue;
    }
    html.push(`<p>${inlineFormat(line)}</p>`);
  }

  closeList();
  closeBlockquote();
  if (inCode) {
    html.push("</code></pre>");
  }
  return html.join("");
}

function renderChunkRow(item, index) {
  const row = document.createElement("div");
  row.className = "row";
  if (state.selectedChunk && state.selectedChunk.index === index) {
    row.classList.add("active");
  }
  const scoreBadge = document.createElement("div");
  scoreBadge.className = "score-badge";
  scoreBadge.textContent = item.score.toFixed(3);
  scoreBadge.style.background = scoreToColor(item.score);
  const body = document.createElement("div");
  const title = document.createElement("div");
  title.className = "row-title";
  title.textContent = item.action_point;
  const meta = document.createElement("div");
  meta.className = "row-meta";
  const idChip = document.createElement("span");
  idChip.className = "chip";
  idChip.textContent = item.action_id ? `id ${item.action_id}` : "id -";
  meta.appendChild(idChip);
  body.appendChild(title);
  body.appendChild(meta);
  row.appendChild(scoreBadge);
  row.appendChild(body);
  row.addEventListener("click", () => selectChunk(item, index));
  return row;
}

function selectChunk(item, index) {
  state.selectedChunk = { ...item, index };
  elements.chunkDetailText.textContent = item.action_point || "";
  elements.copyChunk.disabled = !item.action_point;
  elements.copyChunk.dataset.copyText = item.action_point || "";
  chunkList.render(true);
}

function updateChunkList() {
  const filter = elements.chunkFilter.value.trim().toLowerCase();
  const sourceMatches =
    state.chunkSource === "refined" ? state.refinedMatches : state.initialMatches;
  if (filter) {
    state.filteredMatches = sourceMatches.filter((item) =>
      item.action_point.toLowerCase().includes(filter)
    );
  } else {
    state.filteredMatches = sourceMatches;
  }
  chunkList.setItems(state.filteredMatches);
  elements.matchCount.textContent = formatCount(sourceMatches.length);
  if (!state.filteredMatches.length) {
    elements.chunkDetailText.textContent = "No chunks found.";
    elements.copyChunk.disabled = true;
  }
}

function loadHistory() {
  return Promise.resolve();
}

function setInitialAnswer(question, answer, model, durationMs, matches) {
  state.question = question || "";
  elements.feedbackIncorrect.value = "";
  elements.feedbackMissing.value = "";
  elements.feedbackHint.textContent = "";
  elements.displayQuestion.textContent = question || "No question yet.";
  elements.initialAnswerBody.innerHTML = renderMarkdown(answer || "No answer available.");
  elements.initialModel.textContent = formatAnswerModel(
    state.selectedChatProvider,
    model
  );
  elements.initialTime.textContent = formatDuration(durationMs);
  elements.answerModel.textContent = formatAnswerModel(
    state.selectedChatProvider,
    model
  );
  elements.totalTime.textContent = formatDuration(durationMs);
  elements.copyAnswer.disabled = !answer;
  elements.copyAnswer.dataset.copyText = answer || "";
  state.lastAnswerText = answer || "";
  state.initialMatches = matches || [];
  state.refinedMatches = [];
  state.chunkSource = "initial";
  elements.chunkSourceSelect.value = "initial";
  elements.chunkSourceSelect.options[1].disabled = true;
  elements.reframedQuestion.textContent = "-";
  elements.refinedAnswerBody.innerHTML = "Provide feedback to generate a refined answer.";
  elements.refinedTime.textContent = "00:00";
  elements.refinedModel.textContent = "Model: -";
  updateRefineButtonState();
  state.selectedChunk = null;
  updateChunkList();
}

function setRefinedAnswer(reframedQuestion, answer, model, durationMs, matches) {
  elements.reframedQuestion.textContent = reframedQuestion || "-";
  elements.refinedAnswerBody.innerHTML = renderMarkdown(answer || "No answer available.");
  elements.refinedModel.textContent = formatAnswerModel(
    state.selectedChatProvider,
    model
  );
  elements.refinedTime.textContent = formatDuration(durationMs);
  elements.answerModel.textContent = formatAnswerModel(
    state.selectedChatProvider,
    model
  );
  elements.totalTime.textContent = formatDuration(durationMs);
  elements.copyAnswer.disabled = !answer;
  elements.copyAnswer.dataset.copyText = answer || "";
  state.lastAnswerText = answer || "";
  state.refinedMatches = matches || [];
  state.chunkSource = "refined";
  elements.chunkSourceSelect.value = "refined";
  elements.chunkSourceSelect.options[1].disabled = false;
  state.selectedChunk = null;
  updateChunkList();
}

function setLoadingState(isLoading) {
  state.isLoading = isLoading;
  elements.askButton.disabled = isLoading;
  elements.questionInput.disabled = isLoading;
  elements.topKInput.disabled = isLoading;
  elements.thresholdInput.disabled = isLoading;
  elements.thresholdRange.disabled = isLoading;
  elements.searchModeSelect.disabled = isLoading;
  elements.modelSelect.disabled = isLoading;
  elements.collectionSelect.disabled = isLoading;
  elements.chatProviderSelect.disabled = isLoading;
  elements.chatModelSelect.disabled = isLoading;
  if (elements.loadingOverlay) {
    elements.loadingOverlay.classList.toggle("active", isLoading);
    elements.loadingOverlay.setAttribute("aria-hidden", String(!isLoading));
  }
  updateRefineButtonState();
}

function updateRefineButtonState() {
  const hasIncorrect = elements.feedbackIncorrect.value.trim().length > 0;
  const hasMissing = elements.feedbackMissing.value.trim().length > 0;
  const hasFeedback = hasIncorrect || hasMissing;
  elements.refineButton.disabled = state.isLoading || !state.question || !hasFeedback;
}

function fillSelect(select, options, selectedValue) {
  select.innerHTML = "";
  if (!options.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "Unavailable";
    select.appendChild(option);
    select.value = "";
    return "";
  }
  options.forEach((value) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    select.appendChild(option);
  });
  if (selectedValue && options.includes(selectedValue)) {
    select.value = selectedValue;
  } else {
    select.value = options[0];
  }
  return select.value;
}

function fillProviderSelect(select, providers, selectedValue) {
  select.innerHTML = "";
  if (!providers.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "Unavailable";
    select.appendChild(option);
    select.value = "";
    return "";
  }
  const enabledProviders = providers.filter((provider) => provider.enabled);
  providers.forEach((provider) => {
    const option = document.createElement("option");
    option.value = provider.id;
    option.textContent = provider.label || provider.id;
    option.disabled = !provider.enabled;
    select.appendChild(option);
  });
  const fallback =
    enabledProviders.find((provider) => provider.id === selectedValue)?.id ||
    (enabledProviders[0] ? enabledProviders[0].id : providers[0].id);
  select.value = fallback || "";
  return select.value;
}

function getStoredChatModel(providerId) {
  if (!providerId) {
    return "";
  }
  const perProvider = localStorage.getItem(`selectedChatModel:${providerId}`);
  if (perProvider) {
    return perProvider;
  }
  return localStorage.getItem("selectedChatModel") || "";
}

function updateChatModelSelect(providerId) {
  const provider = findChatProvider(providerId);
  const models = provider ? provider.models || [] : [];
  const storedModel = getStoredChatModel(providerId);
  const defaultModel = provider ? provider.default_model : "";
  const selectedModel = fillSelect(
    elements.chatModelSelect,
    models,
    storedModel || defaultModel
  );
  if (selectedModel && providerId) {
    localStorage.setItem(`selectedChatModel:${providerId}`, selectedModel);
  }
  return selectedModel;
}

async function loadSelectOptions() {
  try {
    addLog("Loading models and collections.");
    const [modelsRes, collectionsRes, providersRes] = await Promise.all([
      fetch("/api/models"),
      fetch("/api/collections"),
      fetch("/api/chat-providers"),
    ]);
    const modelsPayload = await modelsRes.json();
    const collectionsPayload = await collectionsRes.json();
    const models = Array.isArray(modelsPayload.models) ? modelsPayload.models : [];
    const collections = Array.isArray(collectionsPayload.collections)
      ? collectionsPayload.collections
      : [];
    const providersPayload = await providersRes.json();
    const providers = Array.isArray(providersPayload.providers)
      ? providersPayload.providers
      : [];
    state.models = models;
    state.collections = collections;
    state.chatProviders = providers;
    const storedModel = localStorage.getItem("selectedModel");
    const storedCollection = localStorage.getItem("selectedCollection");
    const storedChatProvider = localStorage.getItem("selectedChatProvider");
    const defaultModel = modelsPayload.default_model || "";
    const defaultCollection = collectionsPayload.default_collection || "";
    const defaultChatProvider = providersPayload.default_provider || "";
    fillSelect(
      elements.modelSelect,
      models,
      storedModel || defaultModel
    );
    fillSelect(
      elements.collectionSelect,
      collections,
      storedCollection || defaultCollection
    );
    const providerId = fillProviderSelect(
      elements.chatProviderSelect,
      providers,
      storedChatProvider || defaultChatProvider
    );
    state.selectedChatProvider = providerId;
    if (providerId) {
      localStorage.setItem("selectedChatProvider", providerId);
    }
    updateChatModelSelect(providerId);
    addLog(
      `Loaded ${models.length} models, ${collections.length} collections, ${providers.length} chat providers.`
    );
  } catch (err) {
    setStatus("Could not load models, collections, or chat providers.");
    addLog("Failed to load models, collections, or chat providers.");
  }
}

async function askQuestion() {
  const question = elements.questionInput.value.trim();
  if (!question) {
    setStatus("Please enter a question.");
    return;
  }
  const topK = Math.max(1, Number(elements.topKInput.value || DEFAULT_TOP_K));
  const threshold = Math.max(
    0,
    Math.min(1, Number(elements.thresholdInput.value || DEFAULT_THRESHOLD))
  );
  const searchMode = elements.searchModeSelect.value || DEFAULT_SEARCH_MODE;
  const model = elements.modelSelect.value;
  const collection = elements.collectionSelect.value;
  const chatProvider = elements.chatProviderSelect.value;
  const chatModel = elements.chatModelSelect.value;
  localStorage.setItem("topK", String(topK));
  localStorage.setItem("threshold", String(threshold));
  localStorage.setItem("searchMode", searchMode);
  if (model) {
    localStorage.setItem("selectedModel", model);
  }
  if (collection) {
    localStorage.setItem("selectedCollection", collection);
  }
  if (chatProvider) {
    localStorage.setItem("selectedChatProvider", chatProvider);
  }
  if (chatModel && chatProvider) {
    localStorage.setItem(`selectedChatModel:${chatProvider}`, chatModel);
    localStorage.setItem("selectedChatModel", chatModel);
  }
  setLoadingState(true);
  setLoadingMessage(
    "Generating answer",
    "Searching Qdrant and grounding the response."
  );
  setStatus("Searching and generating answer...");
  addLog(
    `Ask: mode=${searchMode} model=${model || "-"} chat_provider=${chatProvider || "-"} chat_model=${chatModel || "-"} collection=${collection || "-"} topK=${topK} threshold=${threshold.toFixed(
      2
    )}`
  );
  try {
    const response = await fetch("/api/ask", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        question,
        topK,
        threshold,
        model,
        collection,
        search_mode: searchMode,
        chat_provider: chatProvider,
        chat_model: chatModel,
      }),
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || "Request failed.");
    }
    const durationMs = payload.durations ? payload.durations.total_ms : 0;
    state.selectedChatProvider = payload.answer_provider || chatProvider;
    setInitialAnswer(
      payload.question,
      payload.answer,
      payload.answer_model,
      durationMs,
      payload.matches
    );
    loadHistory();
    addLog(
      `Initial answer: matches=${payload.matches.length} duration=${formatDuration(
        durationMs
      )}`
    );
    setStatus("Ready.");
  } catch (err) {
    setStatus(err.message || "Something went wrong.");
    addLog(`Ask error: ${err.message || "request failed"}`);
  } finally {
    setLoadingState(false);
  }
}

async function refineQuestion() {
  const feedbackIncorrect = elements.feedbackIncorrect.value.trim();
  const feedbackMissing = elements.feedbackMissing.value.trim();
  if (!state.question) {
    setStatus("Ask a question first.");
    return;
  }
  if (!feedbackIncorrect && !feedbackMissing) {
    elements.feedbackHint.textContent = "Add what is incorrect or what is missing to refine.";
    return;
  }
  elements.feedbackHint.textContent = "";
  const topK = Math.max(1, Number(elements.topKInput.value || DEFAULT_TOP_K));
  const threshold = Math.max(
    0,
    Math.min(1, Number(elements.thresholdInput.value || DEFAULT_THRESHOLD))
  );
  const searchMode = elements.searchModeSelect.value || DEFAULT_SEARCH_MODE;
  const model = elements.modelSelect.value;
  const collection = elements.collectionSelect.value;
  const chatProvider = elements.chatProviderSelect.value;
  const chatModel = elements.chatModelSelect.value;
  setLoadingState(true);
  setLoadingMessage(
    "Refining answer",
    "Reframing the question and searching again."
  );
  setStatus("Reframing and searching...");
  addLog(
    `Refine: mode=${searchMode} model=${model || "-"} chat_provider=${chatProvider || "-"} chat_model=${chatModel || "-"} collection=${collection || "-"} topK=${topK} threshold=${threshold.toFixed(
      2
    )} incorrect=${feedbackIncorrect ? "yes" : "no"} missing=${feedbackMissing ? "yes" : "no"}`
  );
  try {
    const response = await fetch("/api/reframe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        question: state.question,
        feedback_incorrect: feedbackIncorrect,
        feedback_missing: feedbackMissing,
        topK,
        threshold,
        model,
        collection,
        search_mode: searchMode,
        chat_provider: chatProvider,
        chat_model: chatModel,
      }),
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || "Request failed.");
    }
    const durationMs = payload.durations ? payload.durations.total_ms : 0;
    state.selectedChatProvider = payload.answer_provider || chatProvider;
    setRefinedAnswer(
      payload.reframed_question,
      payload.answer,
      payload.answer_model,
      durationMs,
      payload.matches
    );
    loadHistory();
    addLog(`Reframed question: ${payload.reframed_question}`);
    addLog(
      `Refined answer: matches=${payload.matches.length} duration=${formatDuration(
        durationMs
      )}`
    );
    setStatus("Ready.");
  } catch (err) {
    setStatus(err.message || "Something went wrong.");
    addLog(`Refine error: ${err.message || "request failed"}`);
  } finally {
    setLoadingState(false);
  }
}

function syncThreshold(value) {
  const clamped = Math.max(0, Math.min(1, Number(value) || 0));
  elements.thresholdRange.value = clamped;
  elements.thresholdInput.value = clamped.toFixed(2);
}

function init() {
  const storedTopK = Number(localStorage.getItem("topK") || DEFAULT_TOP_K);
  const storedThreshold = Number(
    localStorage.getItem("threshold") || DEFAULT_THRESHOLD
  );
  const storedSearchMode = localStorage.getItem("searchMode") || DEFAULT_SEARCH_MODE;
  elements.topKInput.value = storedTopK;
  syncThreshold(storedThreshold);
  if (storedSearchMode) {
    elements.searchModeSelect.value = storedSearchMode;
  }
  elements.questionInput.value = "";
  elements.initialAnswerBody.innerHTML = "Ask a question to see a grounded answer.";
  elements.refinedAnswerBody.innerHTML = "Provide feedback to generate a refined answer.";
  elements.reframedQuestion.textContent = "-";
  elements.initialTime.textContent = "00:00";
  elements.refinedTime.textContent = "00:00";
  elements.totalTime.textContent = "00:00";
  elements.initialModel.textContent = "Model: -";
  elements.refinedModel.textContent = "Model: -";
  elements.answerModel.textContent = "Model: -";
  elements.copyAnswer.disabled = true;
  elements.copyAnswer.dataset.copyText = "";
  elements.refineButton.disabled = true;
  loadSelectOptions();
  addLog("UI ready.");
  elements.chunkFilter.addEventListener("input", () => updateChunkList());
  elements.feedbackIncorrect.addEventListener("input", () => updateRefineButtonState());
  elements.feedbackMissing.addEventListener("input", () => updateRefineButtonState());
  elements.askButton.addEventListener("click", () => askQuestion());
  elements.questionInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      askQuestion();
    }
  });
  elements.clearButton.addEventListener("click", () => {
    elements.questionInput.value = "";
    state.question = "";
    elements.feedbackIncorrect.value = "";
    elements.feedbackMissing.value = "";
    elements.feedbackHint.textContent = "";
    elements.initialAnswerBody.innerHTML = "Ask a question to see a grounded answer.";
    elements.refinedAnswerBody.innerHTML = "Provide feedback to generate a refined answer.";
    elements.reframedQuestion.textContent = "-";
    elements.initialTime.textContent = "00:00";
    elements.refinedTime.textContent = "00:00";
    elements.totalTime.textContent = "00:00";
    elements.initialModel.textContent = "Model: -";
    elements.refinedModel.textContent = "Model: -";
    elements.answerModel.textContent = "Model: -";
    elements.copyAnswer.disabled = true;
    elements.copyAnswer.dataset.copyText = "";
    state.initialMatches = [];
    state.refinedMatches = [];
    state.chunkSource = "initial";
    elements.chunkSourceSelect.value = "initial";
    elements.chunkSourceSelect.options[1].disabled = true;
    updateChunkList();
    updateRefineButtonState();
    setStatus("Cleared.");
  });
  elements.thresholdRange.addEventListener("input", (event) =>
    syncThreshold(event.target.value)
  );
  elements.thresholdInput.addEventListener("change", (event) =>
    syncThreshold(event.target.value)
  );
  elements.searchModeSelect.addEventListener("change", () => {
    const searchMode = elements.searchModeSelect.value || DEFAULT_SEARCH_MODE;
    localStorage.setItem("searchMode", searchMode);
  });
  elements.chunkSourceSelect.addEventListener("change", (event) => {
    state.chunkSource = event.target.value;
    updateChunkList();
  });
  elements.refineButton.addEventListener("click", () => refineQuestion());
  elements.modelSelect.addEventListener("change", () => {
    const model = elements.modelSelect.value;
    if (model) {
      localStorage.setItem("selectedModel", model);
    }
  });
  elements.chatProviderSelect.addEventListener("change", () => {
    const providerId = elements.chatProviderSelect.value;
    state.selectedChatProvider = providerId;
    if (providerId) {
      localStorage.setItem("selectedChatProvider", providerId);
    }
    updateChatModelSelect(providerId);
  });
  elements.chatModelSelect.addEventListener("change", () => {
    const chatModel = elements.chatModelSelect.value;
    const providerId = elements.chatProviderSelect.value;
    if (chatModel && providerId) {
      localStorage.setItem(`selectedChatModel:${providerId}`, chatModel);
    }
  });
  elements.collectionSelect.addEventListener("change", () => {
    const collection = elements.collectionSelect.value;
    if (collection) {
      localStorage.setItem("selectedCollection", collection);
    }
  });
  elements.toggleChunks.addEventListener("click", () => {
    state.chunksVisible = !state.chunksVisible;
    elements.chunksContent.style.display = state.chunksVisible ? "grid" : "none";
    elements.toggleChunks.textContent = state.chunksVisible
      ? "Hide chunks"
      : "Show chunks";
  });
  elements.copyAnswer.addEventListener("click", async () => {
    const text = elements.copyAnswer.dataset.copyText || "";
    if (!text) {
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      setStatus("Answer copied.");
    } catch (err) {
      setStatus("Copy failed.");
    }
  });
  elements.copyChunk.addEventListener("click", async () => {
    const text = elements.copyChunk.dataset.copyText || "";
    if (!text) {
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      setStatus("Chunk copied.");
    } catch (err) {
      setStatus("Copy failed.");
    }
  });

  elements.clearLogs.addEventListener("click", () => {
    state.logs = [];
    elements.logView.textContent = "";
    addLog("Logs cleared.");
  });

  if (elements.compareButton) {
    elements.compareButton.addEventListener("click", () => compareEmbeddings());
  }
  if (elements.compareClear) {
    elements.compareClear.addEventListener("click", () => {
      if (elements.compareQuestionInput) {
        elements.compareQuestionInput.value = "";
      }
      if (elements.compareStatus) {
        elements.compareStatus.textContent = "Idle";
      }
      renderCompareResults({
        overlap: [],
        only_lora: [],
        only_ollama: [],
        lora: { matches: [] },
        ollama: { matches: [] },
        stats: {},
      });
    });
  }

  updateRefineButtonState();
}

init();
