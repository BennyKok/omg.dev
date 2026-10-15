#!/usr/bin/env python3
"""Upload App Store creative assets (iOS 27 header / search results) to the
App Asset Library, and stop there.

This script never submits for review and never places an asset on an App
Store version. Both of those touch App Review, and a version review may be
pending. Do them in App Store Connect (Asset Library > Submit, then the
version's Header and Search Results tab) once nobody is waiting on a review.

Flow, from developer.apple.com/documentation/appstoreconnectapi/app-asset-library:
  GET  /v1/apps/{id}/assetLibrary            -> library id
  GET  /v1/appAssetLibraryRefData            -> image specs per placement
  POST /v1/appAssetLibraryImages             -> reservation + uploadOperations
  PUT  <uploadOperations[].url>              -> bytes (no JWT)
  PATCH /v1/appAssetLibraryImages/{id}       -> uploaded: true
  GET  /v1/appAssetLibraryImages/{id}        -> poll until PREPARE_FOR_SUBMISSION

Reuses the credentials and JWT from ~/.local/bin/asc-status.

Usage:
  asc-upload-creative.py [--dry-run]
      [--header PATH] [--search PATH] [--reference-suffix TEXT]
Defaults are the renderer's output in
/home/dev/omg-appstore-screenshots/designed/creative/.
"""
from __future__ import annotations

import argparse
import json
import os
import runpy
import struct
import sys
import time
import urllib.error
import urllib.request

ASC = runpy.run_path("/home/dev/.local/bin/asc-status", run_name="asc_status_lib")
BASE = "https://api.appstoreconnect.apple.com"
APP_ID = ASC["DEFAULT_APP_ID"]
CREATIVE_DIR = "/home/dev/omg-appstore-screenshots/designed/creative"
PLACEMENTS = {
    "header": "PRODUCT_PAGE_HEADER_ASSET",
    "search": "APP_STORE_SEARCH_RESULTS_ASSET",
}


def call(token: str, method: str, path: str, body: dict | None = None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method)
    req.add_header("Authorization", f"Bearer {token}")
    req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            raw = r.read()
            return r.status, (json.loads(raw) if raw else {})
    except urllib.error.HTTPError as e:
        raw = e.read()
        try:
            return e.code, json.loads(raw)
        except Exception:
            return e.code, {"raw": raw.decode(errors="replace")}


def die(msg: str, body=None):
    print(msg, file=sys.stderr)
    if body is not None:
        print(json.dumps(body, indent=2)[:2000], file=sys.stderr)
    sys.exit(1)


def png_info(path: str) -> tuple[int, int, int]:
    """(width, height, colour type) from the IHDR chunk."""
    with open(path, "rb") as f:
        head = f.read(33)
    if head[:8] != b"\x89PNG\r\n\x1a\n" or head[12:16] != b"IHDR":
        die(f"{path}: not a PNG")
    w, h = struct.unpack(">II", head[16:24])
    return w, h, head[25]


