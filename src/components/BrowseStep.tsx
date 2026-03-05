"use client";

import { useEffect, useState, useCallback, type ReactNode } from "react";
import { shortcutRequest, linearRequest } from "@/lib/api";
import { ALL_PROJECTS_QUERY, ALL_INITIATIVES_QUERY, MIGRATED_ISSUES_QUERY } from "@/lib/linear";
import type {
  ShortcutGroup,
  ShortcutMilestone,
  ShortcutEpic,
  ShortcutIteration,
  ShortcutStory,
  ShortcutMember,
  ShortcutWorkflow,
} from "@/lib/shortcut";

export interface BrowseData {
  milestones: ShortcutMilestone[];
  epics: ShortcutEpic[];
  iterations: ShortcutIteration[];
  stories: ShortcutStory[];
  members: ShortcutMember[];
  workflows: ShortcutWorkflow[];
}

export interface Selection {
  milestoneIds: Set<number>;
  epicIds: Set<number>;
  iterationIds: Set<number>;
  storyIds: Set<number>;
}

interface Props {
  shortcutToken: string;
  linearToken: string;
  selectedGroup: ShortcutGroup;
  onNext: (data: BrowseData, selection: Selection) => void;
  onBack: () => void;
}

type Filter = "all" | "open" | "done";

function isEpicOpen(e: ShortcutEpic) {
  return e.state !== "done" && e.state !== "closed";
}

function isIterationOpen(it: ShortcutIteration) {
  return it.status !== "done" && it.status !== "closed";
}

function isMilestoneOpen(m: ShortcutMilestone) {
  return m.state !== "done" && m.state !== "closed";
}

function CheckboxRow({
  checked,
  indeterminate,
  onChange,
  label,
  sub,
  badge,
}: {
  checked: boolean;
  indeterminate?: boolean;
  onChange: () => void;
  label: string;
  sub?: string;
  badge?: ReactNode;
}) {
  return (
    <label className="flex items-start gap-3 px-3 py-2 hover:bg-gray-50 rounded cursor-pointer">
      <input
        type="checkbox"
        checked={checked}
        ref={(el) => {
          if (el) el.indeterminate = !!indeterminate;
        }}
        onChange={onChange}
        className="mt-0.5 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
      />
      <div className="min-w-0">
        <div className="text-sm text-gray-900 truncate">{label}</div>
        {(sub || badge) && (
          <div className="flex items-center gap-2 flex-wrap">
            {sub && <span className="text-xs text-gray-400 truncate">{sub}</span>}
            {badge}
          </div>
        )}
      </div>
    </label>
  );
}

function Section<T>({
  title,
  items,
  selectedIds,
  getId,
  getLabel,
  getSub,
  getBadge,
  filter,
  onFilter,
  onToggle,
  onSelectAll,
}: {
  title: string;
  items: T[];
  selectedIds: Set<number>;
  getId: (item: T) => number;
  getLabel: (item: T) => string;
  getSub?: (item: T) => string;
  getBadge?: (item: T) => ReactNode;
  filter: Filter;
  onFilter: (f: Filter) => void;
  onToggle: (id: number) => void;
  onSelectAll: (ids: number[]) => void;
}) {
  const filtered = items.filter((item) => {
    if (filter === "all") return true;
    return filter === "open"
      ? !selectedIds.has(getId(item)) // placeholder — items are pre-filtered
      : selectedIds.has(getId(item));
  });

  const allFilteredIds = filtered.map(getId);
  const allChecked =
    allFilteredIds.length > 0 && allFilteredIds.every((id) => selectedIds.has(id));
  const someChecked = allFilteredIds.some((id) => selectedIds.has(id));

  return (
    <div className="rounded-lg border border-gray-200 bg-white">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={allChecked}
            ref={(el) => {
              if (el) el.indeterminate = someChecked && !allChecked;
            }}
            onChange={() =>
              allChecked
                ? onSelectAll([])
                : onSelectAll(allFilteredIds)
            }
            className="h-4 w-4 rounded border-gray-300 text-blue-600"
          />
          <span className="font-medium text-sm text-gray-900">{title}</span>
          <span className="text-xs text-gray-400">
            ({selectedIds.size}/{items.length})
          </span>
        </div>
        <div className="flex gap-1">
          {(["all", "open", "done"] as Filter[]).map((f) => (
            <button
              key={f}
              onClick={() => onFilter(f)}
              className={`px-2 py-0.5 rounded text-xs font-medium ${
                filter === f
                  ? "bg-blue-100 text-blue-700"
                  : "text-gray-400 hover:text-gray-600"
              }`}
            >
              {f}
            </button>
          ))}
        </div>
      </div>
      <div className="max-h-56 overflow-y-auto divide-y divide-gray-50">
        {filtered.length === 0 ? (
          <p className="px-4 py-3 text-sm text-gray-400">Nothing to show.</p>
        ) : (
          filtered.map((item) => (
            <CheckboxRow
              key={getId(item)}
              checked={selectedIds.has(getId(item))}
              onChange={() => onToggle(getId(item))}
              label={getLabel(item)}
              sub={getSub?.(item)}
              badge={getBadge?.(item)}
            />
          ))
        )}
      </div>
    </div>
  );
}

