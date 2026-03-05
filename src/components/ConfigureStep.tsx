"use client";

import { useEffect, useState } from "react";
import { linearRequest } from "@/lib/api";
import { TEAMS_QUERY, USERS_QUERY } from "@/lib/linear";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { LinearTeam, LinearUser, LinearWorkflowState } from "@/lib/linear";
import type { BrowseData, Selection } from "./BrowseStep";

export interface MappingConfig {
  linearTeamId: string;
  stateMap: Record<string, string>;
  memberMap: Record<string, string>;
}

export interface LinearData {
  teams: LinearTeam[];
  users: LinearUser[];
}

interface Props {
  linearToken: string;
  browseData: BrowseData;
  selection: Selection;
  onNext: (mapping: MappingConfig, linearData: LinearData) => void;
  onBack: () => void;
}

// Sentinel used in shadcn Select since Radix doesn't support value=""
const NONE = "__none__";

function toSelectValue(id: string) {
  return id || NONE;
}
function fromSelectValue(val: string) {
  return val === NONE ? "" : val;
}

function normalize(s: string) {
  return s.toLowerCase().replace(/[-_\s]+/g, " ").trim();
}

function autoMatchState(scStateName: string, linearStates: LinearWorkflowState[]): string {
  const name = normalize(scStateName);
  // Exact normalized match (handles "To-Do" ↔ "Todo", "In Progress" ↔ "in-progress", etc.)
  const exact = linearStates.find((s) => normalize(s.name) === name);
  if (exact) return exact.id;
  if (name.includes("done") || name.includes("complete") || name.includes("delivered")) {
    const done = linearStates.find((s) => s.type === "completed");
    if (done) return done.id;
  }
  if (name.includes("cancel") || name.includes("won't")) {
    const cancelled = linearStates.find((s) => s.type === "cancelled");
    if (cancelled) return cancelled.id;
  }
  if (name.includes("progress") || name.includes("development")) {
    const started = linearStates.find((s) => s.type === "started");
    if (started) return started.id;
  }
  if (name.includes("review")) {
    const review = linearStates.find((s) => s.type === "started" && s.name.toLowerCase().includes("review"))
      ?? linearStates.find((s) => s.type === "started");
    if (review) return review.id;
  }
  // Inbox → triage state (Linear's inbox equivalent) or backlog
  if (name === "inbox" || name.includes("inbox")) {
    const triage = linearStates.find((s) => s.type === "triage");
    if (triage) return triage.id;
    const backlog = linearStates.find((s) => s.type === "backlog");
    if (backlog) return backlog.id;
  }
  // To-Do / Planned → unstarted (not backlog)
  if (name === "to-do" || name === "todo" || name.includes("planned") || name.includes("ready")) {
    const unstarted = linearStates.find((s) => s.type === "unstarted");
    if (unstarted) return unstarted.id;
  }
  const backlog = linearStates.find((s) => s.type === "backlog") ?? linearStates.find((s) => s.type === "unstarted");
  return backlog?.id ?? linearStates[0]?.id ?? "";
}

