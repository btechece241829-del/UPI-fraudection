export async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || "Request failed");
  }
  return data;
}

export function formatMoney(value) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(Number(value || 0));
}

export function formatDate(value) {
  return value ? new Date(value).toLocaleString() : "-";
}

export function statusClass(status) {
  return `status-${status || "awaiting_scan"}`;
}

export function statusLabel(status) {
  return String(status || "").replace(/_/g, " ").toUpperCase();
}

export function renderTimeline(timeline = []) {
  return timeline
    .map(
      (item) => `
        <li>
          <strong>${item.stage.replace(/_/g, " ")}</strong>
          <div class="muted">${formatDate(item.at)}</div>
          <div>${item.detail}</div>
        </li>
      `
    )
    .join("");
}

export function connectEvents(transactionId, onEvent) {
  const stream = new EventSource(
    transactionId ? `/api/events?transactionId=${encodeURIComponent(transactionId)}` : "/api/events"
  );
  ["snapshot", "transaction.created", "transaction.scanned", "transaction.updated", "transaction.completed", "transaction.blocked"].forEach(
    (type) => stream.addEventListener(type, (event) => onEvent(JSON.parse(event.data)))
  );
  return stream;
}

export function prettyJson(value) {
  return JSON.stringify(value, null, 2);
}
