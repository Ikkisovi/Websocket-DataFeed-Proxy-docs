#!/usr/bin/env python3
"""Build a compact, read-only dashboard feed from formal Vast.ai captures."""

from __future__ import annotations

import argparse
import datetime as dt
import gzip
import hashlib
import json
import math
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd
import pyarrow.parquet as pq


UTC = dt.timezone.utc
RENTAL_ORDER = {"on-demand": 0, "bid": 1, "reserved": 2}


class FeedError(RuntimeError):
    pass


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def read_json(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise FeedError(f"expected JSON object: {path.name}")
    return value


def confined_path(root: Path, relative: str) -> Path:
    candidate = (root / relative).resolve()
    try:
        candidate.relative_to(root.resolve())
    except ValueError as exc:
        raise FeedError("capture artifact escapes the index root") from exc
    return candidate


def slot_iso(slot: str) -> str:
    parsed = dt.datetime.strptime(slot, "%Y%m%dT%H%M%SZ").replace(tzinfo=UTC)
    return parsed.isoformat().replace("+00:00", "Z")


def weighted_quantile(values: np.ndarray, weights: np.ndarray, quantile: float) -> float:
    order = np.argsort(values, kind="stable")
    ordered_values = values[order]
    ordered_weights = weights[order]
    threshold = quantile * float(ordered_weights.sum())
    index = int(np.searchsorted(np.cumsum(ordered_weights), threshold, side="left"))
    return float(ordered_values[min(index, len(ordered_values) - 1)])


def finite_number(value: float) -> float:
    if not math.isfinite(value):
        raise FeedError("non-finite aggregate")
    return round(float(value), 8)


def read_market_vram(root: Path, receipt_path: Path, receipt: dict[str, Any]) -> dict[tuple[str, str], float]:
    values: dict[tuple[str, str], list[float]] = {}
    for segment in receipt.get("segments", []):
        raw_path = confined_path(receipt_path.parent / "raw", str(segment["segment"]))
        expected_hash = str(segment.get("raw_sha256") or "")
        if not expected_hash or sha256_file(raw_path) != expected_hash:
            raise FeedError("raw segment hash mismatch")
        request = segment.get("request", {})
        rental_type = str(request.get("type") or "unknown")
        requested_gpu = str((request.get("gpu_name") or {}).get("eq") or "unknown")
        with gzip.open(raw_path, "rt", encoding="utf-8") as handle:
            payload = json.load(handle)
        for offer in payload.get("offers", []):
            gpu_ram = offer.get("gpu_ram")
            try:
                gpu_ram_gb = float(gpu_ram) / 1000.0
            except (TypeError, ValueError):
                continue
            if not math.isfinite(gpu_ram_gb) or gpu_ram_gb <= 0:
                continue
            gpu_name = str(offer.get("gpu_name") or requested_gpu)
            values.setdefault((rental_type, gpu_name), []).append(gpu_ram_gb)
    return {key: float(np.median(items)) for key, items in values.items() if items}


def aggregate_group(
    frame: pd.DataFrame,
    slot: str,
    capture_id: str,
    formal: bool,
    vram_gb: float | None,
) -> dict[str, Any] | None:
    values = pd.to_numeric(frame["dph_total_per_gpu"], errors="coerce").to_numpy(dtype=float)
    weights = pd.to_numeric(frame["available_gpus"], errors="coerce").fillna(0).to_numpy(dtype=float)
    valid = np.isfinite(values) & np.isfinite(weights) & (values >= 0) & (weights > 0)
    values, weights = values[valid], weights[valid]
    if not len(values):
        return None
    robust_low = weighted_quantile(values, weights, 0.10)
    robust_high = weighted_quantile(values, weights, 0.90)
    tail = (values < robust_low) | (values > robust_high)
    robust_values = np.clip(values, robust_low, robust_high)
    usd_per_100_dlperf = pd.to_numeric(frame["usd_per_100_dlperf"], errors="coerce").to_numpy(dtype=float)[valid]
    valid_dlperf = np.isfinite(usd_per_100_dlperf) & (usd_per_100_dlperf > 0)
    dlperf_per_dollar = (
        weighted_quantile(100.0 / usd_per_100_dlperf[valid_dlperf], weights[valid_dlperf], 0.5)
        if valid_dlperf.any()
        else None
    )
    vram_value = (
        weighted_quantile(vram_gb / values, weights, 0.5)
        if vram_gb is not None and vram_gb > 0 and np.all(values > 0)
        else None
    )
    return {
        "slot": slot_iso(slot),
        "capture_id": capture_id,
        "formal": formal,
        "low": finite_number(robust_low),
        "high": finite_number(robust_high),
        "close": finite_number(weighted_quantile(values, weights, 0.5)),
        "mean": finite_number(np.average(robust_values, weights=weights)),
        "raw_low": finite_number(np.min(values)),
        "raw_high": finite_number(np.max(values)),
        "raw_mean": finite_number(np.average(values, weights=weights)),
        "number": int(weights.sum()),
        "machine_count": int(valid.sum()),
        "tail_gpu_count": int(weights[tail].sum()),
        "tail_machine_count": int(tail.sum()),
        "vram_gb": finite_number(vram_gb) if vram_gb is not None else None,
        "dlperf_per_dollar": finite_number(dlperf_per_dollar) if dlperf_per_dollar is not None else None,
        "vram_per_dollar_hour": finite_number(vram_value) if vram_value is not None else None,
        "vram_cost_per_hour": finite_number(1.0 / vram_value) if vram_value else None,
    }


def read_nebius_artifact(
    root: Path, receipt: dict[str, Any], source: dict[str, Any], name: str
) -> pd.DataFrame:
    artifact = source.get('artifacts', {}).get(name)
    if not isinstance(artifact, dict):
        raise FeedError('nebius artifact is missing')
    path = confined_path(root, str(artifact['path']))
    if not artifact.get('sha256') or sha256_file(path) != artifact['sha256']:
        raise FeedError('nebius artifact hash mismatch')
    if pq.ParquetFile(path).metadata.num_rows != artifact.get('rows'):
        raise FeedError('nebius artifact row count mismatch')
    frame = pd.read_parquet(path)
    if not frame.empty and (
        set(frame.capture_slot) != {str(receipt['capture_slot'])}
        or set(frame.capture_id) != {str(receipt['capture_id'])}
    ):
        raise FeedError('nebius artifact ownership mismatch')
    return frame


def read_nebius_source(
    root: Path, receipt_path: Path, receipt: dict[str, Any]
) -> dict[str, Any]:
    """Read one receipt's Nebius section; never let it block the Vast.ai feed."""
    source = (receipt.get('sources') or {}).get('nebius_spot')
    slot = str(receipt['capture_slot'])
    if not isinstance(source, dict):
        return {'state': 'absent'}
    status = str(source.get('status') or '')
    if status != 'complete':
        return {
            'state': 'gap',
            'slot': slot,
            'reason': 'nebius source is {}'.format(status or 'unknown'),
        }
    try:
        for segment in source.get('segments', []):
            raw_path = confined_path(receipt_path.parent / 'raw', str(segment['segment']))
            if not segment.get('raw_sha256') or sha256_file(raw_path) != segment['raw_sha256']:
                raise FeedError('nebius raw segment hash mismatch')
        snapshot = read_nebius_artifact(root, receipt, source, 'nebius_spot')
        series = read_nebius_artifact(root, receipt, source, 'nebius_spot_series')
    except Exception as error:
        return {
            'state': 'gap',
            'slot': slot,
            'reason': 'nebius artifact validation failed ({})'.format(type(error).__name__),
        }
    return {
        'state': 'ok',
        'slot': slot,
        'capture_id': str(receipt['capture_id']),
        'snapshot_time': source.get('snapshot_time'),
        'spec_sha256': source.get('spec_sha256'),
        'snapshot': snapshot,
        'series': series,
    }


def build_nebius_section(entries: list[dict[str, Any]]) -> dict[str, Any]:
    ok = [entry for entry in entries if entry.get('state') == 'ok']
    gaps = [
        {'slot': slot_iso(entry['slot']), 'reason': entry['reason']}
        for entry in entries
        if entry.get('state') == 'gap'
    ]
    section = {
        'status': 'ok' if ok else 'no_data',
        'source': 'https://api.nebius.cloud/billing/v1alpha1/spot-price (official Nebius spot price viewer API)',
        'methodology': {
            'view': 'provider-listed preemptible/spot SKU price, one row per GPU platform and region',
            'price': 'USD per GPU hour, spot price snapshot and METHOD_LAST_PRICE series',
            'currency': 'USD',
            'windows': 'provider-aggregated history: 15-minute last price over 24h and 1-hour last price over 7d',
            'revision_policy': 'the most recent complete capture wins per timestamp; revisions are counted, never hidden',
            'note': 'Nebius spot prices are market-driven per GPU platform and region and are never mixed into the Vast.ai rental aggregates',
        },
        'snapshot_time': None,
        'latest': [],
        'snapshots': [],
        'series': [],
        'series_revisions': 0,
        'gaps': gaps,
        'capture_count': len(ok),
        'pre_source_slots': sum(1 for entry in entries if entry.get('state') == 'absent'),
    }
    if not ok:
        return section
    latest = sorted(ok, key=lambda entry: entry['slot'])[-1]
    section['snapshot_time'] = latest.get('snapshot_time')
    section['spec_sha256'] = latest.get('spec_sha256')
    section['latest'] = [
        {
            'gpu_name': str(row.gpu_name),
            'gpu_name_raw': str(row.gpu_name_raw),
            'platform': str(row.platform_raw),
            'region': str(row.region),
            'sku_id': str(row.sku_id),
            'price_usd_per_gpu_hour': finite_number(float(row.price_usd_per_gpu_hour)),
            'effective_time': str(row.effective_time),
        }
        for row in latest['snapshot'].itertuples()
    ]
    for entry in sorted(ok, key=lambda item: item['slot']):
        section['snapshots'].extend(
            {
                'slot': slot_iso(str(row.capture_slot)),
                'gpu_name': str(row.gpu_name),
                'region': str(row.region),
                'sku_id': str(row.sku_id),
                'price_usd_per_gpu_hour': finite_number(float(row.price_usd_per_gpu_hour)),
            }
            for row in entry['snapshot'].itertuples()
        )
    merged: dict[tuple[str, str, str, str], dict[str, Any]] = {}
    for entry in sorted(ok, key=lambda item: item['slot']):
        for row in entry['series'].itertuples():
            point_key = (str(row.sku_id), str(row.window), str(row.timestamp), str(row.region))
            value = finite_number(float(row.price_usd_per_gpu_hour))
            previous = merged.get(point_key)
            if previous is not None and previous['value'] != value:
                previous['revised'] = True
                section['series_revisions'] += 1
            merged[point_key] = {'value': value, 'revised': bool(previous and previous.get('revised'))}
    grouped: dict[tuple[str, str], dict[str, Any]] = {}
    for (sku_id, window, _timestamp, _region), point in merged.items():
        # Identify the series by provider SKU so two SKUs sharing a canonical
        # GPU name can never be silently interleaved into one curve.
        item = grouped.setdefault((sku_id, window), {'points': []})
        item['points'].append({'time': _timestamp, 'value': point['value']})
    label_lookup = {
        (str(row.sku_id), str(row.window)): (str(row.gpu_name), str(row.region), str(row.granularity))
        for entry in ok
        for row in entry['series'].itertuples()
    }
    section['series'] = [
        {
            'key': 'spot:{}:{}:{}'.format(sku_id, window, label_lookup[(sku_id, window)][1]),
            'sku_id': sku_id,
            'gpu_name': label_lookup[(sku_id, window)][0],
            'region': label_lookup[(sku_id, window)][1],
            'window': window,
            'granularity': label_lookup[(sku_id, window)][2],
            'points': sorted(item['points'], key=lambda point: point['time']),
        }
        for (sku_id, window), item in sorted(grouped.items())
    ]
    return section


def build_feed(root: Path) -> dict[str, Any]:
    root = root.resolve()
    slots_dir = root / "slots"
    if not slots_dir.is_dir():
        raise FeedError("capture slots directory does not exist")

    grouped: dict[tuple[str, str], list[dict[str, Any]]] = {}
    captures: list[dict[str, Any]] = []
    warnings: list[dict[str, str]] = []
    nebius_entries: list[dict[str, Any]] = []

    for pointer_path in sorted(slots_dir.glob("*.json")):
        try:
            pointer = read_json(pointer_path)
            receipt_path = confined_path(root, str(pointer["receipt"]))
            expected_receipt_hash = str(pointer.get("receipt_sha256") or "")
            if not expected_receipt_hash or sha256_file(receipt_path) != expected_receipt_hash:
                raise FeedError("receipt hash mismatch")
            receipt = read_json(receipt_path)
            if receipt.get("status") != "complete":
                raise FeedError(f"capture status is {receipt.get('status')}")
            slot = str(receipt["capture_slot"])
            capture_id = str(receipt["capture_id"])
            if pointer_path.stem != slot or pointer.get("capture_slot") != slot or pointer.get("capture_id") != capture_id:
                raise FeedError("capture ownership mismatch")
            for name in ("offers", "machines", "index"):
                artifact = receipt.get("artifacts", {}).get(name)
                if not isinstance(artifact, dict):
                    raise FeedError("required artifact is missing")
                artifact_path = confined_path(root, str(artifact["path"]))
                if not artifact.get("sha256") or sha256_file(artifact_path) != artifact["sha256"]:
                    raise FeedError("artifact hash mismatch")
                if pq.ParquetFile(artifact_path).metadata.num_rows != artifact.get("rows"):
                    raise FeedError("artifact row count mismatch")
                ownership = pd.read_parquet(artifact_path, columns=["capture_slot", "capture_id"])
                if not ownership.empty and (set(ownership.capture_slot) != {slot} or set(ownership.capture_id) != {capture_id}):
                    raise FeedError("artifact ownership mismatch")
            machines = pd.read_parquet(confined_path(root, receipt["artifacts"]["machines"]["path"]))
            required = {
                "rental_type",
                "gpu_name",
                "available_gpus",
                "dph_total_per_gpu",
                "usd_per_100_dlperf",
            }
            if not required.issubset(machines.columns):
                raise FeedError("machines artifact schema is incomplete")

            source_dirty = bool(receipt.get("source", {}).get("source_dirty", True))
            has_schema_fingerprints = bool(receipt.get("segments")) and all(
                bool(segment.get("schema_sha256")) for segment in receipt.get("segments", [])
            )
            formal = not source_dirty and has_schema_fingerprints
            slot = str(receipt["capture_slot"])
            capture_id = str(receipt["capture_id"])
            market_vram = read_market_vram(root, receipt_path, receipt)
            nebius_entries.append(read_nebius_source(root, receipt_path, receipt))
            series_count = 0
            for keys, frame in machines.groupby(["rental_type", "gpu_name"], sort=True, dropna=False):
                rental_type, gpu_name = (str(keys[0]), str(keys[1]))
                point = aggregate_group(frame, slot, capture_id, formal, market_vram.get((rental_type, gpu_name)))
                if point is None:
                    continue
                grouped.setdefault((rental_type, gpu_name), []).append(point)
                series_count += 1
            captures.append({
                "slot": slot_iso(slot),
                "capture_id": capture_id,
                "formal": formal,
                "series_count": series_count,
                "index_rows": receipt["artifacts"]["index"]["rows"],
                "quote_rows": receipt["artifacts"]["offers"]["rows"],
                "capacity_rows": receipt["artifacts"]["machines"]["rows"],
                "excluded_machine_groups": receipt.get("counts", {}).get("invalid_machine_groups", 0),
                "integrity": "verified",

            })
        except Exception as error:  # preserve valid slots and report rejected evidence
            warnings.append({"slot": pointer_path.stem, "reason": "capture validation failed"})

    if not grouped:
        raise FeedError("no valid completed captures were found")

    series = [
        {
            "key": f"{rental_type}:{gpu_name}",
            "rental_type": rental_type,
            "gpu_name": gpu_name,
            "points": sorted(points, key=lambda point: point["slot"]),
        }
        for (rental_type, gpu_name), points in grouped.items()
    ]
    series.sort(key=lambda item: (RENTAL_ORDER.get(item["rental_type"], 99), item["gpu_name"]))

    owner = read_json(root / "owner.json") if (root / "owner.json").is_file() else {}
    captures.sort(key=lambda capture: capture["slot"])
    latest_slot = captures[-1]["slot"] if captures else None
    captured_slots = {capture["slot"] for capture in captures}
    expected = []
    cursor = dt.datetime.fromisoformat(captures[0]["slot"].replace("Z", "+00:00"))
    through = dt.datetime.fromisoformat(latest_slot.replace("Z", "+00:00"))
    while cursor <= through:
        expected.append(cursor.isoformat().replace("+00:00", "Z"))
        cursor += dt.timedelta(hours=6)
    return {
        "schema_version": 1,
        "coverage": {
            "expected_slots": len(expected),
            "missing_slots": [slot for slot in expected if slot not in captured_slots],
            "invalid_slots": [item["slot"] for item in warnings],
        },
        "generated_at": dt.datetime.now(tz=UTC).isoformat().replace("+00:00", "Z"),
        "methodology": {
            "view": "capacity",
            "price": "dph_total_per_gpu",
            "currency": "USD",
            "low": "capacity-weighted p10 price",
            "high": "capacity-weighted p90 price",
            "close": "available-GPU weighted median",
            "mean": "available-GPU weighted mean winsorized to p10-p90",
            "raw_low": "minimum observed price retained for audit",
            "raw_high": "maximum observed price retained for audit",
            "raw_mean": "untrimmed available-GPU weighted mean retained for audit",
            "number": "rentable GPUs in eligible normalized machine groups; excluded groups are not included",
            "vram_gb": "Vast gpu_ram in MB divided by 1000",
            "dlperf_per_dollar": "Vast DLPerf per dollar per hour, capacity-weighted median",
            "vram_per_dollar_hour": "derived VRAM GB per dollar per hour, capacity-weighted median",
        },
        "status": {
            "state": owner.get("state", "unknown"),
            "last_result": owner.get("last_result"),
            "last_complete_slot": owner.get("last_complete_slot"),
            "next_capture_at": owner.get("next_capture_at"),
            "last_error": "capture error" if owner.get("last_error") else None,
        },
        "capture_count": len(captures),
        "formal_capture_count": sum(1 for capture in captures if capture["formal"]),
        "latest_slot": latest_slot,
        "captures": captures,
        "rental_types": sorted({item["rental_type"] for item in series}, key=lambda value: RENTAL_ORDER.get(value, 99)),
        "series": series,
        "nebius_spot": build_nebius_section(nebius_entries),
        "warnings": warnings,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, required=True)
    args = parser.parse_args()
    try:
        print(json.dumps(build_feed(args.root), separators=(",", ":"), allow_nan=False))
    except Exception as error:
        parser.exit(1, f"vastai gpu dashboard feed: {error}\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
