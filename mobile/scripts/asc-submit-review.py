#!/usr/bin/env python3
"""Attach a processed build to an App Store version and submit it for review.

Reuses the credentials and JWT from ~/.local/bin/asc-status (the App Store
Connect API key on this box). Idempotent up to the final step: it finds or
creates the version, attaches the build, writes What's New if given, and only
then creates and submits a review submission.

Usage:
  asc-submit-review.py --version 1.0.4 --build 42 [--whats-new "..."] [--release AFTER_APPROVAL|MANUAL] [--dry-run]
"""
from __future__ import annotations

import argparse
import json
import runpy
import sys
import time
import urllib.error
import urllib.request

ASC = runpy.run_path("/home/dev/.local/bin/asc-status", run_name="asc_status_lib")
BASE = "https://api.appstoreconnect.apple.com"
APP_ID = ASC["DEFAULT_APP_ID"]


def call(token: str, method: str, path: str, body: dict | None = None, params: dict | None = None):
    url = BASE + path
    if params:
        url += "?" + "&".join(f"{k}={v}" for k, v in params.items())
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Authorization", f"Bearer {token}")
    req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
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


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--version", required=True)
    ap.add_argument("--build", required=True, help="build number, e.g. 42")
    ap.add_argument("--whats-new", default=None)
    ap.add_argument(
        "--release",
        choices=["AFTER_APPROVAL", "MANUAL"],
        default="AFTER_APPROVAL",
        help="AFTER_APPROVAL goes live the moment Apple approves; MANUAL waits for a press.",
    )
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    creds = ASC["load_credentials"]()
    if not creds:
        die("No App Store Connect credentials (see asc-status --help).")
    token = ASC["make_jwt"](creds["issuerId"], creds["keyId"], creds["privateKey"])

    # 1. The build, and it must be done processing.
    st, body = call(token, "GET", "/v1/builds", params={
        "filter[app]": APP_ID, "filter[version]": args.build, "limit": "5",
    })
    if st != 200:
        die(f"builds lookup failed HTTP {st}", body)
    builds = body.get("data", [])
    if not builds:
        die(f"No build {args.build} in App Store Connect yet.")
    build = builds[0]
    state = build["attributes"].get("processingState")
    print(f"build {args.build}: id {build['id']} processingState {state}")
    if state != "VALID":
        die("Build is not VALID yet. Try again in a few minutes.")

    # 2. The version: find or create.
    st, body = call(token, "GET", f"/v1/apps/{APP_ID}/appStoreVersions", params={
        "filter[platform]": "IOS", "limit": "20",
    })
    if st != 200:
        die(f"versions lookup failed HTTP {st}", body)
    version = next((v for v in body.get("data", []) if v["attributes"].get("versionString") == args.version), None)
    if version:
        print(f"version {args.version}: id {version['id']} state {version['attributes'].get('appStoreState') or version['attributes'].get('appVersionState')}")
    elif args.dry_run:
        print(f"version {args.version}: would create")
    else:
        st, body = call(token, "POST", "/v1/appStoreVersions", {
            "data": {
                "type": "appStoreVersions",
                "attributes": {"platform": "IOS", "versionString": args.version, "releaseType": args.release},
                "relationships": {"app": {"data": {"type": "apps", "id": APP_ID}}},
            }
        })
        if st not in (200, 201):
            die(f"create version failed HTTP {st}", body)
        version = body["data"]
        print(f"version {args.version}: created id {version['id']}")

    if args.dry_run:
        print(f"dry run: stopping before attach and submit (release {args.release})")
        return

    # 2b. Release type on an existing version, so a MANUAL one can become automatic.
    if version["attributes"].get("releaseType") != args.release:
        st, body = call(token, "PATCH", f"/v1/appStoreVersions/{version['id']}", {
            "data": {"type": "appStoreVersions", "id": version["id"], "attributes": {"releaseType": args.release}}
        })
        if st not in (200, 204):
            die(f"set release type failed HTTP {st}", body)
        print(f"release type {args.release}")

    # 3. Attach the build.
    st, body = call(token, "PATCH", f"/v1/appStoreVersions/{version['id']}/relationships/build", {
        "data": {"type": "builds", "id": build["id"]}
    })
    if st not in (200, 204):
        die(f"attach build failed HTTP {st}", body)
    print("build attached")

    # 4. What's New on the en-US localization, if given.
    if args.whats_new:
        st, body = call(token, "GET", f"/v1/appStoreVersions/{version['id']}/appStoreVersionLocalizations")
        if st != 200:
            die(f"localizations lookup failed HTTP {st}", body)
        loc = next((l for l in body.get("data", []) if l["attributes"].get("locale") == "en-US"), None)
        if loc:
            st, body = call(token, "PATCH", f"/v1/appStoreVersionLocalizations/{loc['id']}", {
                "data": {"type": "appStoreVersionLocalizations", "id": loc["id"], "attributes": {"whatsNew": args.whats_new}}
            })
        else:
            st, body = call(token, "POST", "/v1/appStoreVersionLocalizations", {
                "data": {
                    "type": "appStoreVersionLocalizations",
                    "attributes": {"locale": "en-US", "whatsNew": args.whats_new},
                    "relationships": {"appStoreVersion": {"data": {"type": "appStoreVersions", "id": version["id"]}}},
                }
            })
        if st not in (200, 201):
            die(f"what's new failed HTTP {st}", body)
        print("what's new set")

    # 5. Review submission: create, add the version, submit.
    st, body = call(token, "GET", "/v1/reviewSubmissions", params={
        "filter[app]": APP_ID, "filter[state]": "READY_FOR_REVIEW,WAITING_FOR_REVIEW,IN_REVIEW,UNRESOLVED_ISSUES", "limit": "5",
    })
    open_sub = (body.get("data") or [None])[0] if st == 200 else None
    if open_sub and open_sub["attributes"].get("state") != "READY_FOR_REVIEW":
        die(f"A review submission is already {open_sub['attributes'].get('state')}: {open_sub['id']}")
    if open_sub:
        sub = open_sub
        print(f"reusing open submission {sub['id']}")
    else:
        st, body = call(token, "POST", "/v1/reviewSubmissions", {
            "data": {
                "type": "reviewSubmissions",
                "attributes": {"platform": "IOS"},
                "relationships": {"app": {"data": {"type": "apps", "id": APP_ID}}},
            }
        })
        if st not in (200, 201):
            die(f"create review submission failed HTTP {st}", body)
        sub = body["data"]
        print(f"submission created {sub['id']}")

    st, body = call(token, "POST", "/v1/reviewSubmissionItems", {
        "data": {
            "type": "reviewSubmissionItems",
            "relationships": {
                "reviewSubmission": {"data": {"type": "reviewSubmissions", "id": sub["id"]}},
                "appStoreVersion": {"data": {"type": "appStoreVersions", "id": version["id"]}},
            },
        }
    })
    if st not in (200, 201) and "already" not in json.dumps(body).lower():
        die(f"add version to submission failed HTTP {st}", body)
    print("version added to submission")

    st, body = call(token, "PATCH", f"/v1/reviewSubmissions/{sub['id']}", {
        "data": {"type": "reviewSubmissions", "id": sub["id"], "attributes": {"submitted": True}}
    })
    if st not in (200, 204):
        die(f"submit failed HTTP {st}", body)
    print(f"SUBMITTED for review: submission {sub['id']} version {args.version} build {args.build}")


if __name__ == "__main__":
    main()
