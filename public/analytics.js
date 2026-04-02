import { api, connectEvents, formatDate, formatMoney, statusLabel } from "./utils.js";

const metricsRoot = document.getElementById("analytics-metrics");
const graphRoot = document.getElementById("analytics-graph");
const decisionBreakdown = document.getElementById("decision-breakdown");
const modelSummary = document.getElementById("model-summary");
const analyticsList = document.getElementById("analytics-list");

const state = {
  transactions: [],
  metrics: {},
};

let analyticsChart = null;

function renderMetrics() {
  const items = [
    ["Total transactions", state.metrics.total_transactions ?? 0],
    ["Approved", state.metrics.approved_count ?? 0],
    ["OTP pending", state.metrics.otp_required_count ?? 0],
    ["Blocked", state.metrics.blocked_count ?? 0],
    ["Average risk", state.metrics.average_risk_score ?? 0],
    ["Total processed", formatMoney(state.metrics.total_amount_processed ?? 0)],
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
  const recent = [...state.transactions].slice(0, 20).reverse();
  const canvas = document.getElementById("analytics-graph");
  if (!canvas) return;

  if (!recent.length) {
    if (analyticsChart) { analyticsChart.destroy(); analyticsChart = null; }
    return;
  }

  const labels = recent.map((item) => item.transaction.transaction_id.replace("TXN_", "#"));
  const amounts = recent.map((item) => Number(item.transaction.amount || 0));
  const risks = recent.map((item) => Number(item.risk.score || 0));
  const xgbScores = recent.map((item) => Number(item.ml_scores?.xgboost_score || 0));

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
        label: 'XGBoost Processing Model',
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

  if (analyticsChart) {
    analyticsChart.data = data;
    analyticsChart.update();
  } else {
    Chart.defaults.color = '#94a3b8';
    Chart.defaults.font.family = "'Inter', sans-serif";

    analyticsChart = new Chart(canvas, {
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
            title: { display: true, text: 'Transaction Size' }
          },
          yRisk: {
            type: 'linear',
            display: true,
            position: 'right',
            min: 0,
            max: 1.0,
            grid: { drawOnChartArea: false },
            title: { display: true, text: 'Confidence (0-1)' }
          }
        }
      }
    });
  }
}

function renderDecisionBreakdown() {
  const groups = {
    Approved: state.transactions.filter((item) => item.status === "completed").length,
    OtpPending: state.transactions.filter((item) => item.status === "awaiting_otp").length,
    Blocked: state.transactions.filter((item) => item.status === "blocked").length,
  };

  decisionBreakdown.innerHTML = Object.entries(groups)
    .map(
      ([label, value]) => `
        <div class="data-point analytics-stat">
          <div class="muted">${label}</div>
          <strong>${value}</strong>
        </div>
      `
    )
    .join("");
}

function renderModelSummary() {
  const txs = state.transactions;
  if (!txs.length) {
    modelSummary.innerHTML = `<div class="alert info">No model output summary available yet.</div>`;
    return;
  }

  const keys = [
    "xgboost_score",
    "lstm_behavior_score",
    "device_risk_score",
    "location_risk_score",
    "refund_fraud_score",
    "bert_phishing_score",
    "gcn_network_score",
    "final_risk_score",
    "model_confidence",
  ];

  modelSummary.innerHTML = keys
    .map((key) => {
      const avg =
        txs.reduce((sum, item) => sum + Number(item.ml_scores?.[key] || 0), 0) / Math.max(txs.length, 1);
      return `
        <div class="model-point">
          <div class="muted">${key.replace(/_/g, " ")}</div>
          <strong>${avg.toFixed(2)}</strong>
        </div>
      `;
    })
    .join("");
}

function renderLatestList() {
  const latest = [...state.transactions].slice(0, 6);
  analyticsList.innerHTML = latest.length
    ? latest
        .map(
          (item) => `
            <article class="analytics-list-item">
              <div class="analytics-list-top">
                <strong>${item.transaction.user_name || item.transaction.user_id}</strong>
                <span class="status-pill ${item.status ? `status-${item.status}` : ""}">${statusLabel(item.status)}</span>
              </div>
              <div class="muted">${item.transaction.transaction_id} | ${formatDate(item.processing.created_at)}</div>
              <div class="analytics-list-bottom">
                <span>${formatMoney(item.transaction.amount)}</span>
                <span>Risk ${item.risk.score}</span>
              </div>
            </article>
          `
        )
        .join("")
    : `<div class="alert info">No transactions yet.</div>`;
}

function renderScatter() {
  const scatterGraph = document.getElementById("scatter-graph");
  const txs = state.transactions;
  if (!txs.length || !scatterGraph) return;

  const dataPoints = txs.map(t => {
    const amt = Number(t.transaction.amount || 0);
    const risk = Number(t.risk.score || 0);
    return {
      x: amt,
      y: risk,
      r: Math.min(Math.max(amt / 5000, 5), 25),
      label: t.transaction.transaction_id
    };
  });

  const bgColors = dataPoints.map(d => d.y > 0.7 ? 'rgba(239, 68, 68, 0.6)' : d.y > 0.4 ? 'rgba(245, 158, 11, 0.6)' : 'rgba(16, 185, 129, 0.6)');
  const borderColors = dataPoints.map(d => d.y > 0.7 ? '#ef4444' : d.y > 0.4 ? '#f59e0b' : '#10b981');

  const scatterData = {
    datasets: [{
      label: 'Monetary Outliers',
      data: dataPoints,
      backgroundColor: bgColors,
      borderColor: borderColors,
      borderWidth: 1
    }]
  };

  if (window.scatterChart) {
    window.scatterChart.data = scatterData;
    window.scatterChart.update();
  } else {
    window.scatterChart = new Chart(scatterGraph, {
      type: 'bubble',
      data: scatterData,
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: 'rgba(15, 23, 42, 0.9)',
            titleColor: '#fff',
            bodyColor: '#e2e8f0',
            padding: 12,
            cornerRadius: 8,
            callbacks: {
              label: function(ctx) { return ctx.raw.label + ' • ₹' + ctx.raw.x + ' • Risk: ' + ctx.raw.y; }
            }
          }
        },
        scales: {
          x: {
            title: { display: true, text: 'Transaction Volume (₹)' },
            grid: { color: 'rgba(0, 0, 0, 0.05)' },
            ticks: { color: '#64748b' }
          },
          y: {
            title: { display: true, text: 'Risk Assessed (0.0 to 1.0)' },
            min: 0, max: 1.0,
            grid: { color: 'rgba(0, 0, 0, 0.05)' },
            ticks: { color: '#64748b' }
          }
        }
      }
    });
  }
}

function renderAll() {
  renderMetrics();
  renderGraph();
  renderDecisionBreakdown();
  renderModelSummary();
  renderLatestList();
  renderScatter();
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
  const initial = await api("/api/dashboard/transactions");
  state.transactions = initial.transactions || [];
  state.metrics = initial.metrics || {};
  renderAll();

  connectEvents(null, (message) => {
    if (message.type === "snapshot") {
      state.transactions = message.transactions || [];
      state.metrics = message.metrics || {};
      renderAll();
      return;
    }

    const incoming = message.transaction;
    const index = state.transactions.findIndex((item) => item.transaction.transaction_id === incoming.transaction.transaction_id);
    if (index >= 0) {
      state.transactions[index] = incoming;
    } else {
      state.transactions.unshift(incoming);
    }
    state.metrics = message.metrics || state.metrics;
    renderAll();
  });
}

bootstrap();
