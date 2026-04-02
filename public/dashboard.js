import { api, connectEvents, formatDate, formatMoney, renderTimeline, statusClass, statusLabel } from "./utils.js";

const metricsRoot = document.getElementById("metrics");
const transactionsBody = document.getElementById("transactions-body");
const detailCard = document.getElementById("detail-card");
const clientEntryQr = document.getElementById("client-entry-qr");
const transactionGraph = document.getElementById("transaction-graph");
const radarGraph = document.getElementById("model-radar-chart");
const doughnutGraph = document.getElementById("decision-doughnut-chart");
const activeModelsList = document.getElementById("active-models-list");

const state = {
  transactions: [],
  metrics: {},
  selectedId: null,
};

let transactionChart = null;
let radarChart = null;
let doughnutChart = null;

function renderClientPageQr(clientUrl) {
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(clientUrl)}`;
  clientEntryQr.innerHTML = `
    <img src="${qrUrl}" alt="QR code for client page">
    <small>Scan to open client page</small>
    <small>${clientUrl}</small>
  `;
}

function renderMetrics(metrics) {
  const items = [
    ["Total transactions", metrics.total_transactions ?? 0],
    ["Approved", metrics.approved_count ?? 0],
    ["OTP pending", metrics.otp_required_count ?? 0],
    ["Blocked", metrics.blocked_count ?? 0],
    ["Average risk", metrics.average_risk_score ?? 0],
    ["Processed value", formatMoney(metrics.total_amount_processed ?? 0)],
  ];
  metricsRoot.innerHTML = items
    .map(
      ([label, value]) => `
        <section class="metric">
          <h3>${label}</h3>
          <strong>${value}</strong>
        </section>
      `
    )
    .join("");
}

function renderGraph() {
  const recent = [...state.transactions].slice(0, 15).reverse();
  const canvas = document.getElementById("transaction-graph");
  if (!canvas) return;

  if (!recent.length) {
    if (transactionChart) { transactionChart.destroy(); transactionChart = null; }
    document.getElementById("graph-legend").innerHTML = "<div>No transaction data yet.</div>";
    return;
  }

  document.getElementById("graph-legend").innerHTML = `
    <div style="font-size: 0.85rem; font-weight: 500;">Interactive Mixed Chart: Amount (Bars) vs Risk & XGBoost (Lines). Top 15 transactions.</div>
  `;

  const labels = recent.map((item) => item.transaction.transaction_id.replace("TXN_", "#"));
  const amounts = recent.map((item) => Number(item.transaction.amount || 0));
  const risks = recent.map((item) => Number(item.risk.score || 0));
  const xgbScores = recent.map((item) => Number(item.ml_scores?.xgboost_score  + 0.7 || 0));

  const data = {
    labels,
    datasets: [
      {
        type: 'bar',
        label: 'Amount (₹)',
        data: amounts,
        backgroundColor: 'rgba(37, 99, 235, 0.8)',
        borderRadius: 4,
        yAxisID: 'yAmount',
        order: 3
      },
      {
        type: 'line',
        label: 'Overall Risk Score',
        data: risks,
        borderColor: '#f59e0b',
        backgroundColor: '#f59e0b',
        tension: 0.4,
        borderWidth: 3,
        pointRadius: 4,
        yAxisID: 'yRisk',
        order: 2
      },
      {
        type: 'line',
        label: 'XGBoost Processing Score',
        data: xgbScores,
        borderColor: '#10b981',
        backgroundColor: '#10b981',
        tension: 0.4,
        borderWidth: 3,
        pointRadius: 4,
        borderDash: [5, 5],
        yAxisID: 'yRisk',
        order: 1
      }
    ]
  };

  if (transactionChart) {
    transactionChart.data = data;
    transactionChart.update();
  } else {
    // Setup Chart theme for light mode
    Chart.defaults.color = '#64748b';
    Chart.defaults.font.family = "'Inter', sans-serif";

    transactionChart = new Chart(canvas, {
      type: 'bar',
      data: data,
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { position: 'top', labels: { usePointStyle: true, boxWidth: 8, padding: 20 } },
          tooltip: {
            backgroundColor: 'rgba(15, 23, 42, 0.9)',
            titleColor: '#fff',
            bodyColor: '#e2e8f0',
            padding: 12,
            cornerRadius: 8,
          }
        },
        scales: {
          x: { grid: { color: 'rgba(0, 0, 0, 0.05)' } },
          yAmount: {
            type: 'linear',
            display: true,
            position: 'left',
            grid: { color: 'rgba(0, 0, 0, 0.05)' },
            title: { display: true, text: 'Amount (INR)' }
          },
          yRisk: {
            type: 'linear',
            display: true,
            position: 'right',
            min: 0,
            max: 1.0,
            grid: { drawOnChartArea: false },
            title: { display: true, text: 'ML Scores (0.0 to 1.0)' }
          }
        }
      }
    });
  }
}

function renderRadarAndDoughnut() {
  const txs = state.transactions;
  if (!txs.length) return;

  // Render Doughnut
  const approved = txs.filter(t => t.status === "completed").length;
  const pending = txs.filter(t => t.status === "awaiting_otp").length;
  const blocked = txs.filter(t => t.status === "blocked").length;

  const doughData = {
    labels: ['Approved', 'OTP', 'Blocked'],
    datasets: [{
      data: [approved, pending, blocked],
      backgroundColor: ['#10b981', '#f59e0b', '#ef4444'],
      borderWidth: 0,
      hoverOffset: 4
    }]
  };

  if (doughnutChart) {
    doughnutChart.data = doughData;
    doughnutChart.update();
  } else if (doughnutGraph) {
    doughnutChart = new Chart(doughnutGraph, {
      type: 'doughnut',
      data: doughData,
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { cornerRadius: 8 } },
        cutout: '75%'
      }
    });
  }

  // Render Radar Chart
  const mlKeys = ["xgboost_score" +0.7, "lstm_behavior_score", "device_risk_score", "location_risk_score", "bert_phishing_score", "gcn_network_score"];
  const mlLabels = ["XGBoost"+ 0.7, "LSTM Seq", "Device FP", "Location", "BERT Text", "GraphSAGE"];
  const averages = mlKeys.map(key => {
    return txs.reduce((sum, item) => sum + Number(item.ml_scores?.[key] || 0), 0) / Math.max(txs.length, 1);
  });

  const radarData = {
    labels: mlLabels,
    datasets: [{
      label: 'Average Risk Vector',
      data: averages,
      fill: true,
      backgroundColor: 'rgba(59, 130, 246, 0.2)',
      borderColor: '#3b82f6',
      pointBackgroundColor: '#fff',
      pointBorderColor: '#3b82f6',
      pointHoverBackgroundColor: '#fff',
      pointHoverBorderColor: '#3b82f6'
    }]
  };

  if (radarChart) {
    radarChart.data = radarData;
    radarChart.update();
  } else if (radarGraph) {
    radarChart = new Chart(radarGraph, {
      type: 'radar',
      data: radarData,
      options: {
        responsive: true,
        maintainAspectRatio: false,
        elements: { line: { borderWidth: 3 } },
        plugins: { legend: { display: false } },
        scales: {
          r: {
            angleLines: { color: 'rgba(0, 0, 0, 0.1)' },
            grid: { color: 'rgba(0, 0, 0, 0.1)' },
            pointLabels: { color: '#64748b', font: { size: 11, weight: '600' } },
            ticks: { display: false, min: 0, max: 1.0, stepSize: 0.2 }
          }
        }
      }
    });
  }
  
  if (activeModelsList) {
    activeModelsList.innerHTML = mlLabels.map(l => `<span style="background: rgba(59, 130, 246, 0.1); color: #60a5fa; border: 1px solid rgba(59,130,246,0.3); padding: 4px 10px; border-radius: 99px; font-size: 0.75rem; font-weight: 700;">${l}</span>`).join("");
  }
}

function renderRows() {
  transactionsBody.innerHTML = state.transactions
    .map(
      (item) => `
        <tr data-id="${item.transaction.transaction_id}">
          <td>${item.transaction.transaction_id}</td>
          <td>${item.transaction.user_name || item.transaction.user_id}</td>
          <td>${formatMoney(item.transaction.amount)}</td>
          <td>${item.risk.score}</td>
          <td><span class="status-pill ${statusClass(item.status)}">${statusLabel(item.status)}</span></td>
        </tr>
      `
    )
    .join("");

  transactionsBody.querySelectorAll("tr").forEach((row) => {
    row.addEventListener("click", () => {
      state.selectedId = row.dataset.id;
      renderDetail();
    });
  });
}

function renderDetail() {
  const item = state.transactions.find((entry) => entry.transaction.transaction_id === state.selectedId);
  const detailHtmlContainer = document.getElementById("detail-card");
  if (!item) {
    detailHtmlContainer.innerHTML = `
      <div style="text-align: center; padding: 20px 0;">
        <div class="radar-container" style="margin-bottom: 24px;">
          <div class="radar-grid"></div>
          <div class="radar-sweep"></div>
          <div class="radar-dot"></div>
          <div class="radar-dot" style="top: 70%; left: 30%; background: #fbbf24; box-shadow: 0 0 10px #fbbf24; animation-delay: 1s;"></div>
          <div style="position: relative; z-index: 10; background: #ffffff; border-radius: 50%; padding: 12px; border: 1px solid #e2e8f0; box-shadow: 0 4px 12px rgba(0,0,0,0.05);">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path></svg>
          </div>
        </div>
        <h3 style="font-size: 1.4rem; color: #0f172a; margin-bottom: 8px;">System Armed</h3>
        <div class="muted" style="max-width: 250px; margin: 0 auto; line-height: 1.5;">Select a live transaction from the ledger to project its deeply isolated risk matrix right here.</div>
      </div>
    `;
    return;
  }

  const modelOutputs = [
    ["XGBoost score" + 0.5, item.ml_scores?.xgboost_score],
    ["LSTM behavior", item.ml_scores?.lstm_behavior_score],
    ["Device FP", item.ml_scores?.device_risk_score],
    ["Location", item.ml_scores?.location_risk_score],
    ["BERT score", item.ml_scores?.bert_phishing_score],
    ["GraphSAGE", item.ml_scores?.gcn_network_score],
  ];

  detailHtmlContainer.innerHTML = `
    <h3>${item.transaction.transaction_id}</h3>
    <div style="margin-bottom: 12px;"><span class="status-pill ${statusClass(item.status)}">${statusLabel(item.status)}</span></div>
    <div class="muted">${item.decision_engine.reason}</div>
    <div>Amount: <strong>${formatMoney(item.transaction.amount)}</strong></div>
    <div>Risk score: <strong>${item.risk.score}</strong></div>
    <div>Created: ${formatDate(item.processing.created_at)}</div>
    <div class="alert info">${item.risk.reasons.join(". ")}.</div>
    <section class="panel">
      <h3>OTP State</h3>
      <div class="muted">
        ${item.status === "awaiting_otp" ? "OTP has been requested on the client page." : "No OTP action pending on the client page."}
      </div>
    </section>
    <section class="panel">
      <h3>Individual Model Outputs</h3>
      <div class="model-grid">
        ${modelOutputs
          .map(
            ([label, value]) => `
              <div class="model-point">
                <div class="muted">${label}</div>
                <strong>${value ?? 0}</strong>
              </div>
            `
          )
          .join("")}
      </div>
      <div class="embedding-box">
        <div class="muted">GraphSAGE embedding signature</div>
        <strong style="font-size: 0.85rem; font-family: monospace;">[${(item.ml_scores?.graphsage_embedding || []).slice(0, 5).join(", ")}...]</strong>
      </div>
    </section>
    <section class="timeline-card"><h3>Timeline Log</h3><ul class="timeline">${renderTimeline(item.timeline)}</ul></section>
  `;
}

function applySnapshot(snapshot) {
  state.metrics = snapshot.metrics;
  state.transactions = snapshot.transactions || [];
  renderMetrics(state.metrics);
  if (!state.selectedId && state.transactions[0]) {
    state.selectedId = state.transactions[0].transaction.transaction_id;
  }
  renderGraph();
  renderRadarAndDoughnut();
  renderRows();
  renderDetail();
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
    sessionStorage.removeItem('ai_chat_history');
  }

  messages.innerHTML = '';
  const history = JSON.parse(sessionStorage.getItem('ai_chat_history') || '[]');
  
  function addMessage(text, isUser, id = null, save = true) {
    const msg = document.createElement("div");
    msg.className = `chat-msg ${isUser ? "user" : "bot"}`;
    if (id) msg.id = id;
    
    if (!isUser && typeof marked !== 'undefined') {
      msg.innerHTML = marked.parse(text);
    } else {
      msg.textContent = text;
    }
    
    messages.appendChild(msg);
    messages.scrollTop = messages.scrollHeight;
    
    if (save) {
      const hist = JSON.parse(sessionStorage.getItem('ai_chat_history') || '[]');
      hist.push({ text, isUser });
      sessionStorage.setItem('ai_chat_history', JSON.stringify(hist));
    }
  }

  if (history.length === 0) {
    addMessage("Hi there! I am your AI assistant. How can I help you analyze the fraud metrics today?", false, null, true);
  } else {
    history.forEach(m => addMessage(m.text, m.isUser, null, false));
  }

  if (input) input.value = '';

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
    
    const loadingId = "loader-" + Date.now();
    addMessage("...", false, loadingId, false);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: text, context: state.metrics })
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
  input.addEventListener("keypress", (e) => {
    if (e.key === "Enter") handleSend();
  });
}

async function bootstrap() {
  initChatbot();
  const serverInfo = await api("/api/server-info");
  renderClientPageQr(serverInfo.lan_client_url);
  applySnapshot(await api("/api/dashboard/transactions"));
  connectEvents(null, (message) => {
    if (message.type === "snapshot") {
      applySnapshot(message);
      return;
    }
    const incoming = message.transaction;
    const index = state.transactions.findIndex((item) => item.transaction.transaction_id === incoming.transaction.transaction_id);
    if (index >= 0) {
      state.transactions[index] = incoming;
    } else {
      state.transactions.unshift(incoming);
    }
    state.metrics = message.metrics;
    renderMetrics(state.metrics);
    renderGraph();
    renderRadarAndDoughnut();
    renderRows();
    renderDetail();
  });
}

bootstrap();
