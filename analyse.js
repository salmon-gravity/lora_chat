const elements = {
  status: document.getElementById("status"),
  analysisLimit: document.getElementById("analysisLimit"),
  analysisSearch: document.getElementById("analysisSearch"),
  analysisTopK: document.getElementById("analysisTopK"),
  analysisCollectionFilter: document.getElementById("analysisCollectionFilter"),
  analysisShown: document.getElementById("analysisShown"),
  analysisTotal: document.getElementById("analysisTotal"),
  refreshAnalysis: document.getElementById("refreshAnalysis"),
  analysisList: document.getElementById("analysisList"),
  analysisMeta: document.getElementById("analysisMeta"),
  analysisQuestion: document.getElementById("analysisQuestion"),
  analysisQuery: document.getElementById("analysisQuery"),
  analysisConfig: document.getElementById("analysisConfig"),
  analysisMatches: document.getElementById("analysisMatches"),
  analysisRelevant: document.getElementById("analysisRelevant"),
  analysisIrrelevant: document.getElementById("analysisIrrelevant"),
  analysisFile: document.getElementById("analysisFile"),
  analysisStatus: document.getElementById("analysisStatus"),
  analysisGroups: document.getElementById("analysisGroups"),
  analysisGroupSelect: document.getElementById("analysisGroupSelect"),
  analysisRelevantCount: document.getElementById("analysisRelevantCount"),
  analysisIrrelevantCount: document.getElementById("analysisIrrelevantCount"),
  analysisRelevantList: document.getElementById("analysisRelevantList"),
  analysisIrrelevantList: document.getElementById("analysisIrrelevantList"),
  analyseButton: document.getElementById("analyseButton"),
  analyseAllButton: document.getElementById("analyseAllButton"),
  chatProviderSelect: document.getElementById("chatProviderSelect"),
  chatModelSelect: document.getElementById("chatModelSelect"),
  loadingOverlay: document.getElementById("loadingOverlay"),
  loadingTitle: document.getElementById("loadingTitle"),
  loadingSub: document.getElementById("loadingSub"),
  loadingProgressCounts: document.getElementById("loadingProgressCounts"),
  loadingProgressFound: document.getElementById("loadingProgressFound"),
  loadingProgressCurrent: document.getElementById("loadingProgressCurrent"),
  loadingProgressAvg: document.getElementById("loadingProgressAvg"),
};

const DEFAULT_LIMIT = 1000;
const DEFAULT_TOP_K = 1000;

const state = {
  records: [],
  filtered: [],
  selectedIndex: null,
  chatProviders: [],
  selectedChatProvider: "",
  lastCacheRecordId: "",
  selectedCollection: "",
  groupSummaries: [],
  groupDetails: [],
  selectedGroupIndex: 0,
  pendingFocusId: "",
  isLoading: false,
};

function setStatus(message) {
  elements.status.textContent = message;
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

function formatNumber(value) {
  if (!Number.isFinite(value)) {
    return "0";
  }
  return value.toLocaleString("en-US");
}

function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms <= 0) {
    return "-";
  }
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function getRecordId(record) {
  if (!record) {
    return "";
  }
  return record.record_id || record.id || record.request_id || "";
}

function getCollectionFromRecord(record) {
  if (!record) {
    return "";
  }
  const raw =
    record.collection ||
    (record.config && record.config.collection) ||
    (record.config && record.config.search ? record.config.search.collection : "") ||
    "";
  return String(raw || "").trim();
}

function formatGroupRange(group) {
  const start = Number.isFinite(group.start_index) ? group.start_index + 1 : 1;
  const end = Number.isFinite(group.end_index) ? group.end_index + 1 : start;
  return `${start}-${end}`;
}

function findChatProvider(providerId) {
  return state.chatProviders.find((provider) => provider.id === providerId);
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

function getStoredChatModel(providerId) {
  if (!providerId) {
    return "";
  }
  return localStorage.getItem(`selectedChatModel:${providerId}`) || "";
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

async function loadProviders() {
  const response = await fetch("/api/chat-providers");
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || "Failed to load providers.");
  }
  const providers = Array.isArray(payload.providers) ? payload.providers : [];
  state.chatProviders = providers;
  const storedProvider = localStorage.getItem("selectedChatProvider");
  const providerId = fillProviderSelect(
    elements.chatProviderSelect,
    providers,
    storedProvider || payload.default_provider || ""
  );
  state.selectedChatProvider = providerId;
  if (providerId) {
    localStorage.setItem("selectedChatProvider", providerId);
  }
  updateChatModelSelect(providerId);
}

