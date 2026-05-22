# Remote Proxy Project Structure

This document outlines the architecture and project structure of the main local proxy deployed on the `mint-thinkcentre-m900` machine.

## Deployment Environment
- **Host**: `mint-thinkcentre-m900` (Tailscale IP: `100.70.107.106`)
- **User**: `mint` (with root access required for the source code directory)
- **Source Code Path on Host**: `/root/Websocket-DataFeed-Proxy/ec2-primary-backup`
- **Docker Container**: `ec2-primary-backup-alpaca-cloud-proxy-1` (running via Docker Compose)
- **Container Working Directory**: `/app`

## Key Components

The proxy application is a Python-based asynchronous service using `aiohttp` and `websockets` to multiplex connections to upstream data providers like Alpaca and ThetaData.

### Core Files (inside `/app` of the container)

1. **`alpaca_cloud_proxy.py`**
   - **Role**: The main application entry point.
   - **Responsibilities**:
     - Multiplexes WebSocket streams (stocks, options, crypto, news, etc.) from Alpaca and ThetaData to multiple downstream clients.
     - Handles HTTP REST API proxying for historical data, snapshots, and orderbooks.
     - Implements an authentication and authorization layer based on user tokens.
     - Implements in-memory rate limiting (REST requests and WS subscriptions per minute).
     - Integrates with `ThetaData` for options chain resolution and historical data.

2. **`disk_cache.py`**
   - **Role**: Caching layer.
   - **Responsibilities**:
     - Provides disk-backed caching for frequent or heavy REST API responses.
     - Reduces the number of redundant upstream API calls to Alpaca/ThetaData.
     - Runs a background loop to clean up expired cache entries.

3. **`users.json`**
   - **Role**: User Registry.
   - **Responsibilities**:
     - Stores the mapping of access tokens to user IDs, roles, and permissions.
     - Differentiates permissions across `ws` (WebSockets) and `rest` (HTTP) endpoints.

4. **`audit.jsonl`**
   - **Role**: Audit logging.
   - **Responsibilities**:
     - Records HTTP usage and API access patterns for tracking and analytics.

5. **`.thetadata_credentials.txt`**
   - **Role**: Secrets management.
   - **Responsibilities**:
     - Holds the credentials required to authenticate with the ThetaData SDK.

## Data Flow
- **Clients** connect to the proxy via WebSockets or HTTP.
- **Authentication**: The proxy verifies the token against `users.json` or the loaded environment registry.
- **Rate Limiting**: It enforces subscription limits and request rates based on the user's assigned tier (e.g., basic, standard, premium).
- **Upstream Providers**: The proxy routes valid requests to either Alpaca's APIs or ThetaData's APIs, leveraging `disk_cache` where applicable to improve performance.