export default function ConfigureStep({
  linearToken,
  browseData,
  selection,
  onNext,
  onBack,
}: Props) {
  const [linearData, setLinearData] = useState<LinearData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [targetTeamId, setTargetTeamId] = useState("");
  const [stateMap, setStateMap] = useState<Record<string, string>>({});
  const [memberMap, setMemberMap] = useState<Record<string, string>>({});

  useEffect(() => {
    Promise.all([
      linearRequest<{ teams: { nodes: LinearTeam[] } }>(linearToken, TEAMS_QUERY),
      linearRequest<{ users: { nodes: LinearUser[] } }>(linearToken, USERS_QUERY),
    ])
      .then(([teamsData, usersData]) => {
        setLinearData({ teams: teamsData.teams.nodes, users: usersData.users.nodes });
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [linearToken]);

  useEffect(() => {
    if (!linearData || !targetTeamId) return;
    const team = linearData.teams.find((t) => t.id === targetTeamId);
    if (!team) return;

    const linearStates = team.states.nodes;
    const usedStateIds = new Set<number>(
      browseData.stories.filter((s) => selection.storyIds.has(s.id)).map((s) => s.workflow_state_id)
    );

    const initialStateMap: Record<string, string> = {};
    for (const workflow of browseData.workflows) {
      for (const state of workflow.states) {
        if (usedStateIds.has(state.id)) {
          initialStateMap[String(state.id)] = autoMatchState(state.name, linearStates);
        }
      }
    }
    setStateMap(initialStateMap);

    const usedMemberIds = new Set<string>(
      browseData.stories.filter((s) => selection.storyIds.has(s.id)).flatMap((s) => s.owner_ids)
    );
    const initialMemberMap: Record<string, string> = {};
    for (const memberId of usedMemberIds) {
      const member = browseData.members.find((m) => m.id === memberId);
      const email = member?.profile.email_address?.toLowerCase() ?? "";
      const fullName = member?.profile.name?.toLowerCase() ?? "";
      const match =
        (email && linearData.users.find((u) => u.email.toLowerCase() === email)) ||
        (fullName && linearData.users.find((u) => u.name.toLowerCase() === fullName)) ||
        null;
      initialMemberMap[memberId] = match ? match.id : "";
    }
    setMemberMap(initialMemberMap);
  }, [targetTeamId, linearData, browseData, selection]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        <span className="ml-3 text-sm text-muted-foreground">Loading Linear workspace…</span>
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

  if (!linearData) return null;

  const team = linearData.teams.find((t) => t.id === targetTeamId);
  const linearStates = team?.states.nodes ?? [];

  const usedStateIds = new Set<number>(
    browseData.stories.filter((s) => selection.storyIds.has(s.id)).map((s) => s.workflow_state_id)
  );
  const usedStates = browseData.workflows.flatMap((w) => w.states).filter((s) => usedStateIds.has(s.id));
  const uniqueStates = Array.from(new Map(usedStates.map((s) => [s.id, s])).values());

  const usedMemberIds = new Set<string>(
    browseData.stories.filter((s) => selection.storyIds.has(s.id)).flatMap((s) => s.owner_ids)
  );
  const usedMembers = browseData.members.filter((m) => usedMemberIds.has(m.id) && !m.disabled);

  function handleNext() {
    if (!linearData || !targetTeamId) return;
    onNext({ linearTeamId: targetTeamId, stateMap, memberMap }, linearData);
  }

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-2xl font-semibold">Configure mapping</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Choose the target Linear team and map Shortcut concepts to Linear equivalents.
        </p>
      </div>

      {/* Target team */}
      <div className="space-y-2">
        <label className="block text-sm font-semibold">Target Linear team</label>
        <Select value={toSelectValue(targetTeamId)} onValueChange={(v) => setTargetTeamId(fromSelectValue(v))}>
          <SelectTrigger className="w-full">
            <SelectValue placeholder="— select a team —" />
          </SelectTrigger>
          <SelectContent>
            {linearData.teams.map((t) => (
              <SelectItem key={t.id} value={t.id}>
                {t.name} ({t.key})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {targetTeamId && (
        <>
          {/* State mapping */}
          {uniqueStates.length > 0 && (
            <div className="space-y-2">
              <div className="mb-3">
                <h3 className="text-sm font-semibold">Workflow state mapping</h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Map each Shortcut workflow state to the equivalent Linear status.
                </p>
              </div>
              <div className="grid grid-cols-2 gap-4 px-3 mb-1">
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Shortcut state</span>
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Linear status</span>
              </div>
              <div className="rounded-lg border divide-y">
                {uniqueStates.map((state) => (
                  <div key={state.id} className="grid grid-cols-2 gap-4 items-center px-3 py-3">
                    <span className="text-sm font-medium">{state.name}</span>
                    <Select
                      value={toSelectValue(stateMap[String(state.id)] ?? "")}
                      onValueChange={(v) =>
                        setStateMap((prev) => ({ ...prev, [String(state.id)]: fromSelectValue(v) }))
                      }
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="— pick a status —" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NONE}>— pick a status —</SelectItem>
                        {linearStates.map((ls) => (
                          <SelectItem key={ls.id} value={ls.id}>
                            {ls.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Member mapping */}
          {usedMembers.length > 0 && (
            <div className="space-y-2">
              <div className="mb-3">
                <h3 className="text-sm font-semibold">Member mapping</h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Map Shortcut members to their Linear counterparts.
                </p>
              </div>
              <div className="grid grid-cols-2 gap-4 px-3 mb-1">
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Shortcut member</span>
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Linear user</span>
              </div>
              <div className="rounded-lg border divide-y">
                {usedMembers.map((member) => (
                  <div key={member.id} className="grid grid-cols-2 gap-4 items-center px-3 py-3">
                    <div>
                      <span className="text-sm font-medium">{member.profile.name}</span>
                      <span className="ml-2 text-xs text-muted-foreground">
                        @{member.profile.mention_name}
                      </span>
                    </div>
                    <Select
                      value={toSelectValue(memberMap[member.id] ?? "")}
                      onValueChange={(v) =>
                        setMemberMap((prev) => ({ ...prev, [member.id]: fromSelectValue(v) }))
                      }
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="— unassigned —" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NONE}>— unassigned —</SelectItem>
                        {linearData.users.map((u) => (
                          <SelectItem key={u.id} value={u.id}>
                            {u.name} ({u.email})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      <div className="flex items-center justify-between pt-2">
        <Button variant="ghost" size="sm" onClick={onBack}>← Back</Button>
        <Button onClick={handleNext} disabled={!targetTeamId}>
          Preview migration →
        </Button>
      </div>
    </div>
  );
}
