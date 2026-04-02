import { api, connectEvents, formatDate, formatMoney, renderTimeline, statusClass, statusLabel } from "./utils.js";

const form = document.getElementById("transaction-form");
const alertBox = document.getElementById("form-alert");
const clientStatus = document.getElementById("client-status");
const transactionCard = document.getElementById("transaction-card");
const resultOverlay = document.getElementById("result-overlay");
const resultBadge = document.getElementById("result-badge");
const resultTitle = document.getElementById("result-title");
const resultCopy = document.getElementById("result-copy");
const resultReset = document.getElementById("result-reset");
let currentTransactionId = null;
let selectedPreset = "ok";
let pendingTransactionPayload = null;
let upiFailedAttempts = 0;

const upiModal = document.getElementById("upi-modal");
const upiForm = document.getElementById("upi-form");
const upiInput = document.getElementById("upi-input");
const upiAlert = document.getElementById("upi-alert");
const upiCancelBtn = document.getElementById("upi-cancel-btn");

function hideUpiModal() {
  upiModal.style.display = "none";
  upiModal.classList.add("hidden");
  upiInput.value = "";
  upiAlert.classList.add("hidden");
  upiAlert.textContent = "";
}

upiCancelBtn.addEventListener("click", () => {
  hideUpiModal();
  pendingTransactionPayload = null;
});

upiForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const pin = upiInput.value.trim();
  if (pin !== "357335") {
    upiFailedAttempts++;
    if (upiFailedAttempts >= 3) {
      hideUpiModal();
      if (pendingTransactionPayload) {
        const payload = pendingTransactionPayload;
        pendingTransactionPayload = null;
        payload.auth = payload.auth || {};
        payload.auth.upi_pin_failed_attempts = upiFailedAttempts;
        upiFailedAttempts = 0;
        
        try {
          const response = await api("/api/transactions", {
            method: "POST",
            body: JSON.stringify(payload),
          });
          renderTransaction(response.transaction);
        } catch (error) {
          setAlert(error.message);
        }
      }
      return;
    }
    
    upiAlert.textContent = `Incorrect UPI PIN. ${3 - upiFailedAttempts} attempts remaining.`;
    upiAlert.classList.remove("hidden");
    return;
  }
  
  upiFailedAttempts = 0;
  hideUpiModal();
  
  if (!pendingTransactionPayload) return;
  const payload = pendingTransactionPayload;
  pendingTransactionPayload = null;

  try {
    const response = await api("/api/transactions", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    if (response.transaction.status === "awaiting_otp") {
      window.location.href = `/transaction/${response.transaction.transaction.transaction_id}`;
      return;
    }
    renderTransaction(response.transaction);
  } catch (error) {
    setAlert(error.message);
  }
});

const presetConfig = {
  ok: {
    amount: 26000,
    merchant_name: "Fresh Basket",
    merchant_type: "grocery",
    merchant_id: "MERCHANT_008",
    location: "Chennai",
    device_id: "device_111",
    avg_amount: 30000,
    std_amount: 9000,
    txns_in_last_1_hour: 1,
    login_failures: 0,
    merchant_risk_category: "low",
    is_new_device: false,
    location_changed: false,
    unusual_hour: false,
    is_high_risk_merchant: false,
    refund_rate: 0.02,
    refund_pattern: "normal",
    final_risk_score: 0.22,
    device_risk_score: 0.12,
    location_risk_score: 0.1,
    transaction_pattern: "normal",
  },
  suspect: {
    amount: 48000,
    merchant_name: "Night Electronics",
    merchant_type: "electronics",
    merchant_id: "MERCHANT_999",
    location: "Bangalore",
    device_id: "device_new_901",
    avg_amount: 4200,
    std_amount: 1600,
    txns_in_last_1_hour: 6,
    login_failures: 4,
    merchant_risk_category: "high",
    is_new_device: true,
    location_changed: true,
    unusual_hour: true,
    is_high_risk_merchant: true,
    refund_rate: 0.16,
    refund_pattern: "suspicious",
    final_risk_score: 0.66,
    device_risk_score: 0.92,
    location_risk_score: 0.93,
    xgboost_score: 0.94,
    lstm_behavior_score: 0.92,
    bert_phishing_score: 0.93,
    gcn_network_score: 0.94,
    transaction_pattern: "burst",
  },
  block: {
    amount: 95000,
    merchant_name: "Offshore Electronics",
    merchant_type: "electronics",
    merchant_id: "MERCHANT_404",
    location: "Dubai",
    device_id: "device_block_404",
    avg_amount: 3000,
    std_amount: 1200,
    txns_in_last_1_hour: 8,
    login_failures: 5,
    merchant_risk_category: "high",
    is_new_device: true,
    location_changed: true,
    unusual_hour: true,
    is_high_risk_merchant: true,
    refund_rate: 0.2,
    refund_pattern: "suspicious",
    final_risk_score: 0.94,
    device_risk_score: 0.93,
    location_risk_score: 0.92,
    xgboost_score: 0.94,
    lstm_behavior_score: 0.93,
    bert_phishing_score: 0.94,
    gcn_network_score: 0.92,
    transaction_pattern: "burst",
    is_impossible_travel: true,
    blacklist_status: "blocked",
  },
};

function setAlert(message = "") {
  alertBox.textContent = message;
  alertBox.classList.toggle("hidden", !message);
}

function setOtpAlert(message = "") {
  return message;
}

