import { formatMoney } from "./utils.js";

const state = {
  transactions: []
};

function renderTables() {
  const allowedTBody = document.getElementById("allowed-table-body");
  const susTBody = document.getElementById("sus-table-body");
  const blockedTBody = document.getElementById("blocked-table-body");

  const allowedCount = document.getElementById("allowed-count");
  const susCount = document.getElementById("sus-count");
  const blockedCount = document.getElementById("blocked-count");

  const allowedSearch = document.getElementById("allowed-search");
  const susSearch = document.getElementById("sus-search");
  const blockedSearch = document.getElementById("blocked-search");

  const allowedTerm = allowedSearch ? allowedSearch.value.toLowerCase().trim() : "";
  const susTerm = susSearch ? susSearch.value.toLowerCase().trim() : "";
  const blockedTerm = blockedSearch ? blockedSearch.value.toLowerCase().trim() : "";

  const localMatch = (item, localTerm) => {
    if (!localTerm) return true;
    return Object.values(item).join(" ").toLowerCase().includes(localTerm);
  };

  const allowed = state.transactions.filter(
    t => t.Decision_Segment === "Allowed" && localMatch(t, allowedTerm)
  );
  const susp = state.transactions.filter(
    t => t.Decision_Segment === "Suspicious" && localMatch(t, susTerm)
  );
  const blocked = state.transactions.filter(
    t => t.Decision_Segment === "Blocked" && localMatch(t, blockedTerm)
  );

  allowedCount.textContent = `${allowed.length} Users`;
  susCount.textContent = `${susp.length} Users`;
  blockedCount.textContent = `${blocked.length} Users`;

  const rowHtml = (t, colorClass) => `
    <tr style="transition: all 0.2s;">
      <td style="font-weight: 600; color: #334155;">${t.user_id || "Unknown"}</td>
      <td style="font-family: monospace; color: #14B8A6; font-weight: 500;">${t.ip_address || t.location_ip || "192.168.1.x"}</td>
      <td style="color: #3B82F6; font-weight: 700;">${formatMoney(Number(t.monetary_avg || 0))}</td>
      <td style="color: #8B5CF6; font-weight: 600;">${t.frequency_90d || 0} Txns</td>
      <td style="color: #F59E0B; font-weight: 600;">${t.recency_days || 0} Days</td>
    </tr>
  `;

  allowedTBody.innerHTML = allowed.map(t => rowHtml(t, "success")).join("");
  susTBody.innerHTML = susp.map(t => rowHtml(t, "warning")).join("");
  blockedTBody.innerHTML = blocked.map(t => rowHtml(t, "error")).join("");
}

function initChatbot() {
  const btn = document.getElementById("ai-chatbot-btn");
  const windowEl = document.getElementById("ai-chat-window");
  const input = document.getElementById("ai-chat-input");
  const submitBtn = document.getElementById("ai-chat-submit");
  const messages = document.getElementById("ai-chat-messages");

  if (!btn || !windowEl) return;

  const navEntry = window.performance?.getEntriesByType("navigation")[0];
  if (navEntry && navEntry.type === "reload") {
    sessionStorage.removeItem("ai_chat_history");
  }

  messages.innerHTML = "";
  const history = JSON.parse(sessionStorage.getItem("ai_chat_history") || "[]");

  function addMessage(text, isUser, id = null, save = true) {
    const msg = document.createElement("div");
    msg.className = `chat-msg ${isUser ? "user" : "bot"}`;
    if (id) msg.id = id;

    if (!isUser && typeof marked !== "undefined") {
      msg.innerHTML = marked.parse(text);
    } else {
      msg.textContent = text;
    }

    messages.appendChild(msg);
    messages.scrollTop = messages.scrollHeight;

    if (save) {
      const hist = JSON.parse(sessionStorage.getItem("ai_chat_history") || "[]");
      hist.push({ text, isUser });
      sessionStorage.setItem("ai_chat_history", JSON.stringify(hist));
    }
  }

  if (history.length === 0) {
    addMessage("Hi there! I am your AI assistant. Do you have any questions about this filtered ML Output data?", false, null, true);
  } else {
    history.forEach(m => addMessage(m.text, m.isUser, null, false));
  }

  if (input) input.value = "";

  btn.addEventListener("click", () => {
    windowEl.classList.toggle("active");
    if (windowEl.classList.contains("active")) {
      input.focus();
    }
  });

  async function handleSend() {
    const text = input.value.trim();
    if (!text) return;
    addMessage(text, true);
    input.value = "";

    const loadingId = `loader-${Date.now()}`;
    addMessage("...", false, loadingId, false);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: text, context: { page: "Classification", data_points: state.transactions.length } })
      });
      const data = await res.json();
      const loader = document.getElementById(loadingId);
      if (loader) loader.remove();
      addMessage(data.reply || data.error || "An error occurred.", false);
    } catch (e) {
      const loader = document.getElementById(loadingId);
      if (loader) loader.remove();
      addMessage("Connection to intelligence server failed.", false);
    }
  }

  submitBtn.addEventListener("click", handleSend);
  input.addEventListener("keypress", event => {
    if (event.key === "Enter") handleSend();
  });
}

function bootstrap() {
  initChatbot();

  const btnAllowed = document.getElementById("btn-allowed");
  const btnSus = document.getElementById("btn-sus");
  const btnBlocked = document.getElementById("btn-blocked");

  const secAllowed = document.getElementById("section-allowed");
  const secSus = document.getElementById("section-sus");
  const secBlocked = document.getElementById("section-blocked");

  function resetTabs() {
    btnAllowed.style.background = "#fff";
    btnSus.style.background = "#fff";
    btnBlocked.style.background = "#fff";
    secAllowed.style.display = "none";
    secSus.style.display = "none";
    secBlocked.style.display = "none";
  }

  btnAllowed.addEventListener("click", () => {
    resetTabs();
    btnAllowed.style.background = "rgba(16, 185, 129, 0.1)";
    secAllowed.style.display = "block";
  });

  btnSus.addEventListener("click", () => {
    resetTabs();
    btnSus.style.background = "rgba(245, 158, 11, 0.1)";
    secSus.style.display = "block";
  });

  btnBlocked.addEventListener("click", () => {
    resetTabs();
    btnBlocked.style.background = "rgba(239, 68, 68, 0.1)";
    secBlocked.style.display = "block";
  });

  document.getElementById("allowed-search")?.addEventListener("input", renderTables);
  document.getElementById("sus-search")?.addEventListener("input", renderTables);
  document.getElementById("blocked-search")?.addEventListener("input", renderTables);

  const storedCsv = sessionStorage.getItem("ml_dataset");
  if (storedCsv) {
    try {
      state.transactions = JSON.parse(storedCsv);
      document.getElementById("classification-content").style.display = "block";
      document.getElementById("no-data-alert").style.display = "none";
      renderTables();
    } catch (e) {
      document.getElementById("no-data-alert").style.display = "block";
    }
  } else {
    document.getElementById("no-data-alert").style.display = "block";
  }
}

document.addEventListener("DOMContentLoaded", bootstrap);