function setLoadingState(isLoading) {
  state.isLoading = isLoading;
  elements.analyseButton.disabled =
    isLoading || state.selectedIndex === null || state.selectedIndex < 0;
  if (elements.analyseAllButton) {
    elements.analyseAllButton.disabled = isLoading || state.filtered.length === 0;
  }
  elements.chatProviderSelect.disabled = isLoading;
  elements.chatModelSelect.disabled = isLoading;
  elements.analysisTopK.disabled = isLoading;
  elements.analysisLimit.disabled = isLoading;
  elements.analysisSearch.disabled = isLoading;
  elements.analysisCollectionFilter.disabled =
    isLoading || elements.analysisCollectionFilter.options.length <= 1;
  elements.refreshAnalysis.disabled = isLoading;
  if (elements.loadingOverlay) {
    elements.loadingOverlay.classList.toggle("active", isLoading);
    elements.loadingOverlay.setAttribute("aria-hidden", String(!isLoading));
  }
  if (!isLoading) {
    resetLoadingProgress();
  }
}

function setLoadingMessage(title, subText) {
  if (!elements.loadingTitle || !elements.loadingSub) {
    return;
  }
  elements.loadingTitle.textContent = title || "Analysing";
  elements.loadingSub.textContent = subText || "Classifying relevance in batches.";
}

function resetLoadingProgress() {
  if (elements.loadingProgressCounts) {
    elements.loadingProgressCounts.textContent = "To analyse: 0 / 0";
  }
  if (elements.loadingProgressFound) {
    elements.loadingProgressFound.textContent = "Already analysed: 0 / 0";
  }
  if (elements.loadingProgressCurrent) {
    elements.loadingProgressCurrent.textContent = "Current: -";
  }
  if (elements.loadingProgressAvg) {
    elements.loadingProgressAvg.textContent = "Avg per record: -";
  }
}

function setLoadingProgress({
  total = 0,
  toProcess = 0,
  processed = 0,
  alreadyAnalysed = 0,
  currentTitle = "-",
  avgMs = null,
}) {
  if (elements.loadingProgressCounts) {
    const totalLabel = total ? formatNumber(total) : "0";
    const toProcessLabel = toProcess ? formatNumber(toProcess) : "0";
    const processedLabel = formatNumber(processed);
    elements.loadingProgressCounts.textContent = `To analyse: ${toProcessLabel} / ${totalLabel} | Processed: ${processedLabel} / ${toProcessLabel}`;
  }
  if (elements.loadingProgressFound) {
    const totalLabel = total ? formatNumber(total) : "0";
    elements.loadingProgressFound.textContent = `Already analysed: ${formatNumber(alreadyAnalysed)} / ${totalLabel}`;
  }
  if (elements.loadingProgressCurrent) {
    elements.loadingProgressCurrent.textContent = `Current: ${currentTitle || "-"}`;
  }
  if (elements.loadingProgressAvg) {
    const avgLabel =
      avgMs === null || avgMs === undefined ? "-" : formatDuration(avgMs);
    elements.loadingProgressAvg.textContent = `Avg per record: ${avgLabel}`;
  }
}

function recordTitle(record) {
  return (
    record.question ||
    record.retrieval_query ||
    record.reframed_question ||
    "Untitled request"
  );
}

function renderList() {
  elements.analysisList.innerHTML = "";
  if (!state.filtered.length) {
    const empty = document.createElement("div");
    empty.className = "analysis-empty";
    empty.textContent = "No questions found.";
    elements.analysisList.appendChild(empty);
    state.selectedIndex = null;
    renderDetail(null);
    return;
  }
  if (state.selectedIndex === null || state.selectedIndex >= state.filtered.length) {
    state.selectedIndex = 0;
  }

  state.filtered.forEach((record, index) => {
    const row = document.createElement("div");
    row.className = "analysis-item";
    if (index === state.selectedIndex) {
      row.classList.add("active");
    }
    const title = document.createElement("div");
    title.className = "analysis-item-title";
    title.textContent = recordTitle(record);
    const meta = document.createElement("div");
    meta.className = "analysis-item-meta";
    const parts = [
      formatTimestamp(record.timestamp),
      record.type || "-",
      record.search_mode || "-",
      record.collection || "-",
    ];
    meta.textContent = parts.join(" | ");
    row.appendChild(title);
    row.appendChild(meta);
    row.addEventListener("click", () => {
      state.selectedIndex = index;
      renderList();
    });
    elements.analysisList.appendChild(row);
  });

  renderDetail(state.filtered[state.selectedIndex]);
}

