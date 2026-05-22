# Proxy Token Site - Architecture & Implementation Guide

This document describes the architecture, components, and implementation details of the lightweight Token Issuance and Registration Site designed for the WebSocket DataFeed Proxy.

## 1. System Overview

The system acts as a bridge between an external payment/registration event (simulated by a local JSON database) and the upstream WebSocket DataFeed Proxy deployed on an AWS EC2 instance. It provides a user interface for clients to generate access tokens and automatically registers those tokens with precise permissions directly on the EC2 proxy server.

### Core Workflow
1. **User Input:** The client visits the site and enters their `Username` and `Phone Number`.
2. **Local Validation:** The Express backend validates these credentials against a local JSON database (`data/users.json`), which acts as the source of truth for paid/authorized customers.
3. **Token Generation:** If valid, the backend generates a unique UUID token and calculates an expiration date (exactly 1 month from issuance).
4. **EC2 Synchronization:** 
   - The backend connects to the EC2 proxy server via SSH/SCP using a local private key.
   - It downloads the proxy's active `users.json` registry.
   - It injects the new token, binding it to the user's ID, calculating the `expires_at` timestamp, and assigning specific granular permissions (WebSocket streams, REST APIs) based on the user's role defined in the local database.
   - It uploads the updated registry back to the EC2 server, making the token immediately active.
5. **Client Response:** The token and expiry date are displayed to the user alongside the embedded documentation.

## 2. Directory Structure

Located at: `/home/kai/product-apim/proxy-token-site`

```text
proxy-token-site/
├── server.js            # Node.js Express backend server
├── package.json         # Project dependencies (express, cors, uuid, etc.)
├── data/
│   └── users.json       # Local database simulating authorized users & their roles
└── public/
    ├── index.html       # Frontend UI (Split layout: Form + Iframe)
    ├── style.css        # Frontend styling
    └── script.js        # Frontend logic (API fetching, DOM manipulation, Copy to clipboard)
```

## 3. Component Details

### 3.1 Frontend (`public/`)
* **`index.html` & `style.css`**: A responsive, split-screen layout. The left pane contains the token generation form. The right pane embeds the upstream proxy documentation (`https://ikkisovi.github.io/Websocket-DataFeed-Proxy/`) via an iframe, providing a unified onboarding experience.
* **`script.js`**: Handles the form submission via AJAX (`fetch`), manages UI states (loading, success, error), and provides a robust "Copy to Clipboard" utility for mobile and desktop users.

### 3.2 Backend (`server.js`)
A Node.js Express server running on port 3000. 
* **Endpoints**: Exposes a single `POST /api/generate-token` endpoint.
* **Security & Auth**: Unknown credentials are rejected with `401 Unauthorized`.
* **EC2 Integration**: Uses the `child_process` module to execute `scp` commands. It uses atomic operations (download -> modify locally in `/tmp/` -> upload) to prevent partial writes to the live proxy registry.

### 3.3 Data Models

#### Local Database (`data/users.json`)
This file dictates who is allowed to generate a token and what role/permissions they receive.

```json
[
  {
    "username": "user1",
    "phone": "1234567890",
    "role": "premium",
    "permissions": {
      "ws": { "stocks": true, "options": true, "news": true },
      "rest": { "stocks_history": true, "news_history": true }
    }
  }
]
```

#### Upstream Proxy Registry (EC2: `/home/ec2-user/cloud-proxy/users.json`)
The final JSON injected into the EC2 server. It matches the proxy's expected schema, including the 1-month `expires_at` timestamp.

```json
{
  "users": [
    {
      "token": "15e46ba3-e991-4b0b-8f6b-339440171daf",
      "user_id": "user1",
      "role": "premium",
      "expires_at": "2026-06-17T16:41:15.397Z",
      "permissions": {
        "ws": { "stocks": true, "options": true, "news": true },
        "rest": { "stocks_history": true, "news_history": true }
      }
    }
  ]
}
```

## 4. Deployment & Maintenance

* **Local Run**: `cd proxy-token-site && node server.js`
* **Production**: 
  - Ensure the Node.js server is managed by a process manager (e.g., PM2) to keep it running in the background.
  - Expose the Node.js application via a reverse proxy (like Nginx) and configure SSL/HTTPS, as sensitive credentials (phone numbers, tokens) are being transmitted.
  - The SSH key (`/home/kai/.ssh/alpacaproxy.pem`) must remain secure and accessible to the user running the Node.js process.
