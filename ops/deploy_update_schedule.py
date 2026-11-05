#!/usr/bin/env python3
"""Publish the schedule docs with the existing static-release guards and rollback."""
import deploy_docs_static as release

# Account assets and untouched retired aliases have independent live amendments.
# Keep them out of this documentation overlay; never roll them back incidentally.
PRESERVE = {
    "assets/account-page.js", "account-page.jsx", "account.html",
    "docs/financial/morningstar/morningstar-daily-history/index.html",
    "docs/financial/morningstar/morningstar-daily-coverage/index.html",
    "docs/financial/morningstar/morningstar-v3/index.html",
    "docs/financial/eodhd/eodhd-fields/index.html",
}
release.FILES = tuple(name for name in release.FILES if name not in PRESERVE)

if __name__ == "__main__":
    release.main()
