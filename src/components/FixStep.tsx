"use client";

import { useEffect, useRef, useState } from "react";
import { shortcutRequest, linearRequest, delay, withRetry } from "@/lib/api";
import {
  TEAMS_QUERY,
  ISSUE_WITH_STATE_BY_URL_QUERY,
  UPDATE_ISSUE_MUTATION,
  type LinearTeam,
  type LinearIssueWithState,
} from "@/lib/linear";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type {
  ShortcutEpic,
  ShortcutGroup,
  ShortcutStory,
  ShortcutWorkflow,
  ShortcutSearchResult,
} from "@/lib/shortcut";

type Mode = "recent" | "archived";
type Phase = "configure" | "scanning" | "review" | "updating" | "done";

interface FoundIssue {
  story: ShortcutStory;
  shortcutStateName: string;
  shortcutStateType: "unstarted" | "started" | "done";
  linearId: string | null;
  linearIdentifier: string | null;
  linearUrl: string | null;
  currentStateName: string | null;
  currentStateType: string | null;
  // archived mode
  alreadyCancelled: boolean;
  // recent mode
  proposedStateId: string | null;
  proposedStateName: string | null;
}

interface UpdateResult {
  storyId: number;
  storyName: string;
  linearIdentifier: string;
  linearUrl: string;
  status: "updated" | "skipped" | "not-found" | "error";
  error?: string;
}

interface Props {
  shortcutToken: string;
  linearToken: string;
  selectedGroup: ShortcutGroup;
  onBack: () => void;
  onStartOver: () => void;
}

