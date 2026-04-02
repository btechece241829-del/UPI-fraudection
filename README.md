# Fraud Detection Dashboard Demo

Run the app:

```powershell
node server.js
```

Open:

- `http://localhost:3000/client`
- `http://localhost:3000/dashboard`

## Completion process

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

## Note

- QR image rendering uses `api.qrserver.com`.
- Set `PUBLIC_BASE_URL` if you want phone scanning from another device on your network.
