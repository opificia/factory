# Requests for comments

A request for comments (RFC) is a written proposal for a significant change to Opificia AI. It gives everyone a chance to understand and improve the change before work starts.

## When you need an RFC

You need an RFC for:

- new components or subsystems;
- new runtime dependencies, or replacing an existing one;
- changes to public interfaces, such as the plugin API, the model interface or configuration formats;
- any change that affects a commitment in [`SOVEREIGNTY.md`](../../SOVEREIGNTY.md); and
- changes to policy files: licences, governance, the trademark policy.

**Before version 1.0.0**, you need an RFC only for changes to policy files, and for adding, removing or weakening a commitment in [`SOVEREIGNTY.md`](../../SOVEREIGNTY.md). Other significant changes are decided by an [ADR](../adr/README.md) in a pull request, as [`GOVERNANCE.md`](../../GOVERNANCE.md) describes. A maintainer can still ask for an RFC when a change is contested.

You do not need an RFC for bug fixes, documentation improvements, refactoring that does not change behaviour, or small features with no effect on interfaces. When in doubt, ask in a Discussion.

## Lifecycle

1. **Discuss the idea** in the RFCs category of [GitHub Discussions](https://github.com/opificia/factory/discussions). This is optional but saves time.
2. **Write the RFC.** Copy [`0000-template.md`](0000-template.md) to `0000-short-title.md` and fill it in. Complete every section, including the sovereignty impact.
3. **Open a pull request** that adds the RFC file. The pull request number becomes the RFC number: rename the file to `NNNN-short-title.md`, where `NNNN` is the pull request number.
4. **Comment period.** The RFC is open for comments for at least **14 days**. The author updates it in response to feedback. A maintainer announces the start of the period in the Announcements category of Discussions.
5. **Decision.** After the comment period, the maintainers decide by lazy consensus, or by vote if needed, as described in [`GOVERNANCE.md`](../../GOVERNANCE.md). The decision is recorded in the pull request.
6. **Outcome.**
   - **Accepted:** the pull request is merged with status `accepted`. If the RFC sets architecture, the outcome is also recorded as an [ADR](../adr/README.md).
   - **Rejected:** the pull request is merged with status `rejected`, so the reasoning is kept. Or it is closed, if the author prefers.
   - **Postponed:** the idea is good, but not now. The pull request is closed and can be reopened later.

An accepted RFC is a decision to do something, not a promise of when. Implementation happens in separate pull requests that link to the RFC.

## Statuses

| Status | Meaning |
| --- | --- |
| `draft` | Being written; not open for the formal comment period yet. |
| `in comment period` | Open for comments until the date in the RFC. |
| `accepted` | Approved. |
| `rejected` | Not approved. Kept for the record. |
| `postponed` | Deferred. |
| `implemented` | Accepted and done. |
