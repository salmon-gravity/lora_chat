const elements = {
  status: document.getElementById("status"),
  insightsSearch: document.getElementById("insightsSearch"),
  insightsMode: document.getElementById("insightsMode"),
  insightsCollection: document.getElementById("insightsCollection"),
  insightsModel: document.getElementById("insightsModel"),
  insightsTopK: document.getElementById("insightsTopK"),
  insightsThreshold: document.getElementById("insightsThreshold"),
  refreshInsights: document.getElementById("refreshInsights"),
  insightsConfigCount: document.getElementById("insightsConfigCount"),
  insightsRecordCount: document.getElementById("insightsRecordCount"),
  insightsHistoryCount: document.getElementById("insightsHistoryCount"),
  insightsConfigList: document.getElementById("insightsConfigList"),
  insightsConfigMeta: document.getElementById("insightsConfigMeta"),
  insightsMetricGrid: document.getElementById("insightsMetricGrid"),
  insightsDistMeta: document.getElementById("insightsDistMeta"),
  insightsDistGrid: document.getElementById("insightsDistGrid"),
  insightsQuestionMeta: document.getElementById("insightsQuestionMeta"),
  insightsQuestionList: document.getElementById("insightsQuestionList"),
  insightsQuestionSort: document.getElementById("insightsQuestionSort"),
};

const state = {
  records: [],
  filtered: [],
  configs: [],
  selectedConfigKey: "",
};

function setStatus(message) {
  elements.status.textContent = message;
}

function formatNumber(value) {
  if (!Number.isFinite(value)) {
    return "0";
  }
  return value.toLocaleString("en-US");
}

