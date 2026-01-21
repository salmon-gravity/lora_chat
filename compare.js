const elements = {
  status: document.getElementById("status"),
  compareLimit: document.getElementById("compareLimit"),
  compareSearch: document.getElementById("compareSearch"),
  compareType: document.getElementById("compareType"),
  compareMode: document.getElementById("compareMode"),
  compareCollection: document.getElementById("compareCollection"),
  compareAnswerModel: document.getElementById("compareAnswerModel"),
  compareSort: document.getElementById("compareSort"),
  refreshCompare: document.getElementById("refreshCompare"),
  compareShown: document.getElementById("compareShown"),
  compareTotal: document.getElementById("compareTotal"),
  compareList: document.getElementById("compareList"),
  compareMeta: document.getElementById("compareMeta"),
  compareSelectedCount: document.getElementById("compareSelectedCount"),
  compareAnalysisCoverage: document.getElementById("compareAnalysisCoverage"),
  compareAvgRelevance: document.getElementById("compareAvgRelevance"),
  compareAvgMatches: document.getElementById("compareAvgMatches"),
  compareAvgAnswerLength: document.getElementById("compareAvgAnswerLength"),
  compareAvgTotalTime: document.getElementById("compareAvgTotalTime"),
  compareTotalsMeta: document.getElementById("compareTotalsMeta"),
  compareTotalsGrid: document.getElementById("compareTotalsGrid"),
  compareSelectedGrid: document.getElementById("compareSelectedGrid"),
  compareAnswerMeta: document.getElementById("compareAnswerMeta"),
  compareDistributionMeta: document.getElementById("compareDistributionMeta"),
  compareDistributionGrid: document.getElementById("compareDistributionGrid"),
  compareDistributionThresholds: document.getElementById("compareDistributionThresholds"),
  compareAnswerGrid: document.getElementById("compareAnswerGrid"),
  selectFiltered: document.getElementById("selectFiltered"),
  clearSelection: document.getElementById("clearSelection"),
};

const DEFAULT_COMPARE_LIMIT = 200;

