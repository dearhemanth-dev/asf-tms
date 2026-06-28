"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { APP_ROLES, type AppRole } from "@/lib/auth";

type TimeWindow = "7" | "30" | "60";

type SessionState = {
  ready: boolean;
  role: AppRole | null;
};

type Pillar = {
  key: string;
  title: string;
  weight: number;
  summary: string;
  metrics: string[];
};

const PILLARS: Pillar[] = [
  {
    key: "safety",
    title: "Safety Discipline",
    weight: 35,
    summary: "How safely each driver operates on the road.",
    metrics: [
      "Harsh events per 100 miles",
      "Speeding minutes per 100 miles",
      "High-risk event severity mix",
    ],
  },
  {
    key: "idling",
    title: "Idling and Efficiency",
    weight: 20,
    summary: "How efficiently engine time is used.",
    metrics: [
      "Idle minutes per engine hour",
      "Unnecessary idling ratio",
      "Trend vs fleet baseline",
    ],
  },
  {
    key: "fuel",
    title: "Fueling Discipline",
    weight: 15,
    summary: "How consistently drivers protect fuel cost and quality.",
    metrics: [
      "Fuel efficiency vs peer baseline",
      "Fueling pattern consistency",
      "Outlier fuel behavior checks",
    ],
  },
  {
    key: "dvir",
    title: "DVIR and Compliance",
    weight: 15,
    summary: "How reliably inspections and defect actions are completed.",
    metrics: [
      "DVIR submission completion rate",
      "On-time DVIR submission rate",
      "Critical defects open beyond SLA",
    ],
  },
  {
    key: "maintenance",
    title: "Maintenance-Friendly Driving",
    weight: 15,
    summary: "How driving behavior supports lower wear and breakdown risk.",
    metrics: [
      "Driver-correlated fault recurrence",
      "Engine stress pattern indicators",
      "Repeat issue trend over selected window",
    ],
  },
];

const WINDOW_LABELS: Record<TimeWindow, string> = {
  "7": "Last 7 Days",
  "30": "Last 30 Days",
  "60": "Last 60 Days",
};

const WINDOW_NOTES: Record<TimeWindow, string> = {
  "7": "Best for week-to-week coaching and quick behavior correction.",
  "30": "Best for monthly performance review and trend stability.",
  "60": "Best for promotion, incentive, and consistency decisions.",
};

export default function DriverRankingPage() {
  const router = useRouter();
  const [session, setSession] = useState<SessionState>({ ready: false, role: null });
  const [windowDays, setWindowDays] = useState<TimeWindow>("30");

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const sessionRole = window.sessionStorage.getItem("demoRole");
    const normalizedRole = APP_ROLES.includes(sessionRole as AppRole) ? (sessionRole as AppRole) : null;
    setSession({ ready: true, role: normalizedRole });
  }, []);

  useEffect(() => {
    if (session.ready && session.role !== "management") {
      router.replace("/fleet");
    }
  }, [router, session.ready, session.role]);

  const weightedFormula = useMemo(() => {
    return "DPI = 0.35(Safety) + 0.20(Idling) + 0.15(Fuel) + 0.15(DVIR) + 0.15(Maintenance)";
  }, []);

  if (!session.ready) {
    return <main className="min-h-screen grid place-items-center text-slate-300">Loading Driver Ranking...</main>;
  }

  if (session.role !== "management") {
    return <main className="min-h-screen grid place-items-center text-rose-300">Management access only.</main>;
  }

  return (
    <main className="min-h-screen bg-slate-950 px-4 py-5 text-slate-100 md:px-6 md:py-8">
      <section className="mx-auto w-full max-w-5xl space-y-4">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-xl font-semibold tracking-tight text-cyan-100 md:text-2xl">Driver Ranking</h1>
          <Link
            href="/reports/vehicle-ranking"
            className="rounded-md border border-slate-700 px-3 py-1.5 text-xs text-slate-200 hover:bg-slate-800"
          >
            Back to Vehicle Ranking
          </Link>
        </div>

        <div className="rounded-xl border border-cyan-900/45 bg-slate-900/70 p-4 shadow-lg">
          <p className="text-sm text-slate-200">
            Driver Performance Index (DPI) is a single management score (0-100) that combines safety, efficiency,
            fuel discipline, compliance, and maintenance-friendly behavior.
          </p>
          <p className="mt-2 rounded-md border border-slate-700 bg-slate-950/80 px-3 py-2 text-sm font-medium text-cyan-100">
            {weightedFormula}
          </p>
          <p className="mt-2 text-xs text-slate-400">
            Each pillar is normalized by activity levels (miles or engine hours) so rankings stay fair across different
            routes and workloads.
          </p>
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-3">
          <p className="mb-2 text-xs uppercase tracking-wide text-slate-400">Time Window</p>
          <div className="grid grid-cols-3 gap-2">
            {(["7", "30", "60"] as TimeWindow[]).map((option) => {
              const active = windowDays === option;
              return (
                <button
                  key={option}
                  onClick={() => setWindowDays(option)}
                  className={`rounded-md border px-3 py-2 text-sm font-medium transition ${
                    active
                      ? "border-cyan-500 bg-cyan-900/40 text-cyan-100"
                      : "border-slate-700 bg-slate-900/70 text-slate-200 hover:bg-slate-800"
                  }`}
                >
                  {WINDOW_LABELS[option]}
                </button>
              );
            })}
          </div>
          <p className="mt-2 text-xs text-slate-400">{WINDOW_NOTES[windowDays]}</p>
        </div>

        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {PILLARS.map((pillar) => (
            <article key={pillar.key} className="rounded-xl border border-slate-800 bg-slate-900/65 p-3">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-sm font-semibold text-slate-100">{pillar.title}</h2>
                <span className="rounded-full border border-cyan-800/60 bg-cyan-900/30 px-2 py-0.5 text-[11px] text-cyan-200">
                  {pillar.weight}%
                </span>
              </div>
              <p className="mt-1 text-xs text-slate-300">{pillar.summary}</p>
              <div className="mt-2 space-y-1">
                {pillar.metrics.map((metric) => (
                  <p key={metric} className="text-xs text-slate-400">
                    • {metric}
                  </p>
                ))}
              </div>
            </article>
          ))}
        </section>

        <section className="rounded-xl border border-slate-800 bg-slate-900/65 p-4">
          <h3 className="text-sm font-semibold text-slate-100">How Management Should Use This</h3>
          <p className="mt-1 text-sm text-slate-300">
            Use DPI to identify coaching priorities and recognize consistent performers. This page defines the scoring
            method first; live endpoint data wiring is the next phase.
          </p>
        </section>
      </section>
    </main>
  );
}
