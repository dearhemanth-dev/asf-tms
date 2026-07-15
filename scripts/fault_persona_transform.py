#!/usr/bin/env python3
"""Transform a ground-truth fault record into persona-specific operational views.

This module uses OpenAI JSON mode (`response_format={"type": "json_object"}`)
and validates the returned payload against a strict schema contract.
"""

from __future__ import annotations

import json
import os
import re
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, TypedDict

from openai import OpenAI


SYSTEM_PROMPT = (
    "You are a Heavy-Duty Diesel Master Fleet Logician and Director of Maintenance. "
    "You are analyzing an active fault on a Class 8 OTR commercial asset(with mid to high odometer mileages, even over 1 million miles). "
    "You must synthesize the provided ground-truth mechanical manual text into four hyper-focused, trustworthy, and actionable perspective strings. "
    "Do not invent mechanical symptoms outside the provided reference text.\n\n"
    "Your output must be a strict JSON object mapping exactly to these keys:\n"
    "{\n"
    "  \"driver_speak\": {\n"
    "    \"severity\": \"CRITICAL_SHUTDOWN\", \"INTERCEPT_NOW\", or \"MONITOR_AND_RUN\",\n"
    "    \"safe_miles_remaining\": \"Strict integer estimate based ONLY on the operational danger context\",\n"
    "    \"safety_details\": \"Short, clear safety message for the driver's mobile screen (e.g., 'Pull over if you see smoke' or 'Keep engine running at next stop')\"\n"
    "  },\n"
    "  \"mechanic_speak\": {\n"
    "    \"required_resources\": \"Strict array containing combinations of: 'PARTS_REQUIRED', 'LABOR_ONLY', 'DIAGNOSTIC_SOFTWARE_FLASH'\",\n"
    "    \"inspection_focus\": \"1-sentence pinpoint instruction telling the shop mechanic exactly what physical valve, line, or circuit to test first to bypass generic troubleshooting\"\n"
    "  },\n"
    "  \"dispatcher_speak\": {\n"
    "    \"miles_vs_delivery_status\": \"Clear statement comparing the safe_miles_remaining \",\n"
    "    \"post_breakdown_timeline_hours\": \"Estimated down-time in hours if this truck is allowed to completely break down on the road, including towing, part sourcing, and active bay labor\"\n"
    "  },\n"
    "  \"manager_speak\": {\n"
    "    \"estimated_roadside_cost_usd\": \"Realistic dollar amount range for an emergency OTR road-call repair vs an in-house shop fix\",\n"
    "    \"root_cause_recurrence_intelligence\": \"An executive summary explaining why this engine repeats this failure (e.g., component fatigue, carbon buildup due to excessive idling, or sequential sensor degradation), guiding the manager on whether to patch or permanently overhaul the assembly\"\n"
    "  }\n"
    "}"
)

ALLOWED_SEVERITIES = {"CRITICAL_SHUTDOWN", "INTERCEPT_NOW", "MONITOR_AND_RUN"}
ALLOWED_RESOURCES = {"PARTS_REQUIRED", "LABOR_ONLY", "DIAGNOSTIC_SOFTWARE_FLASH"}


class FaultInput(TypedDict, total=False):
    spn: int
    fmi: int
    affected_system: str
    mechanic_repair_steps: str
    operational_danger: str
    truck_mileage: Optional[int]
    remaining_trip_distance_miles: Optional[int]
    samsara_vehicle_id: Optional[str]


class DriverSpeak(TypedDict):
    severity: str
    safe_miles_remaining: str
    safety_details: str


class MechanicSpeak(TypedDict):
    required_resources: List[str]
    inspection_focus: str


class DispatcherSpeak(TypedDict):
    miles_vs_delivery_status: str
    post_breakdown_timeline_hours: str


class ManagerSpeak(TypedDict):
    estimated_roadside_cost_usd: str
    root_cause_recurrence_intelligence: str


class PersonaViews(TypedDict):
    driver_speak: DriverSpeak
    mechanic_speak: MechanicSpeak
    dispatcher_speak: DispatcherSpeak
    manager_speak: ManagerSpeak


@dataclass(frozen=True)
class SamsaraConfig:
    api_token: str
    base_url: str = "https://api.samsara.com"
    timeout_seconds: int = 20


class ValidationError(ValueError):
    """Raised when input or model output violates required schema constraints."""


def _require_non_empty_string(value: Any, field_name: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValidationError(f"{field_name} must be a non-empty string")
    return value.strip()


def _require_int_or_none(value: Any, field_name: str) -> Optional[int]:
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, int):
        raise ValidationError(f"{field_name} must be an integer or null")
    if value < 0:
        raise ValidationError(f"{field_name} must be >= 0")
    return value


