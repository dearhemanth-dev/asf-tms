#!/usr/bin/env python3
"""Hydrate public.fault_knowledge_base with high-value J1939 SPN/FMI definitions.

This script is intentionally tenant-scoped, idempotent, and safe to re-run.
It uses OpenAI JSON output mode to generate one row at a time, validates the
payload, and upserts into Supabase with trust-aware overwrite rules.
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import sys
import time
import re
from pathlib import Path
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Dict, Iterable, List, Optional


LOG = logging.getLogger("fault_kb_seed")

ALLOWED_SOURCE_TYPES = {"OEM_MANUAL", "VERIFIED_FIX", "AI_GENERATED"}
ALLOWED_DISPATCH_ACTIONS = {
    "IMMEDIATE_ROAD_INTERCEPT",
    "DO_NOT_REFUEL",
    "RESTRICT_TO_LOCAL",
    "SCHEDULE_HOME_SHOP",
}

MANDATORY_ROW_KEYS = {
    "affected_system",
    "mechanic_speak",
    "mechanic_repair_steps",
    "operational_danger",
    "default_dispatch_action",
}

SYSTEM_PROMPT = (
    "You are a Senior Fleet Maintenance Director and Master Diesel Mechanic. "
    "Translate the provided J1939 SPN/FMI code into highly granular, production-ready, machine-readable operational instructions for an OTR trucking fleet tracking million-mile assets. "
    "Your output must be a clean JSON object mapping directly to these database keys: "
    "affected_system, mechanic_speak, mechanic_repair_steps, operational_danger, default_dispatch_action. "
    "default_dispatch_action must be one of: IMMEDIATE_ROAD_INTERCEPT, DO_NOT_REFUEL, RESTRICT_TO_LOCAL, SCHEDULE_HOME_SHOP."
)

FAULT_MATRIX: Dict[str, List[Dict[str, Any]]] = {
    "COOLING CIRCUIT": [
        {"spn": 111, "fmi": 1, "label": "Low Engine Coolant Level", "category_hint": "Cooling System - Coolant Level"},
        {"spn": 110, "fmi": 0, "label": "Engine Coolant Temperature High", "category_hint": "Cooling System - Overheat Event"},
        {"spn": 132, "fmi": 0, "label": "Engine Intake Air Temperature High", "category_hint": "Cooling / Intake Air Temperature"},
        {"spn": 110, "fmi": 2, "label": "Engine Coolant Temperature Signal Erratic", "category_hint": "Cooling System - Temperature Sensor Circuit"},
        {"spn": 110, "fmi": 3, "label": "Engine Coolant Temperature Sensor Voltage Above Normal", "category_hint": "Cooling System - Temperature Sensor Circuit"},
        {"spn": 110, "fmi": 4, "label": "Engine Coolant Temperature Sensor Voltage Below Normal", "category_hint": "Cooling System - Temperature Sensor Circuit"},
        {"spn": 110, "fmi": 5, "label": "Engine Coolant Temperature Sensor Open Circuit", "category_hint": "Cooling System - Temperature Sensor Circuit"},
        {"spn": 110, "fmi": 7, "label": "Engine Coolant Temperature Control Not Responding", "category_hint": "Cooling System - Temperature Control"},
        {"spn": 111, "fmi": 2, "label": "Engine Coolant Level Signal Erratic", "category_hint": "Cooling System - Coolant Level"},
        {"spn": 111, "fmi": 3, "label": "Coolant Level Sensor Voltage Above Normal", "category_hint": "Cooling System - Coolant Level Sensor"},
        {"spn": 111, "fmi": 4, "label": "Coolant Level Sensor Voltage Below Normal", "category_hint": "Cooling System - Coolant Level Sensor"},
        {"spn": 111, "fmi": 5, "label": "Coolant Level Sensor Open Circuit", "category_hint": "Cooling System - Coolant Level Sensor"},
        {"spn": 111, "fmi": 7, "label": "Coolant Level System Not Responding", "category_hint": "Cooling System - Coolant Level"},
        {"spn": 132, "fmi": 1, "label": "Engine Intake Air Temperature Below Normal", "category_hint": "Cooling / Intake Air Temperature"},
        {"spn": 132, "fmi": 2, "label": "Engine Intake Air Temperature Signal Erratic", "category_hint": "Cooling / Intake Air Temperature Sensor"},
        {"spn": 132, "fmi": 3, "label": "Intake Air Temperature Sensor Voltage Above Normal", "category_hint": "Cooling / Intake Air Temperature Sensor"},
        {"spn": 132, "fmi": 4, "label": "Intake Air Temperature Sensor Voltage Below Normal", "category_hint": "Cooling / Intake Air Temperature Sensor"},
        {"spn": 132, "fmi": 5, "label": "Intake Air Temperature Sensor Open Circuit", "category_hint": "Cooling / Intake Air Temperature Sensor"},
        {"spn": 132, "fmi": 7, "label": "Intake Air Temperature System Not Responding", "category_hint": "Cooling / Intake Air Temperature"},
    ],
    "AFTERTREATMENT & EMISSIONS": [
        {"spn": 3364, "fmi": 1, "label": "Improper DEF Quality Detected", "category_hint": "DEF Quality / Aftertreatment"},
        {"spn": 4364, "fmi": 18, "label": "SCR Catalyst Conversion Efficiency Low", "category_hint": "SCR Catalyst Efficiency"},
        {"spn": 3216, "fmi": 2, "label": "Inlet NOx Sensor Circuit Intermittent Malfunction", "category_hint": "NOx Sensor Inlet Circuit"},
        {"spn": 3226, "fmi": 12, "label": "Outlet NOx Sensor Component Bad/Defective", "category_hint": "NOx Sensor Outlet Circuit"},
        {"spn": 5394, "fmi": 7, "label": "DEF Dosing Valve Stuck Open/Closed", "category_hint": "DEF Dosing Valve Actuation"},
        {"spn": 3216, "fmi": 5, "label": "Aftertreatment Fuel Injector Open Circuit", "category_hint": "Aftertreatment Fuel Injector Circuit"},
        {"spn": 4334, "fmi": 18, "label": "Diesel Particulate Filter Efficiency Below Threshold", "category_hint": "DPF Restriction / Efficiency"},
        {"spn": 3364, "fmi": 2, "label": "DEF Quality Signal Erratic", "category_hint": "DEF Quality Sensor Circuit"},
        {"spn": 3364, "fmi": 5, "label": "DEF Quality Sensor Open Circuit", "category_hint": "DEF Quality Sensor Circuit"},
        {"spn": 3216, "fmi": 7, "label": "Inlet NOx Sensor Not Responding", "category_hint": "NOx Sensor Inlet Circuit"},
        {"spn": 3226, "fmi": 2, "label": "Outlet NOx Sensor Signal Erratic", "category_hint": "NOx Sensor Outlet Circuit"},
        {"spn": 3226, "fmi": 7, "label": "Outlet NOx Sensor Not Responding", "category_hint": "NOx Sensor Outlet Circuit"},
        {"spn": 3556, "fmi": 7, "label": "Regeneration Fuel Injector Not Responding", "category_hint": "DPF Regeneration Circuit"},
        {"spn": 4334, "fmi": 2, "label": "DPF Efficiency Signal Erratic", "category_hint": "DPF Restriction / Efficiency"},
        {"spn": 4364, "fmi": 7, "label": "SCR Catalyst System Not Responding Properly", "category_hint": "SCR Catalyst Efficiency"},
        {"spn": 5394, "fmi": 5, "label": "DEF Dosing Valve Open Circuit", "category_hint": "DEF Dosing Valve Actuation"},
        {"spn": 3364, "fmi": 0, "label": "DEF Quality Above Acceptable Range", "category_hint": "DEF Quality / Aftertreatment"},
        {"spn": 3364, "fmi": 3, "label": "DEF Quality Sensor Voltage Above Normal", "category_hint": "DEF Quality Sensor Circuit"},
        {"spn": 3364, "fmi": 4, "label": "DEF Quality Sensor Voltage Below Normal", "category_hint": "DEF Quality Sensor Circuit"},
        {"spn": 3364, "fmi": 7, "label": "DEF Quality Sensor Not Responding", "category_hint": "DEF Quality Sensor Circuit"},
        {"spn": 3364, "fmi": 12, "label": "DEF Quality Sensor Component Defective", "category_hint": "DEF Quality Sensor Circuit"},
        {"spn": 3364, "fmi": 18, "label": "DEF Quality Drift Detected Under Load", "category_hint": "DEF Quality / Aftertreatment"},
        {"spn": 3216, "fmi": 0, "label": "Inlet NOx Sensor Reading Above Normal", "category_hint": "NOx Sensor Inlet Circuit"},
        {"spn": 3216, "fmi": 1, "label": "Inlet NOx Sensor Reading Below Normal", "category_hint": "NOx Sensor Inlet Circuit"},
        {"spn": 3216, "fmi": 3, "label": "Inlet NOx Sensor Voltage Above Normal", "category_hint": "NOx Sensor Inlet Circuit"},
        {"spn": 3216, "fmi": 4, "label": "Inlet NOx Sensor Voltage Below Normal", "category_hint": "NOx Sensor Inlet Circuit"},
        {"spn": 3216, "fmi": 12, "label": "Inlet NOx Sensor Component Defective", "category_hint": "NOx Sensor Inlet Circuit"},
        {"spn": 3216, "fmi": 18, "label": "Inlet NOx Sensor Response Degraded", "category_hint": "NOx Sensor Inlet Circuit"},
        {"spn": 3226, "fmi": 0, "label": "Outlet NOx Sensor Reading Above Normal", "category_hint": "NOx Sensor Outlet Circuit"},
        {"spn": 3226, "fmi": 1, "label": "Outlet NOx Sensor Reading Below Normal", "category_hint": "NOx Sensor Outlet Circuit"},
        {"spn": 3226, "fmi": 3, "label": "Outlet NOx Sensor Voltage Above Normal", "category_hint": "NOx Sensor Outlet Circuit"},
        {"spn": 3226, "fmi": 4, "label": "Outlet NOx Sensor Voltage Below Normal", "category_hint": "NOx Sensor Outlet Circuit"},
        {"spn": 3226, "fmi": 5, "label": "Outlet NOx Sensor Open Circuit", "category_hint": "NOx Sensor Outlet Circuit"},
        {"spn": 3226, "fmi": 18, "label": "Outlet NOx Sensor Response Degraded", "category_hint": "NOx Sensor Outlet Circuit"},
        {"spn": 5394, "fmi": 0, "label": "DEF Dosing Valve Command Above Normal", "category_hint": "DEF Dosing Valve Actuation"},
        {"spn": 5394, "fmi": 1, "label": "DEF Dosing Valve Command Below Normal", "category_hint": "DEF Dosing Valve Actuation"},
        {"spn": 5394, "fmi": 2, "label": "DEF Dosing Valve Signal Erratic", "category_hint": "DEF Dosing Valve Actuation"},
        {"spn": 5394, "fmi": 3, "label": "DEF Dosing Valve Circuit Voltage Above Normal", "category_hint": "DEF Dosing Valve Actuation"},
        {"spn": 5394, "fmi": 4, "label": "DEF Dosing Valve Circuit Voltage Below Normal", "category_hint": "DEF Dosing Valve Actuation"},
        {"spn": 5394, "fmi": 12, "label": "DEF Dosing Valve Component Defective", "category_hint": "DEF Dosing Valve Actuation"},
        {"spn": 5394, "fmi": 18, "label": "DEF Dosing Valve Response Degraded", "category_hint": "DEF Dosing Valve Actuation"},
        {"spn": 4334, "fmi": 0, "label": "DPF Restriction Above Normal", "category_hint": "DPF Restriction / Efficiency"},
        {"spn": 4334, "fmi": 1, "label": "DPF Restriction Below Expected Level", "category_hint": "DPF Restriction / Efficiency"},
        {"spn": 4334, "fmi": 3, "label": "DPF Differential Signal Voltage Above Normal", "category_hint": "DPF Restriction / Efficiency"},
        {"spn": 4334, "fmi": 4, "label": "DPF Differential Signal Voltage Below Normal", "category_hint": "DPF Restriction / Efficiency"},
        {"spn": 4334, "fmi": 5, "label": "DPF Differential Sensor Open Circuit", "category_hint": "DPF Restriction / Efficiency"},
        {"spn": 4334, "fmi": 7, "label": "DPF System Not Responding To Regeneration", "category_hint": "DPF Restriction / Efficiency"},
        {"spn": 4364, "fmi": 0, "label": "SCR Efficiency Above Calibration Window", "category_hint": "SCR Catalyst Efficiency"},
        {"spn": 4364, "fmi": 1, "label": "SCR Efficiency Below Calibration Window", "category_hint": "SCR Catalyst Efficiency"},
        {"spn": 4364, "fmi": 2, "label": "SCR Efficiency Signal Erratic", "category_hint": "SCR Catalyst Efficiency"},
        {"spn": 4364, "fmi": 3, "label": "SCR Efficiency Circuit Voltage Above Normal", "category_hint": "SCR Catalyst Efficiency"},
    ],
    "AIR INTAKE, EGR & TURBO SYSTEMS": [
        {"spn": 411, "fmi": 2, "label": "EGR Differential Pressure Sensor Signal Invalid", "category_hint": "EGR Differential Pressure Sensing"},
        {"spn": 641, "fmi": 7, "label": "VGT Turbocharger Actuator Mechanical System Not Responding", "category_hint": "VGT Turbo Actuator"},
        {"spn": 3556, "fmi": 5, "label": "Regeneration Fuel Injector Open Circuit / DPF Clogged", "category_hint": "DPF Regeneration Circuit"},
        {"spn": 102, "fmi": 1, "label": "Boost Pressure Below Normal", "category_hint": "Turbocharger Boost Control"},
        {"spn": 91, "fmi": 2, "label": "Accelerator Pedal Position Signal Erratic", "category_hint": "Driver Demand Sensor"},
        {"spn": 84, "fmi": 2, "label": "Wheel Speed Sensor Signal Erratic", "category_hint": "Wheel Speed / Chassis Sensor"},
        {"spn": 102, "fmi": 0, "label": "Boost Pressure Above Normal", "category_hint": "Turbocharger Boost Control"},
        {"spn": 102, "fmi": 2, "label": "Boost Pressure Signal Erratic", "category_hint": "Turbocharger Boost Control"},
        {"spn": 102, "fmi": 3, "label": "Boost Pressure Sensor Circuit Voltage Above Normal", "category_hint": "Turbocharger Boost Control"},
        {"spn": 102, "fmi": 4, "label": "Boost Pressure Sensor Circuit Voltage Below Normal", "category_hint": "Turbocharger Boost Control"},
        {"spn": 102, "fmi": 5, "label": "Boost Pressure Sensor Open Circuit", "category_hint": "Turbocharger Boost Control"},
        {"spn": 102, "fmi": 7, "label": "Boost Pressure Control Not Responding", "category_hint": "Turbocharger Boost Control"},
        {"spn": 91, "fmi": 3, "label": "Accelerator Pedal Position Sensor Circuit Voltage Above Normal", "category_hint": "Driver Demand Sensor"},
        {"spn": 91, "fmi": 4, "label": "Accelerator Pedal Position Sensor Circuit Voltage Below Normal", "category_hint": "Driver Demand Sensor"},
        {"spn": 84, "fmi": 5, "label": "Wheel Speed Sensor Open Circuit", "category_hint": "Wheel Speed / Chassis Sensor"},
    ],
    "LUBRICATION & FUEL CIRCUITS": [
        {"spn": 100, "fmi": 1, "label": "Engine Oil Pressure Dangerously Low", "category_hint": "Engine Lubrication Pressure"},
        {"spn": 94, "fmi": 1, "label": "Fuel Delivery Pressure Low", "category_hint": "Fuel Supply Pressure"},
        {"spn": 97, "fmi": 1, "label": "Engine Oil Pressure Sensor Reading Low", "category_hint": "Engine Oil Pressure Sensor"},
        {"spn": 94, "fmi": 2, "label": "Fuel Delivery Pressure Signal Erratic", "category_hint": "Fuel Supply Pressure"},
        {"spn": 97, "fmi": 2, "label": "Engine Oil Pressure Signal Erratic", "category_hint": "Engine Oil Pressure Sensor"},
        {"spn": 100, "fmi": 0, "label": "Engine Oil Pressure Above Normal", "category_hint": "Engine Lubrication Pressure"},
    ],
    "ELECTRICAL & CRITICAL SENSORS": [
        {"spn": 168, "fmi": 17, "label": "Battery Potential / Voltage Below Normal", "category_hint": "Battery / Charging System"},
        {"spn": 108, "fmi": 2, "label": "Barometric Pressure Sensor Data Erratic", "category_hint": "Barometric Sensor Circuit"},
        {"spn": 110, "fmi": 1, "label": "Engine Coolant Temperature Below Normal", "category_hint": "Coolant Temperature Sensor"},
        {"spn": 168, "fmi": 3, "label": "Battery Potential Circuit Voltage Above Normal", "category_hint": "Battery / Charging System"},
        {"spn": 168, "fmi": 4, "label": "Battery Potential Circuit Voltage Below Normal", "category_hint": "Battery / Charging System"},
        {"spn": 108, "fmi": 0, "label": "Barometric Pressure Above Normal", "category_hint": "Barometric Sensor Circuit"},
        {"spn": 108, "fmi": 4, "label": "Barometric Pressure Sensor Circuit Voltage Below Normal", "category_hint": "Barometric Sensor Circuit"},
        {"spn": 190, "fmi": 0, "label": "Engine Speed Above Normal", "category_hint": "Engine Speed Sensor"},
        {"spn": 190, "fmi": 2, "label": "Engine Speed Signal Erratic", "category_hint": "Engine Speed Sensor"},
        {"spn": 190, "fmi": 5, "label": "Engine Speed Sensor Open Circuit", "category_hint": "Engine Speed Sensor"},
    ],
}

CURATED_BASELINE_ROWS: List[Dict[str, Any]] = [
    {
        "tenant_id": "__TENANT__",
        "spn": 111,
        "fmi": 1,
        "affected_system": "Cooling Circuit",
        "mechanic_speak": "Coolant level sensing is low, which usually means the engine is actually losing coolant or the level sender circuit is failing.",
        "mechanic_repair_steps": "1) Inspect surge tank and radiator cap condition. 2) Pressure test the cooling system cold. 3) Check hoses, clamps, water pump weep hole, and EGR cooler joints for seepage. 4) Verify sender circuit continuity and connector corrosion if fluid level is stable.",
        "operational_danger": "If ignored, the truck can overheat, warp the head, damage the EGR cooler, and force a highway shutdown within a short distance under load.",
        "default_dispatch_action": "IMMEDIATE_ROAD_INTERCEPT",
        "source_type": "OEM_MANUAL",
    },
    {
        "tenant_id": "__TENANT__",
        "spn": 110,
        "fmi": 0,
        "affected_system": "Cooling Circuit",
        "mechanic_speak": "Engine coolant temperature is above normal operating range, indicating an active overheat condition in the cooling system.",
        "mechanic_repair_steps": "1) Pull the truck out of service immediately and verify coolant level. 2) Inspect fan clutch engagement and belt drive. 3) Check radiator fins for blockage and verify thermostat opening. 4) Pressure test for internal leaks and confirm the water pump is circulating coolant.",
        "operational_danger": "If ignored, the engine can rapidly enter derate, lose power on grade, and suffer head gasket or cylinder head damage.",
        "default_dispatch_action": "IMMEDIATE_ROAD_INTERCEPT",
        "source_type": "OEM_MANUAL",
    },
    {
        "tenant_id": "__TENANT__",
        "spn": 100,
        "fmi": 1,
        "affected_system": "Lubrication & Fuel Circuits",
        "mechanic_speak": "Engine oil pressure is below safe operating range, which means the engine may already be starving bearings and valvetrain components of lubrication.",
        "mechanic_repair_steps": "1) Verify oil level and oil dilution first. 2) Compare mechanical gauge pressure to the ECM reading. 3) Inspect the pickup tube, oil pump, and filter bypass. 4) Check for bearing noise and metal in the oil before returning the vehicle to service.",
        "operational_danger": "If ignored, the truck can suffer catastrophic bearing failure or seizure with very little warning under highway load.",
        "default_dispatch_action": "IMMEDIATE_ROAD_INTERCEPT",
        "source_type": "OEM_MANUAL",
    },
    {
        "tenant_id": "__TENANT__",
        "spn": 94,
        "fmi": 1,
        "affected_system": "Lubrication & Fuel Circuits",
        "mechanic_speak": "Fuel delivery pressure is low, which can cause misfire-like power loss, hard starts, or a no-start condition under demand.",
        "mechanic_repair_steps": "1) Check tank fuel level and supply restriction first. 2) Inspect fuel filters, water separator, and lines for collapse or air intrusion. 3) Verify lift pump and rail supply pressure under load. 4) Confirm fuel quality and eliminate contamination before road release.",
        "operational_danger": "If ignored, the truck can stall under load, lose climb capability, and leave the driver stranded in a non-recoverable roadside failure.",
        "default_dispatch_action": "RESTRICT_TO_LOCAL",
        "source_type": "OEM_MANUAL",
    },
]


@dataclass(frozen=True)
class FaultKey:
    spn: int
    fmi: int
    category_hint: str
    label: str


def now_utc_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def env_required(name: str) -> str:
    value = os.getenv(name)
    if not value:
        raise RuntimeError(f"Missing required environment variable: {name}")
    return value


def env_optional(name: str, default: str) -> str:
    value = os.getenv(name)
    return value if value else default


def parse_int_arg(value: str, field_name: str) -> int:
    try:
        return int(value)
    except ValueError as exc:
        raise argparse.ArgumentTypeError(f"{field_name} must be an integer") from exc


def normalize_whitespace(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip()


def sentence_count(value: str) -> int:
    return len([part for part in re.split(r"[.!?]+", value) if part.strip()])


def http_json(method: str, url: str, headers: Dict[str, str], payload: Optional[dict] = None) -> Any:
    body = None if payload is None else json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(url, data=body, headers=headers, method=method)
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            raw = response.read().decode("utf-8")
            return json.loads(raw) if raw else None
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode("utf-8")
        try:
            details = json.loads(raw)
        except Exception:
            details = raw
        raise RuntimeError(f"HTTP {exc.code} calling {url}: {details}") from exc


def rest_get_existing_source_type(base_url: str, api_key: str, tenant_id: str, spn: int, fmi: int) -> Optional[str]:
    query = urllib.parse.urlencode(
        {
            "select": "source_type,last_updated_at",
            "tenant_id": f"eq.{tenant_id}",
            "spn": f"eq.{spn}",
            "fmi": f"eq.{fmi}",
            "limit": "1",
        }
    )
    url = f"{base_url.rstrip('/')}/rest/v1/fault_knowledge_base?{query}"
    headers = {
        "apikey": api_key,
        "Authorization": f"Bearer {api_key}",
        "Accept": "application/json",
    }
    rows = http_json("GET", url, headers) or []
    if not rows:
        return None
    return rows[0].get("source_type")


def rest_upsert_fault(base_url: str, api_key: str, row: Dict[str, Any]) -> Dict[str, Any]:
    url = f"{base_url.rstrip('/')}/rest/v1/fault_knowledge_base?on_conflict=tenant_id,spn,fmi"
    headers = {
        "apikey": api_key,
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates,return=representation",
    }
    result = http_json("POST", url, headers, row)
    if not isinstance(result, list) or not result:
        raise RuntimeError(f"Unexpected upsert response for SPN {row['spn']} FMI {row['fmi']}: {result}")
    return result[0]


def export_seed_manifest(path: str) -> None:
    output_path = Path(path)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    manifest = {
        "generated_at": now_utc_iso(),
        "matrix": FAULT_MATRIX,
        "curated_baseline_rows": CURATED_BASELINE_ROWS,
    }
    output_path.write_text(json.dumps(manifest, indent=2, sort_keys=True), encoding="utf-8")
    LOG.info("[%s] exported seed manifest to %s", now_utc_iso(), output_path)


def build_prompt(spn: int, fmi: int, category_hint: str, label: str) -> List[Dict[str, str]]:
    user_prompt = (
        f"Generate the fault knowledge record for SPN {spn} FMI {fmi}. "
        f"Category hint: {category_hint}. Fault label hint: {label}. "
        "Return JSON only with keys: affected_system, mechanic_speak, mechanic_repair_steps, operational_danger, default_dispatch_action."
    )
    return [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": user_prompt},
    ]


def local_fault_definition(spn: int, fmi: int, category_hint: str, label: str) -> Dict[str, str]:
    """Deterministic offline fallback used when OpenAI credentials are unavailable.

    This keeps the knowledge base bootstrappable in locked-down environments while
    preserving the same output contract as the model-based generator.
    """

    if spn == 111 and fmi == 1:
        return {
            "affected_system": "Cooling Circuit",
            "mechanic_speak": "Coolant level is below the sender threshold, which usually means the cooling system is actually losing fluid or the level circuit is lying.",
            "mechanic_repair_steps": "1) Inspect the surge tank and radiator cap. 2) Pressure test the complete cooling system cold. 3) Check hoses, heater lines, clamps, water pump weep hole, and EGR cooler joints for wetness. 4) If the level is stable, verify sender continuity and connector corrosion.",
            "operational_danger": "If ignored, the engine can overheat under load, pull power on grade, and suffer head gasket or turbocharger damage before the next service window.",
            "default_dispatch_action": "IMMEDIATE_ROAD_INTERCEPT",
        }
    if spn == 110 and fmi == 0:
        return {
            "affected_system": "Cooling Circuit",
            "mechanic_speak": "Coolant temperature is above the safe operating window and the engine is already in an active overheat condition.",
            "mechanic_repair_steps": "1) Stop the truck from loading the engine further. 2) Verify coolant level and look for external leakage. 3) Check fan clutch operation, belt drive, radiator airflow, and thermostat opening. 4) Confirm water pump circulation and pressure test the system before release.",
            "operational_danger": "If ignored, the truck can derate quickly, lose climb capability, and escalate into severe cylinder head or gasket failure.",
            "default_dispatch_action": "IMMEDIATE_ROAD_INTERCEPT",
        }
    if spn == 3364 and fmi == 1:
        return {
            "affected_system": "Aftertreatment & Emissions",
            "mechanic_speak": "DEF quality is being rejected by the aftertreatment controller, usually because the fluid is contaminated, diluted, or the sensor package is not believable.",
            "mechanic_repair_steps": "1) Verify DEF is ISO 22241 compliant and not frozen-contaminated or diesel-contaminated. 2) Check DEF tank, cap, and fill history. 3) Inspect quality sensor harness and connector. 4) Confirm the dosing module and tank heater are operating before road release.",
            "operational_danger": "If ignored, the aftertreatment system can initiate escalating derate and a no-restart countdown after repeated ignition cycles.",
            "default_dispatch_action": "DO_NOT_REFUEL",
        }
    if spn == 4364 and fmi == 18:
        return {
            "affected_system": "Aftertreatment & Emissions",
            "mechanic_speak": "SCR conversion efficiency is below threshold, meaning the catalyst is not reducing NOx the way the ECM expects under real load.",
            "mechanic_repair_steps": "1) Check upstream and downstream NOx readings for plausibility. 2) Inspect DEF dosing quality, injector spray pattern, and crystallization in the mixer. 3) Test SCR temp sensors and exhaust leaks. 4) Verify catalyst face condition and complete a forced regen test if the system allows it.",
            "operational_danger": "If ignored, the truck will typically enter stronger derate steps and may lock out restart after the emissions monitor exhausts its countdown logic.",
            "default_dispatch_action": "RESTRICT_TO_LOCAL",
        }
    if spn == 3216 and fmi == 2:
        return {
            "affected_system": "Aftertreatment & Emissions",
            "mechanic_speak": "The inlet NOx sensor circuit is intermittent, so the engine is losing a stable upstream emissions reference and the aftertreatment model becomes unreliable.",
            "mechanic_repair_steps": "1) Wiggle-test the inlet sensor harness and connector. 2) Inspect for soot ingress, pin spread, and heat damage. 3) Verify sensor heater and power supply integrity. 4) Replace the sensor if signal dropout persists under vibration.",
            "operational_danger": "If ignored, the ECM can miscalculate NOx control and drive repeated derate events or a forced service-stop strategy.",
            "default_dispatch_action": "RESTRICT_TO_LOCAL",
        }
    if spn == 3226 and fmi == 12:
        return {
            "affected_system": "Aftertreatment & Emissions",
            "mechanic_speak": "The outlet NOx sensor is reporting a defective component state, which means SCR feedback on tailpipe emissions is no longer trustworthy.",
            "mechanic_repair_steps": "1) Inspect the sensor tip for contamination or exhaust leaks upstream. 2) Check heater resistance and power supply. 3) Review harness routing for chafe and connector corrosion. 4) Replace the sensor and confirm the new tailpipe reading after warm-up.",
            "operational_danger": "If ignored, the ECM can assume the SCR system is failing and progressively limit speed and torque until repair is completed.",
            "default_dispatch_action": "RESTRICT_TO_LOCAL",
        }
    if spn == 5394 and fmi == 7:
        return {
            "affected_system": "Aftertreatment & Emissions",
            "mechanic_speak": "The DEF dosing valve is mechanically stuck, so the system cannot reliably meter reductant into the exhaust stream.",
            "mechanic_repair_steps": "1) Inspect for crystallized DEF at the nozzle and lines. 2) Command the valve and verify actuation. 3) Check air supply, pump pressure, and return flow. 4) Replace the dosing module if the valve hangs or leaks during command tests.",
            "operational_danger": "If ignored, NOx reduction will collapse and the truck can move into escalating emissions derate and eventual road-service restriction.",
            "default_dispatch_action": "RESTRICT_TO_LOCAL",
        }
    if spn == 411 and fmi == 2:
        return {
            "affected_system": "Air Intake, EGR & Turbo Systems",
            "mechanic_speak": "The EGR differential pressure signal is invalid, so the engine cannot correctly measure exhaust recirculation flow.",
            "mechanic_repair_steps": "1) Inspect the pressure tubes for soot blockage or cracks. 2) Verify sensor 5V reference and ground. 3) Check for connector moisture or pin damage. 4) Replace the sensor after confirming the passages are clean and free-flowing.",
            "operational_danger": "If ignored, the ECM can mismanage EGR, creating rough running, soot loading, and a power-limiting fault progression.",
            "default_dispatch_action": "RESTRICT_TO_LOCAL",
        }
    if spn == 641 and fmi == 7:
        return {
            "affected_system": "Air Intake, EGR & Turbo Systems",
            "mechanic_speak": "The VGT actuator is not responding mechanically, so turbo vane control is stuck or physically binding.",
            "mechanic_repair_steps": "1) Inspect the actuator linkage for soot binding and heat damage. 2) Confirm commanded movement on a diagnostic tool. 3) Check power, ground, and harness continuity. 4) Replace or recalibrate the actuator if the vane assembly will not sweep cleanly.",
            "operational_danger": "If ignored, boost control can fail under load, leading to slow acceleration, overfueling, and a forced derate.",
            "default_dispatch_action": "SCHEDULE_HOME_SHOP",
        }
    if spn == 3556 and fmi == 5:
        return {
            "affected_system": "Air Intake, EGR & Turbo Systems",
            "mechanic_speak": "The regeneration fuel injector circuit is open or the DPF is too restricted to support normal regen flow.",
            "mechanic_repair_steps": "1) Inspect injector resistance and harness continuity. 2) Check for soot loading and exhaust backpressure. 3) Verify fuel delivery to the regen injector. 4) Service the DPF if backpressure remains high after circuit repair.",
            "operational_danger": "If ignored, passive regen will fail, soot loading will climb, and the engine can enter a severe derate or no-service-restart state.",
            "default_dispatch_action": "SCHEDULE_HOME_SHOP",
        }
    if spn == 168 and fmi == 17:
        return {
            "affected_system": "Electrical & Critical Sensors",
            "mechanic_speak": "Battery potential is below normal operating range, which means the charging system or batteries are no longer supporting stable ECM voltage.",
            "mechanic_repair_steps": "1) Load-test both batteries. 2) Check alternator output and belt drive. 3) Inspect grounds, terminals, and main power feeds for voltage drop. 4) Replace weak batteries or charging hardware before the truck returns to road duty.",
            "operational_danger": "If ignored, the truck can experience module resets, sensor dropouts, cranking failure, or a sudden no-start at the next stop.",
            "default_dispatch_action": "RESTRICT_TO_LOCAL",
        }
    if spn == 108 and fmi == 2:
        return {
            "affected_system": "Electrical & Critical Sensors",
            "mechanic_speak": "The barometric pressure signal is erratic, so the ECM cannot reliably calculate air density and fueling corrections.",
            "mechanic_repair_steps": "1) Inspect the sensor connector and harness for intermittent opens. 2) Compare live baro data to known local pressure. 3) Verify 5V reference and ground stability. 4) Replace the sensor if the reading jumps under vibration or heat soak.",
            "operational_danger": "If ignored, the engine may misfuel, lose power, and show unstable boost and emissions behavior that compounds other faults.",
            "default_dispatch_action": "SCHEDULE_HOME_SHOP",
        }
    if spn == 132 and fmi == 0:
        return {
            "affected_system": "Cooling Circuit",
            "mechanic_speak": "Intake air temperature is above the normal operating range, which usually points to restricted airflow, heat soak, or a sensor reading that no longer tracks reality.",
            "mechanic_repair_steps": "1) Inspect the charge-air cooler, air filter, and intake plumbing for blockage or collapse. 2) Verify the temperature sensor wiring and connector are secure. 3) Check for excessive underhood heat, boost leaks, or post-turbo restrictions. 4) Replace the sensor only after airflow and wiring checks pass.",
            "operational_danger": "If ignored, the engine can pull timing, lose efficiency, and build excess exhaust heat that accelerates derate behavior under load.",
            "default_dispatch_action": "RESTRICT_TO_LOCAL",
        }
    if spn == 102 and fmi == 1:
        return {
            "affected_system": "Air Intake, EGR & Turbo Systems",
            "mechanic_speak": "Boost pressure is below expected range, so the engine is not getting the air it needs for normal torque production.",
            "mechanic_repair_steps": "1) Pressure-test the charge-air system for leaks. 2) Inspect intercooler boots, clamps, CAC tanks, and turbo outlet plumbing. 3) Verify the wastegate or VGT actuator is moving correctly. 4) Confirm the MAP sensor is reading consistently before returning the truck to service.",
            "operational_danger": "If ignored, the truck can feel weak on grades, overfuel, and trigger a derate when the ECM cannot match airflow to demand.",
            "default_dispatch_action": "RESTRICT_TO_LOCAL",
        }
    if spn == 91 and fmi == 2:
        return {
            "affected_system": "Air Intake, EGR & Turbo Systems",
            "mechanic_speak": "Accelerator pedal position is erratic, so the ECM cannot trust the driver demand signal and may jump between torque requests.",
            "mechanic_repair_steps": "1) Inspect the pedal assembly connector and harness for loose pins. 2) Compare both pedal tracks on a diagnostic scan tool. 3) Wiggle-test for intermittent opens, shorts, or contamination. 4) Replace the pedal assembly if the signal still drops or spikes under movement.",
            "operational_danger": "If ignored, the vehicle can surge, limit throttle response, or enter a reduced-power mode that makes safe merging and climbing unreliable.",
            "default_dispatch_action": "SCHEDULE_HOME_SHOP",
        }
    if spn == 84 and fmi == 2:
        return {
            "affected_system": "Air Intake, EGR & Turbo Systems",
            "mechanic_speak": "Wheel speed sensor data is erratic, which makes chassis stability, cruise control, and drivetrain logic less reliable.",
            "mechanic_repair_steps": "1) Inspect the sensor face and tone ring for debris or damage. 2) Check harness routing at the axle and hub for chafe. 3) Verify air gap and connector condition. 4) Replace the sensor if the signal still drops under road vibration.",
            "operational_danger": "If ignored, the truck can lose ABS or traction inputs and create a safety problem during braking or wet-road operation.",
            "default_dispatch_action": "SCHEDULE_HOME_SHOP",
        }
    if spn == 97 and fmi == 1:
        return {
            "affected_system": "Lubrication & Fuel Circuits",
            "mechanic_speak": "Engine oil pressure is reading below normal, which can indicate true low pressure or a failing pressure sensor circuit.",
            "mechanic_repair_steps": "1) Verify oil level and mechanical pressure with a gauge. 2) Inspect the sender wiring and connector. 3) Check for diluted oil, clogged pickup, or pump wear. 4) Resolve any actual pressure loss before replacing the sender alone.",
            "operational_danger": "If ignored, the engine can quickly suffer bearing damage, lifter noise, or seizure under sustained load.",
            "default_dispatch_action": "IMMEDIATE_ROAD_INTERCEPT",
        }
    if spn == 110 and fmi == 1:
        return {
            "affected_system": "Cooling Circuit",
            "mechanic_speak": "Coolant temperature is below the expected operating window, which can point to a stuck-open thermostat or a sensor bias issue.",
            "mechanic_repair_steps": "1) Confirm the engine really is running cool with live data and a mechanical check. 2) Inspect thermostat operation. 3) Verify coolant temperature sensor resistance against specification. 4) Check for fan override or abnormal cold-air flow across the radiator.",
            "operational_danger": "If ignored, the engine can run inefficiently, build soot, and keep the aftertreatment system from reaching proper temperature.",
            "default_dispatch_action": "RESTRICT_TO_LOCAL",
        }
    if spn == 3216 and fmi == 5:
        return {
            "affected_system": "Aftertreatment & Emissions",
            "mechanic_speak": "The aftertreatment fuel injector circuit is open, so the regen system cannot meter fuel into the exhaust stream when commanded.",
            "mechanic_repair_steps": "1) Check injector resistance and harness continuity. 2) Inspect the connector for heat damage or corrosion. 3) Verify commanded regen output from the ECM. 4) Replace the injector or harness segment if the circuit remains open.",
            "operational_danger": "If ignored, soot loading can rise until the truck cannot complete a clean regeneration cycle and must be serviced off route.",
            "default_dispatch_action": "SCHEDULE_HOME_SHOP",
        }
    if spn == 4334 and fmi == 18:
        return {
            "affected_system": "Aftertreatment & Emissions",
            "mechanic_speak": "The diesel particulate filter is not cleaning up exhaust efficiently, which usually means restriction, ash loading, or a failed regeneration strategy.",
            "mechanic_repair_steps": "1) Check soot and ash load values. 2) Inspect differential pressure sensors and tubing for blockage. 3) Confirm recent regen attempts and exhaust temperature behavior. 4) Clean or replace the DPF if backpressure remains out of spec.",
            "operational_danger": "If ignored, the truck can derate progressively, lose fuel economy, and eventually refuse to complete a parked or forced regeneration.",
            "default_dispatch_action": "SCHEDULE_HOME_SHOP",
        }

    # Generic but disciplined fallback for any other matrix item.
    return {
        "affected_system": category_hint,
        "mechanic_speak": f"{label} indicates a component-level fault that is interfering with normal engine control or emissions management.",
        "mechanic_repair_steps": (
            "1) Confirm the exact SPN/FMI on the diagnostic tool. 2) Inspect the sensor, actuator, or harness associated with the fault. "
            "3) Verify power, ground, continuity, and connector condition. 4) Check for soot, fluid contamination, heat damage, or mechanical binding. "
            "5) Repair the failed part, clear codes, and re-test under load before road release."
        ),
        "operational_danger": (
            "If ignored, the fault can escalate into progressive derate, reduced torque, or a roadside no-start condition within the next 100-300 miles depending on duty cycle."
        ),
        "default_dispatch_action": "RESTRICT_TO_LOCAL",
    }


def validate_ai_payload(payload: Dict[str, Any]) -> Dict[str, str]:
    missing = [key for key in MANDATORY_ROW_KEYS if key not in payload]
    if missing:
        raise ValueError(f"Missing required AI keys: {', '.join(missing)}")

    cleaned = {key: normalize_whitespace(str(payload[key])) for key in MANDATORY_ROW_KEYS}
    if not cleaned["affected_system"]:
        raise ValueError("affected_system cannot be empty")
    if not cleaned["mechanic_speak"]:
        raise ValueError("mechanic_speak cannot be empty")
    if sentence_count(cleaned["mechanic_speak"]) != 1:
        raise ValueError("mechanic_speak must be exactly one sentence")
    if not cleaned["mechanic_repair_steps"]:
        raise ValueError("mechanic_repair_steps cannot be empty")
    if len(cleaned["mechanic_repair_steps"]) < 120:
        raise ValueError("mechanic_repair_steps is too short to be operationally useful")
    if not cleaned["operational_danger"]:
        raise ValueError("operational_danger cannot be empty")
    if len(cleaned["operational_danger"]) < 80:
        raise ValueError("operational_danger is too short to be operationally useful")

    action = cleaned["default_dispatch_action"]
    if action not in ALLOWED_DISPATCH_ACTIONS:
        raise ValueError(f"default_dispatch_action must be one of {sorted(ALLOWED_DISPATCH_ACTIONS)}")

    return cleaned


def generate_ai_definition(
    client: Any,
    spn: int,
    fmi: int,
    category_hint: str,
    label: str,
    model: str,
    max_retries: int,
) -> Dict[str, str]:
    last_error: Optional[Exception] = None
    for attempt in range(1, max_retries + 1):
        try:
            completion = client.chat.completions.create(
                model=model,
                temperature=0.2,
                response_format={"type": "json_object"},
                messages=build_prompt(spn, fmi, category_hint, label),
            )
            content = completion.choices[0].message.content or "{}"
            try:
                parsed = json.loads(content)
            except json.JSONDecodeError as exc:
                raise ValueError(f"Malformed JSON from model: {exc}") from exc
            if not isinstance(parsed, dict):
                raise ValueError("Model response must be a JSON object")
            return validate_ai_payload(parsed)
        except Exception as exc:  # noqa: BLE001
            last_error = exc
            wait_seconds = min(2 ** attempt, 30)
            LOG.warning(
                "[%s] generation failed for SPN %s FMI %s attempt %s/%s: %s",
                now_utc_iso(),
                spn,
                fmi,
                attempt,
                max_retries,
                exc,
            )
            if attempt < max_retries:
                time.sleep(wait_seconds)

    raise RuntimeError(f"Generation failed after {max_retries} attempts for SPN {spn} FMI {fmi}") from last_error


def generate_fault_definition(
    spn: int,
    fmi: int,
    category_hint: str,
    label: str,
    use_openai: bool,
    model: str,
    max_retries: int,
) -> Dict[str, str]:
    if use_openai:
        from openai import OpenAI

        client = OpenAI(api_key=env_required("OPENAI_API_KEY"))
        return generate_ai_definition(client, spn, fmi, category_hint, label, model, max_retries)
    return validate_ai_payload(local_fault_definition(spn, fmi, category_hint, label))


def should_overwrite(existing_source_type: Optional[str]) -> bool:
    if existing_source_type is None:
        return True
    return existing_source_type == "AI_GENERATED"


def generate_and_store_fault_definition(
    spn: int,
    fmi: int,
    category_hint: str = "Unknown Subsystem",
    dry_run: bool = False,
) -> Dict[str, Any]:
    """Generate a single fault definition and upsert it into Supabase.

    The function intentionally uses module-level environment configuration so it
    can be imported by cron jobs without forcing a larger application dependency.
    """

    base_url = env_required("NEXT_PUBLIC_SUPABASE_URL")
    api_key = env_required("SUPABASE_SERVICE_ROLE_KEY")
    tenant_id = env_required("FAULT_KB_TENANT_ID")
    model = env_optional("OPENAI_MODEL", "gpt-4o")
    max_retries = int(env_optional("OPENAI_MAX_RETRIES", "3"))
    use_openai = env_optional("FAULT_KB_USE_OPENAI", "false").lower() in {"1", "true", "yes"}

    # Resolve existing trust level first so verified/manual content is never overwritten.
    current_source_type = rest_get_existing_source_type(base_url, api_key, tenant_id, spn, fmi)
    if not should_overwrite(current_source_type):
        LOG.info(
            "[%s] skipping SPN %s FMI %s because existing row source_type=%s has higher trust",
            now_utc_iso(),
            spn,
            fmi,
            current_source_type,
        )
        return {"spn": spn, "fmi": fmi, "skipped": True, "reason": f"existing source_type={current_source_type}"}

    payload = generate_fault_definition(spn, fmi, category_hint, f"SPN {spn} FMI {fmi}", use_openai, model, max_retries)

    row = {
        "tenant_id": tenant_id,
        "spn": spn,
        "fmi": fmi,
        "affected_system": payload["affected_system"],
        "mechanic_speak": payload["mechanic_speak"],
        "mechanic_repair_steps": payload["mechanic_repair_steps"],
        "operational_danger": payload["operational_danger"],
        "default_dispatch_action": payload["default_dispatch_action"],
        "source_type": "AI_GENERATED",
    }

    if dry_run:
        return {"spn": spn, "fmi": fmi, "dry_run": True, "row": row}

    stored = rest_upsert_fault(base_url, api_key, row)
    return {"spn": spn, "fmi": fmi, "stored": stored}


def upsert_curated_baseline_rows(dry_run: bool = False) -> None:
    base_url = env_required("NEXT_PUBLIC_SUPABASE_URL")
    api_key = env_required("SUPABASE_SERVICE_ROLE_KEY")
    tenant_id = env_required("FAULT_KB_TENANT_ID")

    for row in CURATED_BASELINE_ROWS:
        curated_row = dict(row)
        curated_row["tenant_id"] = tenant_id
        if dry_run:
            LOG.info("[%s] dry-run curated row %s", now_utc_iso(), curated_row)
            continue
        rest_upsert_fault(base_url, api_key, curated_row)


def iter_seed_keys() -> Iterable[FaultKey]:
    for category, items in FAULT_MATRIX.items():
        for item in items:
            yield FaultKey(
                spn=int(item["spn"]),
                fmi=int(item["fmi"]),
                category_hint=str(item["category_hint"]),
                label=f"{category} - {item['label']}",
            )


def seed_all() -> None:
    base_url = env_required("NEXT_PUBLIC_SUPABASE_URL")
    api_key = env_required("SUPABASE_SERVICE_ROLE_KEY")
    tenant_id = env_required("FAULT_KB_TENANT_ID")
    model = env_optional("OPENAI_MODEL", "gpt-4o")
    max_retries = int(env_optional("OPENAI_MAX_RETRIES", "3"))
    use_openai = env_optional("FAULT_KB_USE_OPENAI", "false").lower() in {"1", "true", "yes"}

    counters = {"attempted": 0, "inserted": 0, "skipped": 0, "failed": 0}
    for fault_key in iter_seed_keys():
        counters["attempted"] += 1
        LOG.info(
            "[%s] seeding SPN %s FMI %s (%s)",
            now_utc_iso(),
            fault_key.spn,
            fault_key.fmi,
            fault_key.label,
        )
        try:
            existing_source_type = rest_get_existing_source_type(base_url, api_key, tenant_id, fault_key.spn, fault_key.fmi)
            if not should_overwrite(existing_source_type):
                counters["skipped"] += 1
                LOG.info(
                    "[%s] skipped SPN %s FMI %s due to higher trust existing source_type=%s",
                    now_utc_iso(),
                    fault_key.spn,
                    fault_key.fmi,
                    existing_source_type,
                )
                continue

            payload = generate_fault_definition(
                fault_key.spn,
                fault_key.fmi,
                fault_key.category_hint,
                fault_key.label,
                use_openai,
                model,
                max_retries,
            )
            row = {
                "tenant_id": tenant_id,
                "spn": fault_key.spn,
                "fmi": fault_key.fmi,
                "affected_system": payload["affected_system"],
                "mechanic_speak": payload["mechanic_speak"],
                "mechanic_repair_steps": payload["mechanic_repair_steps"],
                "operational_danger": payload["operational_danger"],
                "default_dispatch_action": payload["default_dispatch_action"],
                "source_type": "AI_GENERATED",
            }

            if not set(row).issuperset({"tenant_id", "spn", "fmi", *MANDATORY_ROW_KEYS, "source_type"}):
                raise RuntimeError(f"Row shape is incomplete for SPN {fault_key.spn} FMI {fault_key.fmi}")
            stored = rest_upsert_fault(base_url, api_key, row)
            counters["inserted"] += 1
            LOG.info(
                "[%s] stored id=%s SPN %s FMI %s action=%s",
                now_utc_iso(),
                stored.get("id"),
                fault_key.spn,
                fault_key.fmi,
                stored.get("default_dispatch_action"),
            )
        except Exception as exc:  # noqa: BLE001
            counters["failed"] += 1
            LOG.exception(
                "[%s] failed SPN %s FMI %s: %s",
                now_utc_iso(),
                fault_key.spn,
                fault_key.fmi,
                exc,
            )

    LOG.info("[%s] seed summary %s", now_utc_iso(), counters)


def build_arg_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Seed the fault knowledge base with AI-generated OTR fault definitions.")
    parser.add_argument("--spn", type=lambda value: parse_int_arg(value, "spn"), help="Seed one arbitrary SPN")
    parser.add_argument("--fmi", type=lambda value: parse_int_arg(value, "fmi"), help="Seed one arbitrary FMI")
    parser.add_argument("--category-hint", default="Unknown Subsystem", help="Category hint for one-off generation")
    parser.add_argument("--single", action="store_true", help="Generate one row only using --spn and --fmi")
    parser.add_argument("--dry-run", action="store_true", help="Generate and validate rows without writing to Supabase")
    parser.add_argument("--export-manifest", help="Write the current seed matrix and curated baseline rows to a JSON file")
    parser.add_argument("--curated-only", action="store_true", help="Upsert only the curated baseline rows and skip model generation")
    parser.add_argument("--local-only", action="store_true", help="Force deterministic local generation for all matrix rows")
    return parser


def configure_logging() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
        datefmt="%Y-%m-%dT%H:%M:%S%z",
    )


def main() -> int:
    configure_logging()
    parser = build_arg_parser()
    args = parser.parse_args()

    if args.single:
        if args.spn is None or args.fmi is None:
            parser.error("--single requires both --spn and --fmi")
        result = generate_and_store_fault_definition(args.spn, args.fmi, args.category_hint, dry_run=args.dry_run)
        LOG.info("[%s] single-row result: %s", now_utc_iso(), result)
        return 0

    if args.export_manifest:
        export_seed_manifest(args.export_manifest)
        return 0

    if args.curated_only:
        upsert_curated_baseline_rows(dry_run=args.dry_run)
        return 0

    if args.local_only:
        os.environ["FAULT_KB_USE_OPENAI"] = "false"

    seed_all()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())