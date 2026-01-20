const elements = {
  status: document.getElementById("status"),
  historyLimit: document.getElementById("historyLimit"),
  historySearch: document.getElementById("historySearch"),
  historyType: document.getElementById("historyType"),
  historyMode: document.getElementById("historyMode"),
  historyModel: document.getElementById("historyModel"),
  historyCollection: document.getElementById("historyCollection"),
  historySort: document.getElementById("historySort"),
  clearFilters: document.getElementById("clearFilters"),
  historyShown: document.getElementById("historyShown"),
  historyTotal: document.getElementById("historyTotal"),
  insightTimestamp: document.getElementById("insightTimestamp"),
  insightTotal: document.getElementById("insightTotal"),
  insightAskReframe: document.getElementById("insightAskReframe"),
  insightModes: document.getElementById("insightModes"),
  insightModesSub: document.getElementById("insightModesSub"),
  insightAvgMatches: document.getElementById("insightAvgMatches"),
  insightMedianMatches: document.getElementById("insightMedianMatches"),
  insightAvgRetrieval: document.getElementById("insightAvgRetrieval"),
  insightP95Retrieval: document.getElementById("insightP95Retrieval"),
  insightAvgTotal: document.getElementById("insightAvgTotal"),
  insightP95Total: document.getElementById("insightP95Total"),
  insightFeedback: document.getElementById("insightFeedback"),
  insightFeedbackSub: document.getElementById("insightFeedbackSub"),
  insightCollections: document.getElementById("insightCollections"),
  insightModels: document.getElementById("insightModels"),
  insightLatency: document.getElementById("insightLatency"),
  insightMatches: document.getElementById("insightMatches"),
  refreshHistory: document.getElementById("refreshHistory"),
  historyList: document.getElementById("historyList"),
  historyMeta: document.getElementById("historyMeta"),
  historyChips: document.getElementById("historyChips"),
  historyQuestion: document.getElementById("historyQuestion"),
  historyQuery: document.getElementById("historyQuery"),
  historyReframed: document.getElementById("historyReframed"),
  historyFeedback: document.getElementById("historyFeedback"),
  historyAnswer: document.getElementById("historyAnswer"),
  historyMatchFilter: document.getElementById("historyMatchFilter"),
  historyMatches: document.getElementById("historyMatches"),
  copyAnswer: document.getElementById("copyAnswer"),
};

const DEFAULT_HISTORY_LIMIT = 200;

const state = {
  records: [],
  filtered: [],
  selectedIndex: null,
};

function setStatus(message) {
  elements.status.textContent = message;
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
  formatted = formatted.replace(
    /\[(.+?)\]\((https?:\/\/[^)]+)\)/g,
    (match, label, url) =>
      `<a href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>`
  );
  formatted = formatted.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  formatted = formatted.replace(/__([^_]+)__/g, "<strong>$1</strong>");
  formatted = formatted.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  formatted = formatted.replace(/@@CODE(\d+)@@/g, (match, index) => {
    const code = codeTokens[Number(index)] || "";
    return `<code>${code}</code>`;
  });
  return formatted;
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

function formatDuration(ms) {
  if (!Number.isFinite(ms)) {
    return "-";
  }
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function scoreToColor(score) {
  const clamped = Math.max(0, Math.min(1, score));
  const hue = Math.round(120 * clamped);
  return `hsl(${hue}, 55%, 42%)`;
}

function formatDurationMs(ms) {
  if (!Number.isFinite(ms)) {
    return "-";
  }
  return `${formatDuration(ms)} (${Math.round(ms)} ms)`;
}

function formatNumber(value) {
  if (!Number.isFinite(value)) {
    return "0";
  }
  return value.toLocaleString("en-US");
}

function average(values) {
  if (!values.length) {
    return 0;
  }
  const total = values.reduce((sum, value) => sum + value, 0);
  return total / values.length;
}

function percentile(values, pct) {
  if (!values.length) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil(pct * sorted.length) - 1);
  return sorted[index];
}

function median(values) {
  if (!values.length) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}

function getTextValue(record, field) {
  const value = record[field];
  return value ? String(value) : "";
}

function buildFilterOptions(records, key, select, label) {
  const values = new Set();
  records.forEach((record) => {
    const value = getTextValue(record, key);
    if (value) {
      values.add(value);
    }
  });
  const sorted = Array.from(values).sort();
  select.innerHTML = "";
  const optionAll = document.createElement("option");
  optionAll.value = "all";
  optionAll.textContent = label;
  select.appendChild(optionAll);
  sorted.forEach((value) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    select.appendChild(option);
  });
}

