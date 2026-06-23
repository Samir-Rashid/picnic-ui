from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any


@dataclass(frozen=True)
class HubOrderConstraint:
    hub_id: str
    route_id: str
    delivery_window_start: str | None = None
    delivery_window_end: str | None = None

    def to_graphql(self) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "hubId": self.hub_id,
            "routeId": self.route_id,
        }
        if self.delivery_window_start:
            payload["deliveryWindowStart"] = self.delivery_window_start
        if self.delivery_window_end:
            payload["deliveryWindowEnd"] = self.delivery_window_end
        return payload


@dataclass(frozen=True)
class ScraperConfig:
    api_url: str
    origin: str
    service_slug: str
    hub_order_constraint: HubOrderConstraint
    cookies: str
    facility_id: str | None = None
    filters: dict[str, Any] = field(default_factory=dict)
    headers: dict[str, str] = field(default_factory=dict)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> ScraperConfig:
        constraint = data["hub_order_constraint"]
        return cls(
            api_url=data.get("api_url", "https://order.trypicnic.com/api/picnic"),
            origin=data.get("origin", "https://order.trypicnic.com"),
            service_slug=data.get("service_slug", "picnic"),
            hub_order_constraint=HubOrderConstraint(
                hub_id=constraint["hubId"],
                route_id=constraint["routeId"],
                delivery_window_start=constraint.get("deliveryWindowStart"),
                delivery_window_end=constraint.get("deliveryWindowEnd"),
            ),
            cookies=data["cookies"],
            facility_id=data.get("facility_id"),
            filters=data.get("filters") or {},
            headers=data.get("headers") or {},
        )

    @classmethod
    def load(cls, path: Path) -> ScraperConfig:
        with path.open() as handle:
            return cls.from_dict(json.load(handle))