def validate_fault_input(payload: Dict[str, Any]) -> FaultInput:
    spn = payload.get("spn")
    fmi = payload.get("fmi")

    if isinstance(spn, bool) or not isinstance(spn, int):
        raise ValidationError("spn must be an integer")
    if isinstance(fmi, bool) or not isinstance(fmi, int):
        raise ValidationError("fmi must be an integer")

    record: FaultInput = {
        "spn": spn,
        "fmi": fmi,
        "affected_system": _require_non_empty_string(payload.get("affected_system"), "affected_system"),
        "mechanic_repair_steps": _require_non_empty_string(payload.get("mechanic_repair_steps"), "mechanic_repair_steps"),
        "operational_danger": _require_non_empty_string(payload.get("operational_danger"), "operational_danger"),
        "truck_mileage": _require_int_or_none(payload.get("truck_mileage"), "truck_mileage"),
        "remaining_trip_distance_miles": _require_int_or_none(
            payload.get("remaining_trip_distance_miles"), "remaining_trip_distance_miles"
        ),
    }

    vehicle_id = payload.get("samsara_vehicle_id")
    if vehicle_id is not None:
        record["samsara_vehicle_id"] = _require_non_empty_string(vehicle_id, "samsara_vehicle_id")

    return record


def fetch_truck_mileage_from_samsara(vehicle_id: str, config: SamsaraConfig) -> int:
    """Fetch odometer from Samsara stats and convert meters to miles."""

    params = urllib.parse.urlencode({"types": "obdOdometerMeters", "vehicleIds": vehicle_id, "limit": "1"})
    url = f"{config.base_url.rstrip('/')}/fleet/vehicles/stats?{params}"

    request = urllib.request.Request(
        url,
        headers={
            "Authorization": f"Bearer {config.api_token}",
            "Accept": "application/json",
        },
        method="GET",
    )

    try:
        with urllib.request.urlopen(request, timeout=config.timeout_seconds) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        details = exc.read().decode("utf-8", errors="ignore")
        raise RuntimeError(f"Samsara API error {exc.code}: {details}") from exc

    rows = payload.get("data")
    if not isinstance(rows, list) or not rows:
        raise RuntimeError("Samsara response did not include odometer data")

    row = rows[0] if isinstance(rows[0], dict) else {}
    meters: Optional[float] = None

    stats = row.get("stats")
    if isinstance(stats, dict):
        candidate = stats.get("obdOdometerMeters")
        if isinstance(candidate, (int, float)):
            meters = float(candidate)

    if meters is None:
        candidate = row.get("obdOdometerMeters")
        if isinstance(candidate, (int, float)):
            meters = float(candidate)

    if meters is None or meters < 0:
        raise RuntimeError("Unable to resolve obdOdometerMeters from Samsara response")

    return int(round(meters / 1609.344))


def enrich_with_truck_mileage(record: FaultInput, samsara_config: Optional[SamsaraConfig]) -> FaultInput:
    if record.get("truck_mileage") is not None:
        return record

    vehicle_id = record.get("samsara_vehicle_id")
    if not vehicle_id:
        raise ValidationError(
            "truck_mileage is null and samsara_vehicle_id is missing. Provide one of these to continue."
        )

    if samsara_config is None:
        raise ValidationError(
            "truck_mileage is null and no Samsara config was provided. Cannot deduce mileage."
        )

    enriched = dict(record)
    enriched["truck_mileage"] = fetch_truck_mileage_from_samsara(vehicle_id, samsara_config)
    return enriched


def build_user_message(record: FaultInput) -> str:
    context = {
        "spn": record["spn"],
        "fmi": record["fmi"],
        "affected_system": record["affected_system"],
        "mechanic_repair_steps": record["mechanic_repair_steps"],
        "operational_danger": record["operational_danger"],
        "truck_mileage": record.get("truck_mileage"),
        "remaining_trip_distance_miles": record.get("remaining_trip_distance_miles"),
    }

    return (
        "Use ONLY this ground-truth context and produce strict JSON output matching the required schema.\n"
        f"Context JSON:\n{json.dumps(context, ensure_ascii=True)}"
    )