function renderDetail(record) {
  if (!record) {
    elements.analysisMeta.textContent = "No question selected.";
    elements.analysisQuestion.textContent = "-";
    elements.analysisQuery.textContent = "-";
    elements.analysisConfig.textContent = "-";
    elements.analysisMatches.textContent = "0";
    elements.analysisRelevant.textContent = "0";
    elements.analysisIrrelevant.textContent = "0";
    elements.analysisFile.textContent = "File: -";
    elements.analysisStatus.textContent = "Ready.";
    renderGroupBreakdown([]);
    clearGroupDetails();
    elements.analyseButton.disabled = true;
    return;
  }
  const recordId = record.record_id || record.id || record.request_id || "-";
  const metaParts = [
    `ID: ${recordId}`,
    `Type: ${record.type || "-"}`,
    `Time: ${formatTimestamp(record.timestamp)}`,
  ];
  elements.analysisMeta.textContent = metaParts.join(" | ");
  elements.analysisQuestion.textContent = record.question || "-";
  elements.analysisQuery.textContent =
    record.retrieval_query || record.reframed_question || record.question || "-";
  const configParts = [
    `Mode: ${record.search_mode || "-"}`,
    `Collection: ${record.collection || "-"}`,
    `Model: ${record.model || "-"}`,
    `Threshold: ${record.threshold ?? "-"}`,
  ];
  elements.analysisConfig.textContent = configParts.join(" | ");
  elements.analyseButton.disabled = state.isLoading ? true : false;
  renderGroupBreakdown([]);
  clearGroupDetails();
  void loadCachedAnalysis(record);
}

function applyFilters() {
  const search = elements.analysisSearch.value.trim().toLowerCase();
  const selectedCollection = elements.analysisCollectionFilter.value || "";
  state.selectedCollection = selectedCollection;
  state.filtered = state.records.filter((record) => {
    if (selectedCollection) {
      const collectionName = getCollectionFromRecord(record);
      if (collectionName !== selectedCollection) {
        return false;
      }
    }
    if (!search) {
      return true;
    }
    const text = [record.question, record.retrieval_query, record.reframed_question]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return text.includes(search);
  });
  if (state.pendingFocusId) {
    const targetIndex = state.filtered.findIndex((record) => {
      const recordId = record.record_id || record.id || record.request_id || "";
      return recordId === state.pendingFocusId;
    });
    if (targetIndex >= 0) {
      state.selectedIndex = targetIndex;
    }
    state.pendingFocusId = "";
  }
  elements.analysisShown.textContent = String(state.filtered.length);
  updateAnalyseAllState();
  renderList();
}

function updateAnalyseAllState() {
  if (!elements.analyseAllButton) {
    return;
  }
  elements.analyseAllButton.disabled = state.isLoading || state.filtered.length === 0;
}

async function loadHistory() {
  const limit = Math.max(1, Number(elements.analysisLimit.value || DEFAULT_LIMIT));
  localStorage.setItem("analysisLimit", String(limit));
  setStatus("Loading questions...");
  try {
    const response = await fetch(`/api/history?limit=${limit}`);
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || "Failed to load history.");
    }
    state.records = Array.isArray(payload.items) ? payload.items : [];
    state.lastCacheRecordId = "";
    elements.analysisTotal.textContent = String(payload.total || state.records.length);
    state.selectedIndex = null;
    updateCollectionFilter(state.records);
    applyFilters();
    setStatus(`Loaded ${state.records.length} questions.`);
  } catch (err) {
    state.records = [];
    state.filtered = [];
    elements.analysisList.innerHTML = "";
    const empty = document.createElement("div");
    empty.className = "analysis-empty";
    empty.textContent = "Failed to load questions.";
    elements.analysisList.appendChild(empty);
    elements.analysisShown.textContent = "0";
    elements.analysisTotal.textContent = "0";
    updateCollectionFilter([]);
    renderDetail(null);
    updateAnalyseAllState();
    setStatus(err.message || "History error.");
  }
}

