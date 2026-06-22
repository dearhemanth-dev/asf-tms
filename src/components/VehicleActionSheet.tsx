"use client";

import { useState } from "react";
import type { AppRole } from "@/lib/auth";

export type Vehicle = {
  id: string;
  truckNo: string;
  driver: string;
  assetLabel?: string;
  assetType?: string;
  location: string;
  status: "moving" | "idle" | "alert";
  atHome?: boolean;
  homeDistanceMiles?: number;
  mph?: number;
  fuelLevel?: number;
  eta?: string;
  latitude?: number;
  longitude?: number;
};

type VehicleActionSheetProps = {
  role: AppRole;
  vehicle: Vehicle | null;
  onClose: () => void;
};

const ACTIONS_BY_ROLE: Record<AppRole, Array<string>> = {
  management: ["Contact Driver", "Reassign Route", "Open Incident"],
  accounts: ["View Cost Ledger", "Attach Invoice", "Hold Payment"],
  maintenance: ["View Faults", "Open Work Order", "Check MPG"],
  dispatch: ["Contact Driver", "Send Updated ETA", "Set Priority"],
  driver: ["Acknowledge Job", "Mark Delay", "Request Assistance"],
};

export default function VehicleActionSheet({ role, vehicle, onClose }: VehicleActionSheetProps) {
  const [selectedAction, setSelectedAction] = useState<string | null>(null);

  if (!vehicle) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/45" onClick={onClose}>
      <div
        onClick={(event) => event.stopPropagation()}
        className="absolute bottom-0 left-0 right-0 mx-auto w-full max-w-3xl rounded-t-3xl border border-slate-700 bg-slate-950 p-5"
      >
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h2 className="text-lg font-bold text-white">{vehicle.truckNo}</h2>
            <p className="text-sm text-slate-400">{vehicle.driver}</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white">
            X
          </button>
        </div>

        <div className="grid grid-cols-2 gap-2 text-sm">
          <div className="rounded-lg bg-slate-900 p-3 border border-slate-800">
            <p className="text-slate-400">Location</p>
            <p className="font-medium text-white">{vehicle.location}</p>
          </div>
          <div className="rounded-lg bg-slate-900 p-3 border border-slate-800">
            <p className="text-slate-400">Status</p>
            <p className="font-medium text-cyan-300">{vehicle.status}</p>
          </div>
        </div>

        <div className="mt-4 grid gap-2">
          {ACTIONS_BY_ROLE[role].map((action) => (
            <button
              key={action}
              onClick={() => setSelectedAction(action)}
              className="rounded-xl bg-gradient-to-r from-cyan-600 to-emerald-600 px-4 py-3 text-sm font-semibold text-slate-950 hover:opacity-95"
            >
              {action}
            </button>
          ))}
        </div>

        {selectedAction && (
          <p className="mt-3 rounded-lg border border-emerald-900/40 bg-emerald-950/20 p-3 text-sm text-emerald-300">
            {selectedAction} has been captured for this vehicle.
          </p>
        )}
      </div>
    </div>
  );
}
