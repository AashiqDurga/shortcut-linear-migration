"use client";

import { useEffect, useState, useCallback, type ReactNode } from "react";
import { shortcutRequest, linearRequest } from "@/lib/api";
import { ALL_PROJECTS_QUERY, ALL_INITIATIVES_QUERY, MIGRATED_ISSUES_QUERY } from "@/lib/linear";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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

const MigratedBadge = () => (
  <Badge variant="outline" className="shrink-0 border-green-200 bg-green-50 text-green-700 text-xs font-medium">
    ✓ in Linear
  </Badge>
);

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
    <div className="flex items-start gap-3 px-3 py-2.5 hover:bg-accent rounded cursor-pointer">
      <Checkbox
        checked={indeterminate ? "indeterminate" : checked}
        onCheckedChange={() => onChange()}
        className="mt-0.5"
      />
      <div className="min-w-0 flex-1" onClick={() => onChange()}>
        <div className="text-sm truncate">{label}</div>
        {(sub || badge) && (
          <div className="flex items-center gap-2 flex-wrap mt-0.5">
            {sub && <span className="text-xs text-muted-foreground truncate">{sub}</span>}
            {badge}
          </div>
        )}
      </div>
    </div>
  );
}

function FilterBar({ filter, onFilter }: { filter: Filter; onFilter: (f: Filter) => void }) {
  return (
    <div className="flex gap-1">
      {(["all", "open", "done"] as Filter[]).map((f) => (
        <button
          key={f}
          onClick={() => onFilter(f)}
          className={`px-2 py-0.5 rounded text-xs font-medium transition-colors ${
            filter === f ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {f}
        </button>
      ))}
    </div>
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
      ? !selectedIds.has(getId(item))
      : selectedIds.has(getId(item));
  });

  const allFilteredIds = filtered.map(getId);
  const allChecked = allFilteredIds.length > 0 && allFilteredIds.every((id) => selectedIds.has(id));
  const someChecked = allFilteredIds.some((id) => selectedIds.has(id));

  return (
    <div className="rounded-lg border bg-card">
      <div className="flex items-center justify-between px-4 py-3 border-b">
        <div className="flex items-center gap-2">
          <Checkbox
            checked={allChecked ? true : someChecked ? "indeterminate" : false}
            onCheckedChange={() =>
              allChecked ? onSelectAll([]) : onSelectAll(allFilteredIds)
            }
          />
          <span className="font-medium text-sm">{title}</span>
          <span className="text-xs text-muted-foreground">
            ({selectedIds.size}/{items.length})
          </span>
        </div>
        <FilterBar filter={filter} onFilter={onFilter} />
      </div>
      <div className="max-h-56 overflow-y-auto divide-y divide-border/50">
        {filtered.length === 0 ? (
          <p className="px-4 py-3 text-sm text-muted-foreground">Nothing to show.</p>
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

  const [selectedMilestoneIds, setSelectedMilestoneIds] = useState<Set<number>>(new Set());
  const [selectedEpicIds, setSelectedEpicIds] = useState<Set<number>>(new Set());
  const [selectedIterationIds, setSelectedIterationIds] = useState<Set<number>>(new Set());
  const [selectedStoryIds, setSelectedStoryIds] = useState<Set<number>>(new Set());

  const [milestoneFilter, setMilestoneFilter] = useState<Filter>("all");
  const [epicFilter, setEpicFilter] = useState<Filter>("all");
  const [iterationFilter, setIterationFilter] = useState<Filter>("all");
  const [storyFilter, setStoryFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");

  // Sets of already-migrated names/IDs — populated by querying Linear in the background
  const [migratedProjects, setMigratedProjects] = useState<Set<string>>(new Set());
  const [migratedInitiatives, setMigratedInitiatives] = useState<Set<string>>(new Set());
  const [migratedStoryIds, setMigratedStoryIds] = useState<Set<number>>(new Set());

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

      let milestones: ShortcutMilestone[] = [];
      try {
        milestones = await shortcutRequest<ShortcutMilestone[]>(shortcutToken, "GET", "objectives");
      } catch {
        milestones = await shortcutRequest<ShortcutMilestone[]>(shortcutToken, "GET", "milestones");
      }

      const groupEpics = epics.filter((e) => e.group_ids.includes(selectedGroup.id));
      const groupIterations = iterations.filter((it) => it.group_ids.includes(selectedGroup.id));

      const groupMilestoneIds = new Set(
        groupEpics.map((e) => e.milestone_id).filter((id): id is number => id !== null)
      );
      const groupMilestones = milestones.filter((m) => groupMilestoneIds.has(m.id));

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
            if (!seenIds.has(story.id) && !story.archived) {
              seenIds.add(story.id);
              allStories.push(story);
            }
          }
        }
      }

      setData({ milestones: groupMilestones, epics: groupEpics, iterations: groupIterations, stories: allStories, members, workflows });

      // Check Linear for already-migrated items — 3 batch queries, not per-item:
      //   1. ALL_PROJECTS_QUERY     — one call for all project names
      //   2. ALL_INITIATIVES_QUERY  — one call for all initiative names
      //   3. MIGRATED_ISSUES_QUERY  — paginated, filtered to issues WITH Shortcut attachments only
      {
        setLoadingMsg("Checking migration status…");

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
          } while (cursor && pages < 10);
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
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        <span className="text-sm text-muted-foreground">{loadingMsg}</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-4">
        <div className="rounded-lg bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
        <Button variant="ghost" size="sm" onClick={onBack}>← Back</Button>
      </div>
    );
  }

  if (!data) return null;

  const memberMap = Object.fromEntries(data.members.map((m) => [m.id, m.profile.name]));
  const stateMap = Object.fromEntries(
    data.workflows.flatMap((w) => w.states.map((s) => [s.id, s.name]))
  );

  const epicStoryCount: Record<number, number> = {};
  for (const story of data.stories) {
    if (story.epic_id !== null) {
      epicStoryCount[story.epic_id] = (epicStoryCount[story.epic_id] ?? 0) + 1;
    }
  }

  const q = search.toLowerCase();

  const filteredStories = data.stories.filter((s) => {
    if (q && !s.name.toLowerCase().includes(q) && !String(s.id).includes(q)) return false;
    if (storyFilter === "all") return true;
    const stateName = stateMap[s.workflow_state_id]?.toLowerCase() ?? "";
    if (storyFilter === "done") return stateName.includes("done") || stateName.includes("complete");
    return !stateName.includes("done") && !stateName.includes("complete");
  });

  const filteredMilestones = data.milestones.filter((m) => {
    if (q && !m.name.toLowerCase().includes(q)) return false;
    if (milestoneFilter === "all") return true;
    if (milestoneFilter === "done") return !isMilestoneOpen(m);
    return isMilestoneOpen(m);
  });

  const filteredEpics = data.epics.filter((e) => {
    if (q && !e.name.toLowerCase().includes(q)) return false;
    if (epicFilter === "all") return true;
    if (epicFilter === "done") return !isEpicOpen(e);
    return isEpicOpen(e);
  });

  const filteredIterations = data.iterations.filter((it) => {
    if (q && !it.name.toLowerCase().includes(q)) return false;
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

  function toggleMilestone(milestoneId: number) {
    if (!data) return;
    const checking = !selectedMilestoneIds.has(milestoneId);
    const childEpicIds = data.epics.filter((e) => e.milestone_id === milestoneId).map((e) => e.id);
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

  function toggleEpic(epicId: number) {
    if (!data) return;
    const checking = !selectedEpicIds.has(epicId);
    const childStoryIds = data.stories.filter((s) => s.epic_id === epicId).map((s) => s.id);
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
    selectedMilestoneIds.size + selectedEpicIds.size + selectedIterationIds.size + selectedStoryIds.size;

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
        <h2 className="text-2xl font-semibold">Browse &amp; select</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Team: <strong>{selectedGroup.name}</strong> — check everything you want to migrate.
        </p>
      </div>

      <Input
        placeholder="Search milestones, epics, iterations, stories…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      <Section
        title="Milestones → Initiatives"
        items={filteredMilestones}
        selectedIds={selectedMilestoneIds}
        getId={(m) => m.id}
        getLabel={(m) => m.name}
        getSub={(m) => `${m.state}${m.description ? " · " + m.description.slice(0, 60) : ""}`}
        getBadge={(m) => migratedInitiatives.has(m.name.toLowerCase()) ? <MigratedBadge /> : undefined}
        filter={milestoneFilter}
        onFilter={setMilestoneFilter}
        onToggle={toggleMilestone}
        onSelectAll={(ids) => selectAll(setSelectedMilestoneIds, ids)}
      />

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
        getBadge={(e) => migratedProjects.has(e.name.toLowerCase()) ? <MigratedBadge /> : undefined}
        filter={epicFilter}
        onFilter={setEpicFilter}
        onToggle={toggleEpic}
        onSelectAll={(ids) => selectAll(setSelectedEpicIds, ids)}
      />

      <Section
        title="Iterations → Cycles"
        items={filteredIterations}
        selectedIds={selectedIterationIds}
        getId={(it) => it.id}
        getLabel={(it) => it.name}
        getSub={(it) => `${it.status} · ${it.start_date} → ${it.end_date}`}
        filter={iterationFilter}
        onFilter={setIterationFilter}
        onToggle={(id) => toggle(selectedIterationIds, setSelectedIterationIds, id)}
        onSelectAll={(ids) => selectAll(setSelectedIterationIds, ids)}
      />

      {/* Stories */}
      <div className="rounded-lg border bg-card">
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <div className="flex items-center gap-2">
            <Checkbox
              checked={
                filteredStories.length > 0 && filteredStories.every((s) => selectedStoryIds.has(s.id))
                  ? true
                  : filteredStories.some((s) => selectedStoryIds.has(s.id))
                  ? "indeterminate"
                  : false
              }
              onCheckedChange={() => {
                const allChecked = filteredStories.every((s) => selectedStoryIds.has(s.id));
                selectAll(setSelectedStoryIds, allChecked ? [] : filteredStories.map((s) => s.id));
              }}
            />
            <span className="font-medium text-sm">Stories → Issues</span>
            <span className="text-xs text-muted-foreground">
              ({selectedStoryIds.size}/{data.stories.length})
            </span>
          </div>
          <FilterBar filter={storyFilter} onFilter={setStoryFilter} />
        </div>
        <div className="max-h-72 overflow-y-auto">
          {filteredStories.length === 0 ? (
            <p className="px-4 py-3 text-sm text-muted-foreground">No stories found.</p>
          ) : (
            filteredStories.map((story) => (
              <div
                key={story.id}
                className="flex items-start gap-3 px-3 py-2.5 hover:bg-accent border-b border-border/50 cursor-pointer"
              >
                <Checkbox
                  checked={selectedStoryIds.has(story.id)}
                  onCheckedChange={() => toggle(selectedStoryIds, setSelectedStoryIds, story.id)}
                  className="mt-0.5"
                />
                <div
                  className="min-w-0 flex-1"
                  onClick={() => toggle(selectedStoryIds, setSelectedStoryIds, story.id)}
                >
                  <div className="flex items-center gap-2">
                    <Badge
                      variant="secondary"
                      className={
                        story.story_type === "bug"
                          ? "bg-red-100 text-red-700 border-0 text-xs"
                          : story.story_type === "chore"
                          ? "bg-gray-100 text-gray-600 border-0 text-xs"
                          : "bg-green-100 text-green-700 border-0 text-xs"
                      }
                    >
                      {story.story_type}
                    </Badge>
                    <span className="text-sm truncate">{story.name}</span>
                  </div>
                  <div className="mt-0.5 flex items-center gap-2 flex-wrap">
                    <span className="text-xs text-muted-foreground">#{story.id}</span>
                    <span className="text-xs text-muted-foreground">{stateMap[story.workflow_state_id] ?? "Unknown"}</span>
                    {story.owner_ids[0] && (
                      <span className="text-xs text-muted-foreground">{memberMap[story.owner_ids[0]] ?? "Unknown"}</span>
                    )}
                    {story.estimate != null && (
                      <span className="text-xs text-muted-foreground">{story.estimate} pts</span>
                    )}
                    {story.num_comments > 0 && (
                      <span className="text-xs text-muted-foreground">{story.num_comments} comments</span>
                    )}
                    {migratedStoryIds.has(story.id) && <MigratedBadge />}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="sticky bottom-0 bg-background border-t -mx-6 px-6 py-4 flex items-center justify-between">
        <Button variant="ghost" size="sm" onClick={onBack}>← Back</Button>
        <div className="flex items-center gap-4">
          <span className="text-sm text-muted-foreground">
            {totalSelected} item{totalSelected !== 1 ? "s" : ""} selected
          </span>
          <Button onClick={handleNext} disabled={totalSelected === 0}>
            Configure mapping →
          </Button>
        </div>
      </div>
    </div>
  );
}