def validate_persona_views(payload: Dict[str, Any]) -> PersonaViews:
    required_top = {"driver_speak", "mechanic_speak", "dispatcher_speak", "manager_speak"}
    extra = set(payload.keys()) - required_top
    missing = required_top - set(payload.keys())
    if missing:
        raise ValidationError(f"Missing top-level keys: {sorted(missing)}")
    if extra:
        raise ValidationError(f"Unexpected top-level keys: {sorted(extra)}")

    driver = payload["driver_speak"]
    mechanic = payload["mechanic_speak"]
    dispatcher = payload["dispatcher_speak"]
    manager = payload["manager_speak"]

    if not isinstance(driver, dict):
        raise ValidationError("driver_speak must be an object")
    if not isinstance(mechanic, dict):
        raise ValidationError("mechanic_speak must be an object")
    if not isinstance(dispatcher, dict):
        raise ValidationError("dispatcher_speak must be an object")
    if not isinstance(manager, dict):
        raise ValidationError("manager_speak must be an object")

    severity = _require_non_empty_string(driver.get("severity"), "driver_speak.severity")
    if severity not in ALLOWED_SEVERITIES:
        raise ValidationError(f"driver_speak.severity must be one of {sorted(ALLOWED_SEVERITIES)}")

    safe_miles_remaining = _require_non_empty_string(driver.get("safe_miles_remaining"), "driver_speak.safe_miles_remaining")
    if not re.fullmatch(r"\d+", safe_miles_remaining):
        raise ValidationError("driver_speak.safe_miles_remaining must be a string containing only digits")

    safety_details = _require_non_empty_string(driver.get("safety_details"), "driver_speak.safety_details")

    resources = mechanic.get("required_resources")
    if not isinstance(resources, list) or not resources:
        raise ValidationError("mechanic_speak.required_resources must be a non-empty array")

    normalized_resources: List[str] = []
    for value in resources:
        item = _require_non_empty_string(value, "mechanic_speak.required_resources[]")
        if item not in ALLOWED_RESOURCES:
            raise ValidationError(
                f"mechanic_speak.required_resources values must be in {sorted(ALLOWED_RESOURCES)}"
            )
        normalized_resources.append(item)

    inspection_focus = _require_non_empty_string(mechanic.get("inspection_focus"), "mechanic_speak.inspection_focus")
    miles_vs_delivery_status = _require_non_empty_string(
        dispatcher.get("miles_vs_delivery_status"), "dispatcher_speak.miles_vs_delivery_status"
    )
    post_breakdown_timeline_hours = _require_non_empty_string(
        dispatcher.get("post_breakdown_timeline_hours"), "dispatcher_speak.post_breakdown_timeline_hours"
    )
    estimated_roadside_cost_usd = _require_non_empty_string(
        manager.get("estimated_roadside_cost_usd"), "manager_speak.estimated_roadside_cost_usd"
    )
    root_cause_recurrence_intelligence = _require_non_empty_string(
        manager.get("root_cause_recurrence_intelligence"), "manager_speak.root_cause_recurrence_intelligence"
    )

    return {
        "driver_speak": {
            "severity": severity,
            "safe_miles_remaining": safe_miles_remaining,
            "safety_details": safety_details,
        },
        "mechanic_speak": {
            "required_resources": normalized_resources,
            "inspection_focus": inspection_focus,
        },
        "dispatcher_speak": {
            "miles_vs_delivery_status": miles_vs_delivery_status,
            "post_breakdown_timeline_hours": post_breakdown_timeline_hours,
        },
        "manager_speak": {
            "estimated_roadside_cost_usd": estimated_roadside_cost_usd,
            "root_cause_recurrence_intelligence": root_cause_recurrence_intelligence,
        },
    }


def transform_fault_record(
    input_payload: Dict[str, Any],
    *,
    openai_api_key: Optional[str] = None,
    model: str = "gpt-4o-mini",
    samsara_config: Optional[SamsaraConfig] = None,
) -> PersonaViews:
    """Transform one ground-truth fault record into four persona views."""

    validated = validate_fault_input(input_payload)
    enriched = enrich_with_truck_mileage(validated, samsara_config)

    key = openai_api_key or os.getenv("OPENAI_API_KEY")
    if not key:
        raise ValidationError("OPENAI_API_KEY is required")

    client = OpenAI(api_key=key)

    completion = client.chat.completions.create(
        model=model,
        temperature=0.1,
        response_format={"type": "json_object"},
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": build_user_message(enriched)},
        ],
    )

    raw_content = completion.choices[0].message.content or "{}"
    try:
        parsed = json.loads(raw_content)
    except json.JSONDecodeError as exc:
        raise ValidationError(f"Model returned invalid JSON: {exc}") from exc

    if not isinstance(parsed, dict):
        raise ValidationError("Model output must be a JSON object")

    return validate_persona_views(parsed)


def _example_payload() -> Dict[str, Any]:
    return {
        "spn": 110,
        "fmi": 0,
        "affected_system": "Cooling Circuit",
        "mechanic_repair_steps": (
            "1) Pull the truck out of service immediately and verify coolant level. "
            "2) Inspect fan clutch engagement and belt drive. "
            "3) Check radiator fins for blockage and verify thermostat opening. "
            "4) Pressure test for internal leaks and confirm the water pump is circulating coolant."
        ),
        "operational_danger": (
            "If ignored, the engine can rapidly enter derate, lose power on grade, and suffer "
            "head gasket or cylinder head damage."
        ),
        "truck_mileage": 1002450,
        "remaining_trip_distance_miles": None,
    }


def main() -> None:
    payload = _example_payload()

    output = transform_fault_record(payload)
    print(json.dumps(output, indent=2, ensure_ascii=True))


if __name__ == "__main__":
    main()
