# Confluence Push

[![CI](https://github.com/jnealey-godaddy/obsidian-confluence-push/actions/workflows/ci.yml/badge.svg)](https://github.com/jnealey-godaddy/obsidian-confluence-push/actions/workflows/ci.yml)

Publish Obsidian notes to Confluence Cloud. Write in Obsidian, push to Confluence for your team to read.

Notes are converted to Confluence **storage format**, the XHTML Confluence stores natively, so pages arrive as real Confluence content with working tables, code macros, task lists and panels. Not Markdown pasted into a code block.

Publishing is one-way by design. Confluence is a publishing target rather than a second source of truth, and nothing is merged back automatically. When someone edits a published page directly, the plugin notices and asks before overwriting their work, and `pull` brings their version down beside your note so you can see what changed. Inline comments are re-anchored onto the new content rather than orphaned.

## Install

Not in the community catalogue yet, so install it manually:

1. Download `main.js`, `manifest.json` and `styles.css` from the [latest release](../../releases/latest).
2. Put them in `<your vault>/.obsidian/plugins/confluence-push/`.
3. In Obsidian, go to **Settings > Community plugins**, hit the reload button next to "Installed plugins", and enable **Confluence Push**.

For the [terminal front end](#from-a-terminal), also grab `cli.js` and `confluence-push` from the same release and put them in that folder. `chmod +x confluence-push` after downloading.

To build from source instead:

```bash
git clone https://github.com/jnealey-godaddy/obsidian-confluence-push.git
cd obsidian-confluence-push
npm install && npm run build
```

That produces `main.js` and `cli.js`, which are not tracked in the repo. Copy the folder into `.obsidian/plugins/`.

## Setup

1. Create an Atlassian API token at [id.atlassian.com/manage-profile/security/api-tokens](https://id.atlassian.com/manage-profile/security/api-tokens).
2. Open the plugin settings and fill in:

   | Setting | Value |
   |---|---|
   | Site URL | your Confluence Cloud base URL, for example `https://your-org.atlassian.net` |
   | Account email | the Atlassian account the token belongs to |
   | API token | the token from step 1 |
   | Default space key | the space new pages go to, for example `DOCS` |
   | Default parent page ID | optional, the page new notes are filed under |

3. Click **Test** to confirm the credentials and space are reachable.

### About the token

It is stored in the plugin's `data.json` inside your vault, in plain text. That is how Obsidian plugins store settings, and anything with filesystem access to the vault can read it, so treat the vault the way you treat the token itself.

If your vault is in version control, make sure `.obsidian/plugins/confluence-push/data.json` is ignored. `data.json` also accumulates a record per published note, mapping vault paths to page IDs, so it leaks your note structure even without the token.

Use an API token scoped to an account that only has access to the spaces you intend to publish to.

## Commands

| Command | What it does |
|---|---|
| Push current note to Confluence | Creates or updates the page for the active note |
| Push current note (overwrite remote changes) | Same, but skips the conflict prompt and the unchanged check |
| Push all published notes to Confluence | Re-pushes every note that already has a page, skipping unchanged ones |
| Preview Confluence storage format for current note | Shows the generated markup and any conversion warnings without publishing |
| Open Confluence page for current note | Opens the published page in a browser |

There is also a ribbon icon and a **Push to Confluence** item in the file context menu.

## From a terminal

`confluence-push` is the same pusher without Obsidian. It shares the converter, the REST client, the conflict rules and `data.json`, so a page published from a terminal is the page the plugin would have published, and the two front ends can take turns on the same note.

```bash
.obsidian/plugins/confluence-push/confluence-push push "Team/Metrics Dashboard.md"
```

Run it from the vault root. The wrapper finds Node on its own, including one installed only under nvm, so it works in the non-interactive shells agents and hooks run in.

| Command | What it does |
|---|---|
| `push <note>...` | Create or update the page for each note |
| `push --all` | Push every note that already has a page |
| `move <note>...` | Refile pages under a new parent, leaving content untouched |
| `status [<note>...]` | What each note is bound to, and whether it has drifted |
| `pull [<note>...]` | Save what Confluence holds as a review copy beside each note |
| `preview <note>` | Print the storage markup and conversion warnings |
| `tree [<page>]` | Print the page and folder hierarchy under a page |
| `mkfolder <title> --parent <id>` | Create a folder, or print the id of one that exists |

Options are `--force`, `--parent <id|url>`, `--dry-run`, `--json` and `--all`.

The overwrite prompts have no screen to open on, so the CLI declines them and prints the reason. That makes `cancelled` the normal outcome for a page this vault has not published before; re-run with `--force` once you have looked at the page.

`move` is deliberately separate from `push`. Reorganising is not the same act as publishing, and a page may carry edits or comments this vault has never seen. It uses Confluence's move endpoint, so nothing about the body changes and no new version is created.

## How a note maps to a page

- **Title** comes from the `title` frontmatter property, falling back to the filename. It becomes the Confluence page title.
- **Space** comes from the `confluenceSpace` property, falling back to the default space in settings.
- **Parent** comes from the `confluenceParent` property (page ID or URL), falling back to the default parent in settings. A parent named on the note also **moves** an already-published page; the settings default only applies to pages being created, so it can never drag an existing page somewhere it was not meant to go.
- **Frontmatter itself is never published.** It is metadata for the vault.
- After a successful push, the page URL is written back to the `confluence` property. The page ID is deliberately the last segment of that URL, so anything else reading your notes can take the ID off the end. Confluence's own links end with a slug of the title instead.

On the first push of a note, if a page with the same title already exists in the space, you are asked whether to adopt and replace it rather than create a duplicate. Adopting overwrites a page this vault has never published, so its current content is not backed up locally. If more than one page in the space shares the title, the prompt says so.

## What gets converted

Markdown is converted to Confluence **storage format**, the XHTML that Confluence stores natively, so pages arrive as real Confluence content rather than a code block of Markdown.

| Obsidian | Confluence |
|---|---|
| Headings, lists, tables, quotes | Native equivalents, with table alignment preserved |
| Fenced code blocks | Code macro with the language mapped where Confluence supports it |
| `- [ ]` / `- [x]` | Confluence tasks, complete and incomplete |
| `> [!warning] Title` callouts | Info, note, tip and warning macros, with the title carried over |
| `==highlight==` | Highlighted text |
| `[[Note]]`, `[[Note\|alias]]` | Link to that note's Confluence page if published, otherwise plain text |
| `![[image.png]]`, `![[image.png\|400]]` | Uploaded as a page attachment and embedded, with width honoured |
| `![[file.pdf]]` | Uploaded and linked as an attachment |
| `![](https://...)` | Embedded by URL, not uploaded |
| `![[Another Note]]` | Link to that note's page; Confluence has no transclusion equivalent |
| `%%comments%%` | Removed |
| A leading `# H1` matching the title | Removed, since Confluence already shows the title |

Anything the converter cannot represent produces a warning after the push rather than failing silently. Use **Preview Confluence storage format** to see the warnings before publishing.

Raw HTML is escaped to visible text instead of passed through. Storage format is parsed as XML, so a single unclosed tag would make Confluence reject the whole page; escaping keeps the push working and makes the problem visible on the page. `<br>` and simple inline tags are the exception and pass through as valid XHTML.

## Conflicts and repeat pushes

The plugin records the version number Confluence reported after each push, in `data.json` rather than in your notes.

- If the page is still at that version, pushing updates it silently.
- If the version has moved on, someone edited the page in Confluence. You get a prompt offering to open the page, cancel, or overwrite.
- If there is no record for the note at all, the plugin cannot tell whether the page has been edited, so it prompts before overwriting. This is the normal state for a page that was created outside the plugin, or for any note the first time you push it from a second machine, since `data.json` is local and not synced.
- If the generated markup is identical to the last push, the note is skipped so Confluence does not gain an empty version.
- If the page was deleted in Confluence, a new one is created and you get a warning.

After attachments upload, the page version is re-read from Confluence before it is recorded, so attaching a file does not make the next push look like a conflict.

## Pulling a page back

`pull` answers "what does Confluence hold now". It never writes over a note. The page is saved as a separate `<note>.confluence.md` review copy beside it, for you to read, copy from, and delete.

```bash
.obsidian/plugins/confluence-push/confluence-push pull "Team/Q3 Review.md"
.obsidian/plugins/confluence-push/confluence-push pull --all --dry-run
```

In Obsidian the same thing is **Pull Confluence version of current note for review**, which writes the copy and opens it beside the note.

The copy is not the Markdown you pushed. Confluence renders it back itself, so links return absolute, callouts return as panels, wikilinks are resolved and frontmatter is gone. It differs from your note everywhere, not only where someone edited. That is exactly why it goes in a separate file: written over the note it would churn formatting nobody touched and bury the one paragraph that actually changed.

What gets a copy:

- **drifted**, the version moved since your last push, always.
- **untracked**, no local record so no baseline, only when you name the note. A vault-wide `pull --all` reports these but writes nothing, because "no baseline" is not evidence of a change and copying every one of them would bury the pages that did change.
- **in sync** and **missing** get nothing, unless you pass `--force`.

Review copies carry no `confluence` property, so `push --all` never picks them up and they cannot overwrite the page they came from.

`pull <note> --stdout` prints the page instead, for piping into a diff.

## Comments

**Footer comments**, the stream at the bottom of a page, are separate content that hangs off the page rather than living in its body. Publishing never touches them.

**Inline comments** are anchored to a span of text inside the body, so replacing the body would normally orphan every one of them. Before updating a page, the plugin reads its open inline comments and the markup they are anchored in, then re-attaches each anchor to the same text in the newly converted content.

- Comments on text you have not edited move across silently.
- A comment whose text you have changed or deleted cannot be moved. You are told which ones, quoted, and asked before anything is published.
- Because commenting does not change the page version, this check runs independently of the conflict check above. A page sitting at exactly the version you last pushed can still have collected comments.
- Anchoring uses the surrounding block and the position within it, not just the commented words, so a comment on one instance of a common word stays on that instance.
- A comment spanning formatting boundaries, for example half inside bold text, is reported rather than moved. Wrapping it would split an element and Confluence rejects the whole page.

Turn this off with **Preserve inline comments** in settings.

Renaming or moving a note keeps its link to the page.

**Clear sync state** in settings forgets page IDs and versions. It deletes nothing in Confluence. Notes still carrying a `confluence` URL stay linked to their pages.

## Development

```bash
npm install
npm run dev     # watch build
npm run build   # typecheck, then bundle both main.js and cli.js
npm test        # 131 tests, needs xmllint on PATH
```

The test suite runs the converter and API client outside Obsidian, using a stub for the Obsidian API. Converter output is validated as XML with `xmllint`, which is what catches the malformed-markup failures that make Confluence reject a page.

| File | Responsibility |
|---|---|
| `src/storage.ts` | Markdown to Confluence storage format |
| `src/confluence.ts` | REST client, Confluence v2 API plus v1 for attachments |
| `src/push.ts` | Vault resolution, conflict detection, attachment upload |
| `src/settings.ts` | Settings model and settings tab |
| `src/vault.ts` | Frontmatter lookups shared by the pusher and the plugin entry |
| `src/comments.ts` | Reading inline comment anchors off a page and re-attaching them |
| `src/pull.ts` | Drift states and the review copy written beside a note |
| `src/main.ts` | Plugin entry, commands, menus |
| `src/cli.ts` | Command-line front end |
| `src/node/` | Node stand-ins for the Obsidian API the shared modules use |
