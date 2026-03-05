"use client";

import { useState, useEffect } from "react";
import ConnectStep from "@/components/ConnectStep";
import SelectTeamStep from "@/components/SelectTeamStep";
import BrowseStep, { type BrowseData, type Selection } from "@/components/BrowseStep";
import ConfigureStep, { type MappingConfig, type LinearData } from "@/components/ConfigureStep";
import PreviewStep from "@/components/PreviewStep";
import ExecuteStep from "@/components/ExecuteStep";
import type { ShortcutGroup } from "@/lib/shortcut";

type Step = "connect" | "team" | "browse" | "configure" | "preview" | "execute";

const STEPS: { id: Step; label: string }[] = [
  { id: "connect", label: "Connect" },
  { id: "team", label: "Select team" },
  { id: "browse", label: "Browse & select" },
  { id: "configure", label: "Configure" },
  { id: "preview", label: "Preview" },
  { id: "execute", label: "Migrate" },
];

function StepIndicator({ current }: { current: Step }) {
  const currentIndex = STEPS.findIndex((s) => s.id === current);
  return (
    <nav className="flex items-center gap-0">
      {STEPS.map((step, i) => {
        const done = i < currentIndex;
        const active = step.id === current;
        return (
          <div key={step.id} className="flex items-center">
            <div
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium ${
                active
                  ? "bg-blue-600 text-white"
                  : done
                  ? "text-blue-600"
                  : "text-gray-400"
              }`}
            >
              <span
                className={`flex h-4 w-4 items-center justify-center rounded-full text-[10px] font-bold ${
                  active
                    ? "bg-white text-blue-600"
                    : done
                    ? "bg-blue-100 text-blue-600"
                    : "bg-gray-200 text-gray-500"
                }`}
              >
                {done ? "✓" : i + 1}
              </span>
              {step.label}
            </div>
            {i < STEPS.length - 1 && (
              <div
                className={`h-px w-4 ${done || active ? "bg-blue-300" : "bg-gray-200"}`}
              />
            )}
          </div>
        );
      })}
    </nav>
  );
}

export default function Home() {
  const [step, setStep] = useState<Step>("connect");

  // Credentials — empty string means "use env var on the server"
  const [shortcutToken, setShortcutToken] = useState("");
  const [linearToken, setLinearToken] = useState("");

  // On mount: check if tokens are pre-configured via env vars
  useEffect(() => {
    fetch("/api/config")
      .then((r) => r.json())
      .then(({ shortcutConfigured, linearConfigured }) => {
        if (shortcutConfigured && linearConfigured) {
          // Both tokens available server-side — skip the Connect step
          setStep("team");
        }
      })
      .catch(() => {
        // If config check fails, just stay on Connect step
      });
  }, []);

  // Data
  const [selectedGroup, setSelectedGroup] = useState<ShortcutGroup | null>(null);
  const [browseData, setBrowseData] = useState<BrowseData | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [mapping, setMapping] = useState<MappingConfig | null>(null);
  const [linearData, setLinearData] = useState<LinearData | null>(null);

  function handleConnect(sc: string, lin: string) {
    setShortcutToken(sc);
    setLinearToken(lin);
    setStep("team");
  }

  function handleSelectGroup(group: ShortcutGroup) {
    setSelectedGroup(group);
    setBrowseData(null);
    setSelection(null);
    setStep("browse");
  }

  function handleBrowseNext(data: BrowseData, sel: Selection) {
    setBrowseData(data);
    setSelection(sel);
    setStep("configure");
  }

  function handleConfigureNext(cfg: MappingConfig, ld: LinearData) {
    setMapping(cfg);
    setLinearData(ld);
    setStep("preview");
  }

  function handleStartOver() {
    setSelectedGroup(null);
    setBrowseData(null);
    setSelection(null);
    setMapping(null);
    setLinearData(null);
    setStep("team");
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="mx-auto max-w-5xl flex items-center justify-between">
          <div>
            <h1 className="text-base font-semibold text-gray-900">
              Shortcut → Linear Migration
            </h1>
            <p className="text-xs text-gray-400 mt-0.5">
              Granular, phased migration with full control
            </p>
          </div>
          <StepIndicator current={step} />
        </div>
      </header>

      {/* Main content */}
      <main className="mx-auto max-w-5xl px-6 py-8">
        {step === "connect" && <ConnectStep onConnect={handleConnect} />}

        {step === "team" && (
          <SelectTeamStep
            shortcutToken={shortcutToken}
            linearToken={linearToken}
            onSelect={handleSelectGroup}
            onBack={() => setStep("connect")}
          />
        )}

        {step === "browse" && selectedGroup && (
          <BrowseStep
            shortcutToken={shortcutToken}
            linearToken={linearToken}
            selectedGroup={selectedGroup}
            onNext={handleBrowseNext}
            onBack={() => setStep("team")}
          />
        )}

        {step === "configure" && browseData && selection && (
          <ConfigureStep
            linearToken={linearToken}
            browseData={browseData}
            selection={selection}
            onNext={handleConfigureNext}
            onBack={() => setStep("browse")}
          />
        )}

        {step === "preview" &&
          browseData &&
          selection &&
          mapping &&
          linearData && (
            <PreviewStep
              browseData={browseData}
              selection={selection}
              mapping={mapping}
              linearData={linearData}
              onConfirm={() => setStep("execute")}
              onBack={() => setStep("configure")}
            />
          )}

        {step === "execute" &&
          browseData &&
          selection &&
          mapping &&
          linearData && (
            <ExecuteStep
              shortcutToken={shortcutToken}
              linearToken={linearToken}
              browseData={browseData}
              selection={selection}
              mapping={mapping}
              linearData={linearData}
              onStartOver={handleStartOver}
            />
          )}
      </main>
    </div>
  );
}