async function runAnalysis() {
  const record =
    state.selectedIndex !== null ? state.filtered[state.selectedIndex] : null;
  if (!record) {
    setStatus("Select a question first.");
    return;
  }
  const recordId = getRecordId(record);
  if (!recordId) {
    setStatus("Selected record is missing an id.");
    return;
  }
  const topK = Math.max(1, Number(elements.analysisTopK.value || DEFAULT_TOP_K));
  const chatProvider = elements.chatProviderSelect.value;
  const chatModel = elements.chatModelSelect.value;
  if (chatProvider) {
    localStorage.setItem("selectedChatProvider", chatProvider);
  }
  if (chatModel && chatProvider) {
    localStorage.setItem(`selectedChatModel:${chatProvider}`, chatModel);
  }
  setLoadingState(true);
  setLoadingMessage("Analysing question", "Fetching chunks and classifying relevance.");
  setLoadingProgress({
    total: 1,
    toProcess: 1,
    processed: 0,
    alreadyAnalysed: 0,
    currentTitle: recordTitle(record),
  });
  elements.analysisStatus.textContent = "Running analysis...";
  setStatus("Running analysis...");
  try {
    const startedAt = Date.now();
    const response = await fetch("/api/analyse", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        record_id: recordId,
        topK,
        chat_provider: chatProvider,
        chat_model: chatModel,
      }),
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || "Analysis failed.");
    }
    state.lastCacheRecordId = recordId;
    const cached = Boolean(payload.cached);
    elements.analysisMatches.textContent = formatNumber(payload.match_count || 0);
    elements.analysisRelevant.textContent = formatNumber(payload.relevant_count || 0);
    elements.analysisIrrelevant.textContent = formatNumber(payload.irrelevant_count || 0);
    elements.analysisFile.textContent = payload.file ? `File: ${payload.file}` : "File: -";
    setGroupDetails(payload.group_details || []);
    renderGroupBreakdown(payload.groups || []);
    elements.analysisStatus.textContent = cached
      ? "Loaded saved analysis."
      : "Analysis complete.";
    setStatus(cached ? "Loaded saved analysis." : "Analysis complete.");
    setLoadingProgress({
      total: 1,
      toProcess: 1,
      processed: 1,
      alreadyAnalysed: cached ? 1 : 0,
      currentTitle: recordTitle(record),
      avgMs: cached ? null : Date.now() - startedAt,
    });
  } catch (err) {
    elements.analysisStatus.textContent = err.message || "Analysis failed.";
    setStatus(err.message || "Analysis error.");
  } finally {
    setLoadingState(false);
  }
}

async function checkCachedAnalysis(recordId) {
  const response = await fetch("/api/analyse", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      record_id: recordId,
      cache_only: true,
    }),
  });
  if (response.ok) {
    const payload = await response.json();
    return { cached: true, payload };
  }
  if (response.status === 404) {
    return { cached: false };
  }
  const payload = await response.json();
  throw new Error(payload.error || "Failed to check analysis cache.");
}