function buildInsightList(container, data) {
  container.innerHTML = "";
  if (!data.length) {
    const empty = document.createElement("div");
    empty.className = "history-empty";
    empty.textContent = "No data.";
    container.appendChild(empty);
    return;
  }
  const maxValue = Math.max(...data.map((item) => item.count));
  data.forEach((item) => {
    const row = document.createElement("div");
    row.className = "insight-row";
    const label = document.createElement("div");
    label.className = "insight-row-label";
    label.textContent = item.label;
    const barWrap = document.createElement("div");
    barWrap.className = "insight-row-bar";
    const bar = document.createElement("div");
    bar.className = "insight-row-fill";
    const width = maxValue ? (item.count / maxValue) * 100 : 0;
    bar.style.width = `${width}%`;
    barWrap.appendChild(bar);
    const value = document.createElement("div");
    value.className = "insight-row-value";
    value.textContent = formatNumber(item.count);
    row.appendChild(label);
    row.appendChild(barWrap);
    row.appendChild(value);
    container.appendChild(row);
  });
}

function buildInsightBars(container, buckets) {
  container.innerHTML = "";
  const maxValue = Math.max(...buckets.map((item) => item.count), 1);
  buckets.forEach((bucket) => {
    const row = document.createElement("div");
    row.className = "insight-bar-row";
    const label = document.createElement("div");
    label.className = "insight-bar-label";
    label.textContent = bucket.label;
    const barWrap = document.createElement("div");
    barWrap.className = "insight-bar-track";
    const bar = document.createElement("div");
    bar.className = "insight-bar-fill";
    bar.style.width = `${(bucket.count / maxValue) * 100}%`;
    barWrap.appendChild(bar);
    const value = document.createElement("div");
    value.className = "insight-bar-value";
    value.textContent = formatNumber(bucket.count);
    row.appendChild(label);
    row.appendChild(barWrap);
    row.appendChild(value);
    container.appendChild(row);
  });
}

function buildInsights(records) {
  const total = records.length;
  const askCount = records.filter((r) => r.type === "ask").length;
  const reframeCount = records.filter((r) => r.type === "reframe").length;
  const denseCount = records.filter((r) => {
    const mode = r.search_mode || (r.search && r.search.mode);
    return mode === "dense";
  }).length;
  const hybridCount = records.filter((r) => {
    const mode = r.search_mode || (r.search && r.search.mode);
    return mode === "hybrid";
  }).length;
  const matchCounts = records.map((r) =>
    Array.isArray(r.matches) ? r.matches.length : 0
  );
  const retrievalTimes = records
    .map((r) => (r.durations ? r.durations.retrieval_ms : null))
    .filter((v) => Number.isFinite(v));
  const totalTimes = records
    .map((r) => (r.durations ? r.durations.total_ms : null))
    .filter((v) => Number.isFinite(v));
  const feedbackCount = records.filter((r) => {
    const feedback = r.feedback || {};
    return Boolean(feedback.incorrect || feedback.missing);
  }).length;

  elements.insightTotal.textContent = formatNumber(total);
  elements.insightAskReframe.textContent = `Ask: ${formatNumber(
    askCount
  )} | Reframe: ${formatNumber(reframeCount)}`;
  elements.insightModes.textContent = `Dense ${formatNumber(denseCount)}`;
  elements.insightModesSub.textContent = `Hybrid ${formatNumber(hybridCount)}`;
  elements.insightAvgMatches.textContent = `${formatNumber(
    Math.round(average(matchCounts))
  )} avg`;
  elements.insightMedianMatches.textContent = `${formatNumber(
    Math.round(median(matchCounts))
  )} median`;
  elements.insightAvgRetrieval.textContent = formatDuration(
    average(retrievalTimes)
  );
  elements.insightP95Retrieval.textContent = `P95 ${formatDuration(
    percentile(retrievalTimes, 0.95)
  )}`;
  elements.insightAvgTotal.textContent = formatDuration(average(totalTimes));
  elements.insightP95Total.textContent = `P95 ${formatDuration(
    percentile(totalTimes, 0.95)
  )}`;
  const feedbackPct = total ? Math.round((feedbackCount / total) * 100) : 0;
  elements.insightFeedback.textContent = `${feedbackPct}%`;
  elements.insightFeedbackSub.textContent = `${formatNumber(
    feedbackCount
  )} with feedback`;
  elements.insightTimestamp.textContent = `Updated ${formatTimestamp(
    new Date().toISOString()
  )}`;

  const collectionCounts = {};
  const modelCounts = {};
  records.forEach((record) => {
    if (record.collection) {
      collectionCounts[record.collection] =
        (collectionCounts[record.collection] || 0) + 1;
    }
    if (record.model) {
      modelCounts[record.model] = (modelCounts[record.model] || 0) + 1;
    }
  });
  const topCollections = Object.entries(collectionCounts)
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 6);
  const topModels = Object.entries(modelCounts)
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 6);
  buildInsightList(elements.insightCollections, topCollections);
  buildInsightList(elements.insightModels, topModels);

  const latencyBuckets = [
    { label: "0-5s", max: 5000 },
    { label: "5-10s", max: 10000 },
    { label: "10-20s", max: 20000 },
    { label: "20-40s", max: 40000 },
    { label: "40s+", max: Infinity },
  ].map((bucket) => ({ ...bucket, count: 0 }));
  totalTimes.forEach((value) => {
    const bucket = latencyBuckets.find((b) => value <= b.max);
    if (bucket) {
      bucket.count += 1;
    }
  });
  buildInsightBars(elements.insightLatency, latencyBuckets);

  const matchBuckets = [
    { label: "0", max: 0 },
    { label: "1-10", max: 10 },
    { label: "11-50", max: 50 },
    { label: "51-100", max: 100 },
    { label: "101-200", max: 200 },
    { label: "200+", max: Infinity },
  ].map((bucket) => ({ ...bucket, count: 0 }));
  matchCounts.forEach((value) => {
    const bucket = matchBuckets.find((b) => value <= b.max);
    if (bucket) {
      bucket.count += 1;
    }
  });
  buildInsightBars(elements.insightMatches, matchBuckets);
}

