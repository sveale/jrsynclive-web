const LOADS_KEY = "loads::all";
const POLL_INTERVAL_MS = 10_000;

const appEl = document.getElementById("app");
const loadsEl = document.getElementById("loads");
const metaEl = document.getElementById("meta");
const errorEl = document.getElementById("error");

const redisUrl = appEl?.dataset.redisUrl ?? "";
const redisToken = appEl?.dataset.redisToken ?? "";
const STATUS_CLASS_NAMES = ["load--in-air", "load--planned", "load--landed"];
const updateSkyAnimationState = (hasLoads) => {
  window.dispatchEvent(
    new CustomEvent("manifest:loads-state", {
      detail: { hasLoads: Boolean(hasLoads) }
    })
  );
};

const cardState = new Map();
let lastDataSignature = "";
let showingEmpty = false;

const setError = (message = "") => {
  if (!errorEl) {
    return;
  }

  if (!message) {
    errorEl.style.display = "none";
    errorEl.textContent = "";
    return;
  }

  errorEl.style.display = "block";
  errorEl.textContent = message;
};

const asArray = (value) => {
  if (Array.isArray(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  return [];
};

const clearNode = (node) => {
  if (!node) {
    return;
  }

  while (node.firstChild) {
    node.removeChild(node.firstChild);
  }
};

const getLoadKey = (load, index) => {
  const loadNumber = load?.loadNumber;
  if (loadNumber === null || loadNumber === undefined) {
    return `index:${index}`;
  }

  return `load:${String(loadNumber)}`;
};

const normalizeParticipants = (load) =>
  Array.isArray(load?.loadParticipants) ? load.loadParticipants : [];

const normalizeLoads = (loads) =>
  [...loads]
    .sort((a, b) => {
      const aNum = Number(a?.loadNumber ?? 0);
      const bNum = Number(b?.loadNumber ?? 0);
      return bNum - aNum;
    })
    .map((load, index) => ({
      key: getLoadKey(load, index),
      loadNumber: load?.loadNumber ?? "?",
      status: load?.status ?? "Ukjent",
      participants: normalizeParticipants(load).map((person) => ({
        name: person?.name ?? "Ukjent",
        jumpType: person?.jumpType ?? ""
      }))
    }));

const computeDataSignature = (normalizedLoads) => JSON.stringify(normalizedLoads);

const getStatusKey = (status) => String(status ?? "").trim().toLocaleUpperCase("nb-NO");

const getStatusClassName = (status) => {
  const key = getStatusKey(status);
  if (key === "I LUFTEN") {
    return "load--in-air";
  }

  if (key === "PLANLAGT") {
    return "load--planned";
  }

  if (key === "LANDET") {
    return "load--landed";
  }

  return "";
};

const setCardStatusVisuals = (card, statusEl, status) => {
  for (const className of STATUS_CLASS_NAMES) {
    card.classList.remove(className);
  }

  const statusClass = getStatusClassName(status);
  if (statusClass) {
    card.classList.add(statusClass);
  }

  statusEl.textContent = status;
};

const createParticipantsList = (participants) => {
  const participantsEl = document.createElement("ul");
  participantsEl.className = "participants";

  if (!participants.length) {
    const emptyParticipant = document.createElement("li");
    const label = document.createElement("span");
    label.className = "name";
    label.textContent = "Ingen deltakere";
    emptyParticipant.appendChild(label);
    participantsEl.appendChild(emptyParticipant);
    return participantsEl;
  }

  for (const person of participants) {
    const row = document.createElement("li");

    const name = document.createElement("span");
    name.className = "name";
    name.textContent = person.name;

    const jumpType = document.createElement("span");
    jumpType.className = "jump-type";
    jumpType.textContent = person.jumpType;

    row.append(name, jumpType);
    participantsEl.appendChild(row);
  }

  return participantsEl;
};

const createCard = (normalizedLoad) => {
  const card = document.createElement("article");
  card.className = "load";
  card.dataset.loadKey = normalizedLoad.key;

  const head = document.createElement("header");
  head.className = "load-head";

  const title = document.createElement("h2");
  title.className = "load-title";
  title.textContent = `Løft #${normalizedLoad.loadNumber}`;

  const status = document.createElement("span");
  status.className = "status";
  setCardStatusVisuals(card, status, normalizedLoad.status);

  head.append(title, status);

  const participantsEl = createParticipantsList(normalizedLoad.participants);
  card.append(head, participantsEl);

  return {
    card,
    title,
    status,
    participantsEl,
    signature: JSON.stringify(normalizedLoad)
  };
};

const patchParticipants = (participantsEl, participants) => {
  const next = createParticipantsList(participants);
  participantsEl.replaceWith(next);
  return next;
};

const patchCard = (entry, normalizedLoad, nextSignature) => {
  entry.title.textContent = `Løft #${normalizedLoad.loadNumber}`;
  setCardStatusVisuals(entry.card, entry.status, normalizedLoad.status);
  entry.participantsEl = patchParticipants(entry.participantsEl, normalizedLoad.participants);
  entry.signature = nextSignature;
};

const renderEmpty = () => {
  if (!loadsEl) {
    return;
  }

  if (showingEmpty) {
    return;
  }

  clearNode(loadsEl);
  cardState.clear();

  const empty = document.createElement("div");
  empty.className = "empty";
  empty.textContent = "Ingen løft funnet. Kontakt HFL.";

  loadsEl.appendChild(empty);
  showingEmpty = true;
  lastDataSignature = "";
};

const renderLoads = (loads) => {
  if (!loadsEl) {
    return;
  }

  if (!loads.length) {
    renderEmpty();
    return;
  }

  if (showingEmpty) {
    clearNode(loadsEl);
    showingEmpty = false;
  }

  const normalizedLoads = normalizeLoads(loads);
  const nextDataSignature = computeDataSignature(normalizedLoads);

  if (nextDataSignature === lastDataSignature) {
    return;
  }

  lastDataSignature = nextDataSignature;

  const seenKeys = new Set();

  normalizedLoads.forEach((normalizedLoad, index) => {
    seenKeys.add(normalizedLoad.key);

    const existingEntry = cardState.get(normalizedLoad.key);
    let entry = existingEntry;
    const nextSignature = JSON.stringify(normalizedLoad);

    if (!entry) {
      entry = createCard(normalizedLoad);
      cardState.set(normalizedLoad.key, entry);
    } else if (entry.signature !== nextSignature) {
      patchCard(entry, normalizedLoad, nextSignature);
    }

    const expectedNodeAtIndex = loadsEl.children[index] ?? null;
    if (entry.card !== expectedNodeAtIndex) {
      loadsEl.insertBefore(entry.card, expectedNodeAtIndex);
    }
  });

  for (const [key, entry] of cardState.entries()) {
    if (!seenKeys.has(key)) {
      entry.card.remove();
      cardState.delete(key);
    }
  }
};

const formatTimestamp = (date) =>
  new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).format(date);

const setBusy = (value) => {
  if (loadsEl) {
    loadsEl.setAttribute("aria-busy", value ? "true" : "false");
  }
};

const fetchLoads = async () => {
  if (!metaEl) {
    return;
  }

  if (!redisUrl || !redisToken) {
    updateSkyAnimationState(false);
    setError("Mangler konfigurasjon for Upstash URL/token.");
    renderEmpty();
    setBusy(false);
    metaEl.textContent = "Konfigurasjon mangler";
    return;
  }

  try {
    const response = await fetch(`${redisUrl}/get/${encodeURIComponent(LOADS_KEY)}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${redisToken}`
      },
      cache: "no-store"
    });

    if (!response.ok) {
      throw new Error(`Request failed (${response.status})`);
    }

    const payload = await response.json();
    const loads = asArray(payload?.result);

    updateSkyAnimationState(loads.length > 0);
    renderLoads(loads);
    setError();
    metaEl.textContent = `Sist oppdatert: ${formatTimestamp(new Date())}`;
  } catch (error) {
    console.error("Klarte ikke hente loads::all", error);
    setError("Kunne ikke hente løft nå. Prøver igjen om 10 sekunder.");
    metaEl.textContent = "Oppdatering feilet";
  } finally {
    setBusy(false);
  }
};

if (appEl && loadsEl && metaEl && errorEl) {
  updateSkyAnimationState(false);
  setBusy(true);
  fetchLoads();
  setInterval(fetchLoads, POLL_INTERVAL_MS);
}