function showResultOverlay(status) {
  resultOverlay.classList.remove("hidden");
  resultBadge.className = `badge ${status === "completed" ? "good" : "danger"}`;
  if (status === "completed") {
    resultBadge.textContent = "Payment success";
    resultTitle.textContent = "Payment successful";
    resultCopy.textContent = "The transaction completed successfully.";
    return;
  }
  resultBadge.textContent = "Fraud blocked";
  resultTitle.textContent = "Blocked payment as fraud";
  resultCopy.textContent = "This payment was blocked by the fraud engine.";
}

function hideResultOverlay() {
  resultOverlay.classList.add("hidden");
}

function renderTransaction(transaction) {
  currentTransactionId = transaction.transaction.transaction_id;
  clientStatus.classList.remove("hidden");
  hideResultOverlay();

  const copy =
    transaction.status === "completed"
        ? "Transaction completed successfully."
        : "Transaction blocked by the fraud engine.";

  transactionCard.innerHTML = `
    <h3>${transaction.transaction.transaction_id}</h3>
    <div><span class="status-pill ${statusClass(transaction.status)}">${statusLabel(transaction.status)}</span></div>
    <div class="muted">${copy}</div>
    <div>Amount: <strong>${formatMoney(transaction.transaction.amount)}</strong></div>
    <div>User: <strong>${transaction.transaction.user_name || transaction.transaction.user_id}</strong></div>
    <div>Merchant: <strong>${transaction.transaction.merchant_name}</strong></div>
    <div>Risk score: <strong>${transaction.risk.score}</strong></div>
    <div>Created: ${formatDate(transaction.processing.created_at)}</div>
    <div class="alert info">${transaction.risk.reasons.join(". ")}.</div>
  `;

  if (transaction.status === "completed" || transaction.status === "blocked") {
    showResultOverlay(transaction.status);
  }
}

function slugifyUserName(name) {
  return String(name || "customer")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "") || "CUSTOMER";
}

function selectPreset(presetKey) {
  selectedPreset = presetKey;
  const config = presetConfig[presetKey];
  // Removed form.elements.namedItem("amount").value = config.amount; to keep user input
  document.querySelectorAll(".preset-button").forEach((button) => {
    button.classList.toggle("active", button.dataset.preset === presetKey);
  });
  setAlert("");
  hideResultOverlay();
}

document.getElementById("normal-demo").addEventListener("click", () => {
  selectPreset("ok");
});

document.getElementById("suspicious-demo").addEventListener("click", () => {
  selectPreset("suspect");
});

document.getElementById("blocked-demo").addEventListener("click", () => {
  selectPreset("block");
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  setAlert("");
  hideResultOverlay();

  const data = new FormData(form);
  const userName = String(data.get("user_name") || "").trim();
  if (!userName) {
    setAlert("Enter the user name");
    return;
  }
  const preset = presetConfig[selectedPreset];
  const userId = `USER_${slugifyUserName(userName)}`;
  const payload = {
    transaction: {
      user_id: userId,
      user_name: userName,
      amount: Number(data.get("amount")),
      timestamp: new Date().toISOString(),
      merchant_name: preset.merchant_name,
      merchant_type: preset.merchant_type,
      merchant_id: preset.merchant_id,
      location: preset.location,
      device_id: preset.device_id,
      channel: "UPI",
    },
    user_profile: {
      avg_transaction_amount: preset.avg_amount,
      std_dev_amount: preset.std_amount,
      login_failures: preset.login_failures,
    },
    device: { is_new_device: preset.is_new_device },
    location_history: { new_location_flag: preset.location_changed },
    geolocation: {
      location_change_distance_km: preset.location_changed ? 320 : 0,
      is_impossible_travel: Boolean(preset.is_impossible_travel),
    },
    merchant: {
      merchant_risk_category: preset.merchant_risk_category,
      is_high_risk_merchant: preset.is_high_risk_merchant,
    },
    velocity: {
      txns_in_last_1_hour: preset.txns_in_last_1_hour,
      txns_in_last_5_minutes: preset.is_high_risk_merchant ? 3 : 0,
      unusual_hour: preset.unusual_hour,
      transaction_pattern: preset.transaction_pattern,
    },
    refund_signals: {
      refund_pattern: preset.refund_pattern,
      refund_rate: preset.refund_rate,
    },
    ml_scores: {
      xgboost_score: preset.xgboost_score ?? preset.final_risk_score,
      lstm_behavior_score: preset.lstm_behavior_score ?? preset.final_risk_score,
      device_risk_score: preset.device_risk_score,
      location_risk_score: preset.location_risk_score,
      refund_fraud_score: preset.refund_fraud_score ?? preset.final_risk_score,
      bert_phishing_score: preset.bert_phishing_score ?? preset.final_risk_score,
      gcn_network_score: preset.gcn_network_score ?? preset.final_risk_score,
      final_risk_score: preset.final_risk_score,
      model_confidence: 0.95,
    },
  };

  if (selectedPreset === "block") {
    payload.geolocation.location_change_distance_km = 2800;
    payload.fraud_history = {
      blacklist_status: preset.blacklist_status,
      sanctions_list_match: false,
      pep_list_match: false,
    };
  }

  pendingTransactionPayload = payload;
  upiModal.classList.remove("hidden");
  upiModal.style.display = "flex";
  upiInput.focus();
});

selectPreset("ok");

resultReset.addEventListener("click", () => {
  window.location.href = "/client";
});
