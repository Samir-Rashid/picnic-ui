from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any
from urllib.parse import urlparse


def parse_cookie_header(cookie_header: str) -> str:
    return cookie_header.strip().removeprefix("Cookie:").strip()


def _extract_quoted_curl_arg(text: str, flag: str) -> str | None:
    for pattern in (
        rf"{flag}\s+'([^']*(?:\\'[^']*)*)'",
        rf'{flag}\s+"([^"]*(?:\\"[^"]*)*)"',
    ):
        match = re.search(pattern, text, re.S)
        if match:
            return match.group(1)
    return None


def _extract_url(curl_text: str) -> str:
    match = re.search(r"curl\s+'([^']+)'", curl_text)
    if not match:
        match = re.search(r'curl\s+"([^"]+)"', curl_text)
    if not match:
        match = re.search(r"curl\s+([^\s\\]+)", curl_text)
    if not match:
        raise ValueError("Could not find request URL in curl command")
    return match.group(1).split("?", 1)[0]


def _extract_headers(curl_text: str) -> dict[str, str]:
    headers: dict[str, str] = {}
    for match in re.finditer(
        r"-H\s+'([^:]+):\s*([^']*)'|-H\s+\"([^:]+):\s*([^\"]*)\"",
        curl_text,
    ):
        if match.group(1):
            key, value = match.group(1), match.group(2)
        else:
            key, value = match.group(3), match.group(4)
        if key.lower() == "cookie":
            continue
        if value and value.lower() != "undefined":
            headers[key] = value
    return headers


def build_config_from_curl(curl_text: str) -> dict[str, Any]:
    cookie_match = re.search(r"-H\s+'Cookie:\s*([^']+)'", curl_text, re.I | re.S)
    if not cookie_match:
        cookie_match = re.search(r'-H\s+"Cookie:\s*([^"]+)"', curl_text, re.I | re.S)
    if not cookie_match:
        raise ValueError("Could not find Cookie header in curl command")
    cookie_header = cookie_match.group(1)

    data_raw = _extract_quoted_curl_arg(curl_text, "--data-raw")
    if not data_raw:
        data_raw = _extract_quoted_curl_arg(curl_text, "--data")
    if not data_raw:
        raise ValueError("Could not find --data-raw payload in curl command")

    payload = json.loads(data_raw)
    variables = payload.get("variables") or {}

    hub_constraint = None
    for candidate in (
        variables.get("hubsMainContentInput", {}).get("hubOrderConstraint"),
        variables.get("input", {}).get("hubOrderConstraint"),
        variables.get("hubOrderConstraint"),
    ):
        if candidate and candidate.get("hubId") and candidate.get("routeId"):
            hub_constraint = candidate
            break

    if not hub_constraint:
        raise ValueError(
            "Could not find hubOrderConstraint with hubId/routeId in request variables"
        )

    hubs_input = variables.get("hubsMainContentInput") or variables.get("input") or {}
    service_slug = hubs_input.get("serviceSlug") or "picnic"
    filters = hubs_input.get("filters") or {}
    facility_id = hubs_input.get("cartConstraints", {}).get("facilityId")

    request_url = _extract_url(curl_text)
    parsed = urlparse(request_url)
    api_url = f"{parsed.scheme}://{parsed.netloc}{parsed.path.rsplit('/graphql', 1)[0]}"

    headers = _extract_headers(curl_text)
    keep_headers = {
        key: value
        for key, value in headers.items()
        if key.lower()
        in {
            "application-version",
            "application-name",
            "x-client-session-id",
            "consistent-authz",
            "user-agent",
        }
    }

    return {
        "api_url": api_url,
        "origin": headers.get("Origin", "https://order.trypicnic.com"),
        "service_slug": service_slug,
        "hub_order_constraint": {
            "hubId": hub_constraint["hubId"],
            "routeId": hub_constraint["routeId"],
            "deliveryWindowStart": hub_constraint.get("deliveryWindowStart"),
            "deliveryWindowEnd": hub_constraint.get("deliveryWindowEnd"),
        },
        "filters": filters,
        "facility_id": facility_id,
        "cookies": parse_cookie_header(cookie_header),
        "headers": keep_headers,
        "captured_operation": payload.get("operationName"),
        "captured_query": payload.get("query"),
    }


def write_config_from_curl(curl_path: Path, output_path: Path) -> dict[str, Any]:
    curl_text = curl_path.read_text(encoding="utf-8", errors="replace")
    if "curl" not in curl_text[:200].lower():
        raise ValueError(
            f"{curl_path} does not look like a plain-text curl command. "
            "Re-copy from DevTools as cURL and save again."
        )

    config = build_config_from_curl(curl_text)
    public_config = {key: value for key, value in config.items() if key != "captured_query"}
    with output_path.open("w") as handle:
        json.dump(public_config, handle, indent=2)
        handle.write("\n")

    if captured_query := config.get("captured_query"):
        query_path = output_path.parent / "captured_hubs_main_content.graphql"
        query_path.write_text(captured_query)

    return public_config