"use client";

import { useState } from "react";
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

function SummaryCard({
  label,
  count,
  linearLabel,
}: {
  label: string;
  count: number;
  linearLabel: string;
}) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white px-4 py-3 flex flex-col gap-1">
      <div className="text-2xl font-bold text-gray-900">{count}</div>
      <div className="text-xs text-gray-500">
        {label} <span className="text-gray-300">→</span> {linearLabel}
      </div>
    </div>
  );
}

export default function PreviewStep({
  browseData,
  selection,
  mapping,
  linearData,
  onConfirm,
  onBack,
}: Props) {
  const team = linearData.teams.find((t) => t.id === mapping.linearTeamId);
  const memberMap = Object.fromEntries(browseData.members.map((m) => [m.id, m.profile.name]));
  const linearUserMap = Object.fromEntries(linearData.users.map((u) => [u.id, u.name]));
  const stateNameMap = Object.fromEntries(
    browseData.workflows.flatMap((w) => w.states.map((s) => [s.id, s.name]))
  );
  const linearStateMap = Object.fromEntries(
    (team?.states.nodes ?? []).map((s) => [s.id, s.name])
  );

  const selectedMilestones = browseData.milestones.filter((m) =>
    selection.milestoneIds.has(m.id)
  );
  const selectedEpics = browseData.epics.filter((e) => selection.epicIds.has(e.id));
  const selectedIterations = browseData.iterations.filter((it) =>
    selection.iterationIds.has(it.id)
  );
  const selectedStories = browseData.stories.filter((s) => selection.storyIds.has(s.id));

  // Collect labels that will be created
  const allStoryTypeLabels = new Set(selectedStories.map((s) => s.story_type));
  const allShortcutLabels = new Set(
    selectedStories.flatMap((s) => s.labels.map((l) => l.name))
  );

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold text-gray-900">Preview migration</h2>
        <p className="mt-1 text-sm text-gray-500">
          Migrating into Linear team:{" "}
          <strong>
            {team?.name} ({team?.key})
          </strong>
        </p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <SummaryCard label="Milestones" count={selectedMilestones.length} linearLabel="Initiatives" />
        <SummaryCard label="Epics" count={selectedEpics.length} linearLabel="Projects" />
        <SummaryCard label="Iterations" count={selectedIterations.length} linearLabel="Cycles" />
        <SummaryCard label="Stories" count={selectedStories.length} linearLabel="Issues" />
      </div>

      {/* Labels note */}
      <div className="rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-800">
        <strong>Labels:</strong> Story types ({Array.from(allStoryTypeLabels).join(", ")}) and{" "}
        {allShortcutLabels.size} Shortcut label
        {allShortcutLabels.size !== 1 ? "s" : ""} will be auto-created in Linear if they
        don&apos;t already exist.
      </div>

      {/* What will happen */}
      <div className="rounded-lg bg-gray-50 border border-gray-200 px-4 py-3 text-sm text-gray-700 space-y-1">
        <p className="font-medium text-gray-900 mb-2">What will happen:</p>
        <p>• Story tasks are converted to markdown checkboxes in the issue description.</p>
        <p>• External links are appended to the issue description.</p>
        <p>• Comments are migrated with author name and original date in the body.</p>
        <p>• Only the first Shortcut owner becomes the Linear assignee.</p>
        <p>
          • Stories linked to a selected epic will be added to the corresponding Linear project.
        </p>
        <p>
          • Stories linked to a selected iteration will be added to the corresponding Linear cycle.
        </p>
      </div>

      {/* Detail sections */}
      {selectedMilestones.length > 0 && (
        <DetailSection title="Milestones → Initiatives">
          {selectedMilestones.map((m) => (
            <DetailRow key={m.id} left={m.name} right="Initiative" />
          ))}
        </DetailSection>
      )}

      {selectedEpics.length > 0 && (
        <DetailSection title="Epics → Projects">
          {selectedEpics.map((e) => (
            <DetailRow key={e.id} left={e.name} right={`Project · ${e.state}`} />
          ))}
        </DetailSection>
      )}

      {selectedIterations.length > 0 && (
        <DetailSection title="Iterations → Cycles">
          {selectedIterations.map((it) => (
            <DetailRow
              key={it.id}
              left={it.name}
              right={`Cycle · ${it.start_date} → ${it.end_date}`}
            />
          ))}
        </DetailSection>
      )}

      {selectedStories.length > 0 && (
        <DetailSection title="Stories → Issues">
          {selectedStories.map((s) => {
            const assigneeId = mapping.memberMap[s.owner_ids[0]] ?? "";
            const assigneeName = assigneeId
              ? linearUserMap[assigneeId]
              : s.owner_ids[0]
              ? "(unassigned)"
              : "—";
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
        <button onClick={onBack} className="text-sm text-gray-500 hover:text-gray-700">
          ← Back
        </button>
        <button
          onClick={onConfirm}
          className="rounded-lg bg-green-600 px-5 py-2 text-sm font-medium text-white hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2"
        >
          Run migration
        </button>
      </div>
    </div>
  );
}

function DetailSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="rounded-lg border border-gray-200 overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 hover:bg-gray-100 text-sm font-medium text-gray-700"
      >
        <span>{title}</span>
        <svg
          className={`h-4 w-4 text-gray-400 transition-transform ${open ? "rotate-180" : ""}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && <div className="divide-y divide-gray-100">{children}</div>}
    </div>
  );
}

function DetailRow({ left, right }: { left: string; right: string }) {
  return (
    <div className="flex items-start gap-4 px-4 py-2 text-sm">
      <span className="flex-1 text-gray-900 truncate">{left}</span>
      <span className="shrink-0 text-gray-400 text-xs">{right}</span>
    </div>
  );
}

