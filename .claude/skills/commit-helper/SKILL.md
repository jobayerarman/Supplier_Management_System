---
name: commit-helper
description: Generates clear, Angular-style commit messages from git diffs. Use when writing commit messages or reviewing staged changes.
---

# Commit Message Helper

Generates clear, well-structured commit messages following Angular conventions used in this codebase.

## Instructions

1. Run `git diff --staged` to analyze staged changes
2. Generate a commit message with proper structure
3. Suggest the complete formatted message ready to use

## Angular Commit Message Format

```
<type>(<scope>): <subject>

<body>

<footer>
```

### Type (Required)
One of:
- **feat**: A new feature
- **fix**: A bug fix
- **refactor**: Code change that neither fixes a bug nor adds a feature
- **perf**: Performance improvement
- **docs**: Documentation changes only
- **test**: Adding or updating tests
- **chore**: Changes to build, dependencies, tooling, CI/CD (no code changes)
- **ci**: CI/CD configuration changes
- **style**: Formatting, missing semicolons, etc. (no code logic changes)
- **sync**: Syncing code with external sources or manual changes

### Scope (Optional but Recommended)
Area of the codebase in parentheses:
- Examples from codebase: `(agents)`, `(commands)`, `(cache-manager)`, `(payment-manager)`, `(test-suite)`, `(changelog)`
- Be specific and use lowercase
- Omit if changes span multiple areas or don't fit a single scope

### Subject (Required)
- Imperative mood ("add" not "added" or "adds")
- No period at the end
- Max 50 characters
- Lowercase (unless referencing code/proper nouns)
- Clear and specific about what changed

### Body (Optional but Recommended for Non-Trivial Changes)
- Wrapped at 72 characters per line
- Blank line between subject and body
- Explain **what** and **why**, not **how**
- Use bullet points if listing multiple changes
- Reference related components or dependencies

### Footer (Optional)
- Blank line before footer
- Document breaking changes: `BREAKING CHANGE: description`
- Reference issues: `Closes #123` or `Fixes #456`
- Reference related changes: `Relates to #789`

## Examples from Codebase

### Simple Feature
```
feat(agents): add code-reviewer agent for quality assurance
```

### Feature with Body
```
feat(changelog): create standardized CHANGELOG from full git history

- Parse git log with semantic versioning format
- Group commits by type and version
- Generate markdown with proper hierarchy
- Auto-populate version dates and links
```

### Refactoring with Scope
```
refactor(test-suite): standardize naming, isolate benchmarks, and add full InvoiceManager coverage

Consolidate test organization to improve maintainability:
- Rename test files to follow Test.<Module>.gs pattern
- Separate benchmark tests into dedicated modules
- Add comprehensive InvoiceManager test coverage
- Improve test isolation and independence
```

### Bug Fix with Issue Reference
```
fix(cache-manager): resolve race condition in incremental updates

Prevent cache corruption when concurrent updates occur on same invoice.
Lock acquired during incremental update transaction.

Fixes #234
```

### Documentation Only
```
docs: add Master Database setup instructions

Include step-by-step setup guide, configuration examples, and
troubleshooting section for Master Database mode.
```

## Generation Process

When asked to generate a commit message:

1. **Analyze the diff** - Review what files changed and why
2. **Identify type** - Determine if it's a feature, fix, refactor, etc.
3. **Select scope** - What component/area does this affect?
4. **Write subject** - Concise, present-tense description (max 50 chars)
5. **Compose body** - Explain what and why (if needed)
6. **Add footer** - Reference issues or breaking changes (if applicable)

## Best Practices

✅ **DO:**
- Use present tense and imperative mood
- Be specific about what changed
- Explain the motivation and impact
- Reference issues and related commits
- Capitalize component names in scope
- Keep subject line under 50 characters
- Start body after blank line

❌ **DON'T:**
- Use past tense ("added", "fixed")
- Include periods at end of subject
- Write vague messages ("update stuff")
- Mix multiple unrelated changes in one commit
- Reference implementation details in subject
- Use "I" or "we" language

## Tips for Better Commits

1. **One logical change per commit** - Keep commits focused
2. **Self-contained** - Each commit should be independent and meaningful
3. **Reversible** - Commit message should help future reversions
4. **Reference context** - Link to issues, PRs, or related commits
5. **Test included** - If applicable, include test changes in description
6. **Clear scope** - Use consistent scope names across commits

## Usage Example

User provides git status and asks for commit message:
```
git status
On branch feature-branch
Changes to be staged:
  modified: CacheManager.gs
  modified: PaymentManager.gs
  new file: Test.Cache.gs
```

Assistant analyzes diffs and suggests:
```
feat(cache-manager): add incremental update support for single invoice rows

Implement updateSingleInvoice() to enable fast, targeted cache updates
without full reload. Reduces update time from 500ms to 1ms for typical
operations.

- Add incremental update logic with partition transitions
- Implement consistency validation with fallback to full reload
- Add performance statistics tracking
- Include comprehensive test coverage

Performance: 250x faster for single-row updates (1ms vs 500ms)
```
