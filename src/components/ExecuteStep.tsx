"use client";

import { useState, useEffect, useRef } from "react";
import { shortcutRequest, linearRequest, delay, withRetry } from "@/lib/api";
import {
  LABELS_QUERY,
  INITIATIVE_BY_NAME_QUERY,
  TEAM_PROJECTS_QUERY,
  ISSUE_BY_SHORTCUT_URL_QUERY,
  CREATE_LABEL_MUTATION,
  CREATE_INITIATIVE_MUTATION,
  CREATE_CYCLE_MUTATION,
  CREATE_PROJECT_MUTATION,
  CREATE_ISSUE_MUTATION,
  CREATE_COMMENT_MUTATION,
  LINK_INITIATIVE_PROJECT_MUTATION,
  CREATE_ATTACHMENT_MUTATION,
  CREATE_ISSUE_RELATION_MUTATION,
  UPDATE_ISSUE_MUTATION,
  UPDATE_PROJECT_MUTATION,
  UPDATE_INITIATIVE_MUTATION,
} from "@/lib/linear";
import type {
  LinearLabel,
  LinearInitiative,
  LinearCycle,
  LinearProject,
  LinearIssue,
} from "@/lib/linear";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { ShortcutComment, ShortcutPullRequest } from "@/lib/shortcut";
import type { BrowseData, Selection } from "./BrowseStep";
import type { MappingConfig, LinearData } from "./ConfigureStep";

export interface MigrationResult {
  type: "label" | "initiative" | "cycle" | "project" | "issue";
  sourceId: string | number;
  sourceName: string;
  status: "success" | "error" | "skipped" | "reused" | "updated";
  linearId?: string;
  linearUrl?: string;
  error?: string;
}

interface Props {
  shortcutToken: string;
  linearToken: string;
  browseData: BrowseData;
  selection: Selection;
  mapping: MappingConfig;
  linearData: LinearData;
  onStartOver: () => void;
}

function buildInitiativeDescription(milestone: import("@/lib/shortcut").ShortcutMilestone): string {
  const parts: string[] = [];

  if (milestone.description) {
    parts.push(milestone.description);
  }

  const krs = milestone.key_results ?? [];
  if (krs.length > 0) {
    parts.push("\n---\n\n**Key Results**\n");
    for (const kr of krs) {
      const done =
        kr.status === "complete" || kr.status === "done" || kr.progress >= 100;
      let progress: string;
      if (kr.type === "boolean") {
        progress = done ? "Complete" : "Not started";
      } else {
        const unit = kr.unit ? ` ${kr.unit}` : "%";
        const current = kr.current_observed_value ?? kr.progress;
        const target = kr.target_value ?? 100;
        progress = `${current}${unit} / ${target}${unit}`;
      }
      parts.push(`- [${done ? "x" : " "}] ${kr.name} — ${progress}`);
    }
  }

  parts.push(
    `\n---\n\n*Migrated from Shortcut Objective #${milestone.id}*`
  );

  return parts.join("\n");
}

// Shortcut objective states → Linear initiative statuses
// InitiativeStatus enum values: Planned | Active | Completed
function shortcutObjectiveStateToLinear(state: string): string {
  switch (state?.toLowerCase()) {
    case "done":        return "Completed";
    case "in progress": return "Active";
    case "to do":
    default:            return "Planned";
  }
}

function isGitHubPrLink(url: string) {
  return url.includes("github.com") && url.includes("/pull/");
}

// Returns the Shortcut story ID if the URL points to a Shortcut story, otherwise null.
// Matches: https://app.shortcut.com/{workspace}/story/12345[/...]
function shortcutStoryId(url: string): number | null {
  const match = url.match(/app\.shortcut\.com\/[^/]+\/story\/(\d+)/);
  return match ? parseInt(match[1], 10) : null;
}


// Finds inline Shortcut CDN images in markdown, uploads each to Linear CDN,
// and rewrites the URL so they remain accessible after Shortcut is closed.
async function migrateInlineImages(text: string, shortcutToken: string, linearToken: string): Promise<string> {
  const imageRegex = /!\[([^\]]*)\]\((https?:\/\/(?:media\.shortcut\.com|media\.app\.shortcut\.com|media\.clubhouse\.io)[^)]+)\)/g;
  const matches = [...text.matchAll(imageRegex)];
  if (matches.length === 0) return text;

  let result = text;
  for (const match of matches) {
    const [fullMatch, alt, url] = match;
    try {
      const rawFilename = url.split("/").pop()?.split("?")[0] ?? "image.png";
      const ext = rawFilename.split(".").pop()?.toLowerCase() ?? "png";
      const contentType = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : ext === "gif" ? "image/gif" : ext === "webp" ? "image/webp" : ext === "svg" ? "image/svg+xml" : "image/png";
      const uploadRes = await fetch("/api/upload-asset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shortcutToken, linearToken, fileUrl: url, filename: rawFilename, contentType }),
      });
      if (uploadRes.ok) {
        const { assetUrl } = await uploadRes.json();
        // Use original alt if descriptive, otherwise fall back to the filename
        const displayAlt = alt.trim() || rawFilename;
        result = result.replace(fullMatch, `![${displayAlt}](${assetUrl})`);
      }
    } catch {
      // Leave original URL on failure
    }
  }
  return result;
}