def pick_spec(ref: dict, placement: str, path: str) -> dict:
    """The non-universal image spec for this placement that the file fits."""
    w, h, colour = png_info(path)
    attrs = ref["data"][0]["attributes"] if isinstance(ref["data"], list) else ref["data"]["attributes"]
    spec_ids = set()
    for pt in attrs["placementTypes"]:
        if pt["placementTypeId"] == placement:
            for m in pt["specMappings"]:
                spec_ids.update(m["specs"])
    for spec in attrs["imageSpecs"]:
        if spec["specId"] not in spec_ids or spec.get("universalAsset"):
            continue
        d = spec["dimensions"]
        if not (d["minWidth"] <= w <= d["maxWidth"] and d["minHeight"] <= h <= d["maxHeight"]):
            continue
        if ".png" not in spec["fileExtensions"]:
            die(f"{path}: spec {spec['shortName']} does not accept .png")
        if not spec.get("alphaAllowed") and colour in (4, 6):
            die(f"{path}: has an alpha channel and spec {spec['shortName']} forbids it")
        if os.path.getsize(path) > spec["maxFileSize"]:
            die(f"{path}: larger than {spec['maxFileSize']} bytes")
        return spec
    die(f"{path}: {w}x{h} matches no {placement} image spec")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--header", default=os.path.join(CREATIVE_DIR, "product-page-header.png"))
    ap.add_argument("--search", default=os.path.join(CREATIVE_DIR, "search-results.png"))
    ap.add_argument("--reference-suffix", default=time.strftime("%Y-%m-%d"),
                    help="appended to each referenceName, so a re-render uploads as a new asset")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    creds = ASC["load_credentials"]()
    if not creds:
        die("No App Store Connect credentials (see asc-status --help).")
    token = ASC["make_jwt"](creds["issuerId"], creds["keyId"], creds["privateKey"])

    st, lib = call(token, "GET", f"/v1/apps/{APP_ID}/assetLibrary")
    if st != 200:
        die(f"asset library lookup failed HTTP {st}", lib)
    library_id = lib["data"]["id"]
    st, ref = call(token, "GET", "/v1/appAssetLibraryRefData")
    if st != 200:
        die(f"reference data lookup failed HTTP {st}", ref)

    jobs = []
    for key, path in (("header", args.header), ("search", args.search)):
        if not os.path.exists(path):
            die(f"missing {path}; run mobile/docs/appstore-frames/render.mjs --creative-only")
        spec = pick_spec(ref, PLACEMENTS[key], path)
        name = "Header" if key == "header" else "Search results"
        reference = f"{name} - Keep building your ideas ({args.reference_suffix})"
        jobs.append((key, path, spec, reference))
        print(f"{key}: {path} -> spec {spec['shortName']} ({spec['specId']}) as '{reference}'")

    if args.dry_run:
        print("dry run: nothing uploaded")
        return

    for key, path, spec, reference in jobs:
        # Idempotent: an asset with this referenceName that did not fail is
        # already there; do not upload a duplicate.
        q = urllib.request.quote(reference)
        st, existing = call(token, "GET", f"/v1/appAssetLibraries/{library_id}/images?filter[referenceName]={q}")
        live = [i for i in existing.get("data", []) if i["attributes"].get("state") != "FAILED"]
        if live:
            a = live[0]["attributes"]
            print(f"{key}: already uploaded as {live[0]['id']} (state {a.get('state')}); skipping")
            continue

        size = os.path.getsize(path)
        st, res = call(token, "POST", "/v1/appAssetLibraryImages", {
            "data": {
                "type": "appAssetLibraryImages",
                "attributes": {
                    "fileName": os.path.basename(path),
                    "fileSize": size,
                    "category": "CREATIVE_ASSETS",
                    "referenceName": reference,
                },
                "relationships": {"assetLibrary": {"data": {"type": "appAssetLibraries", "id": library_id}}},
            }
        })
        if st != 201:
            die(f"{key}: reservation failed HTTP {st}", res)
        image_id = res["data"]["id"]
        ops = res["data"]["attributes"]["uploadOperations"]
        print(f"{key}: reserved {image_id}, {len(ops)} upload part(s)")

        with open(path, "rb") as f:
            blob = f.read()
        for op in ops:
            part = blob[op["offset"]:op["offset"] + op["length"]]
            req = urllib.request.Request(op["url"], data=part, method=op["method"])
            for h in op.get("requestHeaders", []):
                req.add_header(h["name"], h["value"])
            with urllib.request.urlopen(req, timeout=300) as r:
                if r.status not in (200, 201, 204):
                    die(f"{key}: part at offset {op['offset']} failed HTTP {r.status}")

        st, res = call(token, "PATCH", f"/v1/appAssetLibraryImages/{image_id}", {
            "data": {"type": "appAssetLibraryImages", "id": image_id, "attributes": {"uploaded": True}}
        })
        if st != 200:
            die(f"{key}: commit failed HTTP {st}", res)

        deadline = time.time() + 600
        while True:
            st, res = call(token, "GET", f"/v1/appAssetLibraryImages/{image_id}")
            a = res.get("data", {}).get("attributes", {})
            state = a.get("state")
            if state == "PREPARE_FOR_SUBMISSION":
                break
            if state == "FAILED":
                die(f"{key}: processing failed", a.get("stateDetails"))
            if time.time() > deadline:
                die(f"{key}: still {state} after 10 minutes; check App Store Connect")
            time.sleep(10)
        if a.get("specId") != spec["specId"]:
            die(f"{key}: Apple matched spec {a.get('specId')}, expected {spec['specId']} ({spec['shortName']})")
        img = a.get("imageAsset") or {}
        print(f"{key}: ready, {img.get('width')}x{img.get('height')}, spec {spec['shortName']}, state {state}")

    print("Uploaded only. Not submitted for review, not placed on any version.")


if __name__ == "__main__":
    main()
