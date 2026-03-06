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
import type { ShortcutEpic, ShortcutGroup, ShortcutStory } from "@/lib/shortcut";

interface FoundIssue {
  story: ShortcutStory;
  linearId: string;
  linearIdentifier: string;
  linearUrl: string;
  currentStateName: string;
  alreadyCancelled: boolean;
}

interface UpdateResult {
  storyId: number;
  storyName: string;
  linearIdentifier: string;
  linearUrl: string;
  status: "updated" | "skipped" | "not-found" | "error";
  error?: string;
}

type Phase = "configure" | "scanning" | "review" | "updating" | "done";

interface Props {
  shortcutToken: string;
  linearToken: string;
  selectedGroup: ShortcutGroup;
  onBack: () => void;
  onStartOver: () => void;
}

export default function FixArchivedStep({
  shortcutToken,
  linearToken,
  selectedGroup,
  onBack,
  onStartOver,
}: Props) {
  const [phase, setPhase] = useState<Phase>("configure");
  const [linearTeams, setLinearTeams] = useState<LinearTeam[]>([]);
  const [loadingTeams, setLoadingTeams] = useState(true);
  const [teamsError, setTeamsError] = useState("");
  const [targetTeamId, setTargetTeamId] = useState("");

  const [scanLog, setScanLog] = useState<string[]>([]);
  const [foundIssues, setFoundIssues] = useState<FoundIssue[]>([]);

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

    try {
      // Get workspace slug for building Shortcut story URLs
      addScanLog("Fetching workspace info…");
      let workspaceSlug = "";
      try {
        const me = await shortcutRequest<{ workspace2: { url_slug: string } }>(shortcutToken, "GET", "member");
        workspaceSlug = me.workspace2?.url_slug ?? "";
      } catch {
        addScanLog("⚠ Could not fetch workspace slug — Linear lookups will be skipped.");
      }

      // Fetch all epics for this group
      addScanLog("Fetching epics…");
      const allEpics = await shortcutRequest<ShortcutEpic[]>(shortcutToken, "GET", "epics");
      const groupEpics = allEpics.filter((e) => e.group_ids.includes(selectedGroup.id));
      addScanLog(`Found ${groupEpics.length} epics. Fetching stories…`);

      // Fetch stories per epic in batches, keep only archived
      const archivedStories: ShortcutStory[] = [];
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
        for (const stories of batchResults) {
          for (const story of stories) {
            if (!seenIds.has(story.id) && story.archived) {
              seenIds.add(story.id);
              archivedStories.push(story);
            }
          }
        }
      }
      addScanLog(`Found ${archivedStories.length} archived stories.`);

      if (archivedStories.length === 0) {
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

      // Look up each archived story in Linear via backlink
      addScanLog("Looking up Linear issues…");
      const team = linearTeams.find((t) => t.id === targetTeamId);
      const cancelledState = team?.states.nodes.find((s) => s.type === "cancelled");
      const found: FoundIssue[] = [];

      for (const story of archivedStories) {
        const shortcutUrl = `https://app.shortcut.com/${workspaceSlug}/story/${story.id}`;
        try {
          const check = await linearRequest<{ issues: { nodes: LinearIssueWithState[] } }>(
            linearToken, ISSUE_WITH_STATE_BY_URL_QUERY, { url: shortcutUrl }
          );
          const issue = check.issues.nodes[0];
          if (issue) {
            found.push({
              story,
              linearId: issue.id,
              linearIdentifier: issue.identifier,
              linearUrl: issue.url,
              currentStateName: issue.state?.name ?? "Unknown",
              alreadyCancelled: issue.state?.id === cancelledState?.id || issue.state?.type === "cancelled",
            });
          }
        } catch {
          // Not found or error — will appear as "not-found" in results
        }
        await delay(80);
      }

      addScanLog(`Done. Found ${found.length} of ${archivedStories.length} archived stories in Linear.`);
      setFoundIssues(found);
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
    if (!cancelledState) {
      addUpdateLog("✗ No cancelled state found in this Linear team.");
      setPhase("done");
      return;
    }

    const toUpdate = foundIssues.filter((i) => !i.alreadyCancelled);
    addUpdateLog(`Updating ${toUpdate.length} issues to "${cancelledState.name}"…`);

    for (const issue of toUpdate) {
      try {
        await withRetry(
          () => linearRequest(linearToken, UPDATE_ISSUE_MUTATION, {
            id: issue.linearId,
            input: { stateId: cancelledState.id },
          }),
          { label: `update ${issue.linearIdentifier}` }
        );
        addUpdateLog(`  ↑ ${issue.linearIdentifier} updated.`);
        setUpdateResults((prev) => [...prev, {
          storyId: issue.story.id,
          storyName: issue.story.name,
          linearIdentifier: issue.linearIdentifier,
          linearUrl: issue.linearUrl,
          status: "updated",
        }]);
      } catch (err) {
        addUpdateLog(`  ✗ ${issue.linearIdentifier} failed: ${err}`);
        setUpdateResults((prev) => [...prev, {
          storyId: issue.story.id,
          storyName: issue.story.name,
          linearIdentifier: issue.linearIdentifier,
          linearUrl: issue.linearUrl,
          status: "error",
          error: String(err),
        }]);
      }
      await delay(150);
    }

    // Mark already-cancelled as skipped
    for (const issue of foundIssues.filter((i) => i.alreadyCancelled)) {
      setUpdateResults((prev) => [...prev, {
        storyId: issue.story.id,
        storyName: issue.story.name,
        linearIdentifier: issue.linearIdentifier,
        linearUrl: issue.linearUrl,
        status: "skipped",
      }]);
    }

    addUpdateLog("Done.");
    setPhase("done");
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

  const pendingCount = foundIssues.filter((i) => !i.alreadyCancelled).length;
  const alreadyDoneCount = foundIssues.filter((i) => i.alreadyCancelled).length;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold">Fix archived stories</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Team: <strong>{selectedGroup.name}</strong> — finds archived Shortcut stories that were migrated to Linear and sets them to Cancelled.
        </p>
      </div>

      {/* Configure phase */}
      {(phase === "configure") && (
        <div className="space-y-4">
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
          <div className="flex items-center justify-between pt-2">
            <Button variant="ghost" size="sm" onClick={onBack}>← Back</Button>
            <Button
              disabled={!targetTeamId}
              onClick={() => { ranRef.current = false; runScan(); }}
            >
              Scan for archived stories
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
              No archived stories found in Linear for this team.
            </div>
          ) : (
            <>
              <div className="rounded-lg bg-muted/50 border px-4 py-3 text-sm space-y-1">
                <p><strong>{foundIssues.length}</strong> archived stories found in Linear.</p>
                <p className="text-muted-foreground">{pendingCount} will be set to Cancelled · {alreadyDoneCount} already Cancelled</p>
              </div>
              <div className="rounded-lg border overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Story</TableHead>
                      <TableHead>Linear</TableHead>
                      <TableHead>Current state</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {foundIssues.map((issue) => (
                      <TableRow key={issue.story.id}>
                        <TableCell className="max-w-xs truncate text-sm">{issue.story.name}</TableCell>
                        <TableCell>
                          <a href={issue.linearUrl} target="_blank" rel="noopener noreferrer"
                            className="text-primary hover:underline text-xs">{issue.linearIdentifier} ↗</a>
                        </TableCell>
                        <TableCell>
                          {issue.alreadyCancelled
                            ? <Badge variant="secondary" className="text-xs">Already Cancelled</Badge>
                            : <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-700 text-xs">{issue.currentStateName}</Badge>
                          }
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </>
          )}
          <div className="flex items-center justify-between pt-2">
            <Button variant="ghost" size="sm" onClick={() => { setPhase("configure"); ranRef.current = false; }}>← Re-scan</Button>
            <Button
              disabled={pendingCount === 0}
              className="bg-green-600 hover:bg-green-700 text-white"
              onClick={runUpdate}
            >
              Update {pendingCount} issue{pendingCount !== 1 ? "s" : ""} to Cancelled
            </Button>
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
                        <a href={r.linearUrl} target="_blank" rel="noopener noreferrer"
                          className="text-primary hover:underline text-xs">{r.linearIdentifier} ↗</a>
                      </TableCell>
                      <TableCell>
                        {r.status === "updated" && <Badge variant="outline" className="border-purple-200 bg-purple-50 text-purple-700 text-xs">↑ Updated</Badge>}
                        {r.status === "skipped" && <Badge variant="secondary" className="text-xs">Skipped</Badge>}
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
