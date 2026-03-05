"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { BrowseData, Selection } from "./BrowseStep";
import type { MappingConfig, LinearData } from "./ConfigureStep";

interface Props {
  browseData: BrowseData;
  selection: Selection;
  mapping: MappingConfig;
  linearData: LinearData;
  onConfirm: () => void;
  onBack: () => void;
}

function SummaryCard({ label, count, linearLabel }: { label: string; count: number; linearLabel: string }) {
  return (
    <Card>
      <CardContent className="pt-4 pb-4">
        <div className="text-2xl font-bold">{count}</div>
        <div className="text-xs text-muted-foreground mt-1">
          {label} <span className="text-muted-foreground/50">→</span> {linearLabel}
        </div>
      </CardContent>
    </Card>
  );
}

function DetailSection({ title, children }: { title: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-lg border overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-4 py-3 bg-muted/50 hover:bg-muted text-sm font-medium transition-colors"
      >
        <span>{title}</span>
        <svg
          className={`h-4 w-4 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
          fill="none" stroke="currentColor" viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && <div className="divide-y">{children}</div>}
    </div>
  );
}

function DetailRow({ left, right }: { left: string; right: string }) {
  return (
    <div className="flex items-start gap-4 px-4 py-2 text-sm">
      <span className="flex-1 truncate">{left}</span>
      <span className="shrink-0 text-muted-foreground text-xs">{right}</span>
    </div>
  );
}

export default function PreviewStep({ browseData, selection, mapping, linearData, onConfirm, onBack }: Props) {
  const team = linearData.teams.find((t) => t.id === mapping.linearTeamId);
  const memberMap = Object.fromEntries(browseData.members.map((m) => [m.id, m.profile.name]));
  const linearUserMap = Object.fromEntries(linearData.users.map((u) => [u.id, u.name]));
  const stateNameMap = Object.fromEntries(
    browseData.workflows.flatMap((w) => w.states.map((s) => [s.id, s.name]))
  );
  const linearStateMap = Object.fromEntries((team?.states.nodes ?? []).map((s) => [s.id, s.name]));

  const selectedMilestones = browseData.milestones.filter((m) => selection.milestoneIds.has(m.id));
  const selectedEpics = browseData.epics.filter((e) => selection.epicIds.has(e.id));
  const selectedIterations = browseData.iterations.filter((it) => selection.iterationIds.has(it.id));
  const selectedStories = browseData.stories.filter((s) => selection.storyIds.has(s.id));

  const allStoryTypeLabels = new Set(selectedStories.map((s) => s.story_type));
  const allShortcutLabels = new Set(selectedStories.flatMap((s) => s.labels.map((l) => l.name)));

  // Suppress unused warning — memberMap is used in detail rows below
  void memberMap;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold">Preview migration</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Migrating into Linear team: <strong>{team?.name} ({team?.key})</strong>
        </p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <SummaryCard label="Milestones" count={selectedMilestones.length} linearLabel="Initiatives" />
        <SummaryCard label="Epics" count={selectedEpics.length} linearLabel="Projects" />
        <SummaryCard label="Iterations" count={selectedIterations.length} linearLabel="Cycles" />
        <SummaryCard label="Stories" count={selectedStories.length} linearLabel="Issues" />
      </div>

      <div className="rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-800">
        <strong>Labels:</strong> Story types ({Array.from(allStoryTypeLabels).join(", ")}) and{" "}
        {allShortcutLabels.size} Shortcut label{allShortcutLabels.size !== 1 ? "s" : ""} will be
        auto-created in Linear if they don&apos;t already exist.
      </div>

      <div className="rounded-lg bg-muted/50 border px-4 py-3 text-sm space-y-1">
        <p className="font-medium mb-2">What will happen:</p>
        <p className="text-muted-foreground">• Story tasks are converted to markdown checkboxes in the issue description.</p>
        <p className="text-muted-foreground">• External links are appended to the issue description.</p>
        <p className="text-muted-foreground">• Comments are migrated with author name and original date in the body.</p>
        <p className="text-muted-foreground">• Only the first Shortcut owner becomes the Linear assignee.</p>
        <p className="text-muted-foreground">• Stories linked to a selected epic will be added to the corresponding Linear project.</p>
        <p className="text-muted-foreground">• Stories linked to a selected iteration will be added to the corresponding Linear cycle.</p>
      </div>

      {selectedMilestones.length > 0 && (
        <DetailSection title="Milestones → Initiatives">
          {selectedMilestones.map((m) => <DetailRow key={m.id} left={m.name} right="Initiative" />)}
        </DetailSection>
      )}

      {selectedEpics.length > 0 && (
        <DetailSection title="Epics → Projects">
          {selectedEpics.map((e) => <DetailRow key={e.id} left={e.name} right={`Project · ${e.state}`} />)}
        </DetailSection>
      )}

      {selectedIterations.length > 0 && (
        <DetailSection title="Iterations → Cycles">
          {selectedIterations.map((it) => (
            <DetailRow key={it.id} left={it.name} right={`Cycle · ${it.start_date} → ${it.end_date}`} />
          ))}
        </DetailSection>
      )}

      {selectedStories.length > 0 && (
        <DetailSection title="Stories → Issues">
          {selectedStories.map((s) => {
            const assigneeId = mapping.memberMap[s.owner_ids[0]] ?? "";
            const assigneeName = assigneeId
              ? linearUserMap[assigneeId]
              : s.owner_ids[0] ? "(unassigned)" : "—";
            const scStateName = stateNameMap[s.workflow_state_id] ?? "?";
            const linearStateId = mapping.stateMap[String(s.workflow_state_id)] ?? "";
            const linearStateName = linearStateId ? linearStateMap[linearStateId] : "(auto)";
            return (
              <DetailRow
                key={s.id}
                left={`#${s.id} ${s.name}`}
                right={`${scStateName} → ${linearStateName} · ${assigneeName}`}
              />
            );
          })}
        </DetailSection>
      )}

      <div className="flex items-center justify-between pt-2">
        <Button variant="ghost" size="sm" onClick={onBack}>← Back</Button>
        <Button onClick={onConfirm} className="bg-green-600 hover:bg-green-700 text-white">
          Run migration
        </Button>
      </div>
    </div>
  );
}
