from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any
from urllib.parse import urlparse


def parse_cookie_header(cookie_header: str) -> str:
    return cookie_header.strip().removeprefix("Cookie:").strip()


def _decode_ansi_c_quoted(value: str) -> str:
    chars: list[str] = []
    index = 0
    while index < len(value):
        char = value[index]
        if char != "\\" or index + 1 >= len(value):
            chars.append(char)
            index += 1
            continue

        escaped = value[index + 1]
        if escaped in {"n", "r", "t", "\\", "'", '"'}:
            chars.append(
                {"n": "\n", "r": "\r", "t": "\t", "\\": "\\", "'": "'", '"': '"'}[escaped]
            )
            index += 2
            continue

        octal_end = index + 1
        while octal_end < len(value) and octal_end < index + 4 and value[octal_end].isdigit():
            octal_end += 1
        if octal_end > index + 1:
            chars.append(chr(int(value[index + 1 : octal_end], 8)))
            index = octal_end
            continue

        chars.append(char)
        index += 1
    return "".join(chars)


def _extract_quoted_curl_arg(text: str, flag: str) -> tuple[str | None, bool]:
    dollar_pattern = rf"{flag}\s+\$'((?:\\.|[^'\\])*)'"
    dollar_match = re.search(dollar_pattern, text, re.S)
    if dollar_match:
        return dollar_match.group(1), True

    for pattern in (
        rf"{flag}\s+'([^']*(?:\\'[^']*)*)'",
        rf'{flag}\s+"([^"]*(?:\\"[^"]*)*)"',
    ):
        match = re.search(pattern, text, re.S)
        if match:
            return match.group(1), False
    return None, False


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


def _find_hub_order_constraint(variables: dict[str, Any]) -> dict[str, Any] | None:
    store_constraints = variables.get("storeConstraints") or {}
    facility_constraints = store_constraints.get("facilityConstraints") or {}
    order_constraint = facility_constraints.get("orderConstraint") or {}

    for candidate in (
        variables.get("hubsMainContentInput", {}).get("hubOrderConstraint"),
        variables.get("input", {}).get("hubOrderConstraint"),
        variables.get("hubOrderConstraint"),
        order_constraint.get("hubOrderConstraint"),
    ):
        if candidate and candidate.get("hubId") and candidate.get("routeId"):
            return candidate
    return None


def _extract_store_content_defaults(variables: dict[str, Any]) -> dict[str, Any]:
    store_constraints = variables.get("storeConstraints") or {}
    facility_constraints = store_constraints.get("facilityConstraints") or {}
    defaults: dict[str, Any] = {}
    for key in (
        "facilityId",
        "customerInteractionSource",
        "serviceSlug",
        "fulfillmentMode",
    ):
        if value := facility_constraints.get(key):
            defaults[key] = value
    return defaults


def build_config_from_curl(curl_text: str) -> dict[str, Any]:
    cookie_match = re.search(r"-H\s+'Cookie:\s*([^']+)'", curl_text, re.I | re.S)
    if not cookie_match:
        cookie_match = re.search(r'-H\s+"Cookie:\s*([^"]+)"', curl_text, re.I | re.S)
    if not cookie_match:
        raise ValueError("Could not find Cookie header in curl command")
    cookie_header = cookie_match.group(1)

    data_raw, ansi_quoted = _extract_quoted_curl_arg(curl_text, "--data-raw")
    if not data_raw:
        data_raw, ansi_quoted = _extract_quoted_curl_arg(curl_text, "--data")
    if not data_raw:
        raise ValueError("Could not find --data-raw payload in curl command")

    if ansi_quoted:
        data_raw = _decode_ansi_c_quoted(data_raw)

    payload = json.loads(data_raw)
    variables = payload.get("variables") or {}

    hub_constraint = _find_hub_order_constraint(variables)
    if not hub_constraint:
        raise ValueError(
            "Could not find hubOrderConstraint with hubId/routeId in request variables"
        )

    hubs_input = variables.get("hubsMainContentInput") or variables.get("input") or {}
    store_content_defaults = _extract_store_content_defaults(variables)
    service_slug = (
        hubs_input.get("serviceSlug")
        or store_content_defaults.get("serviceSlug")
        or "picnic"
    )
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

    config: dict[str, Any] = {
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
    if store_content_defaults:
        config["store_content"] = store_content_defaults
    return config


def _query_filename_for_operation(operation_name: str | None) -> str:
    if operation_name == "storeContent":
        return "captured_store_content.graphql"
    return "captured_hubs_main_content.graphql"


def _merge_config(existing: dict[str, Any], incoming: dict[str, Any]) -> dict[str, Any]:
    merged = dict(existing)
    for key, value in incoming.items():
        if key in {"captured_operation", "captured_query"}:
            continue
        if key == "headers" and isinstance(value, dict):
            merged.setdefault("headers", {}).update(value)
        elif key == "store_content" and isinstance(value, dict):
            merged.setdefault("store_content", {}).update(value)
        elif value is not None:
            merged[key] = value
    return merged


def write_config_from_curl(
    curl_path: Path,
    output_path: Path,
    *,
    merge_existing: bool = True,
) -> dict[str, Any]:
    curl_text = curl_path.read_text(encoding="utf-8", errors="replace")
    if "curl" not in curl_text[:200].lower():
        raise ValueError(
            f"{curl_path} does not look like a plain-text curl command. "
            "Re-copy from DevTools as cURL and save again."
        )

    config = build_config_from_curl(curl_text)
    public_config = {key: value for key, value in config.items() if key != "captured_query"}

    if merge_existing and output_path.exists():
        with output_path.open() as handle:
            public_config = _merge_config(json.load(handle), public_config)

    with output_path.open("w") as handle:
        json.dump(public_config, handle, indent=2)
        handle.write("\n")

    if captured_query := config.get("captured_query"):
        query_path = output_path.parent / _query_filename_for_operation(
            config.get("captured_operation")
        )
        query_path.write_text(captured_query)

    return public_config