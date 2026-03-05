// Linear API types and GraphQL operations

export interface LinearTeam {
  id: string;
  name: string;
  key: string;
  states: {
    nodes: LinearWorkflowState[];
  };
}

export interface LinearWorkflowState {
  id: string;
  name: string;
  type: string;
  color: string;
}

export interface LinearUser {
  id: string;
  name: string;
  email: string;
  active: boolean;
}

export interface LinearLabel {
  id: string;
  name: string;
  color: string;
  team: { id: string };
}

export interface LinearIssue {
  id: string;
  identifier: string;
  title: string;
  url: string;
}

export interface LinearProject {
  id: string;
  name: string;
  url: string;
}

export interface LinearCycle {
  id: string;
  number: number;
}

export interface LinearInitiative {
  id: string;
  name: string;
}

// GraphQL Queries

export const TEAMS_QUERY = `
  query {
    teams(first: 50) {
      nodes {
        id
        name
        key
        states(first: 100) {
          nodes {
            id
            name
            type
            color
          }
        }
      }
    }
  }
`;

export const USERS_QUERY = `
  query {
    users(first: 250, filter: { active: { eq: true } }) {
      nodes {
        id
        name
        email
        active
      }
    }
  }
`;

// Fetch all labels workspace-wide (no team filter) so we catch both
// team-scoped and workspace-level labels and avoid "duplicate label name" errors.
export const LABELS_QUERY = `
  query {
    issueLabels(first: 250) {
      nodes {
        id
        name
        color
        team {
          id
        }
      }
    }
  }
`;

// Check if a specific initiative already exists by exact name
export const INITIATIVE_BY_NAME_QUERY = `
  query CheckInitiative($name: String!) {
    initiatives(filter: { name: { eq: $name } }) {
      nodes {
        id
        name
      }
    }
  }
`;

// Fetch all projects for a team — checked against names in JS rather than
// relying on combined GraphQL filter syntax which varies across Linear versions.
export const TEAM_PROJECTS_QUERY = `
  query GetTeamProjects($teamId: ID!) {
    projects(first: 250, filter: { teams: { id: { eq: $teamId } } }) {
      nodes {
        id
        name
        url
      }
    }
  }
`;

// Find an issue that already has a Shortcut backlink attachment — used to
// detect stories that were migrated in a previous run.
export const ISSUE_BY_SHORTCUT_URL_QUERY = `
  query CheckIssueByShortcutUrl($url: String!) {
    issues(filter: { attachments: { url: { eq: $url } } }) {
      nodes {
        id
        identifier
        url
      }
    }
  }
`;

// GraphQL Mutations

export const CREATE_LABEL_MUTATION = `
  mutation CreateLabel($input: IssueLabelCreateInput!) {
    issueLabelCreate(input: $input) {
      success
      issueLabel {
        id
        name
        color
      }
    }
  }
`;

export const CREATE_ISSUE_MUTATION = `
  mutation CreateIssue($input: IssueCreateInput!) {
    issueCreate(input: $input) {
      success
      issue {
        id
        identifier
        title
        url
      }
    }
  }
`;

export const CREATE_COMMENT_MUTATION = `
  mutation CreateComment($input: CommentCreateInput!) {
    commentCreate(input: $input) {
      success
      comment {
        id
      }
    }
  }
`;

export const CREATE_PROJECT_MUTATION = `
  mutation CreateProject($input: ProjectCreateInput!) {
    projectCreate(input: $input) {
      success
      project {
        id
        name
        url
      }
    }
  }
`;

export const CREATE_CYCLE_MUTATION = `
  mutation CreateCycle($input: CycleCreateInput!) {
    cycleCreate(input: $input) {
      success
      cycle {
        id
        number
      }
    }
  }
`;

export const CREATE_INITIATIVE_MUTATION = `
  mutation CreateInitiative($input: InitiativeCreateInput!) {
    initiativeCreate(input: $input) {
      success
      initiative {
        id
        name
      }
    }
  }
`;

// Links a Linear Project to a Linear Initiative (join-table pattern)
export const LINK_INITIATIVE_PROJECT_MUTATION = `
  mutation LinkInitiativeProject($input: InitiativeToProjectCreateInput!) {
    initiativeToProjectCreate(input: $input) {
      success
    }
  }
`;

// Creates a relationship between two Linear issues (blocks, duplicate, etc.)
export const CREATE_ISSUE_RELATION_MUTATION = `
  mutation CreateIssueRelation($input: IssueRelationCreateInput!) {
    issueRelationCreate(input: $input) {
      success
      issueRelation {
        id
        type
      }
    }
  }
`;

// Workspace-wide projects query — used in BrowseStep to detect already-migrated epics
export const ALL_PROJECTS_QUERY = `
  query {
    projects(first: 250) {
      nodes {
        id
        name
      }
    }
  }
`;

// Workspace-wide initiatives query — used in BrowseStep to detect already-migrated milestones
export const ALL_INITIATIVES_QUERY = `
  query {
    initiatives(first: 250) {
      nodes {
        id
        name
      }
    }
  }
`;

// Issues that have a Shortcut backlink attachment — paginated, used to detect migrated stories.
// Uses startsWith (not contains) as Linear's StringComparator may not support contains on URL.
// attachments requires first: N — connection fields need pagination args in Linear's schema.
export const MIGRATED_ISSUES_QUERY = `
  query MigratedIssues($cursor: String) {
    issues(
      first: 250
      after: $cursor
      filter: { attachments: { url: { startsWith: "https://app.shortcut.com/" } } }
    ) {
      nodes {
        attachments(first: 10) {
          nodes { url }
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

// Creates a rich attachment (external link) on a Linear Issue
export const CREATE_ATTACHMENT_MUTATION = `
  mutation CreateAttachment($input: AttachmentCreateInput!) {
    attachmentCreate(input: $input) {
      success
      attachment {
        id
      }
    }
  }
`;