async function runAnalysisAll() {
  if (state.isLoading) {
    return;
  }
  if (!state.filtered.length) {
    setStatus("No filtered questions to analyse.");
    return;
  }

  const eligible = state.filtered.filter((record) => getRecordId(record));
  if (!eligible.length) {
    setStatus("Filtered questions are missing record ids.");
    return;
  }

  const topK = Math.max(1, Number(elements.analysisTopK.value || DEFAULT_TOP_K));
  const chatProvider = elements.chatProviderSelect.value;
  const chatModel = elements.chatModelSelect.value;
  if (chatProvider) {
    localStorage.setItem("selectedChatProvider", chatProvider);
  }
  if (chatModel && chatProvider) {
    localStorage.setItem(`selectedChatModel:${chatProvider}`, chatModel);
  }

  setLoadingState(true);
  resetLoadingProgress();
  setLoadingMessage("Checking saved analyses", "Scanning filtered questions.");
  elements.analysisStatus.textContent = "Scanning cached analyses...";
  setStatus("Scanning cached analyses...");

  const total = eligible.length;
  const toProcess = [];
  let alreadyAnalysed = 0;

  try {
    for (let i = 0; i < eligible.length; i += 1) {
      const record = eligible[i];
      const recordId = getRecordId(record);
      const title = recordTitle(record);
      setLoadingProgress({
        total,
        toProcess: toProcess.length,
        processed: 0,
        alreadyAnalysed,
        currentTitle: `Checking ${i + 1}/${total}: ${title}`,
      });
      const cacheResult = await checkCachedAnalysis(recordId);
      if (cacheResult.cached) {
        alreadyAnalysed += 1;
      } else {
        toProcess.push(record);
      }
      setLoadingProgress({
        total,
        toProcess: toProcess.length,
        processed: 0,
        alreadyAnalysed,
        currentTitle: `Checked ${i + 1}/${total}: ${title}`,
      });
    }

    if (!toProcess.length) {
      elements.analysisStatus.textContent = "All filtered questions are already analysed.";
      setStatus("All filtered questions are already analysed.");
      return;
    }

    setLoadingMessage(
      "Analysing filtered questions",
      `Processing ${toProcess.length} new analyses.`
    );
    elements.analysisStatus.textContent = "Running batch analysis...";
    setStatus(`Running batch analysis (${toProcess.length} pending).`);

    let processed = 0;
    let totalMs = 0;

    for (let i = 0; i < toProcess.length; i += 1) {
      const record = toProcess[i];
      const recordId = getRecordId(record);
      const title = recordTitle(record);
      setLoadingProgress({
        total,
        toProcess: toProcess.length,
        processed,
        alreadyAnalysed,
        currentTitle: `Processing ${i + 1}/${toProcess.length}: ${title}`,
        avgMs: processed ? totalMs / processed : null,
      });

      const startedAt = Date.now();
      const response = await fetch("/api/analyse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          record_id: recordId,
          topK,
          chat_provider: chatProvider,
          chat_model: chatModel,
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || "Analysis failed.");
      }

      totalMs += Date.now() - startedAt;
      processed += 1;

      setLoadingProgress({
        total,
        toProcess: toProcess.length,
        processed,
        alreadyAnalysed,
        currentTitle: `Processed ${i + 1}/${toProcess.length}: ${title}`,
        avgMs: totalMs / processed,
      });
    }

    elements.analysisStatus.textContent = `Batch analysis complete. Analysed ${processed}, already analysed ${alreadyAnalysed}.`;
    setStatus(`Batch analysis complete. Analysed ${processed}, already analysed ${alreadyAnalysed}.`);
  } catch (err) {
    elements.analysisStatus.textContent = err.message || "Batch analysis failed.";
    setStatus(err.message || "Batch analysis failed.");
  } finally {
    setLoadingState(false);
    updateAnalyseAllState();
    state.lastCacheRecordId = "";
    const selectedRecord =
      state.selectedIndex !== null ? state.filtered[state.selectedIndex] : null;
    if (selectedRecord) {
      void loadCachedAnalysis(selectedRecord);
    }
  }
}

async function loadCachedAnalysis(record) {
  if (!record || state.isLoading) {
    return;
  }
  const recordId = record.record_id || record.id || record.request_id;
  if (!recordId || state.lastCacheRecordId === recordId) {
    return;
  }
  elements.analysisStatus.textContent = "Checking saved analysis...";
  try {
    const response = await fetch("/api/analyse", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        record_id: recordId,
        cache_only: true,
      }),
    });
    if (response.ok) {
      const payload = await response.json();
      state.lastCacheRecordId = recordId;
      elements.analysisMatches.textContent = formatNumber(payload.match_count || 0);
      elements.analysisRelevant.textContent = formatNumber(payload.relevant_count || 0);
      elements.analysisIrrelevant.textContent = formatNumber(payload.irrelevant_count || 0);
      elements.analysisFile.textContent = payload.file ? `File: ${payload.file}` : "File: -";
      setGroupDetails(payload.group_details || []);
      renderGroupBreakdown(payload.groups || []);
      elements.analysisStatus.textContent = "Loaded saved analysis.";
      return;
    }
    if (response.status === 404) {
      elements.analysisMatches.textContent = "0";
      elements.analysisRelevant.textContent = "0";
      elements.analysisIrrelevant.textContent = "0";
      elements.analysisFile.textContent = "File: -";
      elements.analysisStatus.textContent = "No saved analysis.";
      renderGroupBreakdown([]);
      clearGroupDetails();
      return;
    }
    const payload = await response.json();
    elements.analysisStatus.textContent = payload.error || "Failed to load analysis.";
  } catch (err) {
    elements.analysisStatus.textContent = err.message || "Failed to load analysis.";
  }
}

