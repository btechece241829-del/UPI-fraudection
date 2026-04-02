import { api, formatMoney } from "./utils.js";

const token = window.location.pathname.split("/").pop();
const statusRoot = document.getElementById("scan-status");

async function confirmScan() {
  try {
    const data = await api(`/api/scan/${token}`, { method: "POST" });
    const tx = data.transaction;
    statusRoot.innerHTML = `
      <h3>Opening client page</h3>
      <div class="badge good">Transaction ${tx.transaction.transaction_id}</div>
      <p class="muted">The QR link has been recorded. Redirecting to the client transaction page now.</p>
      <div>Amount: <strong>${formatMoney(tx.transaction.amount)}</strong></div>
      <div>User: <strong>${tx.transaction.user_id}</strong></div>
      <div>Status: <strong>${tx.status.replace(/_/g, " ").toUpperCase()}</strong></div>
    `;
    setTimeout(() => {
      window.location.href = `/transaction/${tx.transaction.transaction_id}`;
    }, 900);
  } catch (error) {
    statusRoot.innerHTML = `<h3>Scan failed</h3><div class="alert error">${error.message}</div>`;
  }
}

confirmScan();