function buildIssueDescription(
  story: BrowseData["stories"][number],
  memberMap: Record<string, string>
): string {
  const parts: string[] = [];

  if (story.description) {
    parts.push(story.description);
  }

  if ((story.tasks ?? []).length > 0) {
    parts.push("\n---\n\n**Tasks**\n");
    for (const task of story.tasks) {
      parts.push(`- [${task.complete ? "x" : " "}] ${task.description}`);
    }
  }

  // Embed non-PR, non-Shortcut-story external links in the description.
  // GitHub PRs become Linear attachments; Shortcut story URLs become issue relations.
  const plainLinks = (story.external_links ?? []).filter(
    (l) => !isGitHubPrLink(l) && shortcutStoryId(l) === null
  );
  if (plainLinks.length > 0) {
    parts.push("\n---\n\n**External Links**\n");
    for (const link of plainLinks) {
      parts.push(`- ${link}`);
    }
  }

  const owners = (story.owner_ids ?? []).map((id) => memberMap[id] ?? id).join(", ");
  parts.push(
    `\n---\n\n*Migrated from Shortcut Story #${story.id}${owners ? ` — originally owned by ${owners}` : ""}*`
  );

  return parts.join("\n");
}

function buildCommentBody(
  comment: ShortcutComment,
  memberMap: Record<string, string>
): string {
  const authorName = memberMap[comment.author_id] ?? "Unknown";
  const date = new Date(comment.created_at).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
  return `**${authorName}** commented on ${date}:\n\n${comment.text}`;
}

function StatusBadge({ status }: { status: MigrationResult["status"] }) {
  if (status === "success") {
    return <Badge variant="outline" className="border-green-200 bg-green-50 text-green-700">✓ Created</Badge>;
  }
  if (status === "error") {
    return <Badge variant="outline" className="border-red-200 bg-red-50 text-red-700">✗ Error</Badge>;
  }
  if (status === "reused") {
    return <Badge variant="outline" className="border-blue-200 bg-blue-50 text-blue-700">↩ Reused</Badge>;
  }
  if (status === "updated") {
    return <Badge variant="outline" className="border-purple-200 bg-purple-50 text-purple-700">↑ Updated</Badge>;
  }
  return <Badge variant="secondary">Skipped</Badge>;
}

