# Ostraka

A personal admin base for one developer: a place to keep todos, notes and sketches, review daily work, and see open merge requests and the current sprint at a glance.

## Content

**Todo**:
A unit of work to be done that can be marked done.
_Avoid_: Task, item, action

**Sub-todo**:
A Todo that belongs to a parent Todo; Sub-todos cannot have Sub-todos of their own.
_Avoid_: Subtask, child, step, checklist item

**Dropped**:
The state of a Todo deliberately abandoned without being done, optionally with a reason.
_Avoid_: Cancelled, deleted, archived

**Tag**:
A flat, lowercase label shared by Todos, Notes and Dev logs, created by first use.
_Avoid_: Label, category, project

**Note**:
A free-form piece of writing kept for later reference.
_Avoid_: Memo, doc, page

**Idea**:
A Note tagged as an idea; not a separate kind of content.
_Avoid_: Thought, brainstorm

**Dev log**:
The record of one working day: what was done, worked on, discussed and decided. There is at most one per day.
_Avoid_: Journal, diary, daily log, worklog

**Backfill**:
Writing Dev logs for past days that have none.

**Sketch**:
A quick diagram, such as a sequence or flow diagram, kept as Mermaid text that can be edited visually or as text.
_Avoid_: Drawing, diagram, whiteboard

**Snapshot**:
A commit of the content folder's history, made after changes settle or by a skill; what the app restores to.
_Avoid_: Backup, version, save

**Backup**:
A push of the content folder's Snapshots to its private remote on the work gitlab.com; the content is backed up when its latest Snapshot is on that remote.
_Avoid_: Sync, upload, Snapshot

## People

**Person**:
A colleague recorded in the People directory.
_Avoid_: Contact, user, member

**People directory**:
The machine-wide list of Persons and their identities in each Activity source.
_Avoid_: Address book, contacts, roster

**Stub Person**:
A Person created from a new Mention that has no email yet; the `people` skill fills in their identities.
_Avoid_: Placeholder, draft person

**Mention**:
A reference to a Person in a Todo or Dev log, written `@<person id>`.
_Avoid_: Tag (a Tag is a label, not a Person)

## Work overview

**Briefing**:
The start-of-day summary of what is waiting, open and planned.
_Avoid_: Standup, welcome, digest

**Activity source**:
An external system whose recent activity feeds a Dev log or a Briefing, such as GitLab, Jira, Outlook or Slack.
_Avoid_: Integration, connector, feed

**Reference**:
A pointer from a Todo, Note or Dev log to a merge request or Jira issue, written as that system's own token: `group/project!<iid>` or `<KEY>-<number>`.
_Avoid_: Link, autolink (a Reference is stored as text, not as a URL)