function formatPercent(value) {
  if (!Number.isFinite(value)) {
    return "-";
  }
  return `${(value * 100).toFixed(2)}%`;
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

function normalizeValue(value) {
  if (value === null || value === undefined || value === "") {
    return "-";
  }
  return String(value);
}

function recordTitle(record) {
  return (
    record.question ||
    record.retrieval_query ||
    record.reframed_question ||
    "Untitled request"
  );
}

function buildConfigKey(record) {
  const mode = normalizeValue(record.search_mode);
  const collection = normalizeValue(record.collection);
  const model = normalizeValue(record.model);
  const topK = normalizeValue(record.top_k);
  const threshold =
    record.threshold === null || record.threshold === undefined
      ? "-"
      : Number(record.threshold).toFixed(2);
  return [mode, collection, model, topK, threshold].join("||");
}

function splitConfigKey(key) {
  const [mode, collection, model, topK, threshold] = key.split("||");
  return { mode, collection, model, topK, threshold };
}

function buildFilterOptions(values, select, label) {
  select.innerHTML = "";
  const optionAll = document.createElement("option");
  optionAll.value = "all";
  optionAll.textContent = label;
  select.appendChild(optionAll);

  Array.from(values)
    .sort((a, b) => String(a).localeCompare(String(b)))
    .forEach((value) => {
      const option = document.createElement("option");
      option.value = String(value);
      option.textContent = String(value);
      select.appendChild(option);
    });
}

function uniqueSorted(records, key) {
  const set = new Set();
  records.forEach((record) => {
    const value = record[key];
    if (value !== null && value !== undefined && value !== "") {
      set.add(String(value));
    }
  });
  return Array.from(set);
}

function computeConfigMetrics(records) {
  const totals = {
    totalQuestions: records.length,
    totalMatches: 0,
    totalRelevant: 0,
    totalIrrelevant: 0,
    avgMatches: 0,
    avgRatio: 0,
    medianRatio: 0,
    avgRelevantCount: 0,
    medianRelevantCount: 0,
    zeroRelevant: 0,
    earlyRelevant: 0,
    earlyIrrelevant: 0,
    topRelevant100: 0,
    topRelevant200: 0,
    topRelevant300: 0,
  };

  const ratios = [];
  const relevantCounts = [];
  records.forEach((record) => {
    const relevant = Number(record.relevant_count || 0);
    const irrelevant = Number(record.irrelevant_count || 0);
    const total = relevant + irrelevant;
    totals.totalRelevant += relevant;
    totals.totalIrrelevant += irrelevant;
    totals.totalMatches += Number(record.match_count || 0);
    if (total > 0) {
      ratios.push(relevant / total);
    } else {
      ratios.push(0);
    }
    relevantCounts.push(relevant);
    if (relevant === 0) {
      totals.zeroRelevant += 1;
    }

    const groups = Array.isArray(record.groups) ? record.groups : [];
    groups.forEach((group) => {
      const startIndex = Number(group.start_index || 0);
      const relevantCount = Number(group.relevant_count || 0);
      if (startIndex < 100) {
        totals.topRelevant100 += relevantCount;
      }
      if (startIndex < 200) {
        totals.topRelevant200 += relevantCount;
      }
      if (startIndex < 300) {
        totals.topRelevant300 += relevantCount;
      }
    });
    const firstGroup =
      groups.find((group) => Number(group.group_index) === 0) ||
      groups.find((group) => Number(group.start_index) === 0);
    if (firstGroup) {
      totals.earlyRelevant += Number(firstGroup.relevant_count || 0);
      totals.earlyIrrelevant += Number(firstGroup.irrelevant_count || 0);
    }
  });

  totals.avgMatches =
    records.length > 0 ? totals.totalMatches / records.length : 0;
  totals.avgRatio =
    ratios.length > 0
      ? ratios.reduce((sum, value) => sum + value, 0) / ratios.length
      : 0;
  if (ratios.length) {
    const sorted = ratios.slice().sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    totals.medianRatio =
      sorted.length % 2 === 0
        ? (sorted[mid - 1] + sorted[mid]) / 2
        : sorted[mid];
  }
  totals.avgRelevantCount =
    relevantCounts.length > 0
      ? relevantCounts.reduce((sum, value) => sum + value, 0) /
        relevantCounts.length
      : 0;
  if (relevantCounts.length) {
    const sortedCounts = relevantCounts.slice().sort((a, b) => a - b);
    const mid = Math.floor(sortedCounts.length / 2);
    totals.medianRelevantCount =
      sortedCounts.length % 2 === 0
        ? (sortedCounts[mid - 1] + sortedCounts[mid]) / 2
        : sortedCounts[mid];
  }
  totals.overallRatio =
    totals.totalRelevant + totals.totalIrrelevant > 0
      ? totals.totalRelevant /
        (totals.totalRelevant + totals.totalIrrelevant)
      : 0;
  totals.earlyPrecision =
    totals.earlyRelevant + totals.earlyIrrelevant > 0
      ? totals.earlyRelevant /
        (totals.earlyRelevant + totals.earlyIrrelevant)
      : 0;
  totals.share100 =
    totals.totalRelevant > 0
      ? totals.topRelevant100 / totals.totalRelevant
      : 0;
  totals.share200 =
    totals.totalRelevant > 0
      ? totals.topRelevant200 / totals.totalRelevant
      : 0;
  totals.share300 =
    totals.totalRelevant > 0
      ? totals.topRelevant300 / totals.totalRelevant
      : 0;
  return totals;
}

function buildDistribution(records) {
  const bucketMap = new Map();
  records.forEach((record) => {
    const groups = Array.isArray(record.groups) ? record.groups : [];
    groups.forEach((group) => {
      const start = Number(group.start_index || 0);
      const end = Number(group.end_index || 0);
      const key = `${start}-${end}`;
      if (!bucketMap.has(key)) {
        bucketMap.set(key, {
          start,
          end,
          relevant: 0,
          irrelevant: 0,
        });
      }
      const bucket = bucketMap.get(key);
      bucket.relevant += Number(group.relevant_count || 0);
      bucket.irrelevant += Number(group.irrelevant_count || 0);
    });
  });

  const buckets = Array.from(bucketMap.values()).sort((a, b) => {
    if (a.start !== b.start) {
      return a.start - b.start;
    }
    return a.end - b.end;
  });

  let cumRelevant = 0;
  let cumTotal = 0;
  buckets.forEach((bucket) => {
    const total = bucket.relevant + bucket.irrelevant;
    bucket.total = total;
    bucket.ratio = total ? bucket.relevant / total : 0;
    cumRelevant += bucket.relevant;
    cumTotal += total;
    bucket.cumRelevant = cumRelevant;
    bucket.cumRatio = cumTotal ? cumRelevant / cumTotal : 0;
  });

  return buckets;
}

function buildConfigList(records) {
  const map = new Map();
  records.forEach((record) => {
    const key = buildConfigKey(record);
    if (!map.has(key)) {
      map.set(key, { key, records: [] });
    }
    map.get(key).records.push(record);
  });

  const configs = Array.from(map.values()).map((entry) => {
    const metrics = computeConfigMetrics(entry.records);
    const configParts = splitConfigKey(entry.key);
    return {
      ...entry,
      ...configParts,
      metrics,
    };
  });

  configs.sort((a, b) => {
    if (b.metrics.overallRatio !== a.metrics.overallRatio) {
      return b.metrics.overallRatio - a.metrics.overallRatio;
    }
    return b.metrics.totalRelevant - a.metrics.totalRelevant;
  });
  return configs;
}

function applyFilters() {
  const search = elements.insightsSearch.value.trim().toLowerCase();
  const mode = elements.insightsMode.value;
  const collection = elements.insightsCollection.value;
  const model = elements.insightsModel.value;
  const topK = elements.insightsTopK.value;
  const threshold = elements.insightsThreshold.value;

  state.filtered = state.records.filter((record) => {
    if (mode !== "all" && String(record.search_mode) !== mode) {
      return false;
    }
    if (collection !== "all" && String(record.collection) !== collection) {
      return false;
    }
    if (model !== "all" && String(record.model) !== model) {
      return false;
    }
    if (topK !== "all" && String(record.top_k) !== topK) {
      return false;
    }
    if (threshold !== "all") {
      const recordThreshold =
        record.threshold === null || record.threshold === undefined
          ? "-"
          : Number(record.threshold).toFixed(2);
      if (recordThreshold !== threshold) {
        return false;
      }
    }
    if (!search) {
      return true;
    }
    const text = [record.question, record.retrieval_query]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return text.includes(search);
  });

  state.configs = buildConfigList(state.filtered);
  elements.insightsConfigCount.textContent = formatNumber(state.configs.length);
  elements.insightsRecordCount.textContent = formatNumber(state.filtered.length);

  if (!state.configs.length) {
    state.selectedConfigKey = "";
    renderConfigList();
    renderConfigDetail(null);
    return;
  }

  if (!state.selectedConfigKey) {
    state.selectedConfigKey = state.configs[0].key;
  }
  if (!state.configs.some((config) => config.key === state.selectedConfigKey)) {
    state.selectedConfigKey = state.configs[0].key;
  }

  renderConfigList();
  renderConfigDetail(
    state.configs.find((config) => config.key === state.selectedConfigKey) || null
  );
}

function renderConfigList() {
  elements.insightsConfigList.innerHTML = "";
  if (!state.configs.length) {
    const empty = document.createElement("div");
    empty.className = "insights-empty";
    empty.textContent = "No analysed configurations found.";
    elements.insightsConfigList.appendChild(empty);
    return;
  }

  state.configs.forEach((config, index) => {
    const card = document.createElement("div");
    card.className = "insights-config-card";
    if (config.key === state.selectedConfigKey) {
      card.classList.add("active");
    }

    const title = document.createElement("div");
    title.className = "insights-config-title";
    title.textContent = `Config ${index + 1}`;

    const meta = document.createElement("div");
    meta.className = "insights-config-meta";
    meta.textContent = [
      config.mode,
      config.collection,
      config.model,
      `TopK ${config.topK}`,
      `Thr ${config.threshold}`,
    ].join(" | ");

    const metrics = document.createElement("div");
    metrics.className = "insights-config-metrics";

    const ratio = document.createElement("div");
    ratio.className = "insights-config-metric";
    ratio.innerHTML = `<span>Relevance</span><strong>${formatPercent(
      config.metrics.overallRatio
    )}</strong>`;

    const relevant = document.createElement("div");
    relevant.className = "insights-config-metric";
    relevant.innerHTML = `<span>Relevant</span><strong>${formatNumber(
      config.metrics.totalRelevant
    )}</strong>`;

    const questions = document.createElement("div");
    questions.className = "insights-config-metric";
    questions.innerHTML = `<span>Questions</span><strong>${formatNumber(
      config.metrics.totalQuestions
    )}</strong>`;

    metrics.appendChild(ratio);
    metrics.appendChild(relevant);
    metrics.appendChild(questions);

    card.appendChild(title);
    card.appendChild(meta);
    card.appendChild(metrics);

    card.addEventListener("click", () => {
      state.selectedConfigKey = config.key;
      localStorage.setItem("insightsSelectedConfig", config.key);
      renderConfigList();
      renderConfigDetail(config);
    });

    elements.insightsConfigList.appendChild(card);
  });
}

function renderMetricGrid(metrics) {
  elements.insightsMetricGrid.innerHTML = "";
  const items = [
    { label: "Questions", value: formatNumber(metrics.totalQuestions) },
    { label: "Total matches", value: formatNumber(metrics.totalMatches) },
    { label: "Total relevant", value: formatNumber(metrics.totalRelevant) },
    { label: "Total irrelevant", value: formatNumber(metrics.totalIrrelevant) },
    { label: "Overall relevance", value: formatPercent(metrics.overallRatio) },
    { label: "Avg relevance", value: formatPercent(metrics.avgRatio) },
    { label: "Median relevance", value: formatPercent(metrics.medianRatio) },
    {
      label: "Avg relevant (count)",
      value: formatNumber(Math.round(metrics.avgRelevantCount)),
    },
    {
      label: "Median relevant (count)",
      value: formatNumber(Math.round(metrics.medianRelevantCount)),
    },
    { label: "Avg matches", value: formatNumber(metrics.avgMatches) },
    { label: "Zero-relevant questions", value: formatNumber(metrics.zeroRelevant) },
    { label: "Early precision @100", value: formatPercent(metrics.earlyPrecision) },
    { label: "Rel share @100", value: formatPercent(metrics.share100) },
    { label: "Rel share @200", value: formatPercent(metrics.share200) },
    { label: "Rel share @300", value: formatPercent(metrics.share300) },
  ];

  items.forEach((item) => {
    const card = document.createElement("div");
    card.className = "insights-metric-card";
    const label = document.createElement("div");
    label.className = "insights-metric-label";
    label.textContent = item.label;
    const value = document.createElement("div");
    value.className = "insights-metric-value";
    value.textContent = item.value;
    card.appendChild(label);
    card.appendChild(value);
    elements.insightsMetricGrid.appendChild(card);
  });
}

function renderDistribution(records) {
  const buckets = buildDistribution(records);
  elements.insightsDistGrid.innerHTML = "";
  if (!buckets.length) {
    elements.insightsDistMeta.textContent = "No per-100 breakdown available.";
    elements.insightsDistGrid.innerHTML =
      "<div class=\"insights-empty\">No distribution data.</div>";
    return;
  }

  elements.insightsDistMeta.textContent = `Buckets: ${buckets.length}`;

  const header = document.createElement("div");
  header.className = "insights-dist-row insights-dist-header";
  header.innerHTML =
    "<div>Range</div><div>Relevant</div><div>Irrelevant</div><div>Rel %</div><div>Cum relevant</div><div>Cum %</div>";
  elements.insightsDistGrid.appendChild(header);

  buckets.forEach((bucket) => {
    const row = document.createElement("div");
    row.className = "insights-dist-row";
    const range = `${bucket.start + 1}-${bucket.end + 1}`;
    row.innerHTML = `
      <div>${range}</div>
      <div>${formatNumber(bucket.relevant)}</div>
      <div>${formatNumber(bucket.irrelevant)}</div>
      <div>${formatPercent(bucket.ratio)}</div>
      <div>${formatNumber(bucket.cumRelevant)}</div>
      <div>${formatPercent(bucket.cumRatio)}</div>
    `;
    elements.insightsDistGrid.appendChild(row);
  });
}

function renderQuestionList(records) {
  elements.insightsQuestionList.innerHTML = "";
  if (!records.length) {
    elements.insightsQuestionMeta.textContent = "No questions in this configuration.";
    elements.insightsQuestionList.innerHTML =
      "<div class=\"insights-empty\">No records.</div>";
    return;
  }

  const sort = elements.insightsQuestionSort.value;
  const sorted = records.slice();
  const ratioValue = (record) => {
    const relevant = Number(record.relevant_count || 0);
    const irrelevant = Number(record.irrelevant_count || 0);
    const total = relevant + irrelevant;
    return total > 0 ? relevant / total : 0;
  };
  const sorters = {
    ratio_desc: (a, b) => ratioValue(b) - ratioValue(a),
    ratio_asc: (a, b) => ratioValue(a) - ratioValue(b),
    relevant_desc: (a, b) => (b.relevant_count || 0) - (a.relevant_count || 0),
    relevant_asc: (a, b) => (a.relevant_count || 0) - (b.relevant_count || 0),
    matches_desc: (a, b) => (b.match_count || 0) - (a.match_count || 0),
    matches_asc: (a, b) => (a.match_count || 0) - (b.match_count || 0),
    time_desc: (a, b) => new Date(b.timestamp) - new Date(a.timestamp),
    time_asc: (a, b) => new Date(a.timestamp) - new Date(b.timestamp),
  };
  if (sorters[sort]) {
    sorted.sort(sorters[sort]);
  }

  elements.insightsQuestionMeta.textContent = `Questions: ${formatNumber(
    records.length
  )}`;

  sorted.forEach((record) => {
    const row = document.createElement("div");
    row.className = "insights-question-row";

    const title = document.createElement("div");
    title.className = "insights-question-title";
    title.textContent = recordTitle(record);

    const meta = document.createElement("div");
    meta.className = "insights-question-meta";
    meta.textContent = `Matches ${formatNumber(
      record.match_count || 0
    )} | Relevant ${formatNumber(record.relevant_count || 0)} | Ratio ${formatPercent(
      ratioValue(record)
    )} | ${formatTimestamp(record.timestamp)}`;

    const query = document.createElement("div");
    query.className = "insights-question-query";
    query.textContent = record.retrieval_query || "-";

    row.appendChild(title);
    row.appendChild(meta);
    row.appendChild(query);
    elements.insightsQuestionList.appendChild(row);
  });
}

function renderConfigDetail(config) {
  if (!config) {
    elements.insightsConfigMeta.textContent = "Select a configuration.";
    elements.insightsMetricGrid.innerHTML =
      "<div class=\"insights-empty\">No configuration selected.</div>";
    elements.insightsDistMeta.textContent = "-";
    elements.insightsDistGrid.innerHTML =
      "<div class=\"insights-empty\">No distribution data.</div>";
    elements.insightsQuestionMeta.textContent = "-";
    elements.insightsQuestionList.innerHTML =
      "<div class=\"insights-empty\">No records.</div>";
    return;
  }

  elements.insightsConfigMeta.textContent = [
    `Mode: ${config.mode}`,
    `Collection: ${config.collection}`,
    `Model: ${config.model}`,
    `Top K: ${config.topK}`,
    `Threshold: ${config.threshold}`,
  ].join(" | ");

  renderMetricGrid(config.metrics);
  renderDistribution(config.records);
  renderQuestionList(config.records);
}

async function loadInsights() {
  setStatus("Loading insights...");
  try {
    const response = await fetch("/api/analysis-insights");
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || "Failed to load insights.");
    }
    const records = Array.isArray(payload.records) ? payload.records : [];
    state.records = records;
    elements.insightsHistoryCount.textContent = formatNumber(
      payload.total_history || records.length
    );

    buildFilterOptions(uniqueSorted(records, "search_mode"), elements.insightsMode, "All modes");
    buildFilterOptions(
      uniqueSorted(records, "collection"),
      elements.insightsCollection,
      "All collections"
    );
    buildFilterOptions(
      uniqueSorted(records, "model"),
      elements.insightsModel,
      "All models"
    );
    buildFilterOptions(uniqueSorted(records, "top_k"), elements.insightsTopK, "All top K");
    const thresholdValues = uniqueSorted(records, "threshold")
      .map((value) => Number(value))
      .filter((value) => Number.isFinite(value))
      .map((value) => value.toFixed(2));
    buildFilterOptions(thresholdValues, elements.insightsThreshold, "All thresholds");

    const storedConfig = localStorage.getItem("insightsSelectedConfig") || "";
    state.selectedConfigKey = storedConfig;

    applyFilters();
    setStatus(`Loaded ${records.length} analysed records.`);
  } catch (err) {
    state.records = [];
    state.filtered = [];
    state.configs = [];
    elements.insightsConfigCount.textContent = "0";
    elements.insightsRecordCount.textContent = "0";
    elements.insightsHistoryCount.textContent = "0";
    elements.insightsConfigList.innerHTML =
      "<div class=\"insights-empty\">Failed to load insights.</div>";
    renderConfigDetail(null);
    setStatus(err.message || "Insights error.");
  }
}

function init() {
  loadInsights();
  elements.refreshInsights.addEventListener("click", () => loadInsights());
  elements.insightsSearch.addEventListener("input", () => applyFilters());
  elements.insightsMode.addEventListener("change", () => applyFilters());
  elements.insightsCollection.addEventListener("change", () => applyFilters());
  elements.insightsModel.addEventListener("change", () => applyFilters());
  elements.insightsTopK.addEventListener("change", () => applyFilters());
  elements.insightsThreshold.addEventListener("change", () => applyFilters());
  elements.insightsQuestionSort.addEventListener("change", () => {
    const selected = state.configs.find(
      (config) => config.key === state.selectedConfigKey
    );
    if (selected) {
      renderQuestionList(selected.records);
    }
  });
}

init();