function renderGroupBreakdown(groups) {
  const normalizedGroups = Array.isArray(groups) ? groups : [];
  state.groupSummaries = normalizedGroups;
  elements.analysisGroups.innerHTML = "";
  if (!normalizedGroups.length) {
    const empty = document.createElement("div");
    empty.className = "analysis-group-empty";
    empty.textContent = "No breakdown yet.";
    elements.analysisGroups.appendChild(empty);
    return;
  }

  const header = document.createElement("div");
  header.className = "analysis-group-header";
  header.innerHTML = "<span>Range</span><span>Relevant</span><span>Irrelevant</span>";
  elements.analysisGroups.appendChild(header);

  normalizedGroups.forEach((group, index) => {
    const row = document.createElement("div");
    row.className = "analysis-group-row";
    const range = document.createElement("div");
    range.className = "analysis-group-range";
    range.textContent = formatGroupRange(group);
    const relevant = document.createElement("div");
    relevant.className = "analysis-group-count";
    relevant.textContent = formatNumber(group.relevant_count || 0);
    const irrelevant = document.createElement("div");
    irrelevant.className = "analysis-group-count";
    irrelevant.textContent = formatNumber(group.irrelevant_count || 0);
    row.appendChild(range);
    row.appendChild(relevant);
    row.appendChild(irrelevant);
    if (index === state.selectedGroupIndex) {
      row.classList.add("active");
    }
    row.addEventListener("click", () => {
      setSelectedGroup(index);
    });
    elements.analysisGroups.appendChild(row);
  });
}

function updateCollectionFilter(records) {
  const select = elements.analysisCollectionFilter;
  if (!select) {
    return;
  }
  const collections = Array.from(
    new Set(
      (records || [])
        .map((record) => getCollectionFromRecord(record))
        .filter(Boolean)
    )
  ).sort((a, b) => a.localeCompare(b));
  const stored = localStorage.getItem("analysisCollectionFilter") || "";
  const preferred = state.selectedCollection || stored || "";
  select.innerHTML = "";
  const allOption = document.createElement("option");
  allOption.value = "";
  allOption.textContent = "All collections";
  select.appendChild(allOption);
  collections.forEach((value) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    select.appendChild(option);
  });
  if (collections.length === 0) {
    select.disabled = true;
    select.value = "";
    state.selectedCollection = "";
    return;
  }
  if (preferred && collections.includes(preferred)) {
    select.value = preferred;
  } else {
    select.value = "";
  }
  state.selectedCollection = select.value;
  if (select.value) {
    localStorage.setItem("analysisCollectionFilter", select.value);
  } else {
    localStorage.removeItem("analysisCollectionFilter");
  }
}

function renderActionList(container, items, emptyMessage) {
  container.innerHTML = "";
  const filtered = (items || []).filter(
    (item) => item && String(item.action_point || "").trim().length > 0
  );
  if (!filtered.length) {
    const empty = document.createElement("div");
    empty.className = "analysis-action-empty";
    empty.textContent = emptyMessage;
    container.appendChild(empty);
    return;
  }
  filtered.forEach((item) => {
    const row = document.createElement("div");
    row.className = "analysis-action-item";
    const text = document.createElement("div");
    text.className = "analysis-action-text";
    text.textContent = item.action_point;
    row.appendChild(text);
    const circular = String(item.circular_name || "").trim();
    if (circular) {
      const meta = document.createElement("div");
      meta.className = "analysis-action-meta";
      meta.textContent = `Circular: ${circular}`;
      row.appendChild(meta);
    }
    container.appendChild(row);
  });
}

function setGroupDetails(details) {
  state.groupDetails = Array.isArray(details) ? details : [];
  if (!state.groupDetails.length) {
    state.selectedGroupIndex = 0;
    elements.analysisGroupSelect.innerHTML = "";
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "No groups";
    elements.analysisGroupSelect.appendChild(option);
    elements.analysisGroupSelect.disabled = true;
    elements.analysisRelevantCount.textContent = "0";
    elements.analysisIrrelevantCount.textContent = "0";
    renderActionList(elements.analysisRelevantList, [], "No relevant points.");
    renderActionList(elements.analysisIrrelevantList, [], "No irrelevant points.");
    return;
  }
  elements.analysisGroupSelect.disabled = false;
  elements.analysisGroupSelect.innerHTML = "";
  state.groupDetails.forEach((group, index) => {
    const option = document.createElement("option");
    option.value = String(index);
    option.textContent = formatGroupRange(group);
    elements.analysisGroupSelect.appendChild(option);
  });
  if (state.selectedGroupIndex >= state.groupDetails.length) {
    state.selectedGroupIndex = 0;
  }
  elements.analysisGroupSelect.value = String(state.selectedGroupIndex);
  renderGroupItems(state.groupDetails[state.selectedGroupIndex]);
}

