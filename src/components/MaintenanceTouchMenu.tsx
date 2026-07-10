"use client";

import { useState } from "react";

type MenuGroup = {
  title: string;
  items: string[];
};

const GROUPS: MenuGroup[] = [
  { title: "MPG", items: ["MPG"] },
  { title: "Driver", items: ["Driver"] },
  { title: "Location", items: ["Location"] },
  { title: "Faults", items: ["Faults"] },
  { title: "Drivers Report", items: ["Drivers Report"] },
  { title: "Work Orders", items: ["Work Orders"] },
];

type MaintenanceTouchMenuProps = {
  onClose?: () => void;
};

export default function MaintenanceTouchMenu({ onClose }: MaintenanceTouchMenuProps) {
  const [openGroup, setOpenGroup] = useState<string>(GROUPS[0].title);
  const [activeItem, setActiveItem] = useState<string>("MPG");

  const selectedGroup = GROUPS.find((group) => group.title === openGroup) ?? GROUPS[0];

  return (
    <section className="glass relative overflow-hidden rounded-xl">
      <button
        onClick={onClose}
        className="absolute right-0 top-0 z-30 h-8 w-8 rounded-bl-lg border-b border-l border-slate-700 bg-slate-900/85 text-base font-bold leading-none text-slate-200 hover:bg-slate-800"
        aria-label="Close menu"
      >
        ×
      </button>
      <div className="relative min-h-[220px] rounded-xl border border-slate-800 bg-slate-950/55">
        <ul className="divide-y divide-slate-800/80 pr-40">
          {GROUPS.map((group) => {
            const selected = group.title === openGroup;

            return (
              <li key={group.title}>
                <button
                  onClick={() => setOpenGroup(group.title)}
                  className={`flex w-full items-center justify-between px-2 py-1.5 text-left text-[11px] font-semibold leading-tight transition ${
                    selected ? "bg-orange-950/35 text-orange-100" : "text-slate-200 hover:bg-slate-900/65"
                  }`}
                >
                  <span>{group.title}</span>
                  <span className="text-[10px] text-slate-500">&gt;</span>
                </button>
              </li>
            );
          })}
        </ul>

        <aside className="absolute right-0 top-0 bottom-0 w-36 rounded-r-xl border-l border-orange-900/40 bg-slate-950/92 p-1">
          <p className="mb-1 border-b border-slate-800 pb-1 text-[10px] font-bold uppercase tracking-[0.14em] text-orange-200">
            {selectedGroup.title}
          </p>
          <ul className="space-y-0.5">
            {selectedGroup.items.map((item) => {
              const selected = activeItem === item;

              return (
                <li key={item}>
                  <button
                    onClick={() => setActiveItem(item)}
                    className={`w-full rounded px-1.5 py-1 text-left text-[10px] leading-tight transition ${
                      selected ? "bg-orange-900/35 text-orange-100" : "text-slate-300 hover:bg-slate-900"
                    }`}
                  >
                    {item}
                  </button>
                </li>
              );
            })}
          </ul>
        </aside>
      </div>
    </section>
  );
}