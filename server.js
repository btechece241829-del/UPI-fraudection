const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const os = require("os");

const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
    const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
    if (match) process.env[match[1]] = match[2].trim();
  });
}

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "0.0.0.0";
const PUBLIC_DIR = path.join(__dirname, "public");
const transactions = new Map();
const sseClients = new Set();
let transactionSequence = 1;

const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
};

function respondJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(payload));
}

function respondText(res, statusCode, text) {
  res.writeHead(statusCode, {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(text);
}

function serveFile(res, filePath) {
  fs.readFile(filePath, (error, content) => {
    if (error) {
      respondText(res, 404, "Not found");
      return;
    }
    res.writeHead(200, {
      "Content-Type": mimeTypes[path.extname(filePath)] || "application/octet-stream",
      "Cache-Control": "no-store",
    });
    res.end(content);
  });
}

function collectBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk.toString("utf8");
      if (raw.length > 1000000) {
        reject(new Error("Payload too large"));
      }
    });
    req.on("end", () => {
      if (!raw.trim()) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch (error) {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

function deepMerge(base, update) {
  if (!update || typeof update !== "object" || Array.isArray(update)) {
    return update === undefined ? base : update;
  }
  const result = Array.isArray(base) ? [...base] : { ...(base || {}) };
  Object.entries(update).forEach(([key, value]) => {
    if (
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      result[key] &&
      typeof result[key] === "object" &&
      !Array.isArray(result[key])
    ) {
      result[key] = deepMerge(result[key], value);
      return;
    }
    result[key] = value;
  });
  return result;
}

function generateTransactionId() {
  const id = String(transactionSequence).padStart(5, "0");
  transactionSequence += 1;
  return `TXN_${id}`;
}

function generateOtp() {
  return String(crypto.randomInt(100000, 999999));
}

function sanitizeNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function getBaseUrl(req) {
  if (process.env.PUBLIC_BASE_URL) {
    return process.env.PUBLIC_BASE_URL.replace(/\/$/, "");
  }
  return `http://${req.headers.host || `localhost:${PORT}`}`;
}

function getLanIpAddress() {
  const interfaces = os.networkInterfaces();
  const candidates = [];

  Object.entries(interfaces).forEach(([name, addresses]) => {
    (addresses || []).forEach((entry) => {
      if (entry.family !== "IPv4" || entry.internal) {
        return;
      }

      let score = 1;
      if (/wi-?fi|wlan|ethernet/i.test(name)) {
        score += 5;
      }
      if (/vmware|virtual|vethernet|loopback/i.test(name)) {
        score -= 10;
      }

      candidates.push({ name, address: entry.address, score });
    });
  });

  candidates.sort((a, b) => b.score - a.score);
  return candidates[0]?.address || null;
}

function getLanBaseUrl(req) {
  if (process.env.PUBLIC_BASE_URL) {
    return process.env.PUBLIC_BASE_URL.replace(/\/$/, "");
  }
  const lanIp = getLanIpAddress();
  return lanIp ? `http://${lanIp}:${PORT}` : getBaseUrl(req);
}

function buildDefaultPayload(input, req) {
  const transactionId = input.transaction?.transaction_id || input.transaction_id || generateTransactionId();
  const timestamp = input.transaction?.timestamp || input.timestamp || new Date().toISOString();
  const userId = input.transaction?.user_id || input.user_id || "USER_10001";
  const amount = sanitizeNumber(input.transaction?.amount ?? input.amount, 5000);
  const merchantType = input.transaction?.merchant_type || input.merchant_type || "grocery";
  const merchantName = input.transaction?.merchant_name || input.merchant_name || "Merchant";
  const merchantId = input.transaction?.merchant_id || input.merchant_id || "MERCHANT_001";
  const deviceId = input.transaction?.device_id || input.device_id || "device_001";
  const location = input.transaction?.location || input.location || "Chennai";
  const channel = input.transaction?.channel || input.channel || "UPI";

  return {
    transaction: {
      transaction_id: transactionId,
      user_id: userId,
      amount,
      timestamp,
      merchant_type: merchantType,
      merchant_id: merchantId,
      merchant_name: merchantName,
      location,
      device_id: deviceId,
      channel,
      currency: "INR",
    },
    user_profile: {
      user_id: userId,
      account_age_days: sanitizeNumber(input.user_profile?.account_age_days ?? 365),
      total_transactions: sanitizeNumber(input.user_profile?.total_transactions ?? 150),
      avg_daily_transactions: sanitizeNumber(input.user_profile?.avg_daily_transactions ?? 2.5),
      avg_transaction_amount: sanitizeNumber(input.user_profile?.avg_transaction_amount ?? input.avg_amount, 3000),
      std_dev_amount: sanitizeNumber(input.user_profile?.std_dev_amount ?? input.std_amount, 1800),
      account_status: input.user_profile?.account_status || "active",
      kyc_completed: input.user_profile?.kyc_completed ?? true,
      email_verified: input.user_profile?.email_verified ?? true,
      phone_verified: input.user_profile?.phone_verified ?? true,
      last_login: input.user_profile?.last_login || timestamp,
      login_failures: sanitizeNumber(input.user_profile?.login_failures ?? input.login_failures, 0),
    },
    behavior_window: {
      last_90_days: {
        total_txns: 150,
        total_amount: 450000,
        avg_amount: sanitizeNumber(input.avg_amount, 3000),
        std_amount: sanitizeNumber(input.std_amount, 1800),
        min_amount: 300,
        max_amount: 75000,
        unique_merchants: 24,
        unique_locations: 3,
        unique_devices: 2,
        high_risk_txns: 2,
        disputed_txns: 0,
        refunded_txns: 1,
      },
    },
    device: {
      device_id: deviceId,
      device_type: "mobile",
      os: "Android",
      os_version: "13.0",
      browser: "Chrome",
      device_fingerprint: `fp_${deviceId}`,
      is_new_device: input.device?.is_new_device ?? input.is_new_device ?? false,
      device_age_days: 180,
      app_version: "2.5.1",
      ip_address: "192.168.1.10",
      mac_address: "AA:BB:CC:DD:EE:FF",
    },
    session: {
      session_id: `SESSION_${transactionId}`,
      session_duration_seconds: sanitizeNumber(input.session?.session_duration_seconds ?? 180),
      clicks_count: 18,
      keypress_dynamics: {
        avg_keystroke_interval: 80,
        typing_speed: 42,
        backspace_ratio: 0.04,
      },
      mouse_dynamics: {
        avg_movement_speed: 220,
        click_count: 8,
        scroll_events: 45,
      },
      device_motion: {
        acceleration: 0.4,
        tilt_angle: 4,
      },
    },
    geolocation: {
      current_location: location,
      latitude: 13.0827,
      longitude: 80.2707,
      city: location,
      state: "Tamil Nadu",
      country: "India",
      zip_code: "600001",
      timezone: "IST",
      last_location: location,
      last_location_timestamp: timestamp,
      location_change_distance_km: sanitizeNumber(input.geolocation?.location_change_distance_km ?? (input.location_changed ? 320 : 0)),
      time_since_last_location_minutes: 90,
      is_impossible_travel: input.geolocation?.is_impossible_travel ?? false,
    },
    location_history: {
      location_history_7_days: [{ city: location, count: 20 }],
      new_location_flag: input.location_history?.new_location_flag ?? input.location_changed ?? false,
      location_frequency: { [location]: 1 },
    },
    payment: {
      payment_channel: channel,
      payment_method: "google_pay",
      card_type: null,
      card_last_4: null,
      card_issuer: null,
      upi_id: `${userId.toLowerCase()}@okaxis`,
      wallet_balance: 50000,
      daily_limit: 100000,
      remaining_limit: 80000,
      transaction_success_rate: 0.99,
      is_first_time_method: false,
    },
    merchant: {
      merchant_id: merchantId,
      merchant_name: merchantName,
      merchant_type: merchantType,
      merchant_category_code: "5411",
      merchant_risk_category: input.merchant?.merchant_risk_category || input.merchant_risk_category || "low",
      merchant_age_days: 730,
      total_transactions: 50000,
      chargeback_ratio: 0.01,
      fraud_ratio: 0.005,
      average_ticket_size: 3000,
      is_high_risk_merchant: input.merchant?.is_high_risk_merchant ?? false,
      merchant_location: location,
      merchant_country: "India",
    },
    fraud_history: {
      user_fraud_history: {
        total_fraud_txns: 0,
        confirmed_fraud: 0,
        disputed_txns: 0,
        refund_rate: 0.02,
        chargeback_rate: 0.01,
      },
      known_fraud_indicators: [],
      blacklist_status: input.fraud_history?.blacklist_status || "clean",
      sanctions_list_match: input.fraud_history?.sanctions_list_match ?? false,
      pep_list_match: input.fraud_history?.pep_list_match ?? false,
    },
    refund_signals: {
      refund_history_30_days: 1,
      refund_history_90_days: 3,
      refund_rate: 0.02,
      chargeback_history_6_months: 0,
      dispute_history_6_months: 0,
      refund_to_purchase_ratio: 0.04,
      average_refund_delay_days: 5,
      refund_success_rate: 0.95,
      is_excessive_refunder: false,
      refund_pattern: "normal",
    },
    network: {
      mule_network_score: 0.1,
      network_connections: 5,
      network_density: 0.2,
      similar_accounts: 0,
      incoming_transfers_24h: 1,
      outgoing_transfers_24h: 2,
      rapid_transfer_chain: false,
      clustering_coefficient: 0.3,
    },
    auth: {
      face_recognition_score: 0.98,
      liveness_score: 0.99,
      deepfake_probability: 0.01,
      id_document_verified: true,
      id_expiry_date: "2026-12-31",
      id_type: "aadhar",
      age_verified: true,
      two_factor_enabled: true,
      biometric_enabled: true,
    },
    velocity: {
      txns_in_last_1_hour: sanitizeNumber(input.velocity?.txns_in_last_1_hour ?? input.txns_in_last_1_hour, 2),
      txns_in_last_5_minutes: sanitizeNumber(input.velocity?.txns_in_last_5_minutes, 0),
      txns_in_last_1_day: 8,
      txns_in_last_7_days: 25,
      velocity_score: 0.2,
      unusual_hour: input.velocity?.unusual_hour ?? false,
      unusual_day: false,
      time_since_last_txn_minutes: 120,
      average_time_between_txns_hours: 12,
      transaction_pattern: input.velocity?.transaction_pattern || "normal",
    },
    ml_scores: {
      xgboost_score: sanitizeNumber(input.ml_scores?.xgboost_score, 0.94),
      lstm_behavior_score: sanitizeNumber(input.ml_scores?.lstm_behavior_score, 0.91),
      device_risk_score: sanitizeNumber(input.ml_scores?.device_risk_score, 0.89),
      location_risk_score: sanitizeNumber(input.ml_scores?.location_risk_score, 0.93),
      refund_fraud_score: sanitizeNumber(input.ml_scores?.refund_fraud_score, 0.90),
      bert_phishing_score: sanitizeNumber(input.ml_scores?.bert_phishing_score, 0.95),
      gcn_network_score: sanitizeNumber(input.ml_scores?.gcn_network_score, 0.92),
      graphsage_embedding: Array.isArray(input.ml_scores?.graphsage_embedding)
        ? input.ml_scores.graphsage_embedding
        : [0.5, -0.3, 0.18, 0.72],
      final_risk_score: sanitizeNumber(input.ml_scores?.final_risk_score, 0.915),
      model_confidence: sanitizeNumber(input.ml_scores?.model_confidence, 0.945),
    },
    decision_engine: {
      low_risk_threshold: 0.3,
      medium_risk_threshold: 0.7,
      high_risk_threshold: 0.7,
      confidence_threshold: 0.8,
      decision: "PENDING",
      action: "await_scoring",
      reason: "Awaiting backend scoring",
      requires_otp: false,
      requires_biometric: false,
      requires_manual_review: false,
      base_url: getBaseUrl(req),
    },
  };
}

function validatePayload(payload) {
  const required = ["user_id", "amount", "timestamp", "merchant_type", "location", "device_id"];
  const missing = required.filter((key) => !payload.transaction[key] && payload.transaction[key] !== 0);
  if (missing.length) {
    return { valid: false, message: `Missing required fields: ${missing.join(", ")}` };
  }
  if (!Number.isFinite(Number(payload.transaction.amount)) || Number(payload.transaction.amount) <= 0) {
    return { valid: false, message: "amount must be a positive number" };
  }
  return { valid: true };
}

function scoreTransaction(payload) {
  const reasons = [];
  let score = 0.06;
  const transaction = payload.transaction;
  const profile = payload.user_profile;
  const device = payload.device;
  const geo = payload.geolocation;
  const locationHistory = payload.location_history;
  const merchant = payload.merchant;
  const fraud = payload.fraud_history;
  const refund = payload.refund_signals;
  const network = payload.network;
  const auth = payload.auth;
  const velocity = payload.velocity;
  const ml = payload.ml_scores;

  const avgAmount = sanitizeNumber(profile.avg_transaction_amount, 3000);
  const stdAmount = Math.max(1, sanitizeNumber(profile.std_dev_amount, 1800));
  const amount = sanitizeNumber(transaction.amount, 0);

  if (amount > avgAmount + stdAmount * 2 || amount > avgAmount * 2.5) {
    score += 0.22;
    reasons.push("Amount is much higher than the user's historical pattern");
  }
  if (amount > merchant.average_ticket_size * 1.8) {
    score += 0.07;
    reasons.push("Transaction is unusually large for this merchant");
  }
  if (device.is_new_device) {
    score += 0.17;
    reasons.push("New device detected");
  }
  if (locationHistory.new_location_flag || geo.location_change_distance_km > 150) {
    score += 0.16;
    reasons.push("Location changed significantly from the user's norm");
  }
  if (geo.is_impossible_travel) {
    score += 0.3;
    reasons.push("Impossible travel pattern detected");
  }
  if (velocity.txns_in_last_1_hour >= 5 || velocity.txns_in_last_5_minutes >= 2) {
    score += 0.12;
    reasons.push("Velocity spike detected");
  }
  if (velocity.unusual_hour || velocity.transaction_pattern !== "normal") {
    score += 0.07;
    reasons.push("Time-based behavior is unusual");
  }
  if (merchant.merchant_risk_category === "high" || merchant.is_high_risk_merchant) {
    score += 0.18;
    reasons.push("Merchant is classified as high risk");
  } else if (merchant.merchant_risk_category === "medium") {
    score += 0.08;
    reasons.push("Merchant carries medium fraud risk");
  }
  if (profile.login_failures >= 3) {
    score += 0.08;
    reasons.push("Recent login failures increase takeover risk");
  }
  if (refund.is_excessive_refunder || refund.refund_pattern === "suspicious" || refund.refund_rate > 0.1) {
    score += 0.09;
    reasons.push("Refund behavior is outside normal limits");
  }
  if (fraud.blacklist_status !== "clean" || fraud.sanctions_list_match || fraud.pep_list_match) {
    score += 0.24;
    reasons.push("Fraud or compliance match found");
  }
  if (network.rapid_transfer_chain || network.mule_network_score > 0.6) {
    score += 0.12;
    reasons.push("Network pattern suggests mule or transfer chain activity");
  }
  if (auth.deepfake_probability > 0.35 || auth.liveness_score < 0.6) {
    score += 0.14;
    reasons.push("Identity signal confidence is lower than expected");
  }

  const blendedMl = (
    ml.xgboost_score +
    ml.lstm_behavior_score +
    ml.device_risk_score +
    ml.location_risk_score +
    ml.refund_fraud_score +
    ml.gcn_network_score +
    ml.bert_phishing_score +
    ml.final_risk_score
  ) / 8;

  score = Math.max(0.01, Math.min(0.99, Number((score * 0.7 + blendedMl * 0.3).toFixed(2))));

  const severeBlocker =
    geo.is_impossible_travel ||
    fraud.blacklist_status === "blocked" ||
    fraud.sanctions_list_match ||
    fraud.pep_list_match;

  let decision = "APPROVE";
  let status = "completed";
  let action = "proceed_immediately";
  let reason = "Low risk transaction";
  let requiresOtp = false;
  let requiresManualReview = false;

  if (auth.upi_pin_failed_attempts >= 3) {
    decision = "BLOCK";
    status = "blocked";
    action = "deny_and_hold";
    reason = "Blocked due to 3 incorrect UPI PIN attempts";
    requiresManualReview = true;
    score = Math.max(score, 0.95);
    reasons.push("3 incorrect UPI PIN attempts");
  } else if (score >= payload.decision_engine.high_risk_threshold && severeBlocker) {
    decision = "BLOCK";
    status = "blocked";
    action = "deny_and_hold";
    reason = "Blocked because severe fraud indicators were triggered";
    requiresManualReview = true;
  } else if (score >= payload.decision_engine.low_risk_threshold) {
    decision = "OTP_REQUIRED";
    status = "awaiting_otp";
    action = "otp_required_on_client";
    reason = "Suspicious transaction requires OTP validation on the client page";
    requiresOtp = true;
    requiresManualReview = score >= payload.decision_engine.high_risk_threshold;
  }

  if (!reasons.length) {
    reasons.push("Behavior matches the user's normal profile");
  }

  return { score, decision, status, action, reason, reasons, requiresOtp, requiresManualReview };
}

function publicTransactionView(transaction) {
  if (!transaction) return null;
  return JSON.parse(JSON.stringify(transaction));
}

function pushTimeline(transaction, stage, detail) {
  transaction.timeline.push({ at: new Date().toISOString(), stage, detail });
}

function buildMetrics() {
  const all = [...transactions.values()];
  const total = all.length;
  const approved = all.filter((item) => item.status === "completed").length;
  const pending = all.filter((item) => item.status === "awaiting_otp").length;
  const blocked = all.filter((item) => item.status === "blocked").length;
  const totalAmount = all.reduce((sum, item) => sum + sanitizeNumber(item.transaction.amount), 0);
  const avgRisk = total ? Number((all.reduce((sum, item) => sum + item.risk.score, 0) / total).toFixed(2)) : 0;
  return {
    total_transactions: total,
    approved_count: approved,
    otp_required_count: pending,
    blocked_count: blocked,
    approval_rate: total ? Number((approved / total).toFixed(2)) : 0,
    fraud_detection_rate: total ? Number((blocked / total).toFixed(2)) : 0,
    false_positive_rate: 0,
    average_risk_score: avgRisk,
    total_amount_processed: totalAmount,
    average_transaction_amount: total ? Number((totalAmount / total).toFixed(2)) : 0,
    system_uptime_percent: 99.9,
    avg_processing_time_ms: total
      ? Number((all.reduce((sum, item) => sum + item.processing.processing_time_ms, 0) / total).toFixed(1))
      : 0,
  };
}

function broadcast(eventType, transaction) {
  const message = JSON.stringify({
    type: eventType,
    transactionId: transaction.transaction.transaction_id,
    transaction: publicTransactionView(transaction),
    metrics: buildMetrics(),
  });

  [...sseClients].forEach((client) => {
    try {
      if (client.transactionId && client.transactionId !== transaction.transaction.transaction_id) {
        return;
      }
      client.res.write(`event: ${eventType}\n`);
      client.res.write(`data: ${message}\n\n`);
    } catch (error) {
      sseClients.delete(client);
    }
  });
}

function createTransaction(body, req) {
  const startedAt = Date.now();
  const payload = deepMerge(buildDefaultPayload(body, req), body);
  const validation = validatePayload(payload);
  if (!validation.valid) {
    const error = new Error(validation.message);
    error.statusCode = 400;
    throw error;
  }

  const scoring = scoreTransaction(payload);
  const scanToken = crypto.randomBytes(12).toString("hex");
  const scanUrl = `${payload.decision_engine.base_url}/scan/${scanToken}`;
  const clientOpenUrl = `${payload.decision_engine.base_url}/transaction/${payload.transaction.transaction_id}`;

  payload.decision_engine.decision = scoring.decision;
  payload.decision_engine.action = scoring.action;
  payload.decision_engine.reason = scoring.reason;
  payload.decision_engine.requires_otp = scoring.requiresOtp;
  payload.decision_engine.requires_manual_review = scoring.requiresManualReview;

  const transaction = {
    ...payload,
    risk: { score: scoring.score, reasons: scoring.reasons, model_confidence: payload.ml_scores.model_confidence },
    status: scoring.status,
    decision: scoring.decision,
    scan: {
      token: scanToken,
      scan_url: scanUrl,
      client_open_url: clientOpenUrl,
      qr_image_url: `https://api.qrserver.com/v1/create-qr-code/?size=260x260&data=${encodeURIComponent(clientOpenUrl)}`,
      scanned_at: null,
    },
    security: {
      otp_code: scoring.requiresOtp ? generateOtp() : null,
      otp_verified_at: null,
      otp_attempts: 0,
      otp_expires_at: scoring.requiresOtp ? new Date(Date.now() + 5 * 60 * 1000).toISOString() : null,
    },
    processing: {
      created_at: new Date().toISOString(),
      processing_time_ms: Date.now() - startedAt,
    },
    timeline: [],
  };

  pushTimeline(transaction, "transaction_received", "Transaction captured from the client form");
  pushTimeline(transaction, "risk_scored", `Fraud score ${scoring.score} and decision ${scoring.decision}`);
  if (transaction.status === "completed") {
    pushTimeline(transaction, "transaction_completed", "Transaction approved immediately");
  }
  if (transaction.status === "awaiting_otp") {
    pushTimeline(transaction, "otp_requested", "Suspicious transaction sent for OTP verification on the client page");
  }
  if (transaction.status === "blocked") {
    pushTimeline(transaction, "transaction_blocked", "Transaction blocked by the backend decision engine");
  }

  transactions.set(transaction.transaction.transaction_id, transaction);
  broadcast("transaction.created", transaction);
  return transaction;
}

function findByScanToken(scanToken) {
  return [...transactions.values()].find((item) => item.scan.token === scanToken);
}

function handleScan(scanToken) {
  const transaction = findByScanToken(scanToken);
  if (!transaction) {
    const error = new Error("Scan token not found");
    error.statusCode = 404;
    throw error;
  }
  transaction.scan.scanned_at = new Date().toISOString();
  pushTimeline(transaction, "qr_opened", "QR link opened the client transaction page");
  broadcast("transaction.scanned", transaction);
  return transaction;
}

function verifyOtp(transactionId, otp) {
  const transaction = transactions.get(transactionId);
  if (!transaction) {
    const error = new Error("Transaction not found");
    error.statusCode = 404;
    throw error;
  }
  if (transaction.status !== "awaiting_otp") {
    const error = new Error("OTP is not currently required for this transaction");
    error.statusCode = 400;
    throw error;
  }
  transaction.security.otp_attempts += 1;
  if (new Date(transaction.security.otp_expires_at).getTime() < Date.now()) {
    transaction.status = "blocked";
    pushTimeline(transaction, "otp_expired", "OTP expired and the transaction was blocked");
    broadcast("transaction.blocked", transaction);
    const error = new Error("OTP expired");
    error.statusCode = 400;
    throw error;
  }
  if (String(otp) !== String(transaction.security.otp_code)) {
    pushTimeline(transaction, "otp_failed", "An invalid OTP was submitted");
    broadcast("transaction.updated", transaction);
    const error = new Error("Invalid OTP");
    error.statusCode = 400;
    throw error;
  }

  transaction.status = "completed";
  transaction.security.otp_verified_at = new Date().toISOString();
  pushTimeline(transaction, "otp_verified", "OTP matched and the suspicious transaction was approved");
  pushTimeline(transaction, "transaction_completed", "Transaction completed after OTP verification");
  broadcast("transaction.completed", transaction);
  return transaction;
}

function sendSnapshot(res, transactionId) {
  const snapshot = {
    type: "snapshot",
    metrics: buildMetrics(),
    transactions: transactionId
      ? [publicTransactionView(transactions.get(transactionId))].filter(Boolean)
      : [...transactions.values()]
          .sort((a, b) => new Date(b.processing.created_at) - new Date(a.processing.created_at))
          .map(publicTransactionView),
  };
  res.write("event: snapshot\n");
  res.write(`data: ${JSON.stringify(snapshot)}\n\n`);
}

function pageRoute(pathname) {
  if (pathname === "/" || pathname === "/client") {
    return path.join(PUBLIC_DIR, "client.html");
  }
  if (pathname === "/dashboard") {
    return path.join(PUBLIC_DIR, "dashboard.html");
  }
  if (pathname === "/analytics") {
    return path.join(PUBLIC_DIR, "analytics.html");
  }
  if (pathname === "/segmentation") {
    return path.join(PUBLIC_DIR, "segmentation.html");
  }
  if (pathname === "/classification") {
    return path.join(PUBLIC_DIR, "classification.html");
  }
  if (pathname.startsWith("/transaction/")) {
    return path.join(PUBLIC_DIR, "transaction.html");
  }
  if (pathname.startsWith("/scan/")) {
    return path.join(PUBLIC_DIR, "scan.html");
  }
  const filePath = path.join(PUBLIC_DIR, pathname.replace(/^\//, ""));
  if (filePath.startsWith(PUBLIC_DIR) && fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    return filePath;
  }
  return null;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || `localhost:${PORT}`}`);
  const pathname = url.pathname;

  try {
    if (req.method === "GET" && pathname === "/api/events") {
      const transactionId = url.searchParams.get("transactionId");
      res.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-store, must-revalidate",
        Connection: "keep-alive",
      });
      res.write("\n");
      const client = { res, transactionId };
      sseClients.add(client);
      sendSnapshot(res, transactionId);
      const heartbeat = setInterval(() => {
        try {
          res.write("event: heartbeat\n");
          res.write(`data: ${JSON.stringify({ at: new Date().toISOString() })}\n\n`);
        } catch (error) {
          clearInterval(heartbeat);
          sseClients.delete(client);
        }
      }, 15000);
      req.on("close", () => {
        clearInterval(heartbeat);
        sseClients.delete(client);
      });
      return;
    }

    if (req.method === "GET" && pathname === "/api/dashboard/transactions") {
      respondJson(res, 200, {
        transactions: [...transactions.values()].sort(
          (a, b) => new Date(b.processing.created_at) - new Date(a.processing.created_at)
        ),
        metrics: buildMetrics(),
      });
      return;
    }

    if (req.method === "GET" && pathname === "/api/server-info") {
      const lanBaseUrl = getLanBaseUrl(req);
      respondJson(res, 200, {
        lan_base_url: lanBaseUrl,
        lan_client_url: `${lanBaseUrl}/client`,
        localhost_client_url: `http://localhost:${PORT}/client`,
      });
      return;
    }

    if (req.method === "GET" && pathname.startsWith("/api/transactions/")) {
      const transaction = transactions.get(pathname.split("/").pop());
      if (!transaction) {
        respondJson(res, 404, { error: "Transaction not found" });
        return;
      }
      respondJson(res, 200, { transaction: publicTransactionView(transaction) });
      return;
    }

    if (req.method === "POST" && pathname === "/api/transactions") {
      const transaction = createTransaction(await collectBody(req), req);
      respondJson(res, 201, {
        transaction: publicTransactionView(transaction),
        redirect_to: `/transaction/${transaction.transaction.transaction_id}`,
      });
      return;
    }

    if (req.method === "POST" && pathname === "/api/chat") {
      const body = await collectBody(req);
      const prompt = body.prompt || "";
      const context = body.context || {};

      if (!process.env.GROQ_API_KEY) {
        setTimeout(() => {
          respondJson(res, 200, {
            reply: "This is a local AI mockup because no `GROQ_API_KEY` was provided to the server.\n\nSimulated Answer: The overall risk score stability looks great and anomalies detected are within expected thresholds based on current metrics."
          });
        }, 800);
        return;
      }

      try {
        const groqReqBody = JSON.stringify({
          model: "llama-3.3-70b-versatile",
          messages: [
            { role: "system", content: "You are the PayFind Intelligence assistant, an advanced AI with full access to the client model, server model, and web architecture. You must answer ANY question the user asks completely and thoroughly, drawing upon the provided context metrics and your general knowledge of the system's fraud analytics, Node.js backend, and frontend UI. Do not restrict or decline topics. Provide detailed, helpful answers. IMPORTANT: Do NOT generate or write any code snippets in your responses under any circumstances. Keep your answers purely text, analytical, and conversational." },
            { role: "user", content: `Context Metrics: ${JSON.stringify(context)}\n\nUser Question: ${prompt}` }
          ],
          temperature: 0.5,
          max_tokens: 1000
        });

        const options = {
          hostname: "api.groq.com",
          path: "/openai/v1/chat/completions",
          method: "POST",
          headers: {
            "Authorization": `Bearer ${process.env.GROQ_API_KEY}`,
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(groqReqBody)
          }
        };

        const groqReq = https.request(options, (groqRes) => {
          let data = "";
          groqRes.on("data", chunk => data += chunk);
          groqRes.on("end", () => {
             try {
               const parsed = JSON.parse(data);
               if (parsed.choices && parsed.choices[0] && parsed.choices[0].message) {
                 let aiReply = parsed.choices[0].message.content;
                 
                 // Aggressive code blocking regex
                 aiReply = aiReply.replace(/```[\s\S]*?```/g, "\n*[Code snippet removed by system policy]*\n");
                 aiReply = aiReply.replace(/`[^`\n]+`/g, "*[redacted code]*");
                 
                 respondJson(res, 200, { reply: aiReply });
               } else if (parsed.error) {
                 const reply = `Groq Server Error: ${parsed.error.message || JSON.stringify(parsed.error)}`;
                 respondJson(res, 200, { reply });
               } else {
                 respondJson(res, 200, { reply: "I'm sorry, I couldn't generate a response. No valid API data received." });
               }
             } catch(e) {
               respondJson(res, 500, { error: "Failed to parse Groq response body." });
             }
          });
        });
        
        groqReq.on("error", (e) => respondJson(res, 500, { error: e.message }));
        groqReq.write(groqReqBody);
        groqReq.end();
      } catch (error) {
        respondJson(res, 500, { error: error.message });
      }
      return;
    }

    if (req.method === "POST" && pathname.startsWith("/api/scan/")) {
      respondJson(res, 200, { transaction: publicTransactionView(handleScan(pathname.split("/").pop())) });
      return;
    }

    if (req.method === "POST" && pathname.endsWith("/otp")) {
      const transactionId = pathname.split("/")[3];
      respondJson(res, 200, {
        transaction: publicTransactionView(verifyOtp(transactionId, (await collectBody(req)).otp)),
      });
      return;
    }

    const routeFile = pageRoute(pathname);
    if (req.method === "GET" && routeFile) {
      serveFile(res, routeFile);
      return;
    }

    respondText(res, 404, "Route not found");
  } catch (error) {
    if (res.headersSent) {
      try {
        res.end();
      } catch (endError) {
        // Ignore finalization errors after partial response writes.
      }
      return;
    }
    respondJson(res, error.statusCode || 500, { error: error.message || "Internal server error" });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Fraud detection demo running at http://localhost:${PORT}`);
});