function renderGroupItems(group) {
  const relevant = group && Array.isArray(group.relevant) ? group.relevant : [];
  const irrelevant = group && Array.isArray(group.irrelevant) ? group.irrelevant : [];
  elements.analysisRelevantCount.textContent = formatNumber(relevant.length);
  elements.analysisIrrelevantCount.textContent = formatNumber(irrelevant.length);
  renderActionList(elements.analysisRelevantList, relevant, "No relevant points.");
  renderActionList(elements.analysisIrrelevantList, irrelevant, "No irrelevant points.");
}

function setSelectedGroup(index) {
  if (!state.groupDetails.length) {
    return;
  }
  const maxIndex = state.groupDetails.length - 1;
  const nextIndex = Math.min(Math.max(Number(index) || 0, 0), maxIndex);
  state.selectedGroupIndex = nextIndex;
  elements.analysisGroupSelect.value = String(nextIndex);
  renderGroupItems(state.groupDetails[nextIndex]);
  renderGroupBreakdown(state.groupSummaries);
}

function clearGroupDetails() {
  state.groupDetails = [];
  state.groupSummaries = [];
  state.selectedGroupIndex = 0;
  if (elements.analysisGroupSelect) {
    elements.analysisGroupSelect.innerHTML = "";
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "No groups";
    elements.analysisGroupSelect.appendChild(option);
    elements.analysisGroupSelect.disabled = true;
  }
  if (elements.analysisRelevantCount) {
    elements.analysisRelevantCount.textContent = "0";
  }
  if (elements.analysisIrrelevantCount) {
    elements.analysisIrrelevantCount.textContent = "0";
  }
  if (elements.analysisRelevantList) {
    renderActionList(elements.analysisRelevantList, [], "No relevant points.");
  }
  if (elements.analysisIrrelevantList) {
    renderActionList(elements.analysisIrrelevantList, [], "No irrelevant points.");
  }
}

function init() {
  const storedLimit = Number(
    localStorage.getItem("analysisLimit") || DEFAULT_LIMIT
  );
  const storedTopK = Number(localStorage.getItem("analysisTopK") || DEFAULT_TOP_K);
  elements.analysisLimit.value = storedLimit;
  elements.analysisTopK.value = storedTopK;
  elements.analysisStatus.textContent = "Ready.";
  state.pendingFocusId = localStorage.getItem("analysisFocusId") || "";
  if (state.pendingFocusId) {
    localStorage.removeItem("analysisFocusId");
  }

  loadProviders()
    .then(() => loadHistory())
    .catch((err) => {
      setStatus(err.message || "Failed to load providers.");
    });

  elements.refreshAnalysis.addEventListener("click", () => loadHistory());
  elements.analysisLimit.addEventListener("change", () => loadHistory());
  elements.analysisSearch.addEventListener("input", () => applyFilters());
  elements.analysisTopK.addEventListener("change", () => {
    const topK = Math.max(1, Number(elements.analysisTopK.value || DEFAULT_TOP_K));
    localStorage.setItem("analysisTopK", String(topK));
  });
  elements.analysisCollectionFilter.addEventListener("change", () => {
    const selected = elements.analysisCollectionFilter.value || "";
    state.selectedCollection = selected;
    if (selected) {
      localStorage.setItem("analysisCollectionFilter", selected);
    } else {
      localStorage.removeItem("analysisCollectionFilter");
    }
    applyFilters();
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
  elements.analysisGroupSelect.addEventListener("change", () => {
    setSelectedGroup(elements.analysisGroupSelect.value);
  });
  elements.analyseButton.addEventListener("click", () => runAnalysis());
  if (elements.analyseAllButton) {
    elements.analyseAllButton.addEventListener("click", () => runAnalysisAll());
  }
}

init();
