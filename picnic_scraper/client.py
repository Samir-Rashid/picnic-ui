from __future__ import annotations

from typing import Any

import httpx

from picnic_scraper.config import ScraperConfig


class PicnicGraphQLClient:
    def __init__(self, config: ScraperConfig) -> None:
        self.config = config
        headers = {
            "Content-Type": "application/json",
            "Accept": "*/*",
            "Origin": config.origin,
            "Referer": f"{config.origin}/",
            "Cookie": config.cookies,
            "User-Agent": (
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                "AppleWebKit/605.1.15 (KHTML, like Gecko) "
                "Version/26.5 Safari/605.1.15"
            ),
            "consistent-authz": "true",
            "application-name": "d2c-facility-app",
        }
        headers.update(config.headers)

        self._client = httpx.Client(
            base_url=config.api_url.rstrip("/"),
            headers=headers,
            timeout=60.0,
        )

    def close(self) -> None:
        self._client.close()

    def __enter__(self) -> PicnicGraphQLClient:
        return self

    def __exit__(self, *_: object) -> None:
        self.close()

    def execute(
        self,
        operation_name: str,
        query: str,
        variables: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "operationName": operation_name,
            "query": query,
        }
        if variables is not None:
            payload["variables"] = variables

        response = self._client.post(
            "/graphql",
            params={"operation": operation_name},
            json=payload,
        )
        response.raise_for_status()
        body = response.json()
        if errors := body.get("errors"):
            messages = "; ".join(
                error.get("message", str(error)) for error in errors
            )
            raise RuntimeError(f"GraphQL error in {operation_name}: {messages}")
        return body["data"]