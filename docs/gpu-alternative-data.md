# GPU rental alternative data

The site serves `/alternative-data/` as a static aggregate dashboard. The
workstation remains the sole Vast.ai collector (00/06/12/18 UTC). Site visits
never query Vast.ai or access the raw capture directory.

`proxy-token-site/scripts/vastai_gpu_index_feed.py` validates pointer identity,
receipt hashes, all three Parquet artifacts and their row counts/ownership,
and retained raw segment hashes before deriving capacity-weighted model
summaries. It publishes no provider machine/host/offer identifiers, credentials,
raw rows, or local file paths. Missing slots remain gaps. Bootstrap observations
remain visibly provisional. All-sample means and supply retain price tails;
p10–p90 changes the visual band only. Capacity excludes groups which the frozen
normalizer cannot resolve, and must not be described as full marketplace supply.

The root collector's consolidated table uses interpolated NumPy quantiles;
the dashboard uses an inverse-CDF weighted quantile over eligible machine rows.
These are different derived views over the same receipt-bound source. The
dashboard does not average precomputed segment medians.

## Publication

Run with the validated OpenAlice host Python:

```bash
/home/ikkipipi/openalice/.venv/bin/python ops/publish_gpu_index.py --output /tmp/gpu-index-preview.json
/home/ikkipipi/openalice/.venv/bin/python ops/publish_gpu_index.py
```

The publisher validates storage residency and transfers one aggregate JSON via
SSH, checks the returned SHA-256, and replaces only
`/srv/leandata/proxy-token-site/public/alternative-data/gpu-index.json` atomically.
A validation or transfer failure retains the previously published feed; the page
marks stale observations after six hours plus a 30-minute capture allowance.

Install the publisher and exporter from a clean commit archive under
`~/.local/share/leandata-gpu-publisher/releases/<sha>/`, point `current` to that
release, and install `ops/systemd/leandata-gpu-publisher.{service,timer}` as user
units. The timer checks every ten minutes; this does not change upstream capture
frequency. The new `public/alternative-data` directory alone is writable by the
verified SSH operator. Runtime JSON is gitignored and must survive static-site
releases, or be republished immediately afterward. No capture-root mount or
collector key belongs on the cloud host.

A static release copies only reviewed source/bundle files from the pinned Git
archive into the existing mounted `public/` tree, retaining that directory inode
and backing up each replaced file. It does not replace the site's server,
registry, or Compose configuration. Verify release/host/container/public file
hashes and the live aggregate latest slot before accepting the release.

## Data checkpoint (2026-09-09 23:38 UTC)

All 23 retained slots from September 4 06:00 through September 9 18:00 UTC
passed artifact hashes, Parquet row counts, owner identity, unique segment keys,
and exact in-memory reaggregation of the consolidated table from normalized
inputs. Twenty-two have formal schema fingerprints; the initial bootstrap
capture lacks those fingerprints but its consolidated values also reproduce
exactly. No intervening slot is missing. Sparse segment quantiles intentionally
remain null below the minimum sample threshold.