export default function ExecuteStep({
  shortcutToken,
  linearToken,
  browseData,
  selection,
  mapping,
  linearData,
  onStartOver,
}: Props) {
  const [results, setResults] = useState<MigrationResult[]>([]);
  const [log, setLog] = useState<string[]>([]);
  const [done, setDone] = useState(false);
  const [aborted, setAborted] = useState(false);
  const [running, setRunning] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);
  const ranRef = useRef(false);

  function addLog(msg: string) {
    setLog((prev) => [...prev, msg]);
    setTimeout(() => {
      logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" });
    }, 50);
  }

  function addResult(result: MigrationResult) {
    setResults((prev) => [...prev, result]);
  }

  useEffect(() => {
    if (ranRef.current) return;
    ranRef.current = true;
    runMigration();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function runMigration() {
    setRunning(true);
    const { linearTeamId, stateMap, memberMap } = mapping;

    const scMemberNameMap = Object.fromEntries(
      browseData.members.map((m) => [m.id, m.profile.name])
    );

    // Track created Linear IDs for linking
    const epicToProject: Record<number, string> = {}; // epic id → project id
    const iterationToCycle: Record<number, string> = {}; // iteration id → cycle id
    const milestoneToInitiative: Record<number, string> = {}; // milestone id → initiative id
    const labelNameToId: Record<string, string> = {}; // label name (lower) → linear id
    const storyToIssue: Record<number, string> = {}; // shortcut story id → linear issue id
    const storyLinksMap: Record<number, import("@/lib/shortcut").ShortcutStoryLink[]> = {}; // story id → full story_links

    // Fetch the Shortcut workspace slug so we can build story backlink URLs.
    // GET /member returns the authenticated user's workspace info.
    let shortcutWorkspaceSlug = "";
    try {
      const me = await shortcutRequest<{ workspace2: { url_slug: string } }>(
        shortcutToken, "GET", "member"
      );
      shortcutWorkspaceSlug = me.workspace2?.url_slug ?? "";
    } catch {
      addLog("Warning: could not fetch Shortcut workspace slug — backlinks will be skipped.");
    }

    // ------------------------------------------------------------------
    // 1. Fetch existing labels for the target team
    // ------------------------------------------------------------------
    addLog("Fetching existing Linear labels…");
    try {
      const labelsData = await linearRequest<{ issueLabels: { nodes: LinearLabel[] } }>(
        linearToken,
        LABELS_QUERY
      );
      for (const label of labelsData.issueLabels.nodes) {
        // Only index labels that belong to the target team or are workspace-level (no team).
        // Using a label from a different team causes "labelIds for incorrect team" errors.
        if (!label.team || label.team.id === linearTeamId) {
          labelNameToId[label.name.toLowerCase()] = label.id;
        }
      }
      addLog(`Found ${Object.keys(labelNameToId).length} existing labels.`);
    } catch (err) {
      addLog(`Warning: could not fetch existing labels — ${err}`);
    }

    // ------------------------------------------------------------------
    // 2. Ensure story-type labels exist
    // ------------------------------------------------------------------
    const storyTypeColors: Record<string, string> = {
      feature: "#22c55e",
      bug: "#ef4444",
      chore: "#6b7280",
    };
    const selectedStories = browseData.stories.filter((s) => selection.storyIds.has(s.id));
    const neededTypes = new Set(selectedStories.map((s) => s.story_type));

    for (const type of neededTypes) {
      const capitalized = type.charAt(0).toUpperCase() + type.slice(1);
      if (!labelNameToId[type]) {
        addLog(`Creating label "${capitalized}"…`);
        try {
          const res = await linearRequest<{
            issueLabelCreate: { success: boolean; issueLabel: { id: string } };
          }>(linearToken, CREATE_LABEL_MUTATION, {
            input: { name: capitalized, color: storyTypeColors[type], teamId: linearTeamId },
          });
          if (res.issueLabelCreate.success) {
            labelNameToId[type] = res.issueLabelCreate.issueLabel.id;
            addResult({
              type: "label",
              sourceId: type,
              sourceName: capitalized,
              status: "success",
              linearId: res.issueLabelCreate.issueLabel.id,
            });
          }
        } catch (err) {
          if (String(err).toLowerCase().includes("duplicate")) {
            addLog(`  Label "${capitalized}" already exists — reusing it.`);
            addResult({ type: "label", sourceId: type, sourceName: capitalized, status: "reused" });
          } else {
            addLog(`  ✗ Failed to create label "${capitalized}": ${err}`);
            addResult({ type: "label", sourceId: type, sourceName: capitalized, status: "error", error: String(err) });
          }
        }
        await delay(150);
      }
    }

    // Ensure Shortcut labels exist
    const neededLabels = new Set(
      selectedStories.flatMap((s) => s.labels.map((l) => l.name))
    );
    const labelColorMap = Object.fromEntries(
      selectedStories.flatMap((s) => s.labels.map((l) => [l.name, l.color]))
    );
    for (const labelName of neededLabels) {
      if (!labelNameToId[labelName.toLowerCase()]) {
        addLog(`Creating label "${labelName}"…`);
        try {
          const res = await linearRequest<{
            issueLabelCreate: { success: boolean; issueLabel: { id: string } };
          }>(linearToken, CREATE_LABEL_MUTATION, {
            input: {
              name: labelName,
              color: labelColorMap[labelName] ?? "#94a3b8",
              teamId: linearTeamId,
            },
          });
          if (res.issueLabelCreate.success) {
            labelNameToId[labelName.toLowerCase()] = res.issueLabelCreate.issueLabel.id;
          }
        } catch (err) {
          if (String(err).toLowerCase().includes("duplicate")) {
            addLog(`  Label "${labelName}" already exists — reusing it.`);
          } else {
            addLog(`  ✗ Could not create label "${labelName}", will skip it.`);
          }
        }
        await delay(150);
      }
    }

    // ------------------------------------------------------------------
    // 3. Milestones → Initiatives
    // ------------------------------------------------------------------
    const selectedMilestones = browseData.milestones.filter((m) =>
      selection.milestoneIds.has(m.id)
    );
    if (selectedMilestones.length > 0) {
      addLog(`\nCreating ${selectedMilestones.length} initiatives…`);
    }
    let migrationAborted = false;

    for (const milestone of selectedMilestones) {
      // Linear initiative names are capped at 80 characters
      const initiativeName = milestone.name.length > 80 ? milestone.name.slice(0, 77) + "…" : milestone.name;
      if (initiativeName !== milestone.name) {
        addLog(`  ⚠ Milestone name truncated to 80 chars: "${initiativeName}"`);
      }

      // Check by name before creating — avoids duplicates on re-runs
      let existing: string | null = null;
      try {
        const check = await linearRequest<{ initiatives: { nodes: LinearInitiative[] } }>(
          linearToken, INITIATIVE_BY_NAME_QUERY, { name: initiativeName }
        );
        existing = check.initiatives.nodes[0]?.id ?? null;
      } catch { /* non-fatal */ }

      if (existing) {
        milestoneToInitiative[milestone.id] = existing;
        addLog(`  Updating initiative "${initiativeName}"…`);
        try {
          await linearRequest(linearToken, UPDATE_INITIATIVE_MUTATION, {
            id: existing,
            input: {
              name: initiativeName,
              description: [
                initiativeName !== milestone.name ? `**Full name:** ${milestone.name}\n` : "",
                buildInitiativeDescription(milestone),
              ].filter(Boolean).join("\n") || undefined,
              targetDate: milestone.completed_at_override
                ? milestone.completed_at_override.split("T")[0]
                : undefined,
              status: shortcutObjectiveStateToLinear(milestone.state),
            },
          });
          addLog(`  ↑ Initiative updated.`);
          addResult({ type: "initiative", sourceId: milestone.id, sourceName: milestone.name, status: "updated" });
        } catch (err) {
          addLog(`  ⚠ Could not update initiative: ${err}`);
          addResult({ type: "initiative", sourceId: milestone.id, sourceName: milestone.name, status: "skipped" });
        }
        continue;
      }
      addLog(`  Creating initiative "${initiativeName}"…`);
      try {
        const res = await linearRequest<{
          initiativeCreate: { success: boolean; initiative: LinearInitiative };
        }>(linearToken, CREATE_INITIATIVE_MUTATION, {
          input: {
            name: initiativeName,
            description: [
              initiativeName !== milestone.name ? `**Full name:** ${milestone.name}\n` : "",
              buildInitiativeDescription(milestone),
            ].filter(Boolean).join("\n") || undefined,
            // completed_at_override is Shortcut's "Target date" on objectives.
            // Linear expects TimelessDate format: YYYY-MM-DD
            targetDate: milestone.completed_at_override
              ? milestone.completed_at_override.split("T")[0]
              : undefined,
            status: shortcutObjectiveStateToLinear(milestone.state),
          },
        });
        if (res.initiativeCreate.success) {
          milestoneToInitiative[milestone.id] = res.initiativeCreate.initiative.id;
          addLog(`  ✓ Initiative created.`);
          addResult({
            type: "initiative",
            sourceId: milestone.id,
            sourceName: milestone.name,
            status: "success",
            linearId: res.initiativeCreate.initiative.id,
          });
        }
      } catch (err) {
        addLog(`  ✗ Failed to create initiative "${milestone.name}": ${err}`);
        addLog(`\n⛔ Migration aborted — fix the error above and try again.`);
        addResult({
          type: "initiative",
          sourceId: milestone.id,
          sourceName: milestone.name,
          status: "error",
          error: String(err),
        });
        migrationAborted = true;
        break;
      }
      await delay(200);
    }

    if (migrationAborted) {
      setAborted(true);
      setDone(true);
      setRunning(false);
      return;
    }

    // ------------------------------------------------------------------
    // 4. Iterations → Cycles
    // ------------------------------------------------------------------
    const selectedIterations = browseData.iterations.filter((it) =>
      selection.iterationIds.has(it.id)
    );
    if (selectedIterations.length > 0) {
      addLog(`\nCreating ${selectedIterations.length} cycles…`);
    }
    for (const iteration of selectedIterations) {
      addLog(`  Creating cycle "${iteration.name}"…`);
      try {
        const res = await linearRequest<{
          cycleCreate: { success: boolean; cycle: LinearCycle };
        }>(linearToken, CREATE_CYCLE_MUTATION, {
          input: {
            teamId: linearTeamId,
            name: iteration.name,
            startsAt: `${iteration.start_date}T00:00:00.000Z`,
            endsAt: `${iteration.end_date}T00:00:00.000Z`,
          },
        });
        if (res.cycleCreate.success) {
          iterationToCycle[iteration.id] = res.cycleCreate.cycle.id;
          addLog(`  ✓ Cycle created.`);
          addResult({
            type: "cycle",
            sourceId: iteration.id,
            sourceName: iteration.name,
            status: "success",
            linearId: res.cycleCreate.cycle.id,
          });
        }
      } catch (err) {
        addLog(`  ✗ ${err}`);
        addResult({
          type: "cycle",
          sourceId: iteration.id,
          sourceName: iteration.name,
          status: "error",
          error: String(err),
        });
      }
      await delay(200);
    }

    // ------------------------------------------------------------------
    // 5. Epics → Projects
    // ------------------------------------------------------------------
    // Fetch all existing projects for this team once, then match by name in JS.
    // A single bulk fetch is more reliable than per-item name filter queries.
    const existingProjectsByName: Record<string, { id: string; url: string }> = {};
    try {
      const projData = await linearRequest<{ projects: { nodes: LinearProject[] } }>(
        linearToken, TEAM_PROJECTS_QUERY, { teamId: linearTeamId }
      );
      for (const p of projData.projects.nodes) {
        existingProjectsByName[p.name.toLowerCase()] = { id: p.id, url: p.url };
      }
      addLog(`Found ${projData.projects.nodes.length} existing project(s) for this team.`);
    } catch {
      addLog("Warning: could not fetch existing projects — duplicates possible on re-run.");
    }

    const selectedEpics = browseData.epics.filter((e) => selection.epicIds.has(e.id));
    if (selectedEpics.length > 0) {
      addLog(`\nCreating ${selectedEpics.length} projects…`);
    }
    for (const epic of selectedEpics) {
      const projectName = epic.name.length > 80 ? epic.name.slice(0, 77) + "…" : epic.name;
      const existingProject = existingProjectsByName[projectName.toLowerCase()] ?? null;
      if (existingProject) {
        epicToProject[epic.id] = existingProject.id;
        addLog(`  Updating project "${projectName}"…`);
        try {
          const projectState = epic.state === "done" || epic.state === "closed" ? "completed" : "started";
          await linearRequest(linearToken, UPDATE_PROJECT_MUTATION, {
            id: existingProject.id,
            input: {
              name: projectName,
              description: [
                projectName !== epic.name ? `**Full name:** ${epic.name}\n` : "",
                epic.description,
              ].filter(Boolean).join("\n") || undefined,
              state: projectState,
            },
          });
          addLog(`  ↑ Project updated.`);
          addResult({ type: "project", sourceId: epic.id, sourceName: epic.name, status: "updated", linearId: existingProject.id, linearUrl: existingProject.url });
        } catch (err) {
          addLog(`  ⚠ Could not update project: ${err}`);
          addResult({ type: "project", sourceId: epic.id, sourceName: epic.name, status: "skipped", linearId: existingProject.id, linearUrl: existingProject.url });
        }
        continue;
      }
      if (projectName !== epic.name) {
        addLog(`  ⚠ Epic name truncated to 80 chars: "${projectName}"`);
      }
      addLog(`  Creating project "${projectName}"…`);
      try {
        const projectState =
          epic.state === "done" || epic.state === "closed" ? "completed" : "started";
        const res = await linearRequest<{
          projectCreate: { success: boolean; project: LinearProject };
        }>(linearToken, CREATE_PROJECT_MUTATION, {
          input: {
            name: projectName,
            teamIds: [linearTeamId],
            description: [
              projectName !== epic.name ? `**Full name:** ${epic.name}\n` : "",
              epic.description,
            ].filter(Boolean).join("\n") || undefined,
            state: projectState,
          },
        });
        if (res.projectCreate.success) {
          const projectId = res.projectCreate.project.id;
          epicToProject[epic.id] = projectId;
          addLog(`  ✓ Project created.`);
          addResult({
            type: "project",
            sourceId: epic.id,
            sourceName: epic.name,
            status: "success",
            linearId: projectId,
            linearUrl: res.projectCreate.project.url,
          });

          // Link project to its parent Initiative (Objective → Epic hierarchy)
          const initiativeId = epic.milestone_id
            ? milestoneToInitiative[epic.milestone_id]
            : undefined;
          if (initiativeId) {
            try {
              await linearRequest(linearToken, LINK_INITIATIVE_PROJECT_MUTATION, {
                input: { initiativeId, projectId },
              });
              addLog(`    Linked to initiative.`);
            } catch (err) {
              addLog(`    ✗ Could not link to initiative: ${err}`);
            }
            await delay(100);
          }
        }
      } catch (err) {
        addLog(`  ✗ Failed to create project "${epic.name}": ${err}`);
        addLog(`\n⛔ Migration aborted — fix the error above and try again.`);
        addResult({
          type: "project",
          sourceId: epic.id,
          sourceName: epic.name,
          status: "error",
          error: String(err),
        });
        migrationAborted = true;
        break;
      }
      await delay(200);
    }

    if (migrationAborted) {
      setAborted(true);
      setDone(true);
      setRunning(false);
      return;
    }

    // ------------------------------------------------------------------
    // 6. Stories → Issues
    // ------------------------------------------------------------------
    if (selectedStories.length > 0) {
      addLog(`\nCreating ${selectedStories.length} issues…`);
    }
    for (const story of selectedStories) {
      // Check if this story was already migrated in a previous run by looking
      // for the Shortcut backlink attachment we attach to every issue.
      if (shortcutWorkspaceSlug) {
        const shortcutUrl = `https://app.shortcut.com/${shortcutWorkspaceSlug}/story/${story.id}`;
        try {
          const check = await linearRequest<{
            issues: { nodes: Array<{ id: string; identifier: string; url: string }> };
          }>(linearToken, ISSUE_BY_SHORTCUT_URL_QUERY, { url: shortcutUrl });
          const existing = check.issues.nodes[0];
          if (existing) {
            storyToIssue[story.id] = existing.id;
            addLog(`  Updating #${story.id} "${story.name}" (${existing.identifier})…`);
            try {
              // Fetch full story so description/tasks are up to date
              let fullStory = story;
              try {
                fullStory = await shortcutRequest<typeof story>(shortcutToken, "GET", `stories/${story.id}`);
              } catch { /* use slim story */ }
              if (fullStory.story_links?.length) storyLinksMap[story.id] = fullStory.story_links;

              const rawDesc = buildIssueDescription(fullStory, scMemberNameMap);
              const description = await migrateInlineImages(rawDesc, shortcutToken, linearToken);
              const linearStateId = stateMap[String(story.workflow_state_id)] || undefined;
              const mappedAssignee = story.owner_ids?.[0] ? memberMap[story.owner_ids[0]] : undefined;
              const issueLabelIds: string[] = [];
              const typeLabel = labelNameToId[story.story_type];
              if (typeLabel) issueLabelIds.push(typeLabel);
              for (const l of story.labels ?? []) {
                const lid = labelNameToId[l.name.toLowerCase()];
                if (lid) issueLabelIds.push(lid);
              }
              const safeEstimate = (story.estimate != null && Number.isInteger(story.estimate) && story.estimate > 0)
                ? story.estimate : undefined;
              const projectId = story.epic_id ? epicToProject[story.epic_id] : undefined;
              const cycleId = story.iteration_id ? iterationToCycle[story.iteration_id] : undefined;

              await withRetry(() => linearRequest(linearToken, UPDATE_ISSUE_MUTATION, {
                id: existing.id,
                input: {
                  title: story.name,
                  description,
                  stateId: linearStateId,
                  assigneeId: mappedAssignee || undefined,
                  labelIds: issueLabelIds.length > 0 ? issueLabelIds : undefined,
                  estimate: safeEstimate,
                  projectId: projectId || undefined,
                  cycleId: cycleId || undefined,
                },
              }), { label: `update issue #${story.id}` });

              addLog(`  ↑ Issue updated.`);
              addResult({ type: "issue", sourceId: story.id, sourceName: story.name, status: "updated", linearId: existing.id, linearUrl: existing.url });
            } catch (err) {
              addLog(`  ⚠ Could not update issue: ${err}`);
              addResult({ type: "issue", sourceId: story.id, sourceName: story.name, status: "skipped", linearId: existing.id, linearUrl: existing.url });
            }
            continue;
          }
        } catch { /* non-fatal — proceed with creation */ }
      }

      addLog(`  Creating issue #${story.id} "${story.name}"…`);

      // Build label IDs
      const issueLabelIds: string[] = [];
      const typeLabel = labelNameToId[story.story_type];
      if (typeLabel) issueLabelIds.push(typeLabel);
      for (const l of story.labels ?? []) {
        const labelId = labelNameToId[l.name.toLowerCase()];
        if (labelId) issueLabelIds.push(labelId);
      }

      // Resolve state — archived stories are forced to the cancelled state so
      // they don't appear on the board (they should have been filtered in BrowseStep
      // but this is a safety net for any that slip through).
      const team = linearData.teams.find((t) => t.id === mapping.linearTeamId);
      const cancelledState = team?.states.nodes.find((s) => s.type === "cancelled");
      const linearStateId = story.archived
        ? (cancelledState?.id ?? stateMap[String(story.workflow_state_id)] ?? undefined)
        : (stateMap[String(story.workflow_state_id)] ?? undefined);

      // Resolve assignee — only set if the Shortcut member was explicitly mapped to a
      // known Linear user ID. Empty string means "unmatched / left the org" → unassigned.
      const mappedAssignee = story.owner_ids?.[0] ? memberMap[story.owner_ids[0]] : undefined;
      const assigneeId = mappedAssignee || undefined;

      // Resolve project & cycle
      const projectId = story.epic_id ? epicToProject[story.epic_id] : undefined;
      const cycleId = story.iteration_id ? iterationToCycle[story.iteration_id] : undefined;

      try {
        // /epics/{id}/stories returns slim objects — description, files, and story_links
        // are empty or missing. Fetch the full story to get complete data.
        let fullStory = story;
        try {
          fullStory = await shortcutRequest<typeof story>(
            shortcutToken, "GET", `stories/${story.id}`
          );
        } catch {
          addLog(`    ⚠ Could not fetch full story details for #${story.id}, using partial data.`);
        }

        // Save story_links from the full story for the relations pass (Step 7)
        if (fullStory.story_links?.length) {
          storyLinksMap[story.id] = fullStory.story_links;
        }

        const rawDescription = buildIssueDescription(fullStory, scMemberNameMap);
        const description = await migrateInlineImages(rawDescription, shortcutToken, linearToken);
        // Build inputs from most to least complete — on validation failure we
        // progressively strip optional fields rather than aborting.
        const safeEstimate = (story.estimate != null && Number.isInteger(story.estimate) && story.estimate > 0)
          ? story.estimate : undefined;

        const fullInput = {
          teamId: linearTeamId, title: story.name, description,
          stateId: linearStateId || undefined,
          assigneeId: assigneeId,
          labelIds: issueLabelIds.length > 0 ? issueLabelIds : undefined,
          estimate: safeEstimate,
          projectId: projectId || undefined,
          cycleId: cycleId || undefined,
        };
        const noEstimateInput = { ...fullInput, estimate: undefined };
        const minimalInput = {
          teamId: linearTeamId, title: story.name, description,
          stateId: linearStateId || undefined,
          labelIds: issueLabelIds.length > 0 ? issueLabelIds : undefined,
          projectId: projectId || undefined,
          cycleId: cycleId || undefined,
        };

        type IssueCreateResult = { issueCreate: { success: boolean; issue: LinearIssue } };
        const createFn = (input: typeof minimalInput) =>
          withRetry(
            () => linearRequest<IssueCreateResult>(linearToken, CREATE_ISSUE_MUTATION, { input }),
            { label: `issue #${story.id}` }
          );

        let issueRes: IssueCreateResult | null = null;
        try {
          issueRes = await createFn(fullInput);
        } catch (e1) {
          addLog(`    ⚠ Full create failed, retrying without estimate/assignee: ${e1}`);
          try {
            issueRes = await createFn(noEstimateInput);
            addLog(`    ⚠ Created without estimate${safeEstimate != null ? ` (${safeEstimate})` : ""}.`);
          } catch (e2) {
            addLog(`    ⚠ Still failing, retrying with minimal fields: ${e2}`);
            issueRes = await createFn(minimalInput);
            addLog(`    ⚠ Created with minimal fields — estimate and assignee skipped.`);
          }
        }

        if (!issueRes.issueCreate.success) throw new Error("issueCreate returned success=false");

        const issue = issueRes.issueCreate.issue;
        storyToIssue[story.id] = issue.id;
        addLog(`  ✓ Issue ${issue.identifier} created.`);
        addResult({
          type: "issue",
          sourceId: story.id,
          sourceName: story.name,
          status: "success",
          linearId: issue.id,
          linearUrl: issue.url,
        });
        await delay(150);

        // Shortcut backlink attachment — stores shortcutId in metadata for
        // future querying and provides a clickable link during the transition.
        if (shortcutWorkspaceSlug) {
          try {
            await linearRequest(linearToken, CREATE_ATTACHMENT_MUTATION, {
              input: {
                issueId: issue.id,
                title: `Shortcut #${story.id}`,
                subtitle: "Original Shortcut story",
                url: `https://app.shortcut.com/${shortcutWorkspaceSlug}/story/${story.id}`,
                iconUrl: "https://app.shortcut.com/favicon.ico",
                metadata: { shortcutId: story.id },
              },
            });
          } catch {
            // Non-fatal — backlink is a nice-to-have
          }
          await delay(100);
        }

        // Migrate comments — always attempt fetch rather than relying on
        // num_comments which can be unreliable on full story objects.
        try {
          const comments = await shortcutRequest<ShortcutComment[]>(
            shortcutToken,
            "GET",
            `stories/${story.id}/comments`
          );
          for (const comment of comments) {
            try {
              let commentBody = await migrateInlineImages(buildCommentBody(comment, scMemberNameMap), shortcutToken, linearToken);
              // Upload image files to Linear CDN and embed inline; other files as links.
              for (const file of comment.files ?? []) {
                try {
                  const uploadRes = await fetch("/api/upload-asset", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ shortcutToken, linearToken, fileUrl: file.url, filename: file.name, contentType: file.content_type, size: file.size }),
                  });
                  if (uploadRes.ok) {
                    const { assetUrl } = await uploadRes.json();
                    if (file.content_type.startsWith("image/")) {
                      // Caption below so the filename is visible in the rendered ticket
                      commentBody += `\n\n![${file.name}](${assetUrl})\n*${file.name}*`;
                    } else {
                      await linearRequest(linearToken, CREATE_ATTACHMENT_MUTATION, {
                        input: { issueId: issue.id, title: file.name, subtitle: `From comment · ${file.content_type}`, url: assetUrl },
                      });
                    }
                  }
                  await delay(100);
                } catch {
                  addLog(`    ✗ Could not upload comment file: ${file.name}`);
                }
              }
              await linearRequest(linearToken, CREATE_COMMENT_MUTATION, {
                input: { issueId: issue.id, body: commentBody },
              });
              await delay(100);
            } catch (err) {
              addLog(`    ✗ Comment ${comment.id} failed: ${err}`);
            }
          }
          if (comments.length > 0) addLog(`    Migrated ${comments.length} comment(s).`);
        } catch (err) {
          addLog(`    ✗ Could not fetch comments for story #${story.id}: ${err}`);
        }

        // GitHub PRs — primary source is pull_requests (GitHub integration data).
        // Also catch any GitHub PR URLs manually added to external_links.
        const integratedPRs: ShortcutPullRequest[] = fullStory.pull_requests ?? [];
        const manualPrUrls = (fullStory.external_links ?? []).filter(isGitHubPrLink);
        // Merge, deduping by URL
        const allPrUrls = new Map<string, string>(); // url → title
        for (const pr of integratedPRs) {
          const status = pr.merged ? "Merged" : pr.closed ? "Closed" : "Open";
          allPrUrls.set(pr.url, `PR #${pr.id}: ${pr.title} (${status})`);
        }
        for (const url of manualPrUrls) {
          if (!allPrUrls.has(url)) {
            allPrUrls.set(url, `PR: ${url.split("github.com/")[1] ?? url}`);
          }
        }
        for (const [prUrl, prTitle] of allPrUrls) {
          try {
            await linearRequest(linearToken, CREATE_ATTACHMENT_MUTATION, {
              input: {
                issueId: issue.id,
                title: prTitle,
                subtitle: "GitHub Pull Request",
                url: prUrl,
                iconUrl: "https://github.githubassets.com/favicons/favicon.png",
              },
            });
            await delay(100);
          } catch {
            addLog(`    ✗ Could not attach PR: ${prUrl}`);
          }
        }
        if (allPrUrls.size > 0) {
          addLog(`    Attached ${allPrUrls.size} GitHub PR(s).`);
        }

        // Upload story files to Linear CDN so URLs remain valid after Shortcut is closed.
        for (const file of fullStory.files ?? []) {
          try {
            addLog(`    Uploading ${file.name}…`);
            const uploadRes = await fetch("/api/upload-asset", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ shortcutToken, linearToken, fileUrl: file.url, filename: file.name, contentType: file.content_type, size: file.size }),
            });
            if (!uploadRes.ok) throw new Error(await uploadRes.text());
            const { assetUrl } = await uploadRes.json();
            await linearRequest(linearToken, CREATE_ATTACHMENT_MUTATION, {
              input: { issueId: issue.id, title: file.name, subtitle: file.content_type, url: assetUrl },
            });
            await delay(100);
          } catch (err) {
            addLog(`    ✗ Could not upload ${file.name}: ${err}`);
          }
        }
        if ((fullStory.files ?? []).length > 0) {
          addLog(`    Uploaded ${fullStory.files.length} file(s) to Linear.`);
        }

        // Linked files (Google Drive, Dropbox, etc.) → stable external URLs, attach directly.
        for (const file of fullStory.linked_files ?? []) {
          try {
            await linearRequest(linearToken, CREATE_ATTACHMENT_MUTATION, {
              input: { issueId: issue.id, title: file.name, subtitle: file.type, url: file.url },
            });
            await delay(100);
          } catch {
            addLog(`    ✗ Could not attach linked file: ${file.name}`);
          }
        }
        if ((fullStory.linked_files ?? []).length > 0) {
          addLog(`    Attached ${fullStory.linked_files.length} external link(s).`);
        }
      } catch (err) {
        addLog(`  ✗ Could not create issue "${story.name}" even with minimal fields: ${err}`);
        addLog(`\n⛔ Migration aborted — fix the error above and try again.`);
        addResult({
          type: "issue",
          sourceId: story.id,
          sourceName: story.name,
          status: "error",
          error: String(err),
        });
        migrationAborted = true;
        break;
      }
      await delay(150);
    }

    if (migrationAborted) {
      setAborted(true);
      setDone(true);
      setRunning(false);
      return;
    }

    // ------------------------------------------------------------------
    // 7. Story relationships → Issue relations (second pass)
    // ------------------------------------------------------------------
    // Handles two sources of relations:
    //   a) story_links (blocks / duplicates) — only process subject side to avoid duplicates
    //   b) external_links pointing to Shortcut story URLs → related
    //      Deduped by sorted pair key so A→B and B→A don't create two relations.
    const createdRelationPairs = new Set<string>();

    const storiesWithLinks = selectedStories.filter(
      (s) =>
        (storyLinksMap[s.id]?.some((l) => l.subject_id === s.id)) ||
        s.external_links?.some((l) => shortcutStoryId(l) !== null)
    );

    if (storiesWithLinks.length > 0) {
      addLog(`\nCreating story relationships…`);
      let relationCount = 0;
      let relationErrors = 0;

      for (const story of storiesWithLinks) {
        const issueId = storyToIssue[story.id];
        if (!issueId) continue;

        // a) Explicit story_links from full story (blocks / duplicates / relates to)
        for (const link of storyLinksMap[story.id] ?? []) {
          if (link.subject_id !== story.id) continue; // skip mirror entries
          const relatedIssueId = storyToIssue[link.object_id];
          if (!relatedIssueId) {
            addLog(`  ⚠ #${story.id} "${link.type}" #${link.object_id} — target not migrated, skipping.`);
            continue;
          }
          // "is blocked by" is the mirror of "blocks" on the other story —
          // Linear creates the reciprocal automatically, so skip it here.
          if (link.type === "is blocked by") continue;
          const linearType =
            link.type === "blocks" ? "blocks"
            : link.type === "duplicates" ? "duplicate"
            : "related"; // "relates to" → Linear's "related"
          try {
            await linearRequest(linearToken, CREATE_ISSUE_RELATION_MUTATION, {
              input: { issueId, relatedIssueId, type: linearType },
            });
            relationCount++;
            await delay(100);
          } catch (err) {
            addLog(`  ✗ Relation #${story.id} ${link.type} #${link.object_id}: ${err}`);
            relationErrors++;
          }
        }

        // b) external_links that point to Shortcut story URLs → relates_to
        for (const url of story.external_links ?? []) {
          const linkedStoryId = shortcutStoryId(url);
          if (linkedStoryId === null) continue;
          const relatedIssueId = storyToIssue[linkedStoryId];
          if (!relatedIssueId) {
            addLog(`  ⚠ #${story.id} links to #${linkedStoryId} — not migrated, skipping.`);
            continue;
          }
          // Deduplicate: sort the two issue IDs so A→B and B→A produce the same key
          const pairKey = [issueId, relatedIssueId].sort().join(":");
          if (createdRelationPairs.has(pairKey)) continue;
          createdRelationPairs.add(pairKey);
          try {
            await linearRequest(linearToken, CREATE_ISSUE_RELATION_MUTATION, {
              input: { issueId, relatedIssueId, type: "related" },
            });
            relationCount++;
            await delay(100);
          } catch (err) {
            addLog(`  ✗ related #${story.id} → #${linkedStoryId}: ${err}`);
            relationErrors++;
          }
        }
      }

      addLog(`  Relations: ${relationCount} created, ${relationErrors} failed.`);
    }

    addLog("\nMigration complete!");
    setDone(true);
    setRunning(false);
  }

  const successCount = results.filter((r) => r.status === "success").length;
  const errorCount = results.filter((r) => r.status === "error").length;

  return (
    <div className="space-y-6">
      <div>
        <h2 className={`text-2xl font-semibold ${aborted ? "text-red-700" : "text-gray-900"}`}>
          {!done ? "Running migration…" : aborted ? "Migration aborted" : "Migration complete"}
        </h2>
        {done && (
          <p className="mt-1 text-sm text-gray-500">
            {aborted
              ? "A top-level item failed — no issues were created. Resolve the error and run again."
              : `${successCount} created · ${errorCount} error${errorCount !== 1 ? "s" : ""}`}
          </p>
        )}
      </div>

      {/* Log */}
      <div
        ref={logRef}
        className="rounded-lg bg-gray-900 text-green-400 font-mono text-xs p-4 h-48 overflow-y-auto"
      >
        {log.map((line, i) => (
          <div key={i}>{line || "\u00a0"}</div>
        ))}
        {running && (
          <div className="flex items-center gap-1 mt-1">
            <span className="inline-block h-2 w-2 animate-ping rounded-full bg-green-400 opacity-75" />
            <span className="opacity-60">running…</span>
          </div>
        )}
      </div>

      {/* Results table */}
      {results.length > 0 && (
        <div className="rounded-lg border overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Type</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Linear</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {results.map((r, i) => (
                <TableRow key={i} className={r.status === "error" ? "bg-destructive/5" : ""}>
                  <TableCell className="text-muted-foreground capitalize">{r.type}</TableCell>
                  <TableCell className="max-w-xs truncate">{r.sourceName}</TableCell>
                  <TableCell><StatusBadge status={r.status} /></TableCell>
                  <TableCell>
                    {r.linearUrl ? (
                      <a href={r.linearUrl} target="_blank" rel="noopener noreferrer"
                        className="text-primary hover:underline text-xs">
                        Open ↗
                      </a>
                    ) : r.error ? (
                      <span className="text-xs text-destructive">{r.error}</span>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {done && (
        <Button variant="outline" onClick={onStartOver}>← Migrate more</Button>
      )}
    </div>
  );
}
