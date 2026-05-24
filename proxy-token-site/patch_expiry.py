"""
Patch alpaca_cloud_proxy.py to enforce token expiry.
Run on ThinkCentre: python3 patch_expiry.py

Changes:
1. _normalize_principal_entry: preserve expires_at field
2. Add _is_token_expired() helper
3. resolve_http_principal: reject expired tokens
4. resolve_ws_principal: reject expired tokens
"""
import re
import sys
import shutil
from pathlib import Path

PROXY_FILE = Path.home() / "Websocket-DataFeed-Proxy/ec2-primary-backup/alpaca_cloud_proxy.py"

def patch():
    content = PROXY_FILE.read_text()

    # --- 1. Preserve expires_at in _normalize_principal_entry ---
    old_principal_block = '''    principal = {
        "token": str(token),
        "user_id": str(user_id),
        "role": str(entry.get("role") or "legacy"),
        "permissions": _deep_copy_json(FULL_ACCESS_PERMISSIONS),
    }'''
    new_principal_block = '''    principal = {
        "token": str(token),
        "user_id": str(user_id),
        "role": str(entry.get("role") or "legacy"),
        "permissions": _deep_copy_json(FULL_ACCESS_PERMISSIONS),
        "expires_at": entry.get("expires_at"),
    }'''
    if old_principal_block not in content:
        print("[SKIP] _normalize_principal_entry already patched or not found")
    else:
        content = content.replace(old_principal_block, new_principal_block, 1)
        print("[OK] _normalize_principal_entry: added expires_at")

    # --- 2. Add _is_token_expired helper before is_valid_token ---
    expire_helper = '''
def _is_token_expired(principal) -> bool:
    """Check if a principal's token has expired based on expires_at field."""
    if not principal or not isinstance(principal, dict):
        return False
    expires_at = principal.get("expires_at")
    if not expires_at:
        return False  # no expiry set = never expires
    try:
        from datetime import datetime, timezone
        exp_str = str(expires_at).replace("+00:00", "Z").replace("+0000", "Z")
        if exp_str.endswith("Z"):
            exp_str = exp_str[:-1]
        # Handle both with and without microseconds
        for fmt in ("%Y-%m-%dT%H:%M:%S.%f", "%Y-%m-%dT%H:%M:%S"):
            try:
                exp_dt = datetime.strptime(exp_str, fmt).replace(tzinfo=timezone.utc)
                break
            except ValueError:
                continue
        else:
            return False
        return datetime.now(timezone.utc) > exp_dt
    except Exception:
        return False


'''
    if '_is_token_expired' in content:
        print("[SKIP] _is_token_expired already exists")
    else:
        # Insert before def token_required
        anchor = 'def token_required() -> bool:'
        if anchor in content:
            content = content.replace(anchor, expire_helper + anchor, 1)
            print("[OK] Added _is_token_expired helper")
        else:
            print("[ERROR] Could not find anchor for _is_token_expired")
            return False

    # --- 3. Patch resolve_http_principal to check expiry ---
    old_http = '''def resolve_http_principal(token: str, request):
    if not token:
        return None
    registry = load_user_registry()
    if registry:
        return registry.get(token)'''
    new_http = '''def resolve_http_principal(token: str, request):
    if not token:
        return None
    registry = load_user_registry()
    if registry:
        principal = registry.get(token)
        if principal and _is_token_expired(principal):
            print(f"[Auth] Token expired for user {principal.get('user_id')}", flush=True)
            return None
        return principal'''
    if old_http not in content:
        print("[SKIP] resolve_http_principal already patched or not found")
    else:
        content = content.replace(old_http, new_http, 1)
        print("[OK] resolve_http_principal: added expiry check")

    # --- 4. Patch resolve_ws_principal to check expiry ---
    old_ws = '''def resolve_ws_principal(token: str, websocket):
    if not token:
        return None
    registry = load_user_registry()
    if registry:
        return registry.get(token)'''
    new_ws = '''def resolve_ws_principal(token: str, websocket):
    if not token:
        return None
    registry = load_user_registry()
    if registry:
        principal = registry.get(token)
        if principal and _is_token_expired(principal):
            print(f"[Auth] WS token expired for user {principal.get('user_id')}", flush=True)
            return None
        return principal'''
    if old_ws not in content:
        print("[SKIP] resolve_ws_principal already patched or not found")
    else:
        content = content.replace(old_ws, new_ws, 1)
        print("[OK] resolve_ws_principal: added expiry check")

    # Write back
    backup = PROXY_FILE.with_suffix('.py.pre_expiry_patch')
    shutil.copy2(PROXY_FILE, backup)
    print(f"[OK] Backup saved to {backup}")
    PROXY_FILE.write_text(content)
    print("[OK] Patch applied successfully")
    print("\nTo activate: restart the Docker container:")
    print("  cd ~/Websocket-DataFeed-Proxy/ec2-primary-backup/")
    print("  docker compose -f docker-compose.cloud-proxy.yml up -d --build")
    return True

if __name__ == "__main__":
    if not PROXY_FILE.exists():
        print(f"ERROR: {PROXY_FILE} not found")
        sys.exit(1)
    success = patch()
    sys.exit(0 if success else 1)