export default function BrowseStep({
  shortcutToken,
  linearToken,
  selectedGroup,
  onNext,
  onBack,
}: Props) {
  const [data, setData] = useState<BrowseData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMsg, setLoadingMsg] = useState("Fetching data…");
  const [error, setError] = useState("");
  // Sets of already-migrated names/IDs — populated by querying Linear in the background
  const [migratedProjects, setMigratedProjects] = useState<Set<string>>(new Set());
  const [migratedInitiatives, setMigratedInitiatives] = useState<Set<string>>(new Set());
  const [migratedStoryIds, setMigratedStoryIds] = useState<Set<number>>(new Set());

  const [selectedMilestoneIds, setSelectedMilestoneIds] = useState<Set<number>>(new Set());
  const [selectedEpicIds, setSelectedEpicIds] = useState<Set<number>>(new Set());
  const [selectedIterationIds, setSelectedIterationIds] = useState<Set<number>>(new Set());
  const [selectedStoryIds, setSelectedStoryIds] = useState<Set<number>>(new Set());

  const [milestoneFilter, setMilestoneFilter] = useState<Filter>("all");
  const [epicFilter, setEpicFilter] = useState<Filter>("all");
  const [iterationFilter, setIterationFilter] = useState<Filter>("all");
  const [storyFilter, setStoryFilter] = useState<Filter>("all");

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setLoadingMsg("Fetching members…");
      const [members, workflows, epics, iterations] = await Promise.all([
        shortcutRequest<ShortcutMember[]>(shortcutToken, "GET", "members"),
        shortcutRequest<ShortcutWorkflow[]>(shortcutToken, "GET", "workflows"),
        shortcutRequest<ShortcutEpic[]>(shortcutToken, "GET", "epics"),
        shortcutRequest<ShortcutIteration[]>(shortcutToken, "GET", "iterations"),
      ]);

      // Shortcut renamed Milestones → Objectives; try new endpoint, fall back to old
      let milestones: ShortcutMilestone[] = [];
      try {
        milestones = await shortcutRequest<ShortcutMilestone[]>(shortcutToken, "GET", "objectives");
      } catch {
        milestones = await shortcutRequest<ShortcutMilestone[]>(shortcutToken, "GET", "milestones");
      }

      // Filter epics and iterations by the selected group
      const groupEpics = epics.filter((e) => e.group_ids.includes(selectedGroup.id));
      const groupIterations = iterations.filter((it) =>
        it.group_ids.includes(selectedGroup.id)
      );

      // Objectives are workspace-level (no group_ids on them).
      // Show only milestones explicitly referenced by at least one of this team's epics.
      const groupMilestoneIds = new Set(
        groupEpics.map((e) => e.milestone_id).filter((id): id is number => id !== null)
      );
      const groupMilestones = milestones.filter((m) => groupMilestoneIds.has(m.id));

      // Fetch stories by pulling from each epic directly.
      // This is more reliable than the search endpoint and matches the
      // Objectives → Epics → Stories hierarchy exactly.
      // Note: stories not linked to any epic won't appear here.
      const allStories: ShortcutStory[] = [];
      const seenIds = new Set<number>();
      const BATCH = 8;

      for (let i = 0; i < groupEpics.length; i += BATCH) {
        const batch = groupEpics.slice(i, i + BATCH);
        setLoadingMsg(
          `Fetching stories… (epic ${Math.min(i + BATCH, groupEpics.length)}/${groupEpics.length})`
        );
        const batchResults = await Promise.all(
          batch.map((epic) =>
            shortcutRequest<ShortcutStory[]>(shortcutToken, "GET", `epics/${epic.id}/stories`).catch(
              () => [] as ShortcutStory[]
            )
          )
        );
        for (const stories of batchResults) {
          for (const story of stories) {
            if (!seenIds.has(story.id)) {
              seenIds.add(story.id);
              allStories.push(story);
            }
          }
        }
      }

      setData({
        milestones: groupMilestones,
        epics: groupEpics,
        iterations: groupIterations,
        stories: allStories,
        members,
        workflows,
      });

      // Check Linear for already-migrated items — 3 batch queries, not per-item:
      //   1. ALL_PROJECTS_QUERY     — one call for all project names
      //   2. ALL_INITIATIVES_QUERY  — one call for all initiative names
      //   3. MIGRATED_ISSUES_QUERY  — paginated, filtered to issues WITH Shortcut attachments only
      {
        setLoadingMsg("Checking migration status…");

        // 1 & 2: projects + initiatives in parallel
        const [projResult, initResult] = await Promise.allSettled([
          linearRequest<{ projects: { nodes: Array<{ name: string }> } }>(
            linearToken, ALL_PROJECTS_QUERY
          ),
          linearRequest<{ initiatives: { nodes: Array<{ name: string }> } }>(
            linearToken, ALL_INITIATIVES_QUERY
          ),
        ]);
        if (projResult.status === "fulfilled") {
          setMigratedProjects(new Set(projResult.value.projects.nodes.map((p) => p.name.toLowerCase())));
        }
        if (initResult.status === "fulfilled") {
          setMigratedInitiatives(new Set(initResult.value.initiatives.nodes.map((i) => i.name.toLowerCase())));
        }

        // 3: paginated issues filtered to Shortcut backlinks (only migrated issues come back)
        try {
          const storyIds = new Set<number>();
          let cursor: string | undefined;
          let pages = 0;
          do {
            const issueData = await linearRequest<{
              issues: {
                nodes: Array<{ attachments: { nodes: Array<{ url: string }> } }>;
                pageInfo: { hasNextPage: boolean; endCursor: string };
              };
            }>(linearToken, MIGRATED_ISSUES_QUERY, cursor ? { cursor } : {});
            for (const issue of issueData.issues.nodes) {
              for (const att of issue.attachments.nodes) {
                const match = att.url.match(/app\.shortcut\.com\/[^/]+\/story\/(\d+)/);
                if (match) storyIds.add(parseInt(match[1], 10));
              }
            }
            cursor = issueData.issues.pageInfo.hasNextPage
              ? issueData.issues.pageInfo.endCursor
              : undefined;
            pages++;
          } while (cursor && pages < 10); // cap at 10 pages / 2500 issues
          setMigratedStoryIds(storyIds);
        } catch (err) {
          console.warn("[browse] Could not fetch migrated issues:", err);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load data.");
    } finally {
      setLoading(false);
    }
  }, [shortcutToken, linearToken, selectedGroup]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-3">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
        <span className="text-sm text-gray-500">{loadingMsg}</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-4">
        <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
        <button onClick={onBack} className="text-sm text-gray-500 hover:text-gray-700">
          ← Back
        </button>
      </div>
    );
  }

  if (!data) return null;

  const memberMap = Object.fromEntries(
    data.members.map((m) => [m.id, m.profile.name])
  );
  const stateMap = Object.fromEntries(
    data.workflows.flatMap((w) => w.states.map((s) => [s.id, s.name]))
  );

  // Compute story counts per epic from the locally fetched stories
  const epicStoryCount: Record<number, number> = {};
  for (const story of data.stories) {
    if (story.epic_id !== null) {
      epicStoryCount[story.epic_id] = (epicStoryCount[story.epic_id] ?? 0) + 1;
    }
  }

  // Filter stories
  const filteredStories = data.stories.filter((s) => {
    if (storyFilter === "all") return true;
    const stateName = stateMap[s.workflow_state_id]?.toLowerCase() ?? "";
    if (storyFilter === "done") return stateName.includes("done") || stateName.includes("complete");
    return !stateName.includes("done") && !stateName.includes("complete");
  });

  const filteredMilestones = data.milestones.filter((m) => {
    if (milestoneFilter === "all") return true;
    if (milestoneFilter === "done") return !isMilestoneOpen(m);
    return isMilestoneOpen(m);
  });

  const filteredEpics = data.epics.filter((e) => {
    if (epicFilter === "all") return true;
    if (epicFilter === "done") return !isEpicOpen(e);
    return isEpicOpen(e);
  });

  const filteredIterations = data.iterations.filter((it) => {
    if (iterationFilter === "all") return true;
    if (iterationFilter === "done") return !isIterationOpen(it);
    return isIterationOpen(it);
  });

  function toggle(set: Set<number>, setFn: (s: Set<number>) => void, id: number) {
    const next = new Set(set);
    next.has(id) ? next.delete(id) : next.add(id);
    setFn(next);
  }

  function selectAll(setFn: (s: Set<number>) => void, ids: number[]) {
    setFn(new Set(ids));
  }

  // Cascade: toggling a milestone selects/deselects its child epics and their stories
  function toggleMilestone(milestoneId: number) {
    if (!data) return;
    const checking = !selectedMilestoneIds.has(milestoneId);
    const childEpicIds = data.epics
      .filter((e) => e.milestone_id === milestoneId)
      .map((e) => e.id);
    const childStoryIds = data.stories
      .filter((s) => s.epic_id !== null && childEpicIds.includes(s.epic_id))
      .map((s) => s.id);

    setSelectedMilestoneIds((prev) => {
      const n = new Set(prev);
      checking ? n.add(milestoneId) : n.delete(milestoneId);
      return n;
    });
    setSelectedEpicIds((prev) => {
      const n = new Set(prev);
      childEpicIds.forEach((id) => (checking ? n.add(id) : n.delete(id)));
      return n;
    });
    setSelectedStoryIds((prev) => {
      const n = new Set(prev);
      childStoryIds.forEach((id) => (checking ? n.add(id) : n.delete(id)));
      return n;
    });
  }

  // Cascade: toggling an epic selects/deselects its child stories
  function toggleEpic(epicId: number) {
    if (!data) return;
    const checking = !selectedEpicIds.has(epicId);
    const childStoryIds = data.stories
      .filter((s) => s.epic_id === epicId)
      .map((s) => s.id);

    setSelectedEpicIds((prev) => {
      const n = new Set(prev);
      checking ? n.add(epicId) : n.delete(epicId);
      return n;
    });
    setSelectedStoryIds((prev) => {
      const n = new Set(prev);
      childStoryIds.forEach((id) => (checking ? n.add(id) : n.delete(id)));
      return n;
    });
  }

  const totalSelected =
    selectedMilestoneIds.size +
    selectedEpicIds.size +
    selectedIterationIds.size +
    selectedStoryIds.size;

  function handleNext() {
    if (!data) return;
    onNext(data, {
      milestoneIds: selectedMilestoneIds,
      epicIds: selectedEpicIds,
      iterationIds: selectedIterationIds,
      storyIds: selectedStoryIds,
    });
  }

  return (
    <div className="space-y-4">
      <div className="mb-2">
        <h2 className="text-2xl font-semibold text-gray-900">Browse &amp; select</h2>
        <p className="mt-1 text-sm text-gray-500">
          Team: <strong>{selectedGroup.name}</strong> — check everything you want to migrate.
        </p>
      </div>

      {/* Milestones */}
      <Section
        title="Milestones → Initiatives"
        items={filteredMilestones}
        selectedIds={selectedMilestoneIds}
        getId={(m) => m.id}
        getLabel={(m) => m.name}
        getSub={(m) => `${m.state}${m.description ? " · " + m.description.slice(0, 60) : ""}`}
        getBadge={(m) =>
          migratedInitiatives.has(m.name.toLowerCase()) ? (
            <span className="shrink-0 inline-flex items-center gap-1 rounded-full bg-green-50 border border-green-200 px-1.5 py-0.5 text-xs text-green-700 font-medium">
              ✓ in Linear
            </span>
          ) : undefined
        }
        filter={milestoneFilter}
        onFilter={setMilestoneFilter}
        onToggle={toggleMilestone}
        onSelectAll={(ids) => selectAll(setSelectedMilestoneIds, ids)}
      />

      {/* Epics */}
      <Section
        title="Epics → Projects"
        items={filteredEpics}
        selectedIds={selectedEpicIds}
        getId={(e) => e.id}
        getLabel={(e) => e.name}
        getSub={(e) => {
          const n = epicStoryCount[e.id] ?? 0;
          return `${e.state} · ${n} ${n === 1 ? "story" : "stories"}`;
        }}
        getBadge={(e) => {
          if (!migratedProjects.has(e.name.toLowerCase())) return undefined;
          return (
            <span className="shrink-0 inline-flex items-center gap-1 rounded-full bg-green-50 border border-green-200 px-1.5 py-0.5 text-xs text-green-700 font-medium">
              ✓ in Linear
            </span>
          );
        }}
        filter={epicFilter}
        onFilter={setEpicFilter}
        onToggle={toggleEpic}
        onSelectAll={(ids) => selectAll(setSelectedEpicIds, ids)}
      />

      {/* Iterations */}
      <Section
        title="Iterations → Cycles"
        items={filteredIterations}
        selectedIds={selectedIterationIds}
        getId={(it) => it.id}
        getLabel={(it) => it.name}
        getSub={(it) =>
          `${it.status} · ${it.start_date} → ${it.end_date}`
        }
        filter={iterationFilter}
        onFilter={setIterationFilter}
        onToggle={(id) => toggle(selectedIterationIds, setSelectedIterationIds, id)}
        onSelectAll={(ids) => selectAll(setSelectedIterationIds, ids)}
      />

      {/* Stories */}
      <div className="rounded-lg border border-gray-200 bg-white">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={
                filteredStories.length > 0 &&
                filteredStories.every((s) => selectedStoryIds.has(s.id))
              }
              ref={(el) => {
                if (el)
                  el.indeterminate =
                    filteredStories.some((s) => selectedStoryIds.has(s.id)) &&
                    !filteredStories.every((s) => selectedStoryIds.has(s.id));
              }}
              onChange={() => {
                const allChecked = filteredStories.every((s) => selectedStoryIds.has(s.id));
                selectAll(
                  setSelectedStoryIds,
                  allChecked ? [] : filteredStories.map((s) => s.id)
                );
              }}
              className="h-4 w-4 rounded border-gray-300 text-blue-600"
            />
            <span className="font-medium text-sm text-gray-900">Stories → Issues</span>
            <span className="text-xs text-gray-400">
              ({selectedStoryIds.size}/{data.stories.length})
            </span>
          </div>
          <div className="flex gap-1">
            {(["all", "open", "done"] as Filter[]).map((f) => (
              <button
                key={f}
                onClick={() => setStoryFilter(f)}
                className={`px-2 py-0.5 rounded text-xs font-medium ${
                  storyFilter === f
                    ? "bg-blue-100 text-blue-700"
                    : "text-gray-400 hover:text-gray-600"
                }`}
              >
                {f}
              </button>
            ))}
          </div>
        </div>
        <div className="max-h-72 overflow-y-auto">
          {filteredStories.length === 0 ? (
            <p className="px-4 py-3 text-sm text-gray-400">No stories found.</p>
          ) : (
            filteredStories.map((story) => (
              <label
                key={story.id}
                className="flex items-start gap-3 px-3 py-2 hover:bg-gray-50 border-b border-gray-50 cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={selectedStoryIds.has(story.id)}
                  onChange={() => toggle(selectedStoryIds, setSelectedStoryIds, story.id)}
                  className="mt-0.5 h-4 w-4 rounded border-gray-300 text-blue-600"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span
                      className={`shrink-0 rounded px-1.5 py-0.5 text-xs font-medium ${
                        story.story_type === "bug"
                          ? "bg-red-100 text-red-700"
                          : story.story_type === "chore"
                          ? "bg-gray-100 text-gray-600"
                          : "bg-green-100 text-green-700"
                      }`}
                    >
                      {story.story_type}
                    </span>
                    <span className="text-sm text-gray-900 truncate">{story.name}</span>
                  </div>
                  <div className="mt-0.5 flex items-center gap-2 text-xs text-gray-400 flex-wrap">
                    <span>#{story.id}</span>
                    <span>{stateMap[story.workflow_state_id] ?? "Unknown"}</span>
                    {story.owner_ids[0] && (
                      <span>{memberMap[story.owner_ids[0]] ?? "Unknown"}</span>
                    )}
                    {story.estimate != null && <span>{story.estimate} pts</span>}
                    {story.num_comments > 0 && (
                      <span>{story.num_comments} comments</span>
                    )}
                    {migratedStoryIds.has(story.id) && (
                      <span className="shrink-0 inline-flex items-center gap-1 rounded-full bg-green-50 border border-green-200 px-1.5 py-0.5 text-xs text-green-700 font-medium">
                        ✓ in Linear
                      </span>
                    )}
                  </div>
                </div>
              </label>
            ))
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="sticky bottom-0 bg-white border-t border-gray-200 -mx-6 px-6 py-4 flex items-center justify-between">
        <button onClick={onBack} className="text-sm text-gray-500 hover:text-gray-700">
          ← Back
        </button>
        <div className="flex items-center gap-4">
          <span className="text-sm text-gray-500">
            {totalSelected} item{totalSelected !== 1 ? "s" : ""} selected
          </span>
          <button
            onClick={handleNext}
            disabled={totalSelected === 0}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-40"
          >
            Configure mapping →
          </button>
        </div>
      </div>
    </div>
  );
}
