"use client";

import { useEffect, useState } from "react";
import { linearRequest } from "@/lib/api";
import { TEAMS_QUERY, USERS_QUERY } from "@/lib/linear";
import type { LinearTeam, LinearUser, LinearWorkflowState } from "@/lib/linear";
import type { BrowseData, Selection } from "./BrowseStep";

export interface MappingConfig {
  linearTeamId: string;
  // Shortcut workflow state id (string) → Linear workflow state id
  stateMap: Record<string, string>;
  // Shortcut member id → Linear user id (empty string = unassigned)
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

function autoMatchState(
  scStateName: string,
  linearStates: LinearWorkflowState[]
): string {
  const name = scStateName.toLowerCase();
  const exact = linearStates.find((s) => s.name.toLowerCase() === name);
  if (exact) return exact.id;
  if (name.includes("done") || name.includes("complete") || name.includes("delivered")) {
    const done = linearStates.find((s) => s.type === "completed");
    if (done) return done.id;
  }
  if (name.includes("cancel") || name.includes("won't")) {
    const cancelled = linearStates.find((s) => s.type === "cancelled");
    if (cancelled) return cancelled.id;
  }
  if (name.includes("progress") || name.includes("development") || name.includes("review")) {
    const started = linearStates.find((s) => s.type === "started");
    if (started) return started.id;
  }
  const backlog = linearStates.find((s) => s.type === "backlog" || s.type === "unstarted");
  return backlog?.id ?? linearStates[0]?.id ?? "";
}

const selectCls =
  "w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500";

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
        setLinearData({
          teams: teamsData.teams.nodes,
          users: usersData.users.nodes,
        });
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [linearToken]);

  // Auto-initialise mappings when team is selected
  useEffect(() => {
    if (!linearData || !targetTeamId) return;
    const team = linearData.teams.find((t) => t.id === targetTeamId);
    if (!team) return;

    const linearStates = team.states.nodes;

    const usedStateIds = new Set<number>(
      browseData.stories
        .filter((s) => selection.storyIds.has(s.id))
        .map((s) => s.workflow_state_id)
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
      browseData.stories
        .filter((s) => selection.storyIds.has(s.id))
        .flatMap((s) => s.owner_ids)
    );
    const initialMemberMap: Record<string, string> = {};
    for (const memberId of usedMemberIds) {
      const member = browseData.members.find((m) => m.id === memberId);
      const email = member?.profile.email_address?.toLowerCase() ?? "";
      const fullName = member?.profile.name?.toLowerCase() ?? "";

      // Email is unique — match on that first. Fall back to exact full name only.
      // No fuzzy / partial matching to avoid mis-assigning similar names.
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
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
        <span className="ml-3 text-sm text-gray-500">Loading Linear workspace…</span>
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

  if (!linearData) return null;

  const team = linearData.teams.find((t) => t.id === targetTeamId);
  const linearStates = team?.states.nodes ?? [];

  const usedStateIds = new Set<number>(
    browseData.stories
      .filter((s) => selection.storyIds.has(s.id))
      .map((s) => s.workflow_state_id)
  );
  const usedStates = browseData.workflows
    .flatMap((w) => w.states)
    .filter((s) => usedStateIds.has(s.id));
  const uniqueStates = Array.from(new Map(usedStates.map((s) => [s.id, s])).values());

  const usedMemberIds = new Set<string>(
    browseData.stories
      .filter((s) => selection.storyIds.has(s.id))
      .flatMap((s) => s.owner_ids)
  );
  const usedMembers = browseData.members.filter(
    (m) => usedMemberIds.has(m.id) && !m.disabled
  );

  function handleNext() {
    if (!linearData || !targetTeamId) return;
    onNext({ linearTeamId: targetTeamId, stateMap, memberMap }, linearData);
  }

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-2xl font-semibold text-gray-900">Configure mapping</h2>
        <p className="mt-1 text-sm text-gray-500">
          Choose the target Linear team and map Shortcut concepts to Linear equivalents.
        </p>
      </div>

      {/* Target team */}
      <div className="space-y-2">
        <label className="block text-sm font-semibold text-gray-700">
          Target Linear team
        </label>
        <select
          value={targetTeamId}
          onChange={(e) => setTargetTeamId(e.target.value)}
          className={selectCls}
        >
          <option value="">— select a team —</option>
          {linearData.teams.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name} ({t.key})
            </option>
          ))}
        </select>
      </div>

      {targetTeamId && (
        <>
          {/* State mapping */}
          {uniqueStates.length > 0 && (
            <div className="space-y-2">
              <div className="mb-3">
                <h3 className="text-sm font-semibold text-gray-700">Workflow state mapping</h3>
                <p className="text-xs text-gray-500 mt-0.5">
                  Map each Shortcut workflow state to the equivalent Linear status.
                </p>
              </div>

              {/* Column headers */}
              <div className="grid grid-cols-2 gap-4 px-3 mb-1">
                <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                  Shortcut state
                </span>
                <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                  Linear status
                </span>
              </div>

              <div className="rounded-lg border border-gray-200 divide-y divide-gray-100">
                {uniqueStates.map((state) => (
                  <div key={state.id} className="grid grid-cols-2 gap-4 items-center px-3 py-3">
                    <span className="text-sm text-gray-800 font-medium">{state.name}</span>
                    <select
                      value={stateMap[String(state.id)] ?? ""}
                      onChange={(e) =>
                        setStateMap((prev) => ({
                          ...prev,
                          [String(state.id)]: e.target.value,
                        }))
                      }
                      className={selectCls}
                    >
                      <option value="">— pick a status —</option>
                      {linearStates.map((ls) => (
                        <option key={ls.id} value={ls.id}>
                          {ls.name}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Member mapping */}
          {usedMembers.length > 0 && (
            <div className="space-y-2">
              <div className="mb-3">
                <h3 className="text-sm font-semibold text-gray-700">Member mapping</h3>
                <p className="text-xs text-gray-500 mt-0.5">
                  Map Shortcut members to their Linear counterparts.
                </p>
              </div>

              {/* Column headers */}
              <div className="grid grid-cols-2 gap-4 px-3 mb-1">
                <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                  Shortcut member
                </span>
                <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                  Linear user
                </span>
              </div>

              <div className="rounded-lg border border-gray-200 divide-y divide-gray-100">
                {usedMembers.map((member) => (
                  <div key={member.id} className="grid grid-cols-2 gap-4 items-center px-3 py-3">
                    <div>
                      <span className="text-sm text-gray-800 font-medium">
                        {member.profile.name}
                      </span>
                      <span className="ml-2 text-xs text-gray-400">
                        @{member.profile.mention_name}
                      </span>
                    </div>
                    <select
                      value={memberMap[member.id] ?? ""}
                      onChange={(e) =>
                        setMemberMap((prev) => ({
                          ...prev,
                          [member.id]: e.target.value,
                        }))
                      }
                      className={selectCls}
                    >
                      <option value="">— unassigned —</option>
                      {linearData.users.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.name} ({u.email})
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      <div className="flex items-center justify-between pt-2">
        <button onClick={onBack} className="text-sm text-gray-500 hover:text-gray-700">
          ← Back
        </button>
        <button
          onClick={handleNext}
          disabled={!targetTeamId}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-40"
        >
          Preview migration →
        </button>
      </div>
    </div>
  );
}
