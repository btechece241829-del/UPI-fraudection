import { api, connectEvents, formatDate, formatMoney, renderTimeline, statusClass, statusLabel } from "./utils.js";

const transactionId = window.location.pathname.split("/").pop();
const transactionCard = document.getElementById("transaction-card");
const timelineRoot = document.getElementById("timeline");
const challengeCopy = document.getElementById("challenge-copy");
const otpForm = document.getElementById("otp-form");
const otpInput = document.getElementById("otp-input");
const otpAlert = document.getElementById("otp-alert");
const otpDemo = document.getElementById("otp-demo");

const resultOverlay = document.getElementById("result-overlay");
const resultBadge = document.getElementById("result-badge");
const resultTitle = document.getElementById("result-title");
const resultCopy = document.getElementById("result-copy");
const resultReset = document.getElementById("result-reset");

let otpRevealTimer = null;
let visibleOtpFor = null;

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

if (resultReset) {
  resultReset.addEventListener("click", () => {
    window.location.href = "/client";
  });
}

function setOtpAlert(message = "") {
  otpAlert.textContent = message;
  otpAlert.classList.toggle("hidden", !message);
}

function renderOtpDemo(transaction) {
  if (transaction.status !== "awaiting_otp") {
    otpDemo.classList.add("hidden");
    otpDemo.textContent = "";
    if (otpRevealTimer) {
      clearTimeout(otpRevealTimer);
      otpRevealTimer = null;
    }
    visibleOtpFor = null;
    return;
  }

  otpDemo.classList.remove("hidden");
  if (visibleOtpFor === transaction.transaction.transaction_id) {
    otpDemo.innerHTML = `<strong>OTP:</strong> ${transaction.security.otp_code}`;
    return;
  }

  otpDemo.textContent = "OTP will appear in 8 seconds...";
  if (!otpRevealTimer) {
    otpRevealTimer = setTimeout(() => {
      visibleOtpFor = transaction.transaction.transaction_id;
      otpRevealTimer = null;
      otpDemo.innerHTML = `<strong>OTP:</strong> ${transaction.security.otp_code}`;
    }, 8000);
  }
}

function renderTransaction(transaction) {
  const statusMessage =
    transaction.status === "awaiting_otp"
      ? "Enter the OTP on this page to continue the suspicious payment."
        : transaction.status === "completed"
          ? "Transaction completed successfully."
          : "Transaction blocked by the fraud engine.";

  challengeCopy.textContent = statusMessage;
  transactionCard.innerHTML = `
    <h3>${transaction.transaction.transaction_id}</h3>
    <div><span class="status-pill ${statusClass(transaction.status)}">${statusLabel(transaction.status)}</span></div>
    <div class="muted">${transaction.decision_engine.reason}</div>
    <div>Amount: <strong>${formatMoney(transaction.transaction.amount)}</strong></div>
    <div>User: <strong>${transaction.transaction.user_id}</strong></div>
    <div>Merchant: <strong>${transaction.transaction.merchant_name}</strong></div>
    <div>Risk score: <strong>${transaction.risk.score}</strong></div>
    <div>Created: ${formatDate(transaction.processing.created_at)}</div>
    <div class="alert info">${transaction.risk.reasons.join(". ")}.</div>
  `;
  timelineRoot.innerHTML = renderTimeline(transaction.timeline);

  const shouldShowOtp = transaction.status === "awaiting_otp";
  otpForm.classList.toggle("hidden", !shouldShowOtp);
  renderOtpDemo(transaction);

  if (transaction.status === "completed" || transaction.status === "blocked") {
    showResultOverlay(transaction.status);
  }
}

async function loadTransaction() {
  const data = await api(`/api/transactions/${transactionId}`);
  renderTransaction(data.transaction);
}

otpForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setOtpAlert("");
  try {
    const data = await api(`/api/transactions/${transactionId}/otp`, {
      method: "POST",
      body: JSON.stringify({ otp: otpInput.value.trim() }),
    });
    renderTransaction(data.transaction);
    otpInput.value = "";
  } catch (error) {
    setOtpAlert(error.message);
  }
});

loadTransaction();
connectEvents(transactionId, (message) => {
  if (message.type === "snapshot") {
    if (message.transactions[0]) {
      renderTransaction(message.transactions[0]);
    }
    return;
  }
  renderTransaction(message.transaction);
});
