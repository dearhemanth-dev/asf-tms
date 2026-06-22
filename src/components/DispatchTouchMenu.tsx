"use client";

import { useMemo, useState } from "react";

type LeafNode = {
  label: string;
};

type BranchNode = {
  label: string;
  children: LeafNode[];
};

type MenuGroup = {
  title: string;
  items: Array<LeafNode | BranchNode>;
};

const GROUPS: MenuGroup[] = [
  { title: "Driver", items: [{ label: "Driver" }] },
  { title: "Location", items: [{ label: "Location" }] },
  {
    title: "Load Number",
    items: [
      {
        label: "Route Details",
        children: [{ label: "Origin" }, { label: "Destination" }],
      },
      {
        label: "Backhaul",
        children: [{ label: "Origination" }, { label: "Destination" }],
      },
    ],
  },
  { title: "Paid Miles", items: [{ label: "Paid Miles" }] },
  { title: "Unpaid Miles", items: [{ label: "Unpaid Miles" }] },
  { title: "Broker", items: [{ label: "Broker" }] },
  { title: "Consignee", items: [{ label: "Consignee" }] },
];

function hasChildren(node: LeafNode | BranchNode): node is BranchNode {
  return "children" in node;
}

type DispatchTouchMenuProps = {
  onClose?: () => void;
};

export default function DispatchTouchMenu({ onClose }: DispatchTouchMenuProps) {
  const [openGroup, setOpenGroup] = useState<string>(GROUPS[0].title);
  const [openBranch, setOpenBranch] = useState<string | null>(null);
  const [activeItem, setActiveItem] = useState<string>("Driver");

  const selectedGroup = useMemo(
    () => GROUPS.find((group) => group.title === openGroup) ?? GROUPS[0],
    [openGroup]
  );

  const selectedBranch = useMemo(() => {
    if (!openBranch) return null;

    const branch = selectedGroup.items.find(
      (item): item is BranchNode => hasChildren(item) && item.label === openBranch
    );

    return branch ?? null;
  }, [openBranch, selectedGroup]);

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
        <ul className="divide-y divide-slate-800/80 pr-44">
          {GROUPS.map((group) => {
            const selected = group.title === openGroup;

            return (
              <li key={group.title}>
                <button
                  onClick={() => {
                    setOpenGroup(group.title);
                    setOpenBranch(null);
                  }}
                  className={`flex w-full items-center justify-between px-2 py-1.5 text-left text-[11px] font-semibold leading-tight transition ${
                    selected ? "bg-cyan-950/35 text-cyan-100" : "text-slate-200 hover:bg-slate-900/65"
                  }`}
                >
                  <span>{group.title}</span>
                  <span className="text-[10px] text-slate-500">&gt;</span>
                </button>
              </li>
            );
          })}
        </ul>

        <aside className="absolute right-0 top-0 bottom-0 w-40 rounded-r-xl border-l border-cyan-900/40 bg-slate-950/92 p-1">
          <p className="mb-1 border-b border-slate-800 pb-1 text-[10px] font-bold uppercase tracking-[0.14em] text-cyan-200">
            {selectedGroup.title}
          </p>

          <ul className="space-y-0.5">
            {selectedGroup.items.map((item) => {
              const selected = activeItem === item.label;

              if (hasChildren(item)) {
                const branchOpen = openBranch === item.label;

                return (
                  <li key={item.label}>
                    <button
                      onClick={() => {
                        setOpenBranch(branchOpen ? null : item.label);
                        setActiveItem(item.label);
                      }}
                      className={`flex w-full items-center justify-between rounded px-1.5 py-1 text-left text-[10px] leading-tight transition ${
                        selected ? "bg-cyan-900/35 text-cyan-100" : "text-slate-300 hover:bg-slate-900"
                      }`}
                    >
                      <span>{item.label}</span>
                      <span className="text-[9px] text-slate-500">&gt;</span>
                    </button>
                  </li>
                );
              }

              return (
                <li key={item.label}>
                  <button
                    onClick={() => {
                      setOpenBranch(null);
                      setActiveItem(item.label);
                    }}
                    className={`w-full rounded px-1.5 py-1 text-left text-[10px] leading-tight transition ${
                      selected ? "bg-cyan-900/35 text-cyan-100" : "text-slate-300 hover:bg-slate-900"
                    }`}
                  >
                    {item.label}
                  </button>
                </li>
              );
            })}
          </ul>
        </aside>

        {selectedBranch && (
          <aside className="absolute right-[10rem] top-0 bottom-0 z-20 w-28 rounded-l-xl border-l border-cyan-900/40 bg-slate-950/94 p-1 shadow-lg">
            <p className="mb-1 border-b border-slate-800 pb-1 text-[9px] font-bold uppercase tracking-[0.12em] text-cyan-200">
              {selectedBranch.label}
            </p>
            <ul className="space-y-0.5">
              {selectedBranch.children.map((child) => {
                const selected = activeItem === child.label;

                return (
                  <li key={child.label}>
                    <button
                      onClick={() => setActiveItem(child.label)}
                      className={`w-full rounded px-1.5 py-1 text-left text-[10px] leading-tight transition ${
                        selected ? "bg-cyan-900/35 text-cyan-100" : "text-slate-300 hover:bg-slate-900"
                      }`}
                    >
                      {child.label}
                    </button>
                  </li>
                );
              })}
            </ul>
          </aside>
        )}
      </div>
    </section>
  );
}