const state = {
  records: [],
  filtered: [],
  selectedIds: new Set(),
  analysisCache: {},
  analysisLoading: new Set(),
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

function countWords(text) {
  const tokens = String(text || "").trim().match(/\S+/g);
  return tokens ? tokens.length : 0;
}

function getRecordId(record) {
  return record.record_id || record.id || record.request_id || "";
}

function recordTitle(record) {
  return (
    record.question ||
    record.retrieval_query ||
    record.reframed_question ||
    "Untitled request"
  );
}

function getRecordMode(record) {
  const raw = record.search_mode || (record.search && record.search.mode) || "";
  return String(raw || "").trim();
}

function getRecordCollection(record) {
  const raw =
    record.collection ||
    (record.config && record.config.collection) ||
    (record.config && record.config.search ? record.config.search.collection : "") ||
    "";
  return String(raw || "").trim();
}

function getRecordEmbeddingModel(record) {
  const raw =
    record.model ||
    (record.config && record.config.embedding
      ? record.config.embedding.lora_model || record.config.embedding.model
      : "") ||
    "";
  return String(raw || "").trim();
}

function buildFilterOptions(records, key, select, label) {
  const values = new Set();
  records.forEach((record) => {
    const value = record[key];
    if (value) {
      values.add(String(value));
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

function loadStoredSelection() {
  const raw = localStorage.getItem("compareSelectedIds");
  if (!raw) {
    return;
  }
  try {
    const ids = JSON.parse(raw);
    if (!Array.isArray(ids)) {
      return;
    }
    ids.forEach((id) => {
      if (id) {
        state.selectedIds.add(String(id));
      }
    });
  } catch (err) {
    return;
  }
}

function persistSelection() {
  const ids = Array.from(state.selectedIds.values());
  localStorage.setItem("compareSelectedIds", JSON.stringify(ids));
}

function applyFilters() {
  const search = elements.compareSearch.value.trim().toLowerCase();
  const type = elements.compareType.value;
  const mode = elements.compareMode.value;
  const collection = elements.compareCollection.value;
  const answerModel = elements.compareAnswerModel.value;
  const sort = elements.compareSort.value;
  localStorage.setItem("compareSort", sort);

  state.filtered = state.records.filter((record) => {
    if (type !== "all" && record.type !== type) {
      return false;
    }
    const recordMode = getRecordMode(record);
    if (mode !== "all" && recordMode !== mode) {
      return false;
    }
    if (collection !== "all" && getRecordCollection(record) !== collection) {
      return false;
    }
    if (answerModel !== "all" && record.answer_model !== answerModel) {
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

  elements.compareShown.textContent = String(state.filtered.length);
  renderList();
  renderCompare();
}

function renderList() {
  elements.compareList.innerHTML = "";
  if (!state.filtered.length) {
    const empty = document.createElement("div");
    empty.className = "compare-empty";
    empty.textContent = "No questions found.";
    elements.compareList.appendChild(empty);
    return;
  }

  state.filtered.forEach((record) => {
    const recordId = getRecordId(record);
    const row = document.createElement("div");
    row.className = "compare-item";
    if (recordId && state.selectedIds.has(recordId)) {
      row.classList.add("active");
    }

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.className = "compare-select-box";
    checkbox.checked = Boolean(recordId && state.selectedIds.has(recordId));
    checkbox.addEventListener("click", (event) => {
      event.stopPropagation();
    });
    checkbox.addEventListener("change", () => {
      toggleSelection(recordId);
    });

    const content = document.createElement("div");
    content.className = "compare-item-content";
    const title = document.createElement("div");
    title.className = "compare-item-title";
    title.textContent = recordTitle(record);
    const meta = document.createElement("div");
    meta.className = "compare-item-meta";
    const parts = [
      formatTimestamp(record.timestamp),
      record.type || "-",
      getRecordMode(record) || "-",
      getRecordCollection(record) || "-",
    ];
    meta.textContent = parts.join(" | ");
    content.appendChild(title);
    content.appendChild(meta);

    row.appendChild(checkbox);
    row.appendChild(content);
    row.addEventListener("click", () => {
      toggleSelection(recordId);
    });
    elements.compareList.appendChild(row);
  });
}

function toggleSelection(recordId) {
  if (!recordId) {
    return;
  }
  if (state.selectedIds.has(recordId)) {
    state.selectedIds.delete(recordId);
  } else {
    state.selectedIds.add(recordId);
  }
  persistSelection();
  renderList();
  renderCompare();
}

function renderCompare() {
  const selectedRecords = state.records.filter((record) =>
    state.selectedIds.has(getRecordId(record))
  );
  if (!selectedRecords.length) {
    elements.compareMeta.textContent = "No questions selected.";
    elements.compareSelectedCount.textContent = "0";
    elements.compareAnalysisCoverage.textContent = "-";
    elements.compareAvgRelevance.textContent = "-";
    elements.compareAvgMatches.textContent = "-";
    elements.compareAvgAnswerLength.textContent = "-";
    elements.compareAvgTotalTime.textContent = "-";
    elements.compareTotalsMeta.textContent = "-";
    elements.compareTotalsGrid.innerHTML =
      "<div class=\"compare-empty\">Select questions to compare.</div>";
    elements.compareSelectedGrid.innerHTML =
      "<div class=\"compare-empty\">Select questions to compare.</div>";
    elements.compareDistributionMeta.textContent = "-";
    elements.compareDistributionGrid.innerHTML =
      "<div class=\"compare-empty\">Select questions to compare.</div>";
    elements.compareAnswerMeta.textContent = "-";
    elements.compareAnswerGrid.innerHTML =
      "<div class=\"compare-empty\">Select questions to compare.</div>";
    return;
  }

  elements.compareMeta.textContent = `${selectedRecords.length} questions selected`;
  elements.compareSelectedCount.textContent = formatNumber(selectedRecords.length);

  const relevanceRates = [];
  const matchesCounts = [];
  const answerLengths = [];
  const totalTimes = [];
  let analysisReady = 0;

  selectedRecords.forEach((record) => {
    const recordId = getRecordId(record);
    if (recordId) {
      ensureAnalysis(recordId);
    }
    const analysisEntry = recordId ? state.analysisCache[recordId] : null;
    if (analysisEntry && analysisEntry.status === "ready") {
      analysisReady += 1;
      const matchCount = Number(analysisEntry.data.match_count || 0);
      const relevantCount = Number(analysisEntry.data.relevant_count || 0);
      if (matchCount > 0) {
        relevanceRates.push(relevantCount / matchCount);
      }
      matchesCounts.push(matchCount);
    } else {
      const matchCount = Array.isArray(record.matches) ? record.matches.length : 0;
      matchesCounts.push(matchCount);
    }
    const answerWords = countWords(record.answer || "");
    if (answerWords) {
      answerLengths.push(answerWords);
    }
    if (record.durations && Number.isFinite(record.durations.total_ms)) {
      totalTimes.push(record.durations.total_ms);
    }
  });

  const coverage = `${analysisReady}/${selectedRecords.length}`;
  elements.compareAnalysisCoverage.textContent = coverage;
  elements.compareAvgRelevance.textContent = relevanceRates.length
    ? `${Math.round(average(relevanceRates) * 100)}%`
    : "-";
  elements.compareAvgMatches.textContent = matchesCounts.length
    ? formatNumber(Math.round(average(matchesCounts)))
    : "-";
  elements.compareAvgAnswerLength.textContent = answerLengths.length
    ? `${formatNumber(Math.round(average(answerLengths)))} words`
    : "-";
  elements.compareAvgTotalTime.textContent = totalTimes.length
    ? formatDuration(average(totalTimes))
    : "-";

  const distributionData = buildDistributionData(selectedRecords);
  renderDistribution(distributionData);
  renderTotalsComparison(selectedRecords, analysisReady);
  renderSelectedGrid(selectedRecords);
  renderSideBySide(selectedRecords);
}

function renderSelectedGrid(records) {
  elements.compareSelectedGrid.innerHTML = "";
  if (!records.length) {
    elements.compareSelectedGrid.innerHTML =
      "<div class=\"compare-empty\">Select questions to compare.</div>";
    return;
  }

  records.forEach((record) => {
    const card = document.createElement("div");
    card.className = "compare-selected-card";

    const title = document.createElement("div");
    title.className = "compare-selected-title";
    title.textContent = recordTitle(record);

    const meta = document.createElement("div");
    meta.className = "compare-selected-meta";
    const collection = getRecordCollection(record) || "-";
    const embedModel = getRecordEmbeddingModel(record) || "-";
    meta.textContent = `Embedding: ${embedModel} | Collection: ${collection}`;

    card.appendChild(title);
    card.appendChild(meta);
    elements.compareSelectedGrid.appendChild(card);
  });
}

function renderSideBySide(records) {
  const total = records.length;
  elements.compareAnswerMeta.textContent = `Selected: ${total}`;

  elements.compareAnswerGrid.innerHTML = "";

  records.forEach((record) => {
    const answerCard = document.createElement("div");
    answerCard.className = "compare-wide-card compare-wide-answer";
    const answerTitle = document.createElement("div");
    answerTitle.className = "compare-wide-title";
    answerTitle.textContent = recordTitle(record);
    const answerMeta = document.createElement("div");
    answerMeta.className = "compare-wide-sub";
    const collection = getRecordCollection(record) || "-";
    const embedModel = getRecordEmbeddingModel(record) || "-";
    const answerMetaLine = document.createElement("div");
    answerMetaLine.textContent = `Embedding: ${embedModel} | Collection: ${collection}`;
    const answerProviderLine = document.createElement("div");
    answerProviderLine.textContent = `Answer model: ${record.answer_model || "-"} | Provider: ${
      record.answer_provider || "-"
    }`;
    answerMeta.appendChild(answerMetaLine);
    answerMeta.appendChild(answerProviderLine);
    const answerBody = document.createElement("div");
    answerBody.className = "markdown compare-answer";
    answerBody.innerHTML = renderMarkdown(record.answer || "No answer.");
    answerCard.appendChild(answerTitle);
    answerCard.appendChild(answerMeta);
    answerCard.appendChild(answerBody);
    elements.compareAnswerGrid.appendChild(answerCard);
  });
}

function renderTotalsComparison(records, analysisReady) {
  const total = records.length;
  elements.compareTotalsMeta.textContent = `Coverage: ${analysisReady}/${total}`;
  elements.compareTotalsGrid.innerHTML = "";
  if (!records.length) {
    elements.compareTotalsGrid.innerHTML =
      "<div class=\"compare-empty\">Select questions to compare.</div>";
    return;
  }

  const columnTemplate = buildTotalsColumns(records.length);
  const stats = records.map((record) => {
    const recordId = getRecordId(record);
    const analysisEntry = recordId ? state.analysisCache[recordId] : null;
    if (!recordId) {
      return { record, status: "missing", message: "Missing id" };
    }
    if (!analysisEntry || analysisEntry.status === "loading") {
      return { record, status: "loading", message: "Loading..." };
    }
    if (analysisEntry.status === "missing") {
      return { record, status: "missing", message: "No analysis" };
    }
    if (analysisEntry.status === "error") {
      return { record, status: "error", message: analysisEntry.message || "Analysis error" };
    }
    const relevantCount = Number(analysisEntry.data.relevant_count || 0);
    const irrelevantCount = Number(analysisEntry.data.irrelevant_count || 0);
    const totalCount = relevantCount + irrelevantCount;
    const ratio = totalCount > 0 ? Math.round((relevantCount / totalCount) * 100) : null;
    return {
      record,
      status: "ready",
      relevantCount,
      irrelevantCount,
      ratio,
    };
  });

  const headerRow = document.createElement("div");
  headerRow.className = "compare-totals-row compare-totals-header";
  headerRow.style.gridTemplateColumns = columnTemplate;
  headerRow.appendChild(buildTotalsCell("Metric", "compare-totals-label"));
  stats.forEach((stat) => {
    const cell = buildTotalsCell(recordTitle(stat.record), "compare-totals-question");
    cell.title = recordTitle(stat.record);
    headerRow.appendChild(cell);
  });
  elements.compareTotalsGrid.appendChild(headerRow);

  const rows = [
    {
      label: "Relevant",
      value: (stat) => (stat.status === "ready" ? formatNumber(stat.relevantCount) : stat.message),
    },
    {
      label: "Irrelevant",
      value: (stat) => (stat.status === "ready" ? formatNumber(stat.irrelevantCount) : stat.message),
    },
    {
      label: "Ratio",
      value: (stat) =>
        stat.status === "ready"
          ? stat.ratio !== null
            ? `${stat.ratio}%`
            : "-"
          : stat.message,
    },
  ];

  rows.forEach((rowDef) => {
    const row = document.createElement("div");
    row.className = "compare-totals-row";
    row.style.gridTemplateColumns = columnTemplate;
    row.appendChild(buildTotalsCell(rowDef.label, "compare-totals-label"));
    stats.forEach((stat) => {
      row.appendChild(buildTotalsCell(rowDef.value(stat), "compare-totals-value"));
    });
    elements.compareTotalsGrid.appendChild(row);
  });
}

function buildTotalsColumns(recordCount) {
  const columns = ["minmax(140px, 180px)"];
  for (let i = 0; i < recordCount; i += 1) {
    columns.push("minmax(200px, 1fr)");
  }
  return columns.join(" ");
}

function buildTotalsCell(text, className) {
  const cell = document.createElement("div");
  cell.className = `compare-totals-cell ${className}`;
  cell.textContent = text;
  return cell;
}

function buildDistributionData(records) {
  const entries = [];
  const rangeMap = new Map();
  let withAnalysis = 0;

  records.forEach((record) => {
    const recordId = getRecordId(record);
    const analysisEntry = recordId ? state.analysisCache[recordId] : null;
    const groups =
      analysisEntry && analysisEntry.status === "ready" && Array.isArray(analysisEntry.data.groups)
        ? analysisEntry.data.groups
        : [];

    const hasAnalysis = Boolean(analysisEntry && analysisEntry.status === "ready");
    if (hasAnalysis) {
      withAnalysis += 1;
    }

    const groupMap = {};
    let totalRelevant = 0;
    groups.forEach((group) => {
      const start = Number.isFinite(group.start_index) ? group.start_index : 0;
      const end = Number.isFinite(group.end_index) ? group.end_index : start;
      const key = `${start}-${end}`;
      groupMap[key] = group;
      totalRelevant += Number(group.relevant_count || 0);
      if (!rangeMap.has(key)) {
        rangeMap.set(key, { key, start, end });
      }
    });

    entries.push({ record, groupMap, hasAnalysis, totalRelevant });
  });

  const ranges = Array.from(rangeMap.values()).sort((a, b) => {
    if (a.start !== b.start) {
      return a.start - b.start;
    }
    return a.end - b.end;
  });

  return {
    entries,
    ranges,
    withAnalysis,
    total: records.length,
  };
}

function renderDistribution(data) {
  elements.compareDistributionGrid.innerHTML = "";
  const entries = data.entries;
  const ranges = data.ranges;
  if (!entries.length) {
    elements.compareDistributionMeta.textContent = "-";
    elements.compareDistributionThresholds.innerHTML = "";
    elements.compareDistributionGrid.innerHTML =
      "<div class=\"compare-empty\">Select questions to compare.</div>";
    return;
  }

  if (!ranges.length) {
    elements.compareDistributionMeta.textContent =
      `Buckets: 0 | With analysis: ${data.withAnalysis}/${data.total}`;
    elements.compareDistributionThresholds.innerHTML =
      "<div class=\"compare-empty\">No saved analysis breakdown for selected questions.</div>";
    elements.compareDistributionGrid.innerHTML =
      "<div class=\"compare-empty\">No saved analysis breakdown for selected questions.</div>";
    return;
  }

  const maxTotalRelevant = entries.reduce((maxValue, entry) => {
    const total = Number(entry.totalRelevant || 0);
    return total > maxValue ? total : maxValue;
  }, 0);

  const showSpread = entries.length > 1;
  elements.compareDistributionMeta.textContent =
    `Buckets: ${ranges.length} | With analysis: ${data.withAnalysis}/${data.total}`;

  renderDistributionThresholds(entries, ranges, maxTotalRelevant);

  const columnTemplate = buildDistributionColumns(entries.length, showSpread);
  appendDistributionHeader(
    elements.compareDistributionGrid,
    entries,
    showSpread,
    columnTemplate
  );

  const running = entries.map((entry) => ({
    relevant: 0,
    total: 0,
    hasAnalysis: entry.hasAnalysis,
  }));

  ranges.forEach((range) => {
    const row = document.createElement("div");
    row.className = "compare-distribution-row";
    row.style.gridTemplateColumns = columnTemplate;

    row.appendChild(buildRangeCell(range));

    const cumPercents = [];
    entries.forEach((entry, index) => {
      const group = entry.groupMap[range.key];

      const perCountCell = document.createElement("div");
      perCountCell.className = "compare-dist-cell compare-dist-count-cell";
      const cumCountCell = document.createElement("div");
      cumCountCell.className = "compare-dist-cell compare-dist-cum-count";
      const shareCell = document.createElement("div");
      shareCell.className = "compare-dist-cell compare-dist-share-col";

      if (!entry.hasAnalysis) {
        const noAnalysis = "No analysis";
        perCountCell.classList.add("compare-dist-empty");
        perCountCell.textContent = noAnalysis;
        cumCountCell.classList.add("compare-dist-empty");
        cumCountCell.textContent = noAnalysis;
        shareCell.classList.add("compare-dist-empty");
        shareCell.textContent = noAnalysis;
      } else {
        let perRelevant = 0;
        let perTotal = 0;
        let perPercent = null;

        if (group) {
          perRelevant = Number(group.relevant_count || 0);
          const perIrrelevant = Number(group.irrelevant_count || 0);
          perTotal = perRelevant + perIrrelevant;
          perPercent = perTotal > 0 ? Math.round((perRelevant / perTotal) * 100) : null;
          running[index].relevant += perRelevant;
          running[index].total += perTotal;
        }

        if (group) {
          if (perPercent !== null) {
            const heat = Math.min(0.55, 0.08 + (perPercent / 100) * 0.45);
            perCountCell.style.setProperty("--heat", heat.toFixed(2));
          }
          const perCountEl = document.createElement("div");
          perCountEl.className = "compare-dist-count compare-dist-count-only";
          perCountEl.textContent = `${formatNumber(perRelevant)}/${formatNumber(perTotal)}`;
          perCountCell.appendChild(perCountEl);
        } else {
          perCountCell.classList.add("compare-dist-empty");
          perCountCell.textContent = "-";
        }

        const cumTotal = running[index].total;
        const cumRelevant = running[index].relevant;
        const cumPercent = cumTotal > 0 ? Math.round((cumRelevant / cumTotal) * 100) : null;
        if (cumPercent !== null) {
          cumPercents.push(cumPercent);
          const cumHeat = Math.min(0.55, 0.08 + (cumPercent / 100) * 0.45);
          cumCountCell.style.setProperty("--heat", cumHeat.toFixed(2));
        }
        const cumCountEl = document.createElement("div");
        cumCountEl.className = "compare-dist-count compare-dist-count-only";
        cumCountEl.textContent = cumTotal > 0 ? `${formatNumber(cumRelevant)}/${formatNumber(cumTotal)}` : "-";
        cumCountCell.appendChild(cumCountEl);

        const share =
          maxTotalRelevant > 0
            ? Math.round((cumRelevant / maxTotalRelevant) * 100)
            : null;
        if (share !== null) {
          const shareHeat = Math.min(0.55, 0.08 + (share / 100) * 0.45);
          shareCell.style.setProperty("--heat", shareHeat.toFixed(2));
        }
        const shareEl = document.createElement("div");
        shareEl.className = "compare-dist-percent";
        shareEl.textContent = share !== null ? `${share}%` : "-";
        shareCell.appendChild(shareEl);
      }

      row.appendChild(perCountCell);
      row.appendChild(cumCountCell);
      row.appendChild(shareCell);
      if (index < entries.length - 1) {
        row.appendChild(buildSeparatorCell());
      }
    });

    if (showSpread) {
      row.appendChild(buildSpreadCell(cumPercents));
    }

    elements.compareDistributionGrid.appendChild(row);
  });
}

function appendDistributionHeader(container, entries, showSpread, columnTemplate) {
  const headerTop = document.createElement("div");
  headerTop.className = "compare-distribution-row compare-distribution-header compare-distribution-header-top";
  headerTop.style.gridTemplateColumns = columnTemplate;

  const headerRange = document.createElement("div");
  headerRange.className = "compare-dist-cell compare-dist-range";
  headerRange.textContent = "Range";
  headerTop.appendChild(headerRange);

  entries.forEach((entry, index) => {
    const title = document.createElement("div");
    title.className = "compare-dist-cell compare-dist-question";
    const titleLine = document.createElement("div");
    titleLine.className = "compare-question-title";
    titleLine.textContent = recordTitle(entry.record);
    titleLine.title = recordTitle(entry.record);
    const metaLine = document.createElement("div");
    metaLine.className = "compare-question-meta";
    const metaParts = [];
    const collection = getRecordCollection(entry.record);
    const embedModel = getRecordEmbeddingModel(entry.record);
    if (collection) {
      metaParts.push(collection);
    }
    if (embedModel) {
      metaParts.push(embedModel);
    }
    metaLine.textContent = metaParts.length ? metaParts.join(" | ") : "-";
    title.appendChild(titleLine);
    title.appendChild(metaLine);
    title.style.gridColumn = "span 3";
    headerTop.appendChild(title);
    if (index < entries.length - 1) {
      headerTop.appendChild(buildSeparatorCell());
    }
  });

  if (showSpread) {
    const spreadHeader = document.createElement("div");
    spreadHeader.className = "compare-dist-cell compare-dist-spread";
    spreadHeader.textContent = "Spread (cum)";
    headerTop.appendChild(spreadHeader);
  }

  container.appendChild(headerTop);

  const headerSub = document.createElement("div");
  headerSub.className = "compare-distribution-row compare-distribution-header compare-distribution-header-sub";
  headerSub.style.gridTemplateColumns = columnTemplate;

  const headerRangeSub = document.createElement("div");
  headerRangeSub.className = "compare-dist-cell compare-dist-range";
  headerRangeSub.textContent = "";
  headerSub.appendChild(headerRangeSub);

  entries.forEach((entry, index) => {
    const perHeader = document.createElement("div");
    perHeader.className = "compare-dist-cell compare-dist-count-cell compare-dist-sub-label";
    perHeader.textContent = "Per";
    perHeader.title = `${recordTitle(entry.record)} per bucket`;
    headerSub.appendChild(perHeader);

    const cumHeader = document.createElement("div");
    cumHeader.className = "compare-dist-cell compare-dist-cum-count compare-dist-sub-label";
    cumHeader.textContent = "Cum";
    cumHeader.title = `${recordTitle(entry.record)} cumulative`;
    headerSub.appendChild(cumHeader);

    const shareHeader = document.createElement("div");
    shareHeader.className = "compare-dist-cell compare-dist-share-col";
    shareHeader.textContent = "Rel share";
    shareHeader.title = `${recordTitle(entry.record)} share of total relevant`;
    headerSub.appendChild(shareHeader);
    if (index < entries.length - 1) {
      headerSub.appendChild(buildSeparatorCell());
    }
  });

  if (showSpread) {
    const spreadHeader = document.createElement("div");
    spreadHeader.className = "compare-dist-cell compare-dist-spread";
    spreadHeader.textContent = "Spread";
    headerSub.appendChild(spreadHeader);
  }

  container.appendChild(headerSub);
}

function buildRangeCell(range) {
  const rangeCell = document.createElement("div");
  rangeCell.className = "compare-dist-cell compare-dist-range";
  rangeCell.textContent = formatGroupRange({
    start_index: range.start,
    end_index: range.end,
  });
  return rangeCell;
}

function buildSpreadCell(percents) {
  const spreadCell = document.createElement("div");
  spreadCell.className = "compare-dist-cell compare-dist-spread";
  if (percents.length > 1) {
    const min = Math.min.apply(null, percents);
    const max = Math.max.apply(null, percents);
    const delta = max - min;
    const percentEl = document.createElement("div");
    percentEl.className = "compare-dist-percent";
    percentEl.textContent = `${min}–${max}`;
    const countEl = document.createElement("div");
    countEl.className = "compare-dist-count";
    countEl.textContent = `diff ${delta}`;
    spreadCell.appendChild(percentEl);
    spreadCell.appendChild(countEl);
  } else {
    spreadCell.textContent = "—";
  }
  return spreadCell;
}

function buildDistributionColumns(recordCount, showSpread) {
  const columns = ["minmax(120px, 160px)"];
  for (let i = 0; i < recordCount; i += 1) {
    columns.push("minmax(160px, 1fr)");
    columns.push("minmax(160px, 1fr)");
    columns.push("minmax(110px, 140px)");
    if (i < recordCount - 1) {
      columns.push("12px");
    }
  }
  if (showSpread) {
    columns.push("minmax(120px, 140px)");
  }
  return columns.join(" ");
}

function buildSeparatorCell() {
  const cell = document.createElement("div");
  cell.className = "compare-dist-separator";
  return cell;
}

function renderDistributionThresholds(entries, ranges, maxTotalRelevant) {
  elements.compareDistributionThresholds.innerHTML = "";
  if (!entries.length) {
    return;
  }

  const thresholds = [25, 50, 75, 90];
  const columnTemplate = buildThresholdColumns(entries.length);

  const headerRow = document.createElement("div");
  headerRow.className = "compare-threshold-row compare-threshold-header";
  headerRow.style.gridTemplateColumns = columnTemplate;

  const headerLabel = document.createElement("div");
  headerLabel.className = "compare-threshold-cell compare-threshold-label";
  headerLabel.textContent = "Rel share target";
  headerRow.appendChild(headerLabel);

  entries.forEach((entry) => {
    const headerCell = document.createElement("div");
    headerCell.className = "compare-threshold-cell compare-threshold-question";

    const title = document.createElement("div");
    title.className = "compare-question-title";
    title.textContent = recordTitle(entry.record);
    title.title = recordTitle(entry.record);

    const meta = document.createElement("div");
    meta.className = "compare-question-meta";
    const parts = [];
    const collection = getRecordCollection(entry.record);
    const embedModel = getRecordEmbeddingModel(entry.record);
    if (collection) {
      parts.push(collection);
    }
    if (embedModel) {
      parts.push(embedModel);
    }
    meta.textContent = parts.length ? parts.join(" | ") : "-";

    headerCell.appendChild(title);
    headerCell.appendChild(meta);
    headerRow.appendChild(headerCell);
  });

  elements.compareDistributionThresholds.appendChild(headerRow);

  const rangeEnds = ranges.map((range) =>
    Number.isFinite(range.end) ? range.end + 1 : null
  );

  thresholds.forEach((threshold) => {
    const row = document.createElement("div");
    row.className = "compare-threshold-row";
    row.style.gridTemplateColumns = columnTemplate;

    const label = document.createElement("div");
    label.className = "compare-threshold-cell compare-threshold-label";
    label.textContent = `${threshold}%`;
    row.appendChild(label);

    entries.forEach((entry) => {
      const cell = document.createElement("div");
      cell.className = "compare-threshold-cell compare-threshold-value";

      if (!entry.hasAnalysis) {
        cell.classList.add("compare-dist-empty");
        cell.textContent = "No analysis";
        row.appendChild(cell);
        return;
      }

      let cumRelevant = 0;
      let found = null;
      ranges.forEach((range, index) => {
        const group = entry.groupMap[range.key];
        if (group) {
          cumRelevant += Number(group.relevant_count || 0);
        }
        if (
          found === null &&
          maxTotalRelevant > 0 &&
          cumRelevant / maxTotalRelevant >= threshold / 100
        ) {
          found = rangeEnds[index];
        }
      });

      cell.textContent =
        found === null || !Number.isFinite(found) ? "-" : formatNumber(found);
      row.appendChild(cell);
    });

    elements.compareDistributionThresholds.appendChild(row);
  });
}

function buildThresholdColumns(recordCount) {
  const columns = ["minmax(140px, 180px)"];
  for (let i = 0; i < recordCount; i += 1) {
    columns.push("minmax(220px, 1fr)");
  }
  return columns.join(" ");
}

function renderGroupBreakdown(groups) {
  const container = document.createElement("div");
  container.className = "compare-groups";
  if (!groups.length) {
    const empty = document.createElement("div");
    empty.className = "compare-group-empty";
    empty.textContent = "No breakdown yet.";
    container.appendChild(empty);
    return container;
  }
  const header = document.createElement("div");
  header.className = "compare-group-header";
  header.innerHTML = "<span>Range</span><span>Relevant</span><span>Irrelevant</span>";
  container.appendChild(header);

  groups.forEach((group) => {
    const row = document.createElement("div");
    row.className = "compare-group-row";
    const range = document.createElement("div");
    range.className = "compare-group-range";
    range.textContent = formatGroupRange(group);
    const relevant = document.createElement("div");
    relevant.className = "compare-group-count";
    relevant.textContent = formatNumber(group.relevant_count || 0);
    const irrelevant = document.createElement("div");
    irrelevant.className = "compare-group-count";
    irrelevant.textContent = formatNumber(group.irrelevant_count || 0);
    row.appendChild(range);
    row.appendChild(relevant);
    row.appendChild(irrelevant);
    container.appendChild(row);
  });

  return container;
}

function formatGroupRange(group) {
  const start = Number.isFinite(group.start_index) ? group.start_index + 1 : 1;
  const end = Number.isFinite(group.end_index) ? group.end_index + 1 : start;
  return `${start}-${end}`;
}

async function ensureAnalysis(recordId) {
  if (!recordId) {
    return;
  }
  if (state.analysisCache[recordId] || state.analysisLoading.has(recordId)) {
    return;
  }
  state.analysisLoading.add(recordId);
  state.analysisCache[recordId] = { status: "loading" };
  try {
    const response = await fetch("/api/analyse", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ record_id: recordId, cache_only: true }),
    });
    if (response.status === 404) {
      state.analysisCache[recordId] = { status: "missing" };
    } else {
      const payload = await response.json();
      if (!response.ok) {
        state.analysisCache[recordId] = {
          status: "error",
          message: payload.error || "Failed to load analysis.",
        };
      } else {
        state.analysisCache[recordId] = { status: "ready", data: payload };
      }
    }
  } catch (err) {
    state.analysisCache[recordId] = {
      status: "error",
      message: err.message || "Failed to load analysis.",
    };
  } finally {
    state.analysisLoading.delete(recordId);
    renderCompare();
  }
}

async function loadHistory() {
  const limit = Math.max(
    1,
    Number(elements.compareLimit.value || DEFAULT_COMPARE_LIMIT)
  );
  state.analysisCache = {};
  state.analysisLoading.clear();
  localStorage.setItem("compareLimit", String(limit));
  setStatus("Loading history...");
  try {
    const currentCollection = elements.compareCollection.value || "all";
    const currentAnswerModel = elements.compareAnswerModel.value || "all";
    const response = await fetch(`/api/history?limit=${limit}`);
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || "Failed to load history.");
    }
    state.records = Array.isArray(payload.items) ? payload.items : [];
    elements.compareTotal.textContent = String(payload.total || state.records.length);
    buildFilterOptions(
      state.records,
      "answer_model",
      elements.compareAnswerModel,
      "All answer models"
    );
    const collectionValues = new Set();
    state.records.forEach((record) => {
      const value = getRecordCollection(record);
      if (value) {
        collectionValues.add(value);
      }
    });
    elements.compareCollection.innerHTML = "";
    const optionAll = document.createElement("option");
    optionAll.value = "all";
    optionAll.textContent = "All collections";
    elements.compareCollection.appendChild(optionAll);
    Array.from(collectionValues)
      .sort()
      .forEach((value) => {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = value;
        elements.compareCollection.appendChild(option);
      });
    if (
      currentAnswerModel &&
      Array.from(elements.compareAnswerModel.options).some(
        (option) => option.value === currentAnswerModel
      )
    ) {
      elements.compareAnswerModel.value = currentAnswerModel;
    }
    if (
      currentCollection &&
      Array.from(elements.compareCollection.options).some(
        (option) => option.value === currentCollection
      )
    ) {
      elements.compareCollection.value = currentCollection;
    }

    const validIds = new Set(state.records.map((record) => getRecordId(record)));
    state.selectedIds.forEach((id) => {
      if (!validIds.has(id)) {
        state.selectedIds.delete(id);
      }
    });
    persistSelection();

    applyFilters();
    setStatus(`Loaded ${state.records.length} records.`);
  } catch (err) {
    elements.compareList.innerHTML = "";
    const empty = document.createElement("div");
    empty.className = "compare-empty";
    empty.textContent = "Failed to load history.";
    elements.compareList.appendChild(empty);
    elements.compareTotal.textContent = "0";
    elements.compareShown.textContent = "0";
    renderCompare();
    setStatus(err.message || "History error.");
  }
}

function init() {
  const storedLimit = Number(
    localStorage.getItem("compareLimit") || DEFAULT_COMPARE_LIMIT
  );
  const storedSort = localStorage.getItem("compareSort") || "time_desc";
  elements.compareLimit.value = storedLimit;
  elements.compareSort.value = storedSort;
  loadStoredSelection();

  loadHistory();

  elements.refreshCompare.addEventListener("click", () => loadHistory());
  elements.compareLimit.addEventListener("change", () => loadHistory());
  elements.compareSearch.addEventListener("input", () => applyFilters());
  elements.compareType.addEventListener("change", () => applyFilters());
  elements.compareMode.addEventListener("change", () => applyFilters());
  elements.compareCollection.addEventListener("change", () => applyFilters());
  elements.compareAnswerModel.addEventListener("change", () => applyFilters());
  elements.compareSort.addEventListener("change", () => applyFilters());
  elements.selectFiltered.addEventListener("click", () => {
    state.filtered.forEach((record) => {
      const recordId = getRecordId(record);
      if (recordId) {
        state.selectedIds.add(recordId);
      }
    });
    persistSelection();
    renderList();
    renderCompare();
  });
  elements.clearSelection.addEventListener("click", () => {
    state.selectedIds.clear();
    persistSelection();
    renderList();
    renderCompare();
  });
}

init();