export default function FixStep({
  shortcutToken,
  linearToken,
  selectedGroup,
  onBack,
  onStartOver,
}: Props) {
  const [phase, setPhase] = useState<Phase>("configure");
  const [mode, setMode] = useState<Mode>("recent");
  const [linearTeams, setLinearTeams] = useState<LinearTeam[]>([]);
  const [loadingTeams, setLoadingTeams] = useState(true);
  const [teamsError, setTeamsError] = useState("");
  const [targetTeamId, setTargetTeamId] = useState("");

  const [scanLog, setScanLog] = useState<string[]>([]);
  const [foundIssues, setFoundIssues] = useState<FoundIssue[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

  const [updateLog, setUpdateLog] = useState<string[]>([]);
  const [updateResults, setUpdateResults] = useState<UpdateResult[]>([]);

  const scanLogRef = useRef<HTMLDivElement>(null);
  const updateLogRef = useRef<HTMLDivElement>(null);
  const ranRef = useRef(false);

  useEffect(() => {
    linearRequest<{ teams: { nodes: LinearTeam[] } }>(linearToken, TEAMS_QUERY)
      .then((d) => setLinearTeams(d.teams.nodes))
      .catch((e) => setTeamsError(e.message))
      .finally(() => setLoadingTeams(false));
  }, [linearToken]);

  function addScanLog(msg: string) {
    setScanLog((prev) => [...prev, msg]);
    setTimeout(() => scanLogRef.current?.scrollTo({ top: scanLogRef.current.scrollHeight, behavior: "smooth" }), 50);
  }
  function addUpdateLog(msg: string) {
    setUpdateLog((prev) => [...prev, msg]);
    setTimeout(() => updateLogRef.current?.scrollTo({ top: updateLogRef.current.scrollHeight, behavior: "smooth" }), 50);
  }

  async function runScan() {
    if (ranRef.current) return;
    ranRef.current = true;
    setPhase("scanning");
    setScanLog([]);
    setFoundIssues([]);
    setSelectedIds(new Set());

    try {
      addScanLog("Fetching workspace info…");
      let workspaceSlug = "";
      try {
        const me = await shortcutRequest<{ workspace2: { url_slug: string } }>(shortcutToken, "GET", "member");
        workspaceSlug = me.workspace2?.url_slug ?? "";
      } catch {
        addScanLog("⚠ Could not fetch workspace slug — Linear lookups will be skipped.");
      }

      const team = linearTeams.find((t) => t.id === targetTeamId);
      const stories: ShortcutStory[] = [];

      if (mode === "archived") {
        addScanLog("Fetching epics…");
        const allEpics = await shortcutRequest<ShortcutEpic[]>(shortcutToken, "GET", "epics");
        const groupEpics = allEpics.filter((e) => e.group_ids.includes(selectedGroup.id));
        addScanLog(`Found ${groupEpics.length} epics. Fetching stories…`);

        const seenIds = new Set<number>();
        const BATCH = 8;
        for (let i = 0; i < groupEpics.length; i += BATCH) {
          const batch = groupEpics.slice(i, i + BATCH);
          addScanLog(`  Scanning epic batch ${Math.min(i + BATCH, groupEpics.length)}/${groupEpics.length}…`);
          const batchResults = await Promise.all(
            batch.map((epic) =>
              shortcutRequest<ShortcutStory[]>(shortcutToken, "GET", `epics/${epic.id}/stories`).catch(() => [] as ShortcutStory[])
            )
          );
          for (const storyList of batchResults) {
            for (const story of storyList) {
              if (!seenIds.has(story.id) && story.archived) {
                seenIds.add(story.id);
                stories.push(story);
              }
            }
          }
        }
        addScanLog(`Found ${stories.length} archived stories.`);
      } else {
        const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
        const dateStr = oneDayAgo.toISOString().split("T")[0];
        addScanLog(`Searching for stories updated since ${dateStr}…`);

        let next: string | null = null;
        let page = 0;
        do {
          const body: Record<string, unknown> = {
            query: `group:${selectedGroup.mention_name} updated:>${dateStr}`,
            page_size: 25,
          };
          if (next) body.next = next;
          const result = await shortcutRequest<ShortcutSearchResult>(shortcutToken, "POST", "search/stories", { body });
          for (const story of result.data) {
            if (!story.archived) stories.push(story);
          }
          next = result.next;
          page++;
        } while (next && page < 20);
        addScanLog(`Found ${stories.length} recently updated stories.`);
      }

      if (stories.length === 0) {
        setFoundIssues([]);
        setPhase("review");
        return;
      }

      if (!workspaceSlug) {
        addScanLog("⚠ No workspace slug — cannot look up Linear issues.");
        setFoundIssues([]);
        setPhase("review");
        return;
      }

      // Build state type map for recent mode
      const stateTypeMap = new Map<number, { name: string; type: "unstarted" | "started" | "done" }>();
      if (mode === "recent") {
        try {
          const workflows = await shortcutRequest<ShortcutWorkflow[]>(shortcutToken, "GET", "workflows");
          for (const wf of workflows) {
            for (const state of wf.states) {
              stateTypeMap.set(state.id, { name: state.name, type: state.type });
            }
          }
        } catch {
          addScanLog("⚠ Could not fetch workflows — state mapping may be incomplete.");
        }
      }

      const cancelledState = team?.states.nodes.find((s) => s.type === "cancelled");

      addScanLog("Looking up Linear issues…");
      const found: FoundIssue[] = [];

      for (const story of stories) {
        const shortcutUrl = `https://app.shortcut.com/${workspaceSlug}/story/${story.id}`;
        const stateInfo = stateTypeMap.get(story.workflow_state_id);

        let proposedStateId: string | null = null;
        let proposedStateName: string | null = null;
        if (mode === "recent" && team) {
          const targetType =
            stateInfo?.type === "done" ? "completed" :
            stateInfo?.type === "started" ? "started" : "unstarted";
          const proposed = team.states.nodes.find((s) => s.type === targetType);
          proposedStateId = proposed?.id ?? null;
          proposedStateName = proposed?.name ?? null;
        }

        try {
          const check = await linearRequest<{ issues: { nodes: LinearIssueWithState[] } }>(
            linearToken, ISSUE_WITH_STATE_BY_URL_QUERY, { url: shortcutUrl }
          );
          const issue = check.issues.nodes[0];
          found.push({
            story,
            shortcutStateName: stateInfo?.name ?? "Unknown",
            shortcutStateType: stateInfo?.type ?? "unstarted",
            linearId: issue?.id ?? null,
            linearIdentifier: issue?.identifier ?? null,
            linearUrl: issue?.url ?? null,
            currentStateName: issue?.state?.name ?? null,
            currentStateType: issue?.state?.type ?? null,
            alreadyCancelled: mode === "archived" && (
              issue?.state?.id === cancelledState?.id || issue?.state?.type === "cancelled"
            ),
            proposedStateId,
            proposedStateName,
          });
        } catch {
          found.push({
            story,
            shortcutStateName: stateInfo?.name ?? "Unknown",
            shortcutStateType: stateInfo?.type ?? "unstarted",
            linearId: null,
            linearIdentifier: null,
            linearUrl: null,
            currentStateName: null,
            currentStateType: null,
            alreadyCancelled: false,
            proposedStateId,
            proposedStateName,
          });
        }
        await delay(80);
      }

      addScanLog(`Done. ${found.filter((f) => f.linearId).length} of ${stories.length} found in Linear.`);
      setFoundIssues(found);

      // Default: select all eligible issues
      if (mode === "archived") {
        setSelectedIds(new Set(found.filter((f) => f.linearId && !f.alreadyCancelled).map((f) => f.story.id)));
      } else {
        setSelectedIds(new Set(found.filter((f) => f.linearId).map((f) => f.story.id)));
      }

      setPhase("review");
    } catch (err) {
      addScanLog(`✗ Scan failed: ${err}`);
      setPhase("review");
    }
  }

  async function runUpdate() {
    setPhase("updating");
    setUpdateLog([]);
    setUpdateResults([]);

    const team = linearTeams.find((t) => t.id === targetTeamId);
    const cancelledState = team?.states.nodes.find((s) => s.type === "cancelled");
    const toUpdate = foundIssues.filter((i) => selectedIds.has(i.story.id) && i.linearId);

    if (mode === "archived") {
      if (!cancelledState) {
        addUpdateLog("✗ No cancelled state found in this Linear team.");
        setPhase("done");
        return;
      }
      addUpdateLog(`Setting ${toUpdate.length} issues to "${cancelledState.name}"…`);
      for (const issue of toUpdate) {
        try {
          await withRetry(
            () => linearRequest(linearToken, UPDATE_ISSUE_MUTATION, {
              id: issue.linearId,
              input: { stateId: cancelledState.id },
            }),
            { label: `update ${issue.linearIdentifier}` }
          );
          addUpdateLog(`  ↑ ${issue.linearIdentifier} → ${cancelledState.name}`);
          setUpdateResults((prev) => [...prev, {
            storyId: issue.story.id,
            storyName: issue.story.name,
            linearIdentifier: issue.linearIdentifier!,
            linearUrl: issue.linearUrl!,
            status: "updated",
          }]);
        } catch (err) {
          addUpdateLog(`  ✗ ${issue.linearIdentifier} failed: ${err}`);
          setUpdateResults((prev) => [...prev, {
            storyId: issue.story.id,
            storyName: issue.story.name,
            linearIdentifier: issue.linearIdentifier!,
            linearUrl: issue.linearUrl!,
            status: "error",
            error: String(err),
          }]);
        }
        await delay(150);
      }
      // Mark skipped (deselected or already cancelled)
      for (const issue of foundIssues.filter((i) => !selectedIds.has(i.story.id) && i.linearId)) {
        setUpdateResults((prev) => [...prev, {
          storyId: issue.story.id,
          storyName: issue.story.name,
          linearIdentifier: issue.linearIdentifier!,
          linearUrl: issue.linearUrl!,
          status: "skipped",
        }]);
      }
    } else {
      addUpdateLog(`Syncing ${toUpdate.length} issues to Linear…`);
      for (const issue of toUpdate) {
        try {
          const input: Record<string, unknown> = { title: issue.story.name };
          if (issue.proposedStateId) input.stateId = issue.proposedStateId;
          await withRetry(
            () => linearRequest(linearToken, UPDATE_ISSUE_MUTATION, {
              id: issue.linearId,
              input,
            }),
            { label: `sync ${issue.linearIdentifier}` }
          );
          addUpdateLog(`  ↑ ${issue.linearIdentifier} synced.`);
          setUpdateResults((prev) => [...prev, {
            storyId: issue.story.id,
            storyName: issue.story.name,
            linearIdentifier: issue.linearIdentifier!,
            linearUrl: issue.linearUrl!,
            status: "updated",
          }]);
        } catch (err) {
          addUpdateLog(`  ✗ ${issue.linearIdentifier} failed: ${err}`);
          setUpdateResults((prev) => [...prev, {
            storyId: issue.story.id,
            storyName: issue.story.name,
            linearIdentifier: issue.linearIdentifier!,
            linearUrl: issue.linearUrl!,
            status: "error",
            error: String(err),
          }]);
        }
        await delay(150);
      }
      // Not-in-Linear stories
      for (const issue of foundIssues.filter((i) => !i.linearId)) {
        setUpdateResults((prev) => [...prev, {
          storyId: issue.story.id,
          storyName: issue.story.name,
          linearIdentifier: "—",
          linearUrl: "",
          status: "not-found",
        }]);
      }
    }

    addUpdateLog("Done.");
    setPhase("done");
  }

  function toggleSelect(storyId: number) {
    setSelectedIds((prev) => {
      const n = new Set(prev);
      n.has(storyId) ? n.delete(storyId) : n.add(storyId);
      return n;
    });
  }

  function selectAll() {
    const eligible = foundIssues.filter(
      (i) => i.linearId && (mode === "recent" || !i.alreadyCancelled)
    );
    setSelectedIds(new Set(eligible.map((i) => i.story.id)));
  }

  function selectNone() {
    setSelectedIds(new Set());
  }

  if (loadingTeams) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        <span className="ml-3 text-sm text-muted-foreground">Loading Linear teams…</span>
      </div>
    );
  }

  if (teamsError) {
    return (
      <div className="space-y-4">
        <div className="rounded-lg bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive">{teamsError}</div>
        <Button variant="ghost" size="sm" onClick={onBack}>← Back</Button>
      </div>
    );
  }

  const inLinearCount = foundIssues.filter((i) => i.linearId).length;
  const notInLinearCount = foundIssues.filter((i) => !i.linearId).length;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold">Fix &amp; sync</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Team: <strong>{selectedGroup.name}</strong>
        </p>
      </div>

      {/* Configure phase */}
      {phase === "configure" && (
        <div className="space-y-5">
          <div className="space-y-2">
            <label className="text-sm font-semibold">Target Linear team</label>
            <Select value={targetTeamId || "__none__"} onValueChange={(v) => setTargetTeamId(v === "__none__" ? "" : v)}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="— select a team —" />
              </SelectTrigger>
              <SelectContent>
                {linearTeams.map((t) => (
                  <SelectItem key={t.id} value={t.id}>{t.name} ({t.key})</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-semibold">What to fix</label>
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => setMode("recent")}
                className={`rounded-lg border p-4 text-left transition-colors ${
                  mode === "recent"
                    ? "border-primary bg-primary/5"
                    : "hover:border-primary/40 hover:bg-accent"
                }`}
              >
                <div className="font-medium text-sm">Recently updated</div>
                <div className="mt-1 text-xs text-muted-foreground">
                  Shortcut stories changed in the last 24h — review and re-sync title &amp; state to Linear.
                </div>
              </button>
              <button
                onClick={() => setMode("archived")}
                className={`rounded-lg border p-4 text-left transition-colors ${
                  mode === "archived"
                    ? "border-primary bg-primary/5"
                    : "hover:border-primary/40 hover:bg-accent"
                }`}
              >
                <div className="font-medium text-sm">Fix archived</div>
                <div className="mt-1 text-xs text-muted-foreground">
                  Find archived Shortcut stories already in Linear and set them to Cancelled.
                </div>
              </button>
            </div>
          </div>

          <div className="flex items-center justify-between pt-2">
            <Button variant="ghost" size="sm" onClick={onBack}>← Back</Button>
            <Button
              disabled={!targetTeamId}
              onClick={() => { ranRef.current = false; runScan(); }}
            >
              Scan →
            </Button>
          </div>
        </div>
      )}

      {/* Scanning phase */}
      {phase === "scanning" && (
        <div
          ref={scanLogRef}
          className="rounded-lg bg-gray-900 text-green-400 font-mono text-xs p-4 h-48 overflow-y-auto"
        >
          {scanLog.map((line, i) => <div key={i}>{line || "\u00a0"}</div>)}
          <div className="flex items-center gap-1 mt-1">
            <span className="inline-block h-2 w-2 animate-ping rounded-full bg-green-400 opacity-75" />
            <span className="opacity-60">scanning…</span>
          </div>
        </div>
      )}

      {/* Review phase */}
      {phase === "review" && (
        <div className="space-y-4">
          {foundIssues.length === 0 ? (
            <div className="rounded-lg bg-muted/50 border px-4 py-6 text-center text-sm text-muted-foreground">
              {mode === "archived"
                ? "No archived stories found for this team."
                : "No stories updated in the last 24h."}
            </div>
          ) : (
            <>
              <div className="rounded-lg bg-muted/50 border px-4 py-3 text-sm space-y-1">
                <p>
                  <strong>{foundIssues.length}</strong> stories found ·{" "}
                  <strong>{inLinearCount}</strong> in Linear
                  {notInLinearCount > 0 && (
                    <span className="text-muted-foreground"> · {notInLinearCount} not in Linear (skipped)</span>
                  )}
                </p>
                {mode === "archived" && (
                  <p className="text-muted-foreground">
                    {foundIssues.filter((i) => i.alreadyCancelled).length} already Cancelled
                  </p>
                )}
              </div>

              <div className="flex items-center gap-4">
                <span className="text-sm text-muted-foreground">{selectedIds.size} selected</span>
                <button onClick={selectAll} className="text-xs text-primary hover:underline">Select all eligible</button>
                <button onClick={selectNone} className="text-xs text-muted-foreground hover:underline">Select none</button>
              </div>

              <div className="rounded-lg border overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-8" />
                      <TableHead>Story</TableHead>
                      <TableHead>SC state</TableHead>
                      <TableHead>Linear</TableHead>
                      {mode === "recent" && <TableHead>State sync</TableHead>}
                      {mode === "archived" && <TableHead>Linear state</TableHead>}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {foundIssues.map((issue) => {
                      const inLinear = !!issue.linearId;
                      const disabled = !inLinear || (mode === "archived" && issue.alreadyCancelled);
                      return (
                        <TableRow key={issue.story.id} className={disabled ? "opacity-50" : ""}>
                          <TableCell>
                            <Checkbox
                              checked={selectedIds.has(issue.story.id)}
                              disabled={disabled}
                              onCheckedChange={() => !disabled && toggleSelect(issue.story.id)}
                            />
                          </TableCell>
                          <TableCell className="max-w-xs truncate text-sm">{issue.story.name}</TableCell>
                          <TableCell>
                            <Badge variant="outline" className="text-xs">{issue.shortcutStateName}</Badge>
                          </TableCell>
                          <TableCell>
                            {inLinear ? (
                              <a
                                href={issue.linearUrl!}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-primary hover:underline text-xs"
                              >
                                {issue.linearIdentifier} ↗
                              </a>
                            ) : (
                              <span className="text-xs text-muted-foreground">Not in Linear</span>
                            )}
                          </TableCell>
                          {mode === "recent" && (
                            <TableCell className="text-xs">
                              {inLinear ? (
                                issue.proposedStateName && issue.proposedStateName !== issue.currentStateName ? (
                                  <span>
                                    <span className="text-muted-foreground">{issue.currentStateName ?? "?"}</span>
                                    {" → "}
                                    <span className="text-primary font-medium">{issue.proposedStateName}</span>
                                  </span>
                                ) : (
                                  <span className="text-muted-foreground">
                                    {issue.currentStateName ?? "?"} (no change)
                                  </span>
                                )
                              ) : "—"}
                            </TableCell>
                          )}
                          {mode === "archived" && (
                            <TableCell>
                              {issue.alreadyCancelled ? (
                                <Badge variant="secondary" className="text-xs">Already Cancelled</Badge>
                              ) : inLinear ? (
                                <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-700 text-xs">
                                  {issue.currentStateName ?? "?"}
                                </Badge>
                              ) : "—"}
                            </TableCell>
                          )}
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </>
          )}

          <div className="flex items-center justify-between pt-2">
            <Button variant="ghost" size="sm" onClick={() => { setPhase("configure"); ranRef.current = false; }}>
              ← Re-scan
            </Button>
            {foundIssues.length > 0 && (
              <Button
                disabled={selectedIds.size === 0}
                className={mode === "archived" ? "bg-green-600 hover:bg-green-700 text-white" : ""}
                onClick={runUpdate}
              >
                {mode === "archived"
                  ? `Set ${selectedIds.size} issue${selectedIds.size !== 1 ? "s" : ""} to Cancelled`
                  : `Sync ${selectedIds.size} issue${selectedIds.size !== 1 ? "s" : ""} to Linear`}
              </Button>
            )}
          </div>
        </div>
      )}

      {/* Updating + done phase */}
      {(phase === "updating" || phase === "done") && (
        <div className="space-y-4">
          <div
            ref={updateLogRef}
            className="rounded-lg bg-gray-900 text-green-400 font-mono text-xs p-4 h-36 overflow-y-auto"
          >
            {updateLog.map((line, i) => <div key={i}>{line || "\u00a0"}</div>)}
            {phase === "updating" && (
              <div className="flex items-center gap-1 mt-1">
                <span className="inline-block h-2 w-2 animate-ping rounded-full bg-green-400 opacity-75" />
                <span className="opacity-60">updating…</span>
              </div>
            )}
          </div>
          {updateResults.length > 0 && (
            <div className="rounded-lg border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Story</TableHead>
                    <TableHead>Linear</TableHead>
                    <TableHead>Result</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {updateResults.map((r, i) => (
                    <TableRow key={i}>
                      <TableCell className="max-w-xs truncate text-sm">{r.storyName}</TableCell>
                      <TableCell>
                        {r.linearUrl ? (
                          <a href={r.linearUrl} target="_blank" rel="noopener noreferrer"
                            className="text-primary hover:underline text-xs">{r.linearIdentifier} ↗</a>
                        ) : (
                          <span className="text-xs text-muted-foreground">{r.linearIdentifier}</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {r.status === "updated" && <Badge variant="outline" className="border-purple-200 bg-purple-50 text-purple-700 text-xs">↑ Updated</Badge>}
                        {r.status === "skipped" && <Badge variant="secondary" className="text-xs">Skipped</Badge>}
                        {r.status === "not-found" && <Badge variant="secondary" className="text-xs">Not in Linear</Badge>}
                        {r.status === "error" && <Badge variant="outline" className="border-red-200 bg-red-50 text-red-700 text-xs">✗ Error</Badge>}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          {phase === "done" && (
            <div className="flex items-center gap-3 pt-2">
              <Button variant="outline" onClick={onBack}>← Fix another team</Button>
              <Button variant="ghost" size="sm" onClick={onStartOver}>Start over</Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