function applyFilters() {
  const search = elements.historySearch.value.trim().toLowerCase();
  const type = elements.historyType.value;
  const mode = elements.historyMode.value;
  const model = elements.historyModel.value;
  const collection = elements.historyCollection.value;
  const sort = elements.historySort.value;
  localStorage.setItem("historySort", sort);

  state.filtered = state.records.filter((record) => {
    if (type !== "all" && record.type !== type) {
      return false;
    }
    const recordMode = record.search_mode || (record.search && record.search.mode);
    if (mode !== "all" && recordMode !== mode) {
      return false;
    }
    if (model !== "all" && record.model !== model) {
      return false;
    }
    if (collection !== "all" && record.collection !== collection) {
      return false;
    }
    if (search) {
      const haystack = [
        record.question,
        record.retrieval_query,
        record.reframed_question,
        record.answer,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      if (!haystack.includes(search)) {
        return false;
      }
    }
    return true;
  });

  const sorters = {
    time_desc: (a, b) => new Date(b.timestamp) - new Date(a.timestamp),
    time_asc: (a, b) => new Date(a.timestamp) - new Date(b.timestamp),
    total_desc: (a, b) =>
      (b.durations ? b.durations.total_ms || 0 : 0) -
      (a.durations ? a.durations.total_ms || 0 : 0),
    total_asc: (a, b) =>
      (a.durations ? a.durations.total_ms || 0 : 0) -
      (b.durations ? b.durations.total_ms || 0 : 0),
    matches_desc: (a, b) =>
      (Array.isArray(b.matches) ? b.matches.length : 0) -
      (Array.isArray(a.matches) ? a.matches.length : 0),
    matches_asc: (a, b) =>
      (Array.isArray(a.matches) ? a.matches.length : 0) -
      (Array.isArray(b.matches) ? b.matches.length : 0),
  };
  if (sorters[sort]) {
    state.filtered.sort(sorters[sort]);
  }

  elements.historyShown.textContent = String(state.filtered.length);
  renderHistoryList();
}

function renderHistoryList() {
  elements.historyList.innerHTML = "";
  if (!state.filtered.length) {
    const empty = document.createElement("div");
    empty.className = "history-empty";
    empty.textContent = "No history matches.";
    elements.historyList.appendChild(empty);
    state.selectedIndex = null;
    renderDetail(null);
    return;
  }
  if (state.selectedIndex === null || state.selectedIndex >= state.filtered.length) {
    state.selectedIndex = 0;
  }

  state.filtered.forEach((record, index) => {
    const item = document.createElement("div");
    item.className = "history-item";
    if (index === state.selectedIndex) {
      item.classList.add("active");
    }
    const title = document.createElement("div");
    title.className = "history-item-title";
    title.textContent =
      record.question || record.retrieval_query || record.reframed_question || "Untitled";
    const tags = document.createElement("div");
    tags.className = "history-item-tags";
    const tagValues = [
      record.type || "-",
      record.search_mode || "-",
      record.collection || "-",
      record.model || "-",
    ];
    tagValues.forEach((value) => {
      const tag = document.createElement("span");
      tag.className = "tag";
      tag.textContent = value;
      tags.appendChild(tag);
    });
    const meta = document.createElement("div");
    meta.className = "history-item-meta";
    const metaParts = [
      formatTimestamp(record.timestamp),
      record.type || "-",
      record.search_mode || "-",
      `${Array.isArray(record.matches) ? record.matches.length : 0} matches`,
      formatDuration(record.durations ? record.durations.total_ms : null),
    ];
    meta.textContent = metaParts.join(" | ");
    item.appendChild(title);
    item.appendChild(tags);
    item.appendChild(meta);
    item.addEventListener("click", () => {
      state.selectedIndex = index;
      elements.historyMatchFilter.value = "";
      renderHistoryList();
    });
    elements.historyList.appendChild(item);
  });
  renderDetail(state.filtered[state.selectedIndex]);
}

function renderMatches(record) {
  const matches = Array.isArray(record.matches) ? record.matches : [];
  const filter = elements.historyMatchFilter.value.trim().toLowerCase();
  const filtered = filter
    ? matches.filter((match) =>
        String(match.action_point || "").toLowerCase().includes(filter)
      )
    : matches;

  elements.historyMatches.innerHTML = "";
  if (!filtered.length) {
    const empty = document.createElement("div");
    empty.className = "history-empty";
    empty.textContent = matches.length ? "No matches found." : "No matches in record.";
    elements.historyMatches.appendChild(empty);
    return;
  }

  filtered.forEach((match) => {
    const row = document.createElement("div");
    row.className = "history-match";
    const score = document.createElement("div");
    score.className = "history-match-score";
    const scoreValue = Number(match.score || 0);
    score.textContent = scoreValue.toFixed(4);
    score.style.background = scoreToColor(scoreValue);
    score.style.color = "#fff";
    const body = document.createElement("div");
    body.className = "history-match-body";
    const text = document.createElement("div");
    text.className = "history-match-text";
    text.textContent = match.action_point || "";
    const meta = document.createElement("div");
    meta.className = "history-match-meta";
    const id = match.action_id ? `id ${match.action_id}` : "id -";
    meta.textContent = id;
    body.appendChild(text);
    body.appendChild(meta);
    row.appendChild(score);
    row.appendChild(body);
    elements.historyMatches.appendChild(row);
  });
}

function renderDetail(record) {
  if (!record) {
    elements.historyMeta.textContent = "No record selected.";
    elements.historyChips.textContent = "";
    elements.historyQuestion.textContent = "-";
    elements.historyQuery.textContent = "-";
    elements.historyReframed.textContent = "-";
    elements.historyFeedback.textContent = "-";
    elements.historyAnswer.innerHTML = "-";
    elements.historyMatches.innerHTML = "";
    elements.copyAnswer.disabled = true;
    elements.copyAnswer.dataset.copyText = "";
    return;
  }
  const durations = record.durations || {};
  const meta = [
    `Time: ${formatTimestamp(record.timestamp)}`,
    `Total: ${formatDurationMs(durations.total_ms)}`,
    `Retrieval: ${formatDurationMs(durations.retrieval_ms)}`,
    durations.reframe_ms !== undefined
      ? `Reframe: ${formatDurationMs(durations.reframe_ms)}`
      : null,
  ].filter(Boolean);
  elements.historyMeta.textContent = meta.join(" | ");
  const chips = [
    `Type: ${record.type || "-"}`,
    `Mode: ${record.search_mode || "-"}`,
    `Collection: ${record.collection || "-"}`,
    `Model: ${record.model || "-"}`,
    `Answer model: ${record.answer_model || "-"}`,
    `Matches: ${formatNumber(Array.isArray(record.matches) ? record.matches.length : 0)}`,
  ];
  elements.historyChips.innerHTML = "";
  chips.forEach((text) => {
    const chip = document.createElement("span");
    chip.className = "tag tag-strong";
    chip.textContent = text;
    elements.historyChips.appendChild(chip);
  });
  elements.historyQuestion.textContent = record.question || "-";
  elements.historyQuery.textContent =
    record.retrieval_query || record.reframed_question || record.question || "-";
  elements.historyReframed.textContent = record.reframed_question || "-";
  const feedback = record.feedback || {};
  const feedbackParts = [];
  if (feedback.incorrect) {
    feedbackParts.push(`Incorrect: ${feedback.incorrect}`);
  }
  if (feedback.missing) {
    feedbackParts.push(`Missing: ${feedback.missing}`);
  }
  elements.historyFeedback.textContent = feedbackParts.length ? feedbackParts.join(" | ") : "-";
  elements.historyAnswer.innerHTML = renderMarkdown(record.answer || "No answer.");
  elements.copyAnswer.disabled = !record.answer;
  elements.copyAnswer.dataset.copyText = record.answer || "";
  renderMatches(record);
}

async function loadHistory() {
  const limit = Math.max(
    1,
    Number(elements.historyLimit.value || DEFAULT_HISTORY_LIMIT)
  );
  localStorage.setItem("historyLimit", String(limit));
  setStatus("Loading history...");
  try {
    const currentModel = elements.historyModel.value || "all";
    const currentCollection = elements.historyCollection.value || "all";
    const response = await fetch(`/api/history?limit=${limit}`);
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || "Failed to load history.");
    }
    state.records = Array.isArray(payload.items) ? payload.items : [];
    elements.historyTotal.textContent = String(payload.total || state.records.length);
    buildFilterOptions(state.records, "model", elements.historyModel, "All models");
    buildFilterOptions(
      state.records,
      "collection",
      elements.historyCollection,
      "All collections"
    );
    if (currentModel && Array.from(elements.historyModel.options).some((o) => o.value === currentModel)) {
      elements.historyModel.value = currentModel;
    }
    if (
      currentCollection &&
      Array.from(elements.historyCollection.options).some((o) => o.value === currentCollection)
    ) {
      elements.historyCollection.value = currentCollection;
    }
    state.selectedIndex = null;
    buildInsights(state.records);
    applyFilters();
    setStatus(`Loaded ${state.records.length} records.`);
  } catch (err) {
    elements.historyList.innerHTML = "";
    const empty = document.createElement("div");
    empty.className = "history-empty";
    empty.textContent = "Failed to load history.";
    elements.historyList.appendChild(empty);
    elements.historyTotal.textContent = "0";
    elements.historyShown.textContent = "0";
    renderDetail(null);
    setStatus(err.message || "History error.");
  }
}

