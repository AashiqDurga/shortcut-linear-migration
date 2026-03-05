// Shortcut (formerly Clubhouse) API v3 types

export interface ShortcutGroup {
  id: string;
  name: string;
  description: string;
  mention_name: string;
  num_stories: number;
}

export interface ShortcutMember {
  id: string;
  disabled: boolean;
  profile: {
    name: string;
    mention_name: string;
    email_address: string;
  };
}

export interface ShortcutWorkflowState {
  id: number;
  name: string;
  type: "unstarted" | "started" | "done";
  position: number;
}

export interface ShortcutWorkflow {
  id: number;
  name: string;
  default_state_id: number;
  states: ShortcutWorkflowState[];
}

export interface ShortcutLabel {
  id: number;
  name: string;
  color: string;
}

export interface ShortcutEpic {
  id: number;
  name: string;
  description: string;
  state: string;
  group_ids: string[];
  milestone_id: number | null;
  labels: Array<{ id: number; name: string; color: string }>;
  stats: {
    num_stories: number;
    num_stories_done: number;
  };
}

export interface ShortcutIteration {
  id: number;
  name: string;
  description: string;
  status: string;
  start_date: string;
  end_date: string;
  group_ids: string[];
  stats: {
    num_stories: number;
    num_stories_done: number;
  };
}

export interface ShortcutKeyResult {
  id: string;
  name: string;
  description: string;
  progress: number;        // 0–100
  status: string;          // "unstarted" | "in_progress" | "complete"
  type: string;            // "boolean" | "numeric" | "percent" | "currency"
  current_observed_value: number | null;
  target_value: number | null;
  unit: string | null;
}

export interface ShortcutMilestone {
  id: number;
  name: string;
  description: string;
  state: string;
  categories: Array<{ name: string }>;
  // "Target date" in the Shortcut UI is stored as completed_at_override
  completed_at_override: string | null;
  started_at_override: string | null;
  key_results?: ShortcutKeyResult[];
}

export interface ShortcutFile {
  id: number;
  name: string;
  url: string;
  content_type: string;
  size: number;
  description: string;
}

export interface ShortcutLinkedFile {
  id: number;
  name: string;
  url: string;
  type: string;
  description: string;
}

export interface ShortcutTask {
  id: number;
  description: string;
  complete: boolean;
}

export interface ShortcutStoryLink {
  id: number;
  // "blocks" = this story blocks another; "is blocked by" = this story is blocked by another; "duplicates" = this story duplicates another
  type: "blocks" | "is blocked by" | "duplicates";
  subject_id: number; // the story doing the action
  object_id: number;  // the story being acted upon
}

export interface ShortcutComment {
  id: number;
  text: string;
  author_id: string;
  created_at: string;
  files?: ShortcutFile[];
}

export interface ShortcutStory {
  id: number;
  name: string;
  description: string;
  story_type: "feature" | "bug" | "chore";
  workflow_state_id: number;
  epic_id: number | null;
  iteration_id: number | null;
  owner_ids: string[];
  labels: Array<{ id: number; name: string; color: string }>;
  estimate: number | null;
  external_links: string[];
  story_links: ShortcutStoryLink[];
  tasks: ShortcutTask[];
  files: ShortcutFile[];
  linked_files: ShortcutLinkedFile[];
  num_comments: number;
  group_ids: string[];
}

export interface ShortcutSearchResult {
  data: ShortcutStory[];
  next: string | null;
  total: number;
}
