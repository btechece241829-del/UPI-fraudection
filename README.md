# UPI Fraudection — UPI Fraud Detection Dashboard

Real-time UPI fraud detection dashboard (NEXATHON 2.0 hackathon project). It
takes a transaction from the client intake page, scores it for fraud risk,
flags suspicious transactions, and completes them through an OTP-verified
flow — with everything streamed live to an analytics dashboard.

**Live demo:** https://upi-fraudection-production.up.railway.app/dashboard

## Features

- Zero-dependency Node.js server — only Node's built-in modules, nothing to `npm install`
- Client transaction intake with server-side parameter validation
- Real-time fraud scoring engine
- Suspicious transactions move to `awaiting_scan` and require OTP verification
- Live dashboard with server-sent events (SSE) and QR codes for phone scanning
- Companion Python scripts for RFM fraud-labelled ML and K-Means segmentation

## Requirements

- Node.js 18 or newer (there is **no** `npm install` step — the server uses
  only the standard library)

## Run

```bash
git clone https://github.com/btechece241829-del/UPI-fraudection.git
cd UPI-fraudection

npm start        # or: node server.js
```

Open:

- Client page: `http://localhost:3000/client`
- Dashboard: `http://localhost:3000/dashboard`

## Configuration (optional)

Create a `.env` file in the project root (already gitignored):

```env
PORT=3000
HOST=0.0.0.0
PUBLIC_BASE_URL=http://192.168.1.10:3000
```

- `PORT` (default `3000`) and `HOST` (default `0.0.0.0`) — server bind settings.
- `PUBLIC_BASE_URL` — set to your machine's LAN or public address if you want
  phone scanning from another device on your network. It is used to build the
  QR code and scan links shown on the dashboard.

## How the OTP flow works

1. Open the client intake page and submit a transaction.
2. The backend validates required parameters and computes the fraud score.
3. Safe transactions complete immediately.
4. Suspicious transactions move to `awaiting_scan`.
5. The dashboard shows a QR code that opens the client transaction page.
6. Scan the QR code or click the scan link from the dashboard.
7. If the transaction is suspicious, the client page asks for OTP.
8. Enter the OTP on the client page.
9. The backend verifies the OTP and marks the transaction as completed.
10. The dashboard updates in real time with the final state and full transaction details.

## RFM analytics (optional, Python)

Companion scripts for RFM-based fraud analysis and customer segmentation:

```bash
pip install pandas numpy scikit-learn matplotlib seaborn

python rfm_fraud_model.py          # generate RFM dataset + train fraud model
python rfm_kmeans_clustering.py    # K-Means (k=3) segmentation + plots
```

Outputs:

- `segmented_output.csv` — full dataset with the assigned cluster labels
- `segmentation_2d.png` / `segmentation_3d.png` — 2D / 3D visualizations
- `payfind_rfm_dataset.csv` — exported RFM dataset (also committed here)

## Project structure

```
public/            Frontend pages (client, dashboard, scan, analytics, ...)
server.js          Zero-dependency HTTP server (API + static files + SSE)
rfm_fraud_model.py          Optional Python RFM fraud ML pipeline
rfm_kmeans_clustering.py    Optional Python K-Means segmentation
segmented_output.csv        Segmented RFM output
package.json       npm start = node server.js
```

## Notes

- QR image rendering uses `api.qrserver.com`.
- `NEXATHON 2.0 PS.docx` contains the hackathon problem statement reference.