function init() {
  const storedLimit = Number(
    localStorage.getItem("historyLimit") || DEFAULT_HISTORY_LIMIT
  );
  const storedSort = localStorage.getItem("historySort") || "time_desc";
  elements.historyLimit.value = storedLimit;
  elements.historySort.value = storedSort;
  loadHistory();
  elements.refreshHistory.addEventListener("click", () => loadHistory());
  elements.historyLimit.addEventListener("change", () => loadHistory());
  elements.historySearch.addEventListener("input", () => applyFilters());
  elements.historyType.addEventListener("change", () => applyFilters());
  elements.historyMode.addEventListener("change", () => applyFilters());
  elements.historyModel.addEventListener("change", () => applyFilters());
  elements.historyCollection.addEventListener("change", () => applyFilters());
  elements.historySort.addEventListener("change", () => applyFilters());
  elements.clearFilters.addEventListener("click", () => {
    elements.historySearch.value = "";
    elements.historyType.value = "all";
    elements.historyMode.value = "all";
    elements.historyModel.value = "all";
    elements.historyCollection.value = "all";
    elements.historySort.value = "time_desc";
    applyFilters();
  });
  elements.historyMatchFilter.addEventListener("input", () => {
    const record =
      state.selectedIndex !== null ? state.filtered[state.selectedIndex] : null;
    if (record) {
      renderMatches(record);
    }
  });
  elements.copyAnswer.addEventListener("click", async () => {
    const text = elements.copyAnswer.dataset.copyText || "";
    if (!text) {
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      setStatus("Copied answer to clipboard.");
    } catch (err) {
      setStatus("Copy failed.");
    }
  });
}

init